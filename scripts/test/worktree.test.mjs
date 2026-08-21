// node --test scripts/test/worktree.test.mjs — end-to-end against a temp repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'worktree.mjs');

function sh(cwd, cmd, cmdArgs) {
  return execFileSync(cmd, cmdArgs, { cwd, encoding: 'utf8' });
}

function makeRepoWithOrigin(root) {
  const origin = join(root, 'origin.git');
  mkdirSync(origin);
  sh(root, 'git', ['init', '--bare', origin]);
  const repo = join(root, 'app');
  sh(root, 'git', ['clone', origin, repo]);
  sh(repo, 'git', ['config', 'user.email', 't@t']);
  sh(repo, 'git', ['config', 'user.name', 't']);
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  writeFileSync(join(repo, '.env'), 'SECRET=1\n');
  writeFileSync(join(repo, '.env.local'), 'LOCAL=1\n');
  writeFileSync(join(repo, '.gitignore'), '.env*\n');
  sh(repo, 'git', ['add', 'README.md', '.gitignore']);
  sh(repo, 'git', ['commit', '-m', 'init']);
  sh(repo, 'git', ['branch', '-M', 'main']);
  sh(repo, 'git', ['push', '-u', 'origin', 'main']);
  return repo;
}

test('new copies env files and cuts clean from origin/main; remove cleans up', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const repo = makeRepoWithOrigin(root);
  const env = { ...process.env, CLAUDE_WORKSPACE_ROOT: root };

  const out = execFileSync(process.execPath, [script, 'new', repo, 'demo'], { encoding: 'utf8', env });
  const wt = join(root, '.worktrees', 'app-demo');
  assert.ok(existsSync(wt), 'worktree dir exists');
  assert.ok(existsSync(join(wt, '.env')), '.env copied');
  assert.ok(existsSync(join(wt, '.env.local')), '.env.local copied');
  assert.match(out, /branch: {3}feat\/demo/);
  assert.doesNotMatch(out, /WARNING: new branch is not clean/);

  execFileSync(process.execPath, [script, 'remove', wt], { encoding: 'utf8', env });
  assert.ok(!existsSync(wt), 'worktree dir removed');
  const list = sh(repo, 'git', ['worktree', 'list']);
  assert.doesNotMatch(list, /app-demo/);
});

test('.worktreeinclude overrides the default env set', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const repo = makeRepoWithOrigin(root);
  writeFileSync(join(repo, '.worktreeinclude'), '# only this one\n.env.local\n');
  const env = { ...process.env, CLAUDE_WORKSPACE_ROOT: root };

  execFileSync(process.execPath, [script, 'new', repo, 'inc'], { encoding: 'utf8', env });
  const wt = join(root, '.worktrees', 'app-inc');
  assert.ok(existsSync(join(wt, '.env.local')));
  assert.ok(!existsSync(join(wt, '.env')), '.env excluded by .worktreeinclude');
});
