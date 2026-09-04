// node --test scripts/test/land.test.mjs — the claude-config commit lane
// against a temp repo standing in for the main checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'land.mjs');

function sh(cwd, cmd, cmdArgs, input) {
  return execFileSync(cmd, cmdArgs, { cwd, encoding: 'utf8', input });
}

test('start lands only the named path in an ephemeral worktree', () => {
  const root = mkdtempSync(join(tmpdir(), 'land-'));
  const origin = join(root, 'origin.git');
  mkdirSync(origin);
  sh(root, 'git', ['init', '--bare', origin]);
  const cfg = join(root, 'claude-config');
  sh(root, 'git', ['clone', origin, cfg]);
  sh(cfg, 'git', ['config', 'user.email', 't@t']);
  sh(cfg, 'git', ['config', 'user.name', 't']);
  writeFileSync(join(cfg, 'mine.md'), 'v1\n');
  writeFileSync(join(cfg, 'theirs.md'), 'v1\n');
  sh(cfg, 'git', ['add', 'mine.md', 'theirs.md']);
  sh(cfg, 'git', ['commit', '-m', 'init']);
  sh(cfg, 'git', ['branch', '-M', 'main']);
  sh(cfg, 'git', ['push', '-u', 'origin', 'main']);

  // live edits from "two sessions": ours (mine.md) and a concurrent one (theirs.md)
  appendFileSync(join(cfg, 'mine.md'), 'my change\n');
  appendFileSync(join(cfg, 'theirs.md'), 'foreign in-flight edit\n');

  const env = { ...process.env, CLAUDE_WORKSPACE_ROOT: root, CLAUDE_CONFIG_REPO: cfg };
  const out = execFileSync(process.execPath, [script, 'start', 'demo', '-m', 'chore: mine only', '--', 'mine.md'], {
    encoding: 'utf8',
    env,
  });
  assert.match(out, /mine\.md/);
  assert.doesNotMatch(out, /theirs\.md/, 'the concurrent session\'s edit must not be swept in');

  const wt = join(root, '.worktrees', 'claude-config-demo');
  const show = sh(wt, 'git', ['show', '--stat', 'HEAD']);
  assert.match(show, /mine\.md/);
  assert.doesNotMatch(show, /theirs\.md/);

  // finish removes the worktree
  execFileSync(process.execPath, [script, 'finish', 'demo'], { encoding: 'utf8', env });
  assert.ok(!existsSync(wt));
});

test('start lands a file whose last line is blank (patch ends in a lone-space context line)', () => {
  // Regression: lib.mjs's git() trims stdout, and a patch is whitespace-
  // significant. The context line for a blank line is a single space, so a diff
  // whose last changed file ends with a blank line ends with " \n" — trimming
  // that leaves the hunk one line shorter than its own @@ header claims and git
  // reports "corrupt patch at <n>" one line past the end. This cost two
  // workstreams a manual land, and neither the byte-identity nor the CRLF
  // fixtures above can catch it: the content is pure ASCII and applies fine.
  // scratchRepo models the real repo (autocrlf + `* text=auto`); the bug does
  // not reproduce without that setup, which is itself worth knowing.
  const { root, cfg, env } = scratchRepo({ 'doc.md': 'intro\n\n## Your job\n\n' });

  // Edit an EARLIER line, leaving the trailing blank line as trailing context.
  writeFileSync(join(cfg, 'doc.md'), 'intro changed\n\n## Your job\n\n');

  const rawDiff = sh(cfg, 'git', ['diff', '--binary', 'HEAD', '--', 'doc.md']);
  assert.ok(rawDiff.endsWith(' \n'), 'fixture must produce a patch ending in a lone-space context line');
  assert.notEqual(rawDiff, `${rawDiff.trim()}\n`, 'and trimming it must actually change it');

  execFileSync(process.execPath, [script, 'start', 'blankline', '-m', 'chore: blank-line tail', '--', 'doc.md'], {
    encoding: 'utf8',
    env,
  });

  const wt = join(root, '.worktrees', 'claude-config-blankline');
  assert.match(sh(wt, 'git', ['show', '--stat', 'HEAD']), /doc\.md/);
  // Line endings are the checkout's business; what matters is that the trailing
  // blank line survived rather than being eaten with the patch's last line.
  assert.equal(readFileSync(join(wt, 'doc.md'), 'utf8').replace(/\r\n/g, '\n'), 'intro changed\n\n## Your job\n\n');
});

test('start refuses when the main checkout is off main', () => {
  const root = mkdtempSync(join(tmpdir(), 'land-'));
  const origin = join(root, 'origin.git');
  mkdirSync(origin);
  sh(root, 'git', ['init', '--bare', origin]);
  const cfg = join(root, 'claude-config');
  sh(root, 'git', ['clone', origin, cfg]);
  sh(cfg, 'git', ['config', 'user.email', 't@t']);
  sh(cfg, 'git', ['config', 'user.name', 't']);
  writeFileSync(join(cfg, 'a.md'), 'x\n');
  sh(cfg, 'git', ['add', 'a.md']);
  sh(cfg, 'git', ['commit', '-m', 'init']);
  sh(cfg, 'git', ['branch', '-M', 'main']);
  sh(cfg, 'git', ['push', '-u', 'origin', 'main']);
  sh(cfg, 'git', ['checkout', '-b', 'stray']);

  const env = { ...process.env, CLAUDE_WORKSPACE_ROOT: root, CLAUDE_CONFIG_REPO: cfg };
  assert.throws(() =>
    execFileSync(process.execPath, [script, 'start', 'x', '-m', 'm', '--', 'a.md'], { encoding: 'utf8', env }),
  );
});

// --- sync: paths origin/main added that this checkout never tracked -----------
//
// The two scratch repos above use a bare `git init` with no .gitattributes and
// no autocrlf, so content round-trips byte-for-byte. The real claude-config repo
// does not: core.autocrlf=true plus `* text=auto` means every text file is CRLF
// in the worktree and LF in the blob. A sync fix tested only on LF content is a
// permanent no-op on the real checkout, so these fixtures configure it.

function scratchRepo(seedFiles = {}) {
  const root = mkdtempSync(join(tmpdir(), 'land-'));
  const origin = join(root, 'origin.git');
  mkdirSync(origin);
  sh(root, 'git', ['init', '--bare', origin]);

  // Seed origin/main from a plain clone, then check `cfg` out FRESH with
  // autocrlf. The main checkout has to be a tree git itself wrote, so the
  // index stat cache agrees with the CRLF worktree. Hand-writing LF files
  // into an autocrlf repo produces a state git never creates, and in it even
  // a correct sync fails: `git diff` reports no change while the stale stat
  // makes `merge --ff-only` refuse. That is a fixture bug, not a bug worth
  // coding around — build the fixture the way the real checkout exists.
  const seed = join(root, 'seed');
  sh(root, 'git', ['clone', origin, seed]);
  sh(seed, 'git', ['config', 'user.email', 't@t']);
  sh(seed, 'git', ['config', 'user.name', 't']);
  writeFileSync(join(seed, '.gitattributes'), '* text=auto\n');
  sh(seed, 'git', ['add', '.gitattributes']);
  for (const [p, content] of Object.entries(seedFiles)) {
    mkdirSync(dirname(join(seed, p)), { recursive: true });
    writeFileSync(join(seed, p), content);
    sh(seed, 'git', ['add', p]);
  }
  sh(seed, 'git', ['commit', '-m', 'init']);
  sh(seed, 'git', ['branch', '-M', 'main']);
  sh(seed, 'git', ['push', '-u', 'origin', 'main']);

  const cfg = join(root, 'claude-config');
  sh(root, 'git', ['clone', '--branch', 'main', '-c', 'core.autocrlf=true', origin, cfg]);
  sh(cfg, 'git', ['config', 'user.email', 't@t']);
  sh(cfg, 'git', ['config', 'user.name', 't']);
  return { root, origin, cfg, env: { ...process.env, CLAUDE_WORKSPACE_ROOT: root, CLAUDE_CONFIG_REPO: cfg } };
}

/** Land commits on origin/main from a throwaway clone — stands in for a merged PR. */
function pushUpstream(root, origin, files, msg) {
  const up = mkdtempSync(join(root, 'up-'));
  // --branch main explicitly: the bare repo's HEAD is an unborn `master`, so a
  // default clone lands on an empty branch and the push is rejected as behind.
  sh(root, 'git', ['clone', '--branch', 'main', origin, up]);
  sh(up, 'git', ['config', 'user.email', 't@t']);
  sh(up, 'git', ['config', 'user.name', 't']);
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(dirname(join(up, p)), { recursive: true });
    writeFileSync(join(up, p), content);
    sh(up, 'git', ['add', p]);
  }
  sh(up, 'git', ['commit', '-m', msg]);
  sh(up, 'git', ['push', 'origin', 'HEAD:main']);
}

const runSync = (env, files) =>
  execFileSync(process.execPath, [script, 'sync', '--', ...files], { encoding: 'utf8', env });

const headsMatch = (cfg) =>
  sh(cfg, 'git', ['rev-parse', 'HEAD']).trim() === sh(cfg, 'git', ['rev-parse', 'origin/main']).trim();

test('sync adopts an untracked path origin/main added, despite CRLF-vs-LF storage', () => {
  const { root, origin, cfg, env } = scratchRepo();
  pushUpstream(root, origin, { 'hooks/new.mjs': 'alpha\nbeta\n' }, 'feat: add hook');

  // What a merged PR leaves behind here: the same file, untracked, CRLF on disk.
  mkdirSync(join(cfg, 'hooks'), { recursive: true });
  writeFileSync(join(cfg, 'hooks', 'new.mjs'), 'alpha\r\nbeta\r\n');

  // Guard the fixture itself: if these ever agree byte-for-byte the test has
  // stopped exercising normalization and would silently prove nothing.
  const onDisk = readFileSync(join(cfg, 'hooks', 'new.mjs'));
  assert.ok(onDisk.includes('\r\n'), 'fixture must put CRLF on disk');
  sh(cfg, 'git', ['fetch', 'origin']);
  const blob = sh(cfg, 'git', ['cat-file', '-p', 'origin/main:hooks/new.mjs']);
  assert.ok(!blob.includes('\r\n'), 'fixture must keep LF in the blob');
  assert.notEqual(onDisk.length, Buffer.byteLength(blob), 'a byte compare must disagree here');

  runSync(env, ['hooks/new.mjs']);

  sh(cfg, 'git', ['ls-files', '--error-unmatch', 'hooks/new.mjs']);
  assert.ok(headsMatch(cfg), 'checkout should be fast-forwarded to origin/main');
});

test('sync refuses, and destroys nothing, when an untracked path really differs', () => {
  const { root, origin, cfg, env } = scratchRepo();
  pushUpstream(root, origin, { 'hooks/new.mjs': 'upstream version\n' }, 'feat: add hook');

  const mine = join(cfg, 'hooks', 'new.mjs');
  mkdirSync(join(cfg, 'hooks'), { recursive: true });
  writeFileSync(mine, 'my unpushed work\r\n');

  assert.throws(() => runSync(env, ['hooks/new.mjs']));
  // The destructive failure mode this fix could otherwise have introduced.
  assert.ok(existsSync(mine), 'a divergent local file must survive the refusal');
  assert.equal(readFileSync(mine, 'utf8'), 'my unpushed work\r\n');
});

test('sync leaves an untracked path that origin/main does not have alone', () => {
  const { root, origin, cfg, env } = scratchRepo();
  pushUpstream(root, origin, { 'hooks/new.mjs': 'alpha\n' }, 'feat: add hook');

  mkdirSync(join(cfg, 'hooks'), { recursive: true });
  writeFileSync(join(cfg, 'hooks', 'new.mjs'), 'alpha\r\n');
  // Another session's in-flight file — agents/manager.md was exactly this.
  const foreign = join(cfg, 'agents', 'manager.md');
  mkdirSync(join(cfg, 'agents'), { recursive: true });
  writeFileSync(foreign, 'role body in progress\r\n');

  runSync(env, ['hooks/new.mjs', 'agents/manager.md']);

  assert.ok(existsSync(foreign), 'a path origin/main lacks must not be deleted');
  assert.equal(readFileSync(foreign, 'utf8'), 'role body in progress\r\n');
  assert.throws(
    () => sh(cfg, 'git', ['ls-files', '--error-unmatch', 'agents/manager.md']),
    'and it must still be untracked, not swept into the index',
  );
});

test('sync still fast-forwards a tracked path whose live edit matches origin/main', () => {
  const { root, origin, cfg, env } = scratchRepo({ 'a.md': 'v1\n' });
  assert.equal(sh(cfg, 'git', ['status', '--porcelain']).trim(), '', 'fresh checkout must be clean');

  pushUpstream(root, origin, { 'a.md': 'v2\n' }, 'chore: bump a');
  writeFileSync(join(cfg, 'a.md'), 'v2\r\n'); // the live edit that became the PR

  runSync(env, ['a.md']);
  assert.ok(headsMatch(cfg));
});

test('the third failure mode is real: ff-only refuses an incoming path that exists untracked', () => {
  // Pins the git behaviour the fix depends on, so "deleting the local copy
  // first is enough" stays a checked fact rather than an assumption.
  const { root, origin, cfg } = scratchRepo();
  pushUpstream(root, origin, { 'hooks/new.mjs': 'alpha\n' }, 'feat: add hook');
  mkdirSync(join(cfg, 'hooks'), { recursive: true });
  writeFileSync(join(cfg, 'hooks', 'new.mjs'), 'alpha\r\n');
  sh(cfg, 'git', ['fetch', 'origin']);
  assert.throws(() => sh(cfg, 'git', ['merge', '--ff-only', 'origin/main']));
});
