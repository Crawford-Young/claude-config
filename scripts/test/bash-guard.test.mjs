// node --test scripts/test/bash-guard.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { staticCheck, gitTargetRepo, effectiveCwd, clauses, stripMessages } from '../../hooks/bash-guard.mjs';

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

test('gitTargetRepo resolves -C paths and falls back to cwd', () => {
  assert.equal(gitTargetRepo('git -C /repo commit -m x', '/cwd'), '/repo');
  assert.equal(gitTargetRepo('git -C "/re po" commit -m x', '/cwd'), '/re po');
  assert.equal(gitTargetRepo('git commit -m x', '/cwd'), '/cwd');
});

// --- scoping: a flag in one clause is not a flag in another ------------------

test('clauses splits on every shell separator', () => {
  assert.deepEqual(clauses('a && b'), ['a', 'b']);
  assert.deepEqual(clauses('a || b ; c | d & e'), ['a', 'b', 'c', 'd', 'e']);
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

test('effectiveCwd walks leading cd segments', () => {
  assert.equal(effectiveCwd('git commit -m x', '/cwd'), '/cwd');
  assert.equal(effectiveCwd('cd /repo && git commit -m x', '/cwd'), '/repo');
  assert.equal(effectiveCwd('cd "/re po" && git commit -m x', '/cwd'), '/re po');
  assert.equal(effectiveCwd('cd ~/code/web/site && git commit -m x', '/cwd'), join(homedir(), 'code/web/site'));
  // Relative cd resolves against the payload cwd; chained cds compose.
  assert.equal(effectiveCwd('cd web && cd site && git commit -m x', resolve('/code')), resolve('/code/web/site'));
  // A cd AFTER the git call does not move it.
  assert.equal(effectiveCwd('git commit -m x && cd /elsewhere', '/cwd'), '/cwd');
  // No cwd and no absolute cd — stay null so the caller fails open.
  assert.equal(effectiveCwd('git commit -m x', null), null);
});

test('gitTargetRepo honours the cd, and -C still wins over it', () => {
  assert.equal(gitTargetRepo('cd /repo && git commit -m x', '/cwd'), '/repo');
  assert.equal(gitTargetRepo('cd /repo && git -C /other commit -m x', '/cwd'), '/other');
});
