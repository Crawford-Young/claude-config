// node --test scripts/test/bash-guard.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { execHarness } from './_spawn.mjs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  staticCheck,
  gitCalls,
  clauses,
  stripMessages,
  stripHeredocs,
  billedLaunch,
  gatedVerb,
  gatedVerbs,
  isApproving,
  isDeletePush,
  pushGateReason,
  browserCommand,
  substitutions,
} from '../../hooks/bash-guard.mjs';

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
  try {
    execHarness(hookPath, [], { input: JSON.stringify({ tool_input: { command }, cwd: h }), home: h, env: extraEnv });
    return 0;
  } catch (e) {
    return e.status;
  }
}

/** Same as guardRun, but through the real hook entrypoint with a transcript_path
 *  in the payload (rule 8 reads it from there, not from an argument). */
function guardRunT(command, h, transcriptPath, extraEnv = {}) {
  try {
    execHarness(hookPath, [], {
      input: JSON.stringify({ tool_input: { command }, cwd: h, transcript_path: transcriptPath }),
      home: h,
      env: extraEnv,
    });
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

// A repo on main with one commit: commit-on-main only blocks once HEAD exists.
function bornRepo(dir) {
  mkdirSync(dir);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'root']);
}

test('commit-on-main follows the cd to the segment holding the commit', () => {
  const h = tmpHome();
  const app = join(h, 'app');
  const docs = join(h, 'docs');
  for (const r of [app, docs]) bornRepo(r);
  // Starts in a code repo, commits in docs — the docs lane is allowed.
  assert.equal(guardRun(`cd ${app}; git status; cd ${docs} && git commit -m x`, h), 0);
  // Starts in docs, commits in a code repo on main — blocked.
  assert.equal(guardRun(`cd ${docs} && git log; cd ${app} && git commit -m x`, h), 2);
  assert.equal(guardRun(`cd ${app} && git commit -m x`, h), 2);
});

test('commit-on-main allows the root commit in an unborn repo, blocks once HEAD exists', () => {
  const h = tmpHome();
  const app = join(h, 'app');
  mkdirSync(app);
  execFileSync('git', ['init', '-q', '-b', 'main', app]);
  // No commits yet: the root commit (.gitignore first) may land on main.
  assert.equal(guardRun(`cd ${app} && git commit -m root`, h), 0);
  execFileSync('git', ['-C', app, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'root']);
  // HEAD exists now: blocked again.
  assert.equal(guardRun(`cd ${app} && git commit -m next`, h), 2);
  // Same for an unborn master.
  const master = join(h, 'm');
  mkdirSync(master);
  execFileSync('git', ['init', '-q', '-b', 'master', master]);
  assert.equal(guardRun(`cd ${master} && git commit -m root`, h), 0);
});

test('commit words in quoted or heredoc text never trip commit-on-main', () => {
  const h = tmpHome();
  const app = join(h, 'app');
  bornRepo(app);
  assert.equal(guardRun(`cd ${app} && echo "then git commit -m x" >> notes.md`, h), 0);
  assert.equal(guardRun(`cd ${app} && grep -rn "git commit" .`, h), 0);
  assert.equal(guardRun(`cd ${app} && cat > n.md <<'EOF'\ngit commit -m x\nEOF`, h), 0);
  assert.equal(guardRun(`cd ${app} && git log --grep commit`, h), 0);
  // ...but a quoted command a shell will run is still judged.
  assert.equal(guardRun(`cd ${app} && bash -c "git commit -m x"`, h), 2);
});

// --- rule 8: push / gh pr create / gh pr merge need an approving answer -----

test('gatedVerb finds git push and gh pr create/merge, parsed by command word', () => {
  assert.equal(gatedVerb('git push', '/repo'), 'git push');
  assert.equal(gatedVerb('git push -u origin feat/x', '/repo'), 'git push');
  assert.equal(gatedVerb('cd /repo && git push', '/cwd'), 'git push');
  assert.equal(gatedVerb('gh pr create --fill', '/repo'), 'gh pr create');
  assert.equal(gatedVerb('gh pr merge --rebase', '/repo'), 'gh pr merge');
});

test('gatedVerb exempts dry-run pushes and non-gated gh/git calls', () => {
  assert.equal(gatedVerb('git push --dry-run', '/repo'), null);
  assert.equal(gatedVerb('git push --dry-run origin main', '/repo'), null);
  assert.equal(gatedVerb('gh pr view 12', '/repo'), null);
  assert.equal(gatedVerb('git status', '/repo'), null);
  assert.equal(gatedVerb('git pull', '/repo'), null);
});

test('gatedVerb never trips on quoted text or a commit message', () => {
  assert.equal(gatedVerb('echo "git push"', '/repo'), null);
  assert.equal(gatedVerb('git commit -m "git push later"', '/repo'), null);
  assert.equal(gatedVerb('grep -rn "gh pr create" docs', '/repo'), null);
});

/** A throwaway transcript with one AskUserQuestion answer record. */
function transcriptWith(dir, answers, { uuid = 'uuid-1', timestamp = new Date().toISOString() } = {}) {
  const path = join(dir, `t-${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(path, `${JSON.stringify({ type: 'user', uuid, timestamp, toolUseResult: { questions: [], answers } })}\n`);
  return path;
}

function pushGateTmp() {
  const h = mkdtempSync(join(tmpdir(), 'pg-'));
  return { h, stateFile: join(h, 'state.json') };
}

test('push is allowed after an approving answer, then blocked on reuse', () => {
  const { h, stateFile } = pushGateTmp();
  const t = transcriptWith(h, { 'Commit, push and open a PR?': 'Commit + PR (Recommended)' });
  assert.equal(pushGateReason('git push', '/repo', t, stateFile), null);
  assert.ok(pushGateReason('git push', '/repo', t, stateFile));
});

test('one approval covers push, pr create and pr merge exactly once each', () => {
  const { h, stateFile } = pushGateTmp();
  const t = transcriptWith(h, { 'Ship it?': 'Push + open PR' });
  assert.equal(pushGateReason('git push', '/repo', t, stateFile), null);
  assert.equal(pushGateReason('gh pr create --fill', '/repo', t, stateFile), null);
  assert.equal(pushGateReason('gh pr merge --rebase', '/repo', t, stateFile), null);
  // Each verb is single-use even under the same approval.
  assert.ok(pushGateReason('git push', '/repo', t, stateFile));
  assert.ok(pushGateReason('gh pr merge --rebase', '/repo', t, stateFile));
});

test('the latest answer blocks even when an older answer in the same transcript approved', () => {
  const { h, stateFile } = pushGateTmp();
  const path = join(h, 'two.jsonl');
  const older = { type: 'user', uuid: 'u-old', timestamp: '2026-10-01T00:00:00.000Z', toolUseResult: { questions: [], answers: { 'Push?': 'Push + open PR' } } };
  const newer = { type: 'user', uuid: 'u-new', timestamp: '2026-10-02T00:00:00.000Z', toolUseResult: { questions: [], answers: { 'Push?': 'Review first' } } };
  writeFileSync(path, `${JSON.stringify(older)}\n${JSON.stringify(newer)}\n`);
  assert.ok(pushGateReason('git push', '/repo', path, stateFile));
});

test('free-text approval allows, deny wording blocks', () => {
  const { h, stateFile } = pushGateTmp();
  const t1 = transcriptWith(h, { 'Should I proceed?': 'yes go ahead and push it' });
  assert.equal(pushGateReason('git push', '/repo', t1, stateFile), null);

  const { stateFile: stateFile2 } = pushGateTmp();
  const t2 = transcriptWith(h, { 'Should I proceed?': "hold off, don't push yet" });
  assert.ok(pushGateReason('git push', '/repo', t2, stateFile2));
});

test('a missing or unreadable transcript blocks (fail-closed)', () => {
  const { h, stateFile } = pushGateTmp();
  assert.ok(pushGateReason('git push', '/repo', join(h, 'does-not-exist.jsonl'), stateFile));
  assert.ok(pushGateReason('git push', '/repo', undefined, stateFile));
});

test('a transcript with no answer record blocks', () => {
  const { h, stateFile } = pushGateTmp();
  const path = join(h, 'empty.jsonl');
  writeFileSync(path, `${JSON.stringify({ type: 'assistant', uuid: 'a1' })}\n`);
  assert.ok(pushGateReason('git push', '/repo', path, stateFile));
});

test('a non-gated command never consults pushGateReason input at all (gatedVerb short-circuits)', () => {
  // No transcript/state file given at all — if this read the transcript it would throw.
  assert.equal(pushGateReason('gh pr view 12', '/repo', '/no/such/transcript.jsonl', '/no/such/state.json'), null);
  assert.equal(pushGateReason('echo "git push"', '/repo', '/no/such/transcript.jsonl', '/no/such/state.json'), null);
});

test('end-to-end through the real hook: git push is gated and spends its approval once', () => {
  const h = tmpHome();
  const transcriptPath = join(h, 'transcript.jsonl');
  writeFileSync(
    transcriptPath,
    `${JSON.stringify({ type: 'user', uuid: 'e2e-1', timestamp: new Date().toISOString(), toolUseResult: { questions: [], answers: { 'Push it?': 'Push + open PR' } } })}\n`,
  );
  // No approval reachable yet (bad path) — fails closed.
  assert.equal(guardRunT('git push', h, join(h, 'missing.jsonl')), 2);
  // Approving transcript: first push passes, second is blocked (spent).
  assert.equal(guardRunT('git push', h, transcriptPath), 0);
  assert.equal(guardRunT('git push', h, transcriptPath), 2);
  // A non-gated command with the very same transcript is untouched.
  assert.equal(guardRunT('git status', h, transcriptPath), 0);
});

// --- #75 follow-up (a): one gated verb per Bash call ---------------------------

test('a command with more than one gated verb is blocked without spending the approval', () => {
  const { h, stateFile } = pushGateTmp();
  const t = transcriptWith(h, { 'Ship it?': 'Push + open PR' });
  for (const cmd of ['git push; gh pr create --fill', 'git push && git push origin v1', 'gh pr create --fill && gh pr merge --rebase']) {
    const reason = pushGateReason(cmd, '/repo', t, stateFile);
    assert.match(reason || '', /own Bash call/, cmd);
  }
  // Nothing was spent: each verb still passes once on its own.
  assert.equal(pushGateReason('git push', '/repo', t, stateFile), null);
  assert.equal(pushGateReason('gh pr create --fill', '/repo', t, stateFile), null);
});

test('one gated verb next to ungated commands is still a single gated call', () => {
  const { h, stateFile } = pushGateTmp();
  const t = transcriptWith(h, { 'Ship it?': 'Push + open PR' });
  assert.equal(pushGateReason('git status && git push -u origin feat/x', '/repo', t, stateFile), null);
});

// --- #75 follow-up (b): gh global flags before the subcommand -------------------

test('gatedVerb sees gh pr create/merge behind -R / --repo / --repo=', () => {
  assert.equal(gatedVerb('gh -R owner/repo pr merge 12 --rebase', '/repo'), 'gh pr merge');
  assert.equal(gatedVerb('gh --repo owner/repo pr create --fill', '/repo'), 'gh pr create');
  assert.equal(gatedVerb('gh --repo=owner/repo pr merge 12', '/repo'), 'gh pr merge');
  assert.equal(gatedVerb('gh pr -R owner/repo merge 12', '/repo'), 'gh pr merge');
  assert.equal(gatedVerb('gh -R owner/repo pr view 12', '/repo'), null);
});

// --- #75 gate-pipe row: common gate forms piped to tail/head --------------------

test('common gate forms piped to tail/head are blocked', () => {
  assert.ok(staticCheck('pnpm test | tail'));
  assert.ok(staticCheck('npm run lint | head'));
  assert.ok(staticCheck('node --test scripts/test/ | tail -5'));
  assert.ok(staticCheck('pnpm run typecheck 2>&1 | tail -20'));
  assert.ok(staticCheck('npx playwright test | tail'));
  assert.equal(staticCheck('npm run lint'), null);
  assert.equal(staticCheck('node --test scripts/test/'), null);
  assert.equal(staticCheck('node scripts/foo.mjs | head'), null);
});

// --- #75 browser consent: commands that open a visible browser -----------------

test('browserCommand flags playwright forms that open a visible browser', () => {
  for (const cmd of [
    'npx playwright test --headed',
    'pnpm exec playwright test e2e/x.spec.ts --headed',
    'pnpm playwright test --ui',
    'npx playwright codegen http://localhost:3000',
    'npx playwright show-report',
    'playwright open http://localhost:3000',
    'cd web && npx playwright test --headed',
  ]) {
    assert.ok(browserCommand(cmd, '/repo'), cmd);
  }
});

test('headless playwright and mentions of it stay ungated', () => {
  for (const cmd of [
    'npx playwright test',
    'pnpm exec playwright test e2e/x.spec.ts --reporter=line',
    'pnpm e2e',
    'echo "npx playwright test --headed"',
    'grep -rn "playwright codegen" docs',
    'git commit -m "run playwright --headed"',
  ]) {
    assert.equal(browserCommand(cmd, '/repo'), null, cmd);
  }
});

test('end-to-end: a headed playwright run needs a browser answer, then the session is granted', () => {
  const h = tmpHome();
  const stateEnv = { CLAUDE_BROWSER_GATE_STATE: join(h, 'browser.json') };
  const run = (command, transcriptPath, session_id) => {
    try {
      execHarness(hookPath, [], {
        input: JSON.stringify({ tool_input: { command }, cwd: h, transcript_path: transcriptPath, session_id }),
        home: h,
        env: stateEnv,
      });
      return 0;
    } catch (e) {
      return e.status;
    }
  };
  const push = transcriptWith(h, { 'Ship?': 'Push + PR' });
  const browser = transcriptWith(h, { 'Launch the lab?': 'Yes, open Chrome' });
  assert.equal(run('npx playwright test --headed', join(h, 'missing.jsonl'), 's1'), 2); // fail closed
  assert.equal(run('npx playwright test --headed', push, 's1'), 2); // not a browser answer
  assert.equal(run('npx playwright test', push, 's1'), 0); // headless: ungated
  assert.equal(run('npx playwright test --headed', browser, 's1'), 0);
  // Granted for the session: later calls pass even once the latest answer moved on.
  assert.equal(run('npx playwright codegen', push, 's1'), 0);
  // A different session is not granted.
  assert.equal(run('npx playwright codegen', push, 's2'), 2);
});

// --- #92: gated verbs inside command substitution -------------------------------

test('substitutions finds backtick, $(…) and <(…) bodies; single quotes stay literal', () => {
  assert.deepEqual(substitutions('echo $(gh pr merge 5)'), ['gh pr merge 5']);
  assert.deepEqual(substitutions('node -e "x = `gh pr merge 5`"'), ['gh pr merge 5']);
  assert.deepEqual(substitutions('echo "$(a "b)" c)"'), ['a "b)" c']);
  assert.deepEqual(substitutions('diff <(git show a) >(tee x)'), ['git show a', 'tee x']);
  assert.deepEqual(substitutions("echo '$(gh pr merge 5)' '`x`'"), []);
  assert.deepEqual(substitutions('node -e "x = \\`gh pr merge 5\\`"'), []); // escaped backticks are literal
  assert.deepEqual(substitutions('echo $(gh pr merge 5'), ['gh pr merge 5']); // unclosed: rest of line
  assert.deepEqual(substitutions("don't $(x)", true), ['x']); // heredoc body: quotes are text
});

test('clauses keeps a substitution body whole', () => {
  assert.deepEqual(clauses('echo $(git status; gh pr view 5) && ls'), ['echo $(git status; gh pr view 5)', 'ls']);
  assert.deepEqual(clauses('echo `a; b`; c'), ['echo `a; b`', 'c']);
});

test('#92 repro: gated verbs in backticks or $(…) are gated, quoted or not', () => {
  for (const cmd of [
    'node -e "x = `gh pr merge 5 --rebase`"',
    'echo $(gh pr merge 5 --rebase)',
    'echo "$(gh pr merge 5 --rebase)"',
    'x=$(gh pr merge 5 --rebase)',
    'x="$(gh pr merge 5 --rebase)"',
    'echo $(echo $(gh pr merge 5 --rebase))',
    'echo $(git status; gh pr merge 5 --rebase)',
    'diff <(gh pr merge 5 --rebase) x',
    'git commit -m "$(gh pr merge 5 --rebase)"',
    "bash -c 'echo $(gh pr merge 5 --rebase)'",
    'cat > f <<EOF\nline\n$(gh pr merge 5 --rebase)\nEOF',
    "cat > f <<EOF\ndon't `gh pr merge 5 --rebase`\nEOF",
  ]) {
    assert.deepEqual(gatedVerbs(cmd, '/repo'), ['gh pr merge'], cmd);
  }
  assert.deepEqual(gatedVerbs('echo `git push`', '/repo'), ['git push']);
});

test('#92 negative controls: literal substitution text runs nothing', () => {
  for (const cmd of [
    "echo '$(gh pr merge 5 --rebase)'",
    "node -e 'x = `gh pr merge 5 --rebase`'",
    'node -e "x = \\`gh pr merge 5 --rebase\\`"',
    "git commit -m 'fix $(gh pr merge 5)'",
    "cat > f <<'EOF'\n$(gh pr merge 5 --rebase)\nEOF",
    "git commit -m \"$(cat <<'EOF'\ndocs: run `gh pr merge` after review\nEOF\n)\"",
  ]) {
    assert.deepEqual(gatedVerbs(cmd, '/repo'), [], cmd);
  }
});

test('#92: a shell command string is not double-counted', () => {
  assert.deepEqual(gatedVerbs('bash -c "echo $(gh pr merge 5)"', '/repo'), ['gh pr merge']);
  assert.deepEqual(gatedVerbs('eval "$(gh pr merge 5)"', '/repo'), ['gh pr merge']);
});

test('#92 end-to-end through the real hook: substitution forms block without approval', () => {
  const h = tmpHome();
  const missing = join(h, 'missing.jsonl');
  assert.equal(guardRunT('gh pr merge 5 --rebase', h, missing), 2);
  assert.equal(guardRunT('node -e "x = `gh pr merge 5 --rebase`"', h, missing), 2);
  assert.equal(guardRunT('echo $(gh pr merge 5 --rebase)', h, missing), 2);
  assert.equal(guardRunT("echo '$(gh pr merge 5 --rebase)'", h, missing), 0);
});

// --- #88: remote branch deletes accept "delete" wording ------------------------

test('isDeletePush sees --delete, -d and :branch refspecs only', () => {
  assert.ok(isDeletePush('git push origin --delete feat/a feat/b', '/repo'));
  assert.ok(isDeletePush('git push -d origin feat/a', '/repo'));
  assert.ok(isDeletePush('git push origin :feat/a :feat/b', '/repo'));
  assert.equal(isDeletePush('git push origin :feat/a feat/b', '/repo'), false); // also pushes feat/b
  assert.equal(isDeletePush('git push -u origin feat/a', '/repo'), false);
  assert.equal(isDeletePush('git push origin --delete x --dry-run', '/repo'), false);
});

test('#88: a branch delete passes on "delete" wording; a plain push does not', () => {
  const { h, stateFile } = pushGateTmp();
  const t = transcriptWith(h, { 'Delete the 3 merged remote branches?': 'Delete all 3' });
  assert.equal(pushGateReason('git push origin --delete feat/a feat/b feat/c', '/repo', t, stateFile), null);
  const { stateFile: s2 } = pushGateTmp();
  assert.equal(pushGateReason('git push origin :feat/a', '/repo', t, s2), null);
  const { stateFile: s3 } = pushGateTmp();
  assert.ok(pushGateReason('git push -u origin feat/x', '/repo', t, s3));
});

test('#88: "delete" wording is still subject to the deny words', () => {
  const { h, stateFile } = pushGateTmp();
  const t = transcriptWith(h, { 'Delete the merged branches?': "No, don't delete them yet" });
  assert.ok(pushGateReason('git push origin --delete feat/a', '/repo', t, stateFile));
});

// --- #98: the gate-pipe rule reads gate commands, not tool names ---------------

test('#98: non-gate commands that mention a tool name pass', () => {
  for (const cmd of [
    'npm view typescript@6 version | tail -1; npm view lint-staged version | tail -1',
    'npm view vitest version | tail -1',
    'pnpm add -D vitest 2>&1 | tail -5',
    'grep -rn "tsc --noEmit" docs | head',
    'for p in vite vitest; do echo $p; done | head',
    'node --test scripts/test/x.test.mjs > out.txt 2>&1; echo rc=$?; grep fail out.txt | head',
  ]) {
    assert.equal(staticCheck(cmd), null, cmd);
  }
});

test('#98: Rust, just and package-runner gates piped onward are blocked', () => {
  for (const cmd of [
    'cargo clippy --workspace --all-targets -- -D warnings 2>&1 | tail -5; echo EXIT:${PIPESTATUS[0]}',
    'cargo test | tail',
    'cargo +nightly test --workspace | head -20',
    'cargo fmt --all --check | head',
    'just test 2>&1 | grep -E "Passing|Failing"',
    'just typecheck | tail',
    'node --test scripts/test/*.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"',
    'pnpm --filter web test | tail',
    'pnpm exec tsc --noEmit | tail',
    'npx tsc | tee tsc.log',
    'bash -c "pnpm test | tail"',
    'pnpm test |& tail',
  ]) {
    assert.ok(staticCheck(cmd), cmd);
  }
  for (const cmd of ['cargo fmt --all | head', 'cargo build | tail', 'just dev | tail', 'cargo test > out.txt 2>&1']) {
    assert.equal(staticCheck(cmd), null, cmd);
  }
});

test('clauses keeps redirections whole; pipes split only without the pipes flag', () => {
  assert.deepEqual(clauses('pnpm test 2>&1 | tail'), ['pnpm test 2>&1', 'tail']);
  assert.deepEqual(clauses('a &>log && b'), ['a &>log', 'b']);
  assert.deepEqual(clauses('a 2>&1 | b; c & d', true), ['a 2>&1 | b', 'c', 'd']);
});

// --- #96: a negator refuses only the act it negates -----------------------------

test('#96 incident: "…push and pr but … dont know if…" approves the push', () => {
  const { h, stateFile } = pushGateTmp();
  const t = transcriptWith(h, {
    'Ready?': 'looks good commit push and pr but we need to ... dont know if you could cli it ...',
  });
  assert.equal(pushGateReason('git push', '/repo', t, stateFile), null);
});

test('#96: negated acts, leading "no" and hold words still refuse', () => {
  for (const v of [
    "don't push yet",
    'dont push',
    'don’t merge this',
    'do not open a pull request',
    'never push to main',
    'No — found a problem',
    'no, push later',
    'push it, but wait for CI',
    'Review first',
    'Hold the PR',
    "Don't push yet, just commit",
  ]) {
    assert.equal(isApproving({ q: v }), false, v);
  }
  for (const v of ['push, no rush', 'Push + open PR, not sure about the title', 'yes go ahead and push it']) {
    assert.equal(isApproving({ q: v }), true, v);
  }
});

test('#92: the other rules read substitution bodies too', () => {
  assert.ok(staticCheck('echo $(git add -A)'));
  assert.ok(staticCheck('x=`git commit -am wip`'));
  assert.equal(staticCheck("echo '$(git add -A)'"), null);
});
