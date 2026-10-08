// node --test scripts/test/worktree.test.mjs — end-to-end against a temp repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { execHarness } from './_spawn.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function writeSession(sessionsDir, pid, name, nameSource) {
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(join(sessionsDir, `${pid}.json`), JSON.stringify({ pid, name, nameSource }));
}

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
  const env = { CLAUDE_WORKSPACE_ROOT: root };

  const out = execHarness(script, ['new', repo, 'demo'], { encoding: 'utf8', env });
  const wt = join(root, '.worktrees', 'app-demo');
  assert.ok(existsSync(wt), 'worktree dir exists');
  assert.ok(existsSync(join(wt, '.env')), '.env copied');
  assert.ok(existsSync(join(wt, '.env.local')), '.env.local copied');
  assert.match(out, /branch: {3}feat\/demo/);
  assert.doesNotMatch(out, /WARNING: new branch is not clean/);

  execHarness(script, ['remove', wt], { encoding: 'utf8', env });
  assert.ok(!existsSync(wt), 'worktree dir removed');
  const list = sh(repo, 'git', ['worktree', 'list']);
  assert.doesNotMatch(list, /app-demo/);
});

test('.worktreeinclude overrides the default env set', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const repo = makeRepoWithOrigin(root);
  writeFileSync(join(repo, '.worktreeinclude'), '# only this one\n.env.local\n');
  const env = { CLAUDE_WORKSPACE_ROOT: root };

  execHarness(script, ['new', repo, 'inc'], { encoding: 'utf8', env });
  const wt = join(root, '.worktrees', 'app-inc');
  assert.ok(existsSync(join(wt, '.env.local')));
  assert.ok(!existsSync(join(wt, '.env')), '.env excluded by .worktreeinclude');
});

test('new warns when the session name is auto-generated, even if it happens to match', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const repo = makeRepoWithOrigin(root);
  const sessionsDir = join(root, 'sessions');
  writeSession(sessionsDir, '4242', 'app-72', 'auto');
  const env = {
    CLAUDE_WORKSPACE_ROOT: root,
    CLAUDE_SESSIONS_DIR: sessionsDir,
    CLAUDE_PID: '4242',
  };

  const out = execHarness(script, ['new', repo, '72-foo'], { encoding: 'utf8', env });
  assert.match(out, /WARNING: session name 'app-72' is auto-generated/);
  assert.doesNotMatch(out, /doesn't follow/);
  assert.doesNotMatch(out, /statusline/);
  assert.match(out, /\/rename app-72\b/);
});

test('new warns when the user-set session name does not match the convention', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const repo = makeRepoWithOrigin(root);
  const sessionsDir = join(root, 'sessions');
  writeSession(sessionsDir, '4242', 'some-other-name', 'user');
  const env = {
    CLAUDE_WORKSPACE_ROOT: root,
    CLAUDE_SESSIONS_DIR: sessionsDir,
    CLAUDE_PID: '4242',
  };

  const out = execHarness(script, ['new', repo, '72-foo'], { encoding: 'utf8', env });
  assert.match(out, /WARNING: session name 'some-other-name' doesn't follow <repo>-<issue>/);
  assert.doesNotMatch(out, /statusline/);
  assert.match(out, /\/rename app-72\b/);
});

test('new says nothing when the user-set session name already matches', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const repo = makeRepoWithOrigin(root);
  const sessionsDir = join(root, 'sessions');
  writeSession(sessionsDir, '4242', 'app-72', 'user');
  const env = {
    CLAUDE_WORKSPACE_ROOT: root,
    CLAUDE_SESSIONS_DIR: sessionsDir,
    CLAUDE_PID: '4242',
  };

  const out = execHarness(script, ['new', repo, '72-foo'], { encoding: 'utf8', env });
  assert.doesNotMatch(out, /WARNING: session name/);
});

test('new warns on an auto name even when the slug has no issue number, with the generic name', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const repo = makeRepoWithOrigin(root);
  const sessionsDir = join(root, 'sessions');
  writeSession(sessionsDir, '4242', 'whatever', 'auto');
  const env = {
    CLAUDE_WORKSPACE_ROOT: root,
    CLAUDE_SESSIONS_DIR: sessionsDir,
    CLAUDE_PID: '4242',
  };

  const out = execHarness(script, ['new', repo, 'no-number-here'], { encoding: 'utf8', env });
  assert.match(out, /WARNING: session name 'whatever' is auto-generated/);
  assert.match(out, /\/rename app-<issue>/);
  assert.doesNotMatch(out, /undefined|null/);
});

test('new says nothing for a user name when the slug has no issue number', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const repo = makeRepoWithOrigin(root);
  const sessionsDir = join(root, 'sessions');
  writeSession(sessionsDir, '4242', 'whatever', 'user');
  const env = {
    CLAUDE_WORKSPACE_ROOT: root,
    CLAUDE_SESSIONS_DIR: sessionsDir,
    CLAUDE_PID: '4242',
  };

  const out = execHarness(script, ['new', repo, 'no-number-here'], { encoding: 'utf8', env });
  assert.doesNotMatch(out, /WARNING: session name/);
});

test('an auto session with no name never prints undefined', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const repo = makeRepoWithOrigin(root);
  const sessionsDir = join(root, 'sessions');
  writeSession(sessionsDir, '4242', undefined, 'auto');
  const env = {
    CLAUDE_WORKSPACE_ROOT: root,
    CLAUDE_SESSIONS_DIR: sessionsDir,
    CLAUDE_PID: '4242',
  };

  const out = execHarness(script, ['new', repo, '72-foo'], { encoding: 'utf8', env });
  assert.match(out, /WARNING: session/);
  assert.match(out, /\/rename app-72\b/);
  assert.doesNotMatch(out, /undefined/);
});

test('new says nothing when CLAUDE_PID is unset (non-Claude shell)', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const repo = makeRepoWithOrigin(root);
  const sessionsDir = join(root, 'sessions');
  writeSession(sessionsDir, '4242', 'whatever', 'auto');
  const env = { CLAUDE_WORKSPACE_ROOT: root, CLAUDE_SESSIONS_DIR: sessionsDir };

  const out = execHarness(script, ['new', repo, '72-foo'], { encoding: 'utf8', env });
  assert.doesNotMatch(out, /WARNING: session name/);
});

test('new says nothing when the session registry file is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const repo = makeRepoWithOrigin(root);
  const sessionsDir = join(root, 'sessions'); // never written
  const env = {
    CLAUDE_WORKSPACE_ROOT: root,
    CLAUDE_SESSIONS_DIR: sessionsDir,
    CLAUDE_PID: '4242',
  };

  const out = execHarness(script, ['new', repo, '72-foo'], { encoding: 'utf8', env });
  assert.doesNotMatch(out, /WARNING: session name/);
});
