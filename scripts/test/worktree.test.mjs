// node --test scripts/test/worktree.test.mjs — end-to-end against a temp repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { execHarness, spawnHarness } from './_spawn.mjs';
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

test('remove finishes a half-removed worktree: empty dir, no .git pointer', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const dir = join(root, '.worktrees', 'app-half');
  mkdirSync(dir, { recursive: true });

  const out = execHarness(script, ['remove', dir], { encoding: 'utf8', env: { CLAUDE_WORKSPACE_ROOT: root } });
  assert.ok(!existsSync(dir), 'empty directory removed');
  assert.match(out, /half-removed/);
});

test('remove refuses a non-empty dir with no .git pointer, listing what remains', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const dir = join(root, 'not-a-worktree');
  mkdirSync(dir);
  for (let i = 0; i < 12; i++) writeFileSync(join(dir, `file${String(i).padStart(2, '0')}.txt`), 'x');

  const r = spawnHarness(script, ['remove', dir], { env: { CLAUDE_WORKSPACE_ROOT: root } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /file00\.txt/);
  assert.doesNotMatch(r.stderr, /file11\.txt/, 'list is capped');
  assert.match(r.stderr, /and 2 more/);
  assert.ok(existsSync(join(dir, 'file11.txt')), 'nothing deleted');
});

test('remove on a plain file dies and leaves the file', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const file = join(root, 'some-file.txt');
  writeFileSync(file, 'keep me');

  const r = spawnHarness(script, ['remove', file], { env: { CLAUDE_WORKSPACE_ROOT: root } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a directory/);
  assert.ok(existsSync(file), 'file survives');
});

test('bare remove dies with the usage line instead of targeting the cwd', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const r = spawnHarness(script, ['remove'], { cwd: root, env: { CLAUDE_WORKSPACE_ROOT: root } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage: worktree\.mjs remove <worktree-path>/);
  assert.ok(existsSync(root), 'cwd untouched');
});

/**
 * Run `fn` while a child node process holds `dir` as its cwd, then kill it and wait for it
 * to exit. The exit promise exists from spawn time, so a child that already died cannot hang
 * the wait.
 */
async function withHolder(dir, fn) {
  const holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: dir, stdio: 'ignore' });
  const exited = new Promise((res) => holder.once('exit', res));
  holder.on('error', () => {});
  try {
    return await fn();
  } finally {
    if (holder.exitCode === null && holder.signalCode === null) holder.kill();
    await exited;
  }
}

function assertHolderMessage(r) {
  assert.equal(r.status, 1);
  assert.match(r.stderr, /could not delete /);
  assert.match(r.stderr, /Likely holder: a Claude session or shell whose working directory is inside this worktree/);
  assert.match(r.stderr, /cd ~\/code/);
}

// A live process whose cwd is inside the worktree makes the directory delete fail on
// Windows (EPERM/EBUSY); POSIX allows the delete, so these cases only exist there.
const heldOpts = { skip: process.platform !== 'win32' && 'a held cwd only blocks deletion on Windows', timeout: 60_000 };

test('remove names the likely holder when the directory delete fails', heldOpts, async () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const repo = makeRepoWithOrigin(root);
  const env = { CLAUDE_WORKSPACE_ROOT: root };
  execHarness(script, ['new', repo, 'held'], { encoding: 'utf8', env });
  const wt = join(root, '.worktrees', 'app-held');

  await withHolder(wt, () => assertHolderMessage(spawnHarness(script, ['remove', wt], { env })));
});

test('retry on a held, already-unregistered empty dir names the holder and keeps the dir', heldOpts, async () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const dir = join(root, '.worktrees', 'app-retry');
  mkdirSync(dir, { recursive: true });

  await withHolder(dir, () => assertHolderMessage(spawnHarness(script, ['remove', dir], { env: { CLAUDE_WORKSPACE_ROOT: root } })));
  assert.ok(existsSync(dir), 'directory kept');
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
