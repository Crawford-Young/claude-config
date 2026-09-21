// node --test scripts/test/bash-guard.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { staticCheck, gitCalls, clauses, stripMessages, stripHeredocs, billedLaunch } from '../../hooks/bash-guard.mjs';

test('blocks git add -A and flag-order variants', () => {
  assert.ok(staticCheck('git add -A'));
  assert.ok(staticCheck('git add --all'));
  assert.ok(staticCheck('git add -fA'));
  assert.ok(staticCheck('git add -Af .'));
  assert.ok(staticCheck('git -C /x/docs add -A'));
  assert.equal(staticCheck('git add file.ts other.ts'), null);
  assert.equal(staticCheck('git add -p src/a.ts'), null);
});

test('blocks git add . (and ./), not dot-prefixed paths', () => {
  assert.ok(staticCheck('git add .'));
  assert.ok(staticCheck('git add ./'));
  assert.ok(staticCheck('git add . -v'));
  assert.ok(staticCheck('git -C /x/docs add .'));
  assert.ok(staticCheck('git add .env')); // still blocked, but by rule 2 (env files), not this one
  assert.equal(staticCheck('git add .github/workflows/ci.yml'), null);
  assert.equal(staticCheck('git add ./src/file.ts'), null);
  assert.equal(staticCheck('git add .gitignore'), null);
});

test('blocks git commit -a/-am/--all, not -m or -a inside a message', () => {
  assert.ok(staticCheck('git commit -a'));
  assert.ok(staticCheck('git commit -am "wip"'));
  assert.ok(staticCheck('git commit -ma "wip"'));
  assert.ok(staticCheck('git commit --all -m "wip"'));
  assert.equal(staticCheck('git commit -m "wip"'), null);
  assert.equal(staticCheck('git commit -m "add -a flag"'), null);
  assert.equal(staticCheck('git commit --amend -m "wip"'), null);
  assert.equal(staticCheck('git commit --author="A <a@x.com>" -m "wip"'), null);
});

test('blocks env files in git add/commit, allows .env.example', () => {
  assert.ok(staticCheck('git add .env'));
  assert.ok(staticCheck('git add .env.local'));
  assert.ok(staticCheck('git commit --only .env -m x'));
  assert.ok(staticCheck('git add src/.env.production'));
  assert.equal(staticCheck('git add .env.example'), null);
  assert.equal(staticCheck('git add README.md'), null);
  assert.equal(staticCheck('cat .env'), null); // reading is fine
});

test('blocks gate commands piped to tail/head', () => {
  assert.ok(staticCheck('pnpm test | tail -20'));
  assert.ok(staticCheck('just check | head'));
  assert.ok(staticCheck('vitest run src/x.test.ts | tail -n 5'));
  assert.equal(staticCheck('pnpm test'), null);
  assert.equal(staticCheck('ls | head'), null);
});

test('blocks PowerShell content cmdlets', () => {
  assert.ok(staticCheck('Set-Content -Path a.md -Value hi'));
  assert.ok(staticCheck('echo hi | Out-File b.txt'));
  assert.ok(staticCheck('Add-Content x.md y'));
  assert.equal(staticCheck('Get-Content a.md'), null);
});

test('gitCalls resolves -C paths and falls back to cwd', () => {
  assert.equal(gitCalls('git -C /repo commit -m x', '/cwd')[0].repo, '/repo');
  assert.equal(gitCalls('git -C "/re po" commit -m x', '/cwd')[0].repo, '/re po');
  assert.equal(gitCalls('git commit -m x', '/cwd')[0].repo, '/cwd');
});

// --- scoping: a flag in one clause is not a flag in another ------------------

test('clauses splits on every shell separator', () => {
  assert.deepEqual(clauses('a && b'), ['a', 'b']);
  assert.deepEqual(clauses('a || b ; c | d & e'), ['a', 'b', 'c', 'd', 'e']);
});

test('clauses keeps separators inside quotes', () => {
  assert.deepEqual(clauses('echo "a; git commit && b" > f; ls'), ['echo "a; git commit && b" > f', 'ls']);
  assert.deepEqual(clauses("printf '%s|%s' x y && ls"), ["printf '%s|%s' x y", 'ls']);
  // Unbalanced quotes fall back to the plain split rather than swallowing the rest.
  assert.deepEqual(clauses('echo "a; b'), ['echo "a', 'b']);
});

test('the -A rule is scoped to the git add clause', () => {
  // The workspace's own review commands pair a scoped add with an -A grep.
  assert.equal(staticCheck('git add -p src/a.ts && grep -A 3 foo src/a.ts'), null);
  assert.equal(staticCheck('grep -A 5 needle log.txt ; git add src/a.ts'), null);
  assert.equal(staticCheck('tar -A -f a.tar b.tar && git add a.tar'), null);
  // ...but still fires when the flag really is on the add.
  assert.ok(staticCheck('grep -c foo a.ts && git add -A'));
});

test('the commit -a rule is scoped to the git commit clause', () => {
  // grep -a (treat binary as text) is unrelated to git commit --all.
  assert.equal(staticCheck('grep -a foo log.txt && git commit -m "wip"'), null);
  assert.equal(staticCheck('git commit -m "wip" ; grep -a foo log.txt'), null);
  // ...but still fires when the flag really is on the commit.
  assert.ok(staticCheck('grep -a foo log.txt && git commit -a'));
});

// --- scoping: quoted text is data, not a command --------------------------

test('git/cmdlet words in quoted text never trip the static rules', () => {
  assert.equal(staticCheck('grep -rn "git add -A" docs'), null);
  assert.equal(staticCheck("rg 'git add .' hooks"), null);
  assert.equal(staticCheck("echo 'git commit -a' >> notes.md"), null);
  assert.equal(staticCheck('echo "git add .env" > notes.md'), null);
  assert.equal(staticCheck('grep -n "Set-Content" hooks/README.md'), null);
  assert.equal(staticCheck('git add a.ts && cat .env.local'), null); // reading an env file is not staging it
});

test('the static rules still fire on real calls, incl. ones handed to a shell', () => {
  assert.ok(staticCheck('bash -c "git add -A"'));
  assert.ok(staticCheck("pwsh -Command 'git commit -am wip'"));
  assert.ok(staticCheck('cd repo && git add -- .'));
  assert.ok(staticCheck('git add "src/.env.production"'));
  assert.ok(staticCheck("$t = 'x'; $t | Set-Content a.md"));
  assert.ok(staticCheck("pwsh -Command 'Out-File -FilePath a.md -InputObject x'"));
});

// --- scoping: a commit message is prose, not a command -----------------------

test('stripMessages replaces quoted -m payloads only', () => {
  assert.equal(stripMessages('git commit -m "handle .env loading"'), 'git commit -m "MSG"');
  assert.equal(stripMessages("git commit -m 'use Set-Content'"), "git commit -m 'MSG'");
  assert.equal(stripMessages('git commit --message="x"'), 'git commit --message "MSG"');
  assert.equal(stripMessages('git add .env'), 'git add .env');
});

test('commit-message prose does not trip content rules', () => {
  assert.equal(staticCheck('git commit -m "handle .env loading"'), null);
  assert.equal(staticCheck('git commit -m "document Set-Content ban"'), null);
  assert.equal(staticCheck('git commit -m "stop using git add -A"'), null);
  // A real staged path outside the message still blocks.
  assert.ok(staticCheck('git add .env && git commit -m "harmless message"'));
  assert.ok(staticCheck('git commit --only .env -m "harmless message"'));
});

// --- scoping: the shell cd's before git runs ---------------------------------

const repoOf = (cmd, cwd) => gitCalls(cmd, cwd)[0]?.repo;

test('gitCalls walks the cd segments before each git call', () => {
  assert.equal(repoOf('git commit -m x', '/cwd'), '/cwd');
  assert.equal(repoOf('cd /repo && git commit -m x', '/cwd'), '/repo');
  assert.equal(repoOf('cd "/re po" && git commit -m x', '/cwd'), '/re po');
  assert.equal(repoOf('cd ~/code/web/site && git commit -m x', '/cwd'), join(homedir(), 'code/web/site'));
  // Relative cd resolves against the payload cwd; chained cds compose.
  assert.equal(repoOf('cd web && cd site && git commit -m x', resolve('/code')), resolve('/code/web/site'));
  // A cd AFTER the git call does not move it.
  assert.equal(repoOf('git commit -m x && cd /elsewhere', '/cwd'), '/cwd');
  // No cwd and no absolute cd — stay null so the caller fails open.
  assert.equal(repoOf('git commit -m x', null), null);
});

test('each git call gets the cwd of its own segment, not the first git call', () => {
  const calls = gitCalls('cd /cfg; git status; cd /docs && git commit -m x', '/cwd');
  assert.deepEqual(calls.map((c) => [c.sub, c.repo]), [['status', '/cfg'], ['commit', '/docs']]);
  // PowerShell's Set-Location / pushd move the shell too.
  assert.equal(repoOf('Set-Location -Path /repo; git commit -m x', '/cwd'), '/repo');
  assert.equal(repoOf('pushd /repo && git commit -m x', '/cwd'), '/repo');
});

test('-C wins over the cd, and composes with it when relative', () => {
  assert.equal(repoOf('cd /repo && git -C /other commit -m x', '/cwd'), '/other');
  assert.equal(repoOf('cd /code && git -C web commit -m x', '/cwd'), resolve('/code/web'));
});

test('git words in quoted text or as arguments are not git calls', () => {
  assert.deepEqual(gitCalls('echo "git commit -m x" >> notes.md', '/cwd'), []);
  assert.deepEqual(gitCalls("grep -rn 'git commit' hooks", '/cwd'), []);
  assert.deepEqual(gitCalls('echo "cd /x; git commit" > f', '/cwd'), []);
  assert.deepEqual(gitCalls("$msg = @'\ngit commit -m x\n'@", '/cwd'), []);
  // The subcommand is the first non-option word: log --grep commit is a log.
  assert.equal(gitCalls('git log --grep commit', '/cwd')[0].sub, 'log');
  assert.equal(gitCalls('git -c core.x=y -C /r commit -m x', '/cwd')[0].sub, 'commit');
});

test('a quoted command handed to a shell is still a git call', () => {
  assert.equal(repoOf('cd /repo && bash -c "git commit -m x"', '/cwd'), '/repo');
  assert.equal(repoOf("pwsh -Command 'cd /repo; git commit -m x'", '/cwd'), '/repo');
});

// --- scoping: a heredoc body written to a file is data, not commands ---------

test('stripHeredocs drops bodies but keeps the opening and closing lines', () => {
  const cmd = "cat >> notes.md <<'EOF'\nrun git add -A then git commit -a\nEOF\necho done";
  assert.equal(stripHeredocs(cmd), "cat >> notes.md <<'EOF'\nEOF\necho done");
  // <<- allows tab-indented terminators.
  assert.equal(stripHeredocs('cat > f <<-END\n\tgit add .\n\tEND'), 'cat > f <<-END\n\tEND');
  // Unterminated: nothing to strip safely.
  assert.equal(stripHeredocs('cat > f <<EOF\ngit add -A'), 'cat > f <<EOF\ngit add -A');
});

test('heredoc bodies written to files no longer trip the rules', () => {
  assert.equal(staticCheck("cat >> t.mjs <<'EOF'\nassert.ok(staticCheck('git add -A'));\nEOF"), null);
  assert.equal(staticCheck("cat > a.md <<EOF\nnever Set-Content here\nEOF"), null);
  assert.equal(billedLaunch("cat > run.sh <<'EOF'\nclaude --model fable\nEOF"), null);
  // The consuming command itself is still checked.
  assert.ok(staticCheck("git add -A && cat > a <<EOF\nx\nEOF"));
});

test('heredocs fed to an interpreter are still checked — the body runs', () => {
  assert.ok(staticCheck("bash <<'EOF'\ngit add -A\nEOF"));
  assert.ok(staticCheck("sh -s <<EOF\ngit commit -a\nEOF"));
  assert.equal(billedLaunch("bash <<'EOF'\nclaude --model fable\nEOF"), 'fable');
});

// --- rule 7: shell-launched claude on a billed model -------------------------

test('billedLaunch catches --model, --model= and env-set billed models', () => {
  assert.equal(billedLaunch('claude -p "hi" --model fable'), 'fable');
  assert.equal(billedLaunch('claude --bg --model=claude-fable-5-1'), 'claude-fable-5-1');
  assert.equal(billedLaunch('claude agents --model "mythos"'), 'mythos');
  assert.equal(billedLaunch('ANTHROPIC_MODEL=fable claude -p x'), 'fable');
  assert.equal(billedLaunch("$env:ANTHROPIC_MODEL = 'claude-fable-5-1'; claude -p x"), 'claude-fable-5-1');
  assert.equal(billedLaunch('& "C:\\bin\\claude.exe" --model fable'), 'fable');
  assert.equal(billedLaunch('npx claude --model FABLE'), 'fable');
});

test('billedLaunch ignores non-billed models and non-claude commands', () => {
  assert.equal(billedLaunch('claude -p x --model opus'), null);
  assert.equal(billedLaunch('claude -p x'), null);
  assert.equal(billedLaunch('grep -rn fable claude-config/hooks'), null);
  assert.equal(billedLaunch('cat ~/.claude/fable-dispatch.log'), null);
  assert.equal(billedLaunch('node scripts/run.mjs --model fable'), null);
  assert.equal(billedLaunch('git commit -m "gate claude --model fable"'), null);
});

const hookPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks', 'bash-guard.mjs');

/** A throwaway HOME so the marker and dispatch log are never the real ones. */
function tmpHome() {
  const h = mkdtempSync(join(tmpdir(), 'bg-'));
  mkdirSync(join(h, '.claude'), { recursive: true });
  return h;
}

function guardRun(command, h, extraEnv = {}) {
  const env = { ...process.env, HOME: h, USERPROFILE: h, CLAUDE_WORKSPACE_ROOT: join(h, 'code'), ...extraEnv };
  try {
    execFileSync(process.execPath, [hookPath], { input: JSON.stringify({ tool_input: { command }, cwd: h }), env, encoding: 'utf8' });
    return 0;
  } catch (e) {
    return e.status;
  }
}

test('a billed shell launch spends the single-use marker and logs it', () => {
  const h = tmpHome();
  const marker = join(h, '.claude', 'fable-clearance.json');
  assert.equal(guardRun('claude -p x --model fable', h), 2); // no marker
  writeFileSync(marker, JSON.stringify({ granted: new Date().toISOString() }));
  assert.equal(guardRun('claude -p x --model fable', h), 0);
  assert.equal(existsSync(marker), false);
  assert.equal(guardRun('claude -p x --model fable', h), 2); // spent
  const log = readFileSync(join(h, '.claude', 'fable-dispatch.log'), 'utf8');
  assert.match(log, /BLOCK shell model=fable[\s\S]*ALLOW shell model=fable[\s\S]*BLOCK shell/);
});

test('an expired marker blocks, and a non-billed launch never spends one', () => {
  const h = tmpHome();
  const marker = join(h, '.claude', 'fable-clearance.json');
  writeFileSync(marker, JSON.stringify({ granted: new Date(Date.now() - 31 * 60 * 1000).toISOString() }));
  assert.equal(guardRun('claude --model fable', h), 2);
  writeFileSync(marker, JSON.stringify({ granted: new Date().toISOString() }));
  assert.equal(guardRun('claude -p x --model opus', h), 0);
  assert.equal(existsSync(marker), true);
});

// --- rule 6: the claude-config main checkout never restores files ------------

test('file restores are blocked on the claude-config main checkout, not elsewhere', () => {
  const h = tmpHome();
  const cfg = join(h, 'cfg');
  const other = join(h, 'other');
  for (const r of [cfg, other]) {
    mkdirSync(r);
    execFileSync('git', ['init', '-q', '-b', 'main', r]);
  }
  const env = { CLAUDE_CONFIG_REPO: cfg };
  for (const c of ['git checkout -- scripts/land.mjs', 'git checkout .', 'git restore hooks/a.mjs', 'git restore --staged --worktree a']) {
    assert.equal(guardRun(`cd ${cfg} && ${c}`, h, env), 2, c);
  }
  // Unstaging only touches the index — allowed.
  assert.equal(guardRun(`cd ${cfg} && git restore --staged a.mjs`, h, env), 0);
  // Any other repo keeps its restores.
  assert.equal(guardRun(`cd ${other} && git checkout -- a.mjs`, h, env), 0);
  assert.equal(guardRun(`cd ${other} && git restore a.mjs`, h, env), 0);
});

// --- rule 5: commit-on-main judges the repo each commit really runs in -----

test('commit-on-main follows the cd to the segment holding the commit', () => {
  const h = tmpHome();
  const app = join(h, 'app');
  const docs = join(h, 'docs');
  for (const r of [app, docs]) {
    mkdirSync(r);
    execFileSync('git', ['init', '-q', '-b', 'main', r]);
  }
  // Starts in a code repo, commits in docs — the docs lane is allowed.
  assert.equal(guardRun(`cd ${app}; git status; cd ${docs} && git commit -m x`, h), 0);
  // Starts in docs, commits in a code repo on main — blocked.
  assert.equal(guardRun(`cd ${docs} && git log; cd ${app} && git commit -m x`, h), 2);
  assert.equal(guardRun(`cd ${app} && git commit -m x`, h), 2);
});

test('commit words in quoted or heredoc text never trip commit-on-main', () => {
  const h = tmpHome();
  const app = join(h, 'app');
  mkdirSync(app);
  execFileSync('git', ['init', '-q', '-b', 'main', app]);
  assert.equal(guardRun(`cd ${app} && echo "then git commit -m x" >> notes.md`, h), 0);
  assert.equal(guardRun(`cd ${app} && grep -rn "git commit" .`, h), 0);
  assert.equal(guardRun(`cd ${app} && cat > n.md <<'EOF'\ngit commit -m x\nEOF`, h), 0);
  assert.equal(guardRun(`cd ${app} && git log --grep commit`, h), 0);
  // ...but a quoted command a shell will run is still judged.
  assert.equal(guardRun(`cd ${app} && bash -c "git commit -m x"`, h), 2);
});
