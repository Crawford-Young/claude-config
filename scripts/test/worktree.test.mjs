// node --test scripts/test/worktree.test.mjs — end-to-end against a temp repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { execHarness, spawnHarness } from './_spawn.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { commitlintConfig, isHuskyRepo, servePorts } from '../worktree.mjs';

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
  assert.match(out, /launch: {3}claude -n general-demo\n/, 'no issue number: a general launch line');
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
 * to exit (or, with `lifetimeMs`, it exits by itself after that long). The exit promise exists
 * from spawn time, so a child that already died cannot hang
 * the wait.
 */
async function withHolder(dir, fn, lifetimeMs = 0) {
  const hold = lifetimeMs ? `setTimeout(() => {}, ${lifetimeMs})` : 'setInterval(() => {}, 1000)';
  const holder = spawn(process.execPath, ['-e', hold], { cwd: dir, stdio: 'ignore' });
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

test('remove retries a pinned-dir EPERM until the holder exits', heldOpts, async () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const repo = makeRepoWithOrigin(root);
  const env = { CLAUDE_WORKSPACE_ROOT: root };
  execHarness(script, ['new', repo, 'pinned'], { encoding: 'utf8', env });
  const wt = join(root, '.worktrees', 'app-pinned');

  // The holder lets go on its own 1.5 s in, while remove's retries are still running.
  await withHolder(wt, () => {
    const r = spawnHarness(script, ['remove', wt], { env });
    assert.equal(r.status, 0, r.stderr);
  }, 1500);
  assert.ok(!existsSync(wt), 'worktree dir removed once the holder exited');
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
  assert.doesNotMatch(out, /names another unit|no type/);
  assert.doesNotMatch(out, /statusline/);
  assert.match(out, /claude -n ticket-app-72\n/);
  assert.match(out, /\/rename ticket-app-72\b/);
});

test('new prints the ticket launch line from the slug or the branch number', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const repo = makeRepoWithOrigin(root);
  const env = { CLAUDE_WORKSPACE_ROOT: root };
  assert.match(execHarness(script, ['new', repo, '72-foo'], { encoding: 'utf8', env }), /launch: {3}claude -n ticket-app-72\n/);
  assert.match(execHarness(script, ['new', repo, 'bar', '--branch', 'feat/88-bar'], { encoding: 'utf8', env }), /launch: {3}claude -n ticket-app-88\n/);
});

test('new normalizes a leading-zero issue number and treats 0 as no number, never throwing mid-new', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const repo = makeRepoWithOrigin(root);
  const env = { CLAUDE_WORKSPACE_ROOT: root };
  const z = spawnHarness(script, ['new', repo, '007-foo'], { env });
  assert.equal(z.status, 0, z.stderr);
  assert.match(z.stdout, /launch: {3}claude -n ticket-app-7\n/);
  const zero = spawnHarness(script, ['new', repo, '0-foo'], { env });
  assert.equal(zero.status, 0, zero.stderr);
  assert.match(zero.stdout, /launch: {3}claude -n general-0-foo\n/);
});

test('a director, or an epic of this repo, gets the child launch line and no warning', () => {
  for (const name of ['director-harness', 'epic-app-40']) {
    const root = mkdtempSync(join(tmpdir(), 'wt-'));
    const repo = makeRepoWithOrigin(root);
    const sessionsDir = join(root, 'sessions');
    writeSession(sessionsDir, '4242', name, 'user');
    const env = { CLAUDE_WORKSPACE_ROOT: root, CLAUDE_SESSIONS_DIR: sessionsDir, CLAUDE_PID: '4242' };

    const out = execHarness(script, ['new', repo, '72-foo'], { encoding: 'utf8', env });
    assert.match(out, /launch: {3}claude -n ticket-app-72\n/, name);
    assert.doesNotMatch(out, /WARNING|\/rename/, name);
  }
});

test('a long slug with no number gives the same general name as the CLI (4-word cap)', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const repo = makeRepoWithOrigin(root);
  const out = execHarness(script, ['new', repo, 'one-two-three-four-five'], { encoding: 'utf8', env: { CLAUDE_WORKSPACE_ROOT: root } });
  assert.match(out, /launch: {3}claude -n general-one-two-three-four\n/);
});

test('new survives a null session registry entry', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const repo = makeRepoWithOrigin(root);
  const sessionsDir = join(root, 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(join(sessionsDir, '4242.json'), 'null');
  const r = spawnHarness(script, ['new', repo, '72-foo'], { env: { CLAUDE_WORKSPACE_ROOT: root, CLAUDE_SESSIONS_DIR: sessionsDir, CLAUDE_PID: '4242' } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /launch: {3}claude -n ticket-app-72\n/);
});

test('new warns when the user-set session name has no type', () => {
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
  assert.match(out, /WARNING: session name 'some-other-name' has no type/);
  assert.doesNotMatch(out, /statusline/);
  assert.match(out, /claude -n ticket-app-72\n/);
  assert.match(out, /\/rename ticket-app-72\b/);
});

test('new says nothing when the session name is this unit, as a typed or legacy ticket or an epic', () => {
  for (const [name, source] of [['app-72', 'user'], ['ticket-app-72', 'user'], ['epic-app-72', 'peer'], ['ticket-app-72', undefined], ['ticket-app-72', 'auto'], ['Ticket-App-72', 'derived']]) {
    const root = mkdtempSync(join(tmpdir(), 'wt-'));
    const repo = makeRepoWithOrigin(root);
    const sessionsDir = join(root, 'sessions');
    writeSession(sessionsDir, '4242', name, source);
    const env = { CLAUDE_WORKSPACE_ROOT: root, CLAUDE_SESSIONS_DIR: sessionsDir, CLAUDE_PID: '4242' };

    const out = execHarness(script, ['new', repo, '72-foo'], { encoding: 'utf8', env });
    assert.doesNotMatch(out, /WARNING: session/, name);
  }
});

test('new warns, never blocks, when the session names another unit', () => {
  for (const name of ['ticket-app-73', 'ticket-other-72', 'epic-other-72']) {
    const root = mkdtempSync(join(tmpdir(), 'wt-'));
    const repo = makeRepoWithOrigin(root);
    const sessionsDir = join(root, 'sessions');
    writeSession(sessionsDir, '4242', name, 'user');
    const env = { CLAUDE_WORKSPACE_ROOT: root, CLAUDE_SESSIONS_DIR: sessionsDir, CLAUDE_PID: '4242' };

    const out = execHarness(script, ['new', repo, '72-foo'], { encoding: 'utf8', env });
    assert.match(out, new RegExp(`WARNING: session name '${name}' names another unit`), name);
    assert.match(out, /claude -n ticket-app-72\n/, name);
    assert.ok(existsSync(join(root, '.worktrees', 'app-72-foo')), 'the worktree is still made');
  }
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
  assert.match(out, /claude -n general-no-number-here\n/);
  assert.match(out, /\/rename general-no-number-here\b/);
  assert.doesNotMatch(out, /undefined|null/);
});

test('with no issue number in the slug, any typed name passes and an untyped one warns', () => {
  for (const [name, warns] of [['director-harness', false], ['general-cleanup', false], ['ticket-app-9', false], ['whatever', true]]) {
    const root = mkdtempSync(join(tmpdir(), 'wt-'));
    const repo = makeRepoWithOrigin(root);
    const sessionsDir = join(root, 'sessions');
    writeSession(sessionsDir, '4242', name, 'user');
    const env = { CLAUDE_WORKSPACE_ROOT: root, CLAUDE_SESSIONS_DIR: sessionsDir, CLAUDE_PID: '4242' };

    const out = execHarness(script, ['new', repo, 'no-number-here'], { encoding: 'utf8', env });
    if (warns) assert.match(out, /WARNING: session name 'whatever' has no type[\s\S]*claude -n general-no-number-here\n/);
    else assert.doesNotMatch(out, /WARNING: session/, name);
  }
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
  assert.match(out, /\/rename ticket-app-72\b/);
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

// ---- prepush: commitlint over origin/<base>..HEAD (#170) ----

/** A stand-in @commitlint/cli under `dir`: fails any subject in `git log from..to` that isn't
 *  a lowercase conventional one, and echoes the range and cwd it ran with. */
function fakeCommitlint(dir) {
  const pkg = join(dir, 'node_modules', '@commitlint', 'cli');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@commitlint/cli', bin: { commitlint: './cli.js' } }));
  writeFileSync(join(pkg, 'cli.js'), `
const { execFileSync } = require('node:child_process');
const a = process.argv.slice(2);
const from = a[a.indexOf('--from') + 1];
const to = a[a.indexOf('--to') + 1];
console.log('range ' + from + '..' + to.slice(0, 7) + ' cwd ' + process.cwd());
const subjects = execFileSync('git', ['log', '--format=%s', from + '..' + to], { encoding: 'utf8' }).split('\\n').filter(Boolean);
const bad = subjects.filter((s) => !/^[a-z]+(\\(.+\\))?: [a-z]/.test(s));
for (const s of bad) console.log('x subject-case: ' + s);
process.exit(bad.length ? 1 : 0);
`);
}

function commitIn(wt, file, msg) {
  writeFileSync(join(wt, file), `${msg}\n`);
  sh(wt, 'git', ['add', file]);
  sh(wt, 'git', ['commit', '-m', msg]);
}

test('prepush skips a checkout with no commitlint config', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const repo = makeRepoWithOrigin(root);
  const env = { CLAUDE_WORKSPACE_ROOT: root };
  execHarness(script, ['new', repo, 'nolint'], { env });
  const wt = join(root, '.worktrees', 'app-nolint');
  commitIn(wt, 'a.txt', 'Not Conventional At All');

  const r = spawnHarness(script, ['prepush', wt], { env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /commitlint: no config in .* skipped/);
});

test('prepush blocks a bad subject over origin/main..HEAD and passes once it is reworded', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const repo = makeRepoWithOrigin(root);
  const env = { CLAUDE_WORKSPACE_ROOT: root };
  execHarness(script, ['new', repo, 'lint'], { env });
  const wt = join(root, '.worktrees', 'app-lint');
  writeFileSync(join(wt, 'commitlint.config.js'), "module.exports = { extends: ['@commitlint/config-conventional'] };\n");
  fakeCommitlint(wt);

  assert.match(execHarness(script, ['prepush', wt], { env }), /commitlint: no commits over origin\/main\.\.HEAD/);

  commitIn(wt, 'a.txt', 'feat: good one');
  commitIn(wt, 'b.txt', 'feat(hud): HIT/MISS readout'); // the dog-eat-dog#23 subject-case failure
  const bad = spawnHarness(script, ['prepush', wt], { env });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /commitlint failed over origin\/main\.\.HEAD/);
  assert.match(bad.stderr, /range origin\/main\.\.[0-9a-f]{7}/);
  assert.match(bad.stderr, /subject-case: feat\(hud\): HIT\/MISS readout/);
  assert.doesNotMatch(bad.stderr, /subject-case: (feat: good one|init)/, 'only the range is linted');

  sh(wt, 'git', ['commit', '--amend', '-m', 'feat(hud): hit/miss readout']);
  const good = spawnHarness(script, ['prepush', wt], { env });
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /commitlint: 2 commits clean over origin\/main\.\.HEAD \(commitlint\.config\.js\)/);
});

test('prepush fails closed with commitlint uninstalled, and borrows the main checkout install', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const repo = makeRepoWithOrigin(root);
  const env = { CLAUDE_WORKSPACE_ROOT: root };
  execHarness(script, ['new', repo, 'borrow'], { env });
  const wt = join(root, '.worktrees', 'app-borrow');
  writeFileSync(join(wt, 'package.json'), JSON.stringify({ commitlint: { extends: ['@commitlint/config-conventional'] } }));
  commitIn(wt, 'a.txt', 'fix: one');

  const none = spawnHarness(script, ['prepush', wt], { env });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /commitlint config package\.json found but @commitlint\/cli is not installed/);

  fakeCommitlint(repo);
  const borrowed = spawnHarness(script, ['prepush', wt], { env });
  assert.equal(borrowed.status, 0, borrowed.stderr);
  assert.match(borrowed.stdout, /cwd .*app\s*$/m, 'ran from the main checkout');
  assert.match(borrowed.stdout, /1 commit clean over origin\/main\.\.HEAD \(package\.json\)/);
});

// ---- remove: stop the serve-port listener first (#170) ----

test('servePorts reads serve-type Justfile recipes and package.json scripts only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-ports-'));
  writeFileSync(join(dir, 'Justfile'), [
    'port := "1234"',
    'set shell := ["bash", "-c"]',
    '',
    '# run the game',
    'run:',
    '    godot --path . -p 1111',
    '',
    '# serve the web build locally',
    'serve:',
    '    npx serve build/web -p 8060',
    '',
    'deploy host:',
    '    ssh -p 22 {{host}}',
  ].join('\r\n'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    scripts: { dev: 'next dev --port 3001', preview: 'vite preview --port=4173', start: 'PORT=5000 node server.js', test: 'vitest -p 9999' },
  }));
  assert.deepEqual(servePorts(dir), [3001, 4173, 5000, 8060]);
  assert.deepEqual(servePorts(mkdtempSync(join(tmpdir(), 'wt-ports-'))), [], 'no Justfile or package.json');
  assert.equal(commitlintConfig(dir), null, 'package.json with no commitlint key');
});

/** An OS-assigned free port, so concurrent suites never bind the same one. */
function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

/** A node server on `port` with `cwd` as its working directory, like the `npx serve` left behind. */
async function startListener(cwd, port) {
  const child = spawn(process.execPath, ['-e', `require('node:http').createServer().listen(${port}, () => console.log('up'))`], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise((res) => child.once('exit', res));
  child.on('error', () => {});
  await new Promise((res, rej) => {
    child.stdout.once('data', res);
    child.once('exit', (code) => rej(new Error(`listener exited ${code} before listening on ${port}`)));
  });
  return { child, exited };
}

const lsofMissing = process.platform !== 'win32' && spawnSync('lsof', ['-v']).error;
test('remove --dry-run names the serve-port listener; remove stops it, then removes the worktree', { skip: lsofMissing && 'lsof not installed', timeout: 60_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const repo = makeRepoWithOrigin(root);
  const env = { CLAUDE_WORKSPACE_ROOT: root };
  execHarness(script, ['new', repo, 'serve'], { env });
  const wt = join(root, '.worktrees', 'app-serve');
  const port = await freePort();
  writeFileSync(join(wt, 'Justfile'), `serve:\n    npx serve build/web -p ${port}\n`);

  const { child, exited } = await startListener(wt, port);
  try {
    const dry = execHarness(script, ['remove', wt, '--dry-run'], { env });
    assert.match(dry, new RegExp(`would stop \\S+ \\(PID \\d+\\) listening on port ${port}`));
    assert.match(dry, /would remove /);
    assert.ok(existsSync(wt), 'dry run removes nothing');
    assert.equal(child.exitCode, null, 'dry run stops nothing');

    const out = execHarness(script, ['remove', wt], { env });
    assert.match(out, new RegExp(`stopped \\S+ \\(PID ${child.pid}\\) listening on port ${port}`));
    await exited;
    assert.ok(!existsSync(wt), 'worktree dir removed');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  }
});

test('remove --port rejects a value that is not a port', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  const repo = makeRepoWithOrigin(root);
  const env = { CLAUDE_WORKSPACE_ROOT: root };
  execHarness(script, ['new', repo, 'badport'], { env });
  const wt = join(root, '.worktrees', 'app-badport');

  const r = spawnHarness(script, ['remove', wt, '--port', '80x'], { env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--port needs a port number/);
  assert.ok(existsSync(wt), 'nothing removed');
});

test('isHuskyRepo detects the prepare script or a core.hooksPath under .husky/', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-husky-'));
  const repo = makeRepoWithOrigin(root);
  assert.equal(isHuskyRepo(repo), false, 'plain repo');
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { prepare: 'husky' } }));
  assert.equal(isHuskyRepo(repo), true, 'prepare: husky');
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { prepare: 'lefthook install' } }));
  assert.equal(isHuskyRepo(repo), false, 'another hook manager');
  sh(repo, 'git', ['config', 'core.hooksPath', '.husky/_']);
  assert.equal(isHuskyRepo(repo), true, 'hooksPath under .husky/');
});

test('new copies the main checkout husky stubs so commit-msg runs, or warns loudly when it has none', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-husky-'));
  const repo = makeRepoWithOrigin(root);
  const env = { CLAUDE_WORKSPACE_ROOT: root };
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { prepare: 'husky' } }));
  sh(repo, 'git', ['add', 'package.json']);
  sh(repo, 'git', ['commit', '-m', 'add husky']);
  sh(repo, 'git', ['push', 'origin', 'main']);

  // main checkout never ran `husky`: nothing to copy, so the warning names the fix
  const bare = execHarness(script, ['new', repo, 'nostubs'], { encoding: 'utf8', env });
  assert.match(bare, /WARNING: husky repo.*pnpm install/);
  assert.ok(!existsSync(join(root, '.worktrees', 'app-nostubs', '.husky', '_')));

  mkdirSync(join(repo, '.husky', '_'), { recursive: true });
  writeFileSync(join(repo, '.husky', '_', 'commit-msg'), '#!/usr/bin/env sh\n. "$(dirname "$0")/h"');
  writeFileSync(join(repo, '.husky', '_', 'h'), '#!/usr/bin/env sh\n');
  const out = execHarness(script, ['new', repo, 'stubs'], { encoding: 'utf8', env });
  const wt = join(root, '.worktrees', 'app-stubs');
  assert.ok(existsSync(join(wt, '.husky', '_', 'commit-msg')), 'commit-msg stub copied');
  assert.ok(existsSync(join(wt, '.husky', '_', 'h')), 'h copied');
  assert.match(out, /husky:\s+copied/);
  assert.doesNotMatch(out, /WARNING: husky/);
});
