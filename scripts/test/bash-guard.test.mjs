// node --test scripts/test/bash-guard.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { staticCheck, gitTargetRepo } from '../../hooks/bash-guard.mjs';

test('blocks git add -A and flag-order variants', () => {
  assert.ok(staticCheck('git add -A'));
  assert.ok(staticCheck('git add --all'));
  assert.ok(staticCheck('git add -fA'));
  assert.ok(staticCheck('git add -Af .'));
  assert.ok(staticCheck('git -C /x/docs add -A'));
  assert.equal(staticCheck('git add file.ts other.ts'), null);
  assert.equal(staticCheck('git add -p src/a.ts'), null);
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
