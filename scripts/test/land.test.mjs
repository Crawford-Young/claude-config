// node --test scripts/test/land.test.mjs — the claude-config commit lane
// against a temp repo standing in for the main checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { execHarness, spawnHarness, tempDir } from './_spawn.mjs';
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'land.mjs');

function sh(cwd, cmd, cmdArgs, input) {
  return execFileSync(cmd, cmdArgs, { cwd, encoding: 'utf8', input });
}

test('start lands only the named path in an ephemeral worktree', () => {
  const root = tempDir('land-');
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

  const env = { CLAUDE_WORKSPACE_ROOT: root, CLAUDE_CONFIG_REPO: cfg };
  const out = execHarness(script, ['start', 'demo', '-m', 'chore: mine only', '--', 'mine.md'], {
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
  execHarness(script, ['finish', 'demo'], { encoding: 'utf8', env });
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
  // scratchRepo models the real repo's line-ending config; when this was
  // written (autocrlf + `* text=auto`, CRLF checkouts) the bug did not
  // reproduce without that setup, which is itself worth knowing.
  const { root, cfg, env } = scratchRepo({ 'doc.md': 'intro\n\n## Your job\n\n' });

  // Edit an EARLIER line, leaving the trailing blank line as trailing context.
  writeFileSync(join(cfg, 'doc.md'), 'intro changed\n\n## Your job\n\n');

  const rawDiff = sh(cfg, 'git', ['diff', '--binary', 'HEAD', '--', 'doc.md']);
  assert.ok(rawDiff.endsWith(' \n'), 'fixture must produce a patch ending in a lone-space context line');
  assert.notEqual(rawDiff, `${rawDiff.trim()}\n`, 'and trimming it must actually change it');

  execHarness(script, ['start', 'blankline', '-m', 'chore: blank-line tail', '--', 'doc.md'], {
    encoding: 'utf8',
    env,
  });

  const wt = join(root, '.worktrees', 'claude-config-blankline');
  assert.match(sh(wt, 'git', ['show', '--stat', 'HEAD']), /doc\.md/);
  // Line endings are the checkout's business; what matters is that the trailing
  // blank line survived rather than being eaten with the patch's last line.
  assert.equal(readFileSync(join(wt, 'doc.md'), 'utf8').replace(/\r\n/g, '\n'), 'intro changed\n\n## Your job\n\n');
});

// --- finish: worktree + branch cleanup after a merged (or not-yet-merged) PR --
//
// PRs merge via "Rebase and merge", so a merged branch's commits are never
// ancestors of origin/main — only patch-equivalent to a commit main now has.
// `git cherry origin/main <branch>` is what tells the two apart from `merge
// --is-ancestor`. CLAUDE_LAND_NO_GH forces the cherry fallback so these tests
// never depend on the real `gh` CLI or a real PR existing.

function initOrigin(root) {
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
  return { origin, cfg };
}

test('finish deletes a rebase-merged branch locally and on the remote', () => {
  const root = tempDir('land-');
  const { origin, cfg } = initOrigin(root);
  const env = { CLAUDE_WORKSPACE_ROOT: root, CLAUDE_CONFIG_REPO: cfg, CLAUDE_LAND_NO_GH: '1' };

  appendFileSync(join(cfg, 'a.md'), 'my change\n');
  execHarness(script, ['start', 'demo', '-m', 'chore: my change', '--', 'a.md'], {
    encoding: 'utf8',
    env,
  });
  const wt = join(root, '.worktrees', 'claude-config-demo');
  sh(wt, 'git', ['push', '-u', 'origin', 'chore/demo']);

  // Simulate GitHub's "Rebase and merge": land the SAME patch on main as a
  // brand-new commit, from a throwaway clone — never through chore/demo itself.
  const up = tempDir('up-', root);
  sh(root, 'git', ['clone', '--branch', 'main', origin, up]);
  sh(up, 'git', ['config', 'user.email', 't@t']);
  sh(up, 'git', ['config', 'user.name', 't']);
  sh(up, 'git', ['fetch', 'origin', 'chore/demo']);
  sh(up, 'git', ['cherry-pick', 'FETCH_HEAD']);
  sh(up, 'git', ['push', 'origin', 'HEAD:main']);

  const out = execHarness(script, ['finish', 'demo'], { encoding: 'utf8', env });
  assert.ok(!existsSync(wt), 'worktree removed');
  assert.match(out, /deleted local branch chore\/demo/);
  assert.match(out, /deleted remote branch origin\/chore\/demo/);

  assert.equal(git_showref(cfg, 'refs/heads/chore/demo'), false, 'local branch gone');
  sh(cfg, 'git', ['fetch', 'origin']);
  assert.equal(
    sh(cfg, 'git', ['ls-remote', '--heads', 'origin', 'chore/demo']).trim(),
    '',
    'remote branch gone',
  );
});

test('finish keeps an unmerged branch, locally and on the remote, and says so', () => {
  const root = tempDir('land-');
  const { cfg } = initOrigin(root);
  const env = { CLAUDE_WORKSPACE_ROOT: root, CLAUDE_CONFIG_REPO: cfg, CLAUDE_LAND_NO_GH: '1' };

  appendFileSync(join(cfg, 'a.md'), 'unmerged change\n');
  execHarness(script, ['start', 'unmerged', '-m', 'chore: unmerged', '--', 'a.md'], {
    encoding: 'utf8',
    env,
  });
  const wt = join(root, '.worktrees', 'claude-config-unmerged');
  sh(wt, 'git', ['push', '-u', 'origin', 'chore/unmerged']);

  const out = execHarness(script, ['finish', 'unmerged'], { encoding: 'utf8', env });
  assert.ok(!existsSync(wt), 'worktree still removed regardless of branch merge state');
  assert.match(out, /kept local branch chore\/unmerged/);
  assert.match(out, /kept remote branch origin\/chore\/unmerged/);

  assert.equal(git_showref(cfg, 'refs/heads/chore/unmerged'), true, 'local branch kept');
  sh(cfg, 'git', ['fetch', 'origin']);
  assert.notEqual(
    sh(cfg, 'git', ['ls-remote', '--heads', 'origin', 'chore/unmerged']).trim(),
    '',
    'remote branch kept',
  );
});

test('finish removes a leftover worktree directory that got unregistered without being deleted', () => {
  // Reproduces PR #50: `git worktree remove` (or a manual prune) can drop the
  // registration in .git/worktrees/<name> while the directory on disk survives.
  // finish must clean that up rather than refuse.
  const root = tempDir('land-');
  const { cfg } = initOrigin(root);
  const env = { CLAUDE_WORKSPACE_ROOT: root, CLAUDE_CONFIG_REPO: cfg, CLAUDE_LAND_NO_GH: '1' };

  appendFileSync(join(cfg, 'a.md'), 'leftover dir change\n');
  execHarness(script, ['start', 'leftover', '-m', 'chore: leftover', '--', 'a.md'], {
    encoding: 'utf8',
    env,
  });
  const wt = join(root, '.worktrees', 'claude-config-leftover');
  assert.ok(existsSync(wt));

  // Unregister without touching the directory: what a stale/incomplete prior
  // `worktree remove` leaves behind.
  rmSync(join(cfg, '.git', 'worktrees', 'claude-config-leftover'), { recursive: true, force: true });
  sh(cfg, 'git', ['worktree', 'prune']);
  assert.doesNotMatch(sh(cfg, 'git', ['worktree', 'list']), /claude-config-leftover/);
  assert.ok(existsSync(wt), 'directory survives the unregister, per the bug being reproduced');

  const out = execHarness(script, ['finish', 'leftover'], { encoding: 'utf8', env });
  assert.ok(!existsSync(wt), 'leftover directory removed rather than refused');
  assert.match(out, /leftover|removed/i);
});

test('finish carries on to the branch steps when a locked worktree dir survives the remove', async () => {
  // Reproduces the agent-qol follow-up: on Windows, a process whose cwd is
  // inside the worktree locks the directory. `git worktree remove` unregisters
  // it and then fails deleting it, so the --force retry dies with "not a
  // working tree". finish must re-check registration and carry on. Off
  // Windows, cwd does not lock and this exercises the normal remove.
  const root = tempDir('land-');
  const { cfg } = initOrigin(root);
  const env = { CLAUDE_WORKSPACE_ROOT: root, CLAUDE_CONFIG_REPO: cfg, CLAUDE_LAND_NO_GH: '1' };

  appendFileSync(join(cfg, 'a.md'), 'locked dir change\n');
  execHarness(script, ['start', 'locked', '-m', 'chore: locked', '--', 'a.md'], {
    encoding: 'utf8',
    env,
  });
  const wt = join(root, '.worktrees', 'claude-config-locked');

  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { cwd: wt, stdio: 'ignore' });
  await new Promise((r) => holder.once('spawn', r));
  let res;
  try {
    res = spawnHarness(script, ['finish', 'locked'], { encoding: 'utf8', env });
  } finally {
    holder.kill();
    await new Promise((r) => holder.once('exit', r));
  }

  assert.equal(res.status, 0, `finish must not die partway:\n${res.stderr}`);
  assert.match(res.stdout, /kept local branch chore\/locked/, 'reached the branch steps');
  assert.doesNotMatch(sh(cfg, 'git', ['worktree', 'list']), /claude-config-locked/);
  if (existsSync(wt)) assert.match(res.stdout + res.stderr, /still locked/i, 'says the dir survived');
});

function git_showref(repo, ref) {
  try {
    execFileSync('git', ['-C', repo, 'show-ref', '--verify', '--quiet', ref]);
    return true;
  } catch {
    return false;
  }
}

test('start refuses when the main checkout is off main', () => {
  const root = tempDir('land-');
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

  const env = { CLAUDE_WORKSPACE_ROOT: root, CLAUDE_CONFIG_REPO: cfg };
  assert.throws(() =>
    execHarness(script, ['start', 'x', '-m', 'm', '--', 'a.md'], { encoding: 'utf8', env }),
  );
});

// --- sync: paths origin/main added that this checkout never tracked -----------
//
// The two scratch repos above use a bare `git init` with no .gitattributes and
// no autocrlf, so content round-trips byte-for-byte. The real claude-config repo
// does not: it sets `* text=auto eol=lf` under Git for Windows' system
// core.autocrlf=true. Checkouts are LF, but a file written on disk as CRLF
// (an editor, a `*.ps1`, a checkout from before `eol=lf`) still reads clean to
// git while differing byte-for-byte from its LF blob. A sync fix tested only
// on byte-identical content misses that, so these fixtures configure both.

function scratchRepo(seedFiles = {}) {
  const root = tempDir('land-');
  const origin = join(root, 'origin.git');
  mkdirSync(origin);
  sh(root, 'git', ['init', '--bare', origin]);

  // Seed origin/main from a plain clone, then check `cfg` out FRESH with
  // autocrlf. The main checkout has to be a tree git itself wrote, so the
  // index stat cache agrees with the worktree. Hand-writing files into a
  // repo instead produces a state git never creates, and in it even
  // a correct sync fails: `git diff` reports no change while the stale stat
  // makes `merge --ff-only` refuse. That is a fixture bug, not a bug worth
  // coding around — build the fixture the way the real checkout exists.
  const seed = join(root, 'seed');
  sh(root, 'git', ['clone', origin, seed]);
  sh(seed, 'git', ['config', 'user.email', 't@t']);
  sh(seed, 'git', ['config', 'user.name', 't']);
  writeFileSync(join(seed, '.gitattributes'), '* text=auto eol=lf\n');
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
  return { root, origin, cfg, env: { CLAUDE_WORKSPACE_ROOT: root, CLAUDE_CONFIG_REPO: cfg } };
}

/**
 * Land commits on origin/main from a throwaway clone — stands in for a merged PR.
 * A `null` content deletes the path.
 */
function pushUpstream(root, origin, files, msg) {
  const up = tempDir('up-', root);
  // --branch main explicitly: the bare repo's HEAD is an unborn `master`, so a
  // default clone lands on an empty branch and the push is rejected as behind.
  sh(root, 'git', ['clone', '--branch', 'main', origin, up]);
  sh(up, 'git', ['config', 'user.email', 't@t']);
  sh(up, 'git', ['config', 'user.name', 't']);
  for (const [p, content] of Object.entries(files)) {
    if (content === null) {
      sh(up, 'git', ['rm', '-q', p]);
      continue;
    }
    mkdirSync(dirname(join(up, p)), { recursive: true });
    writeFileSync(join(up, p), content);
    sh(up, 'git', ['add', p]);
  }
  sh(up, 'git', ['commit', '-m', msg]);
  sh(up, 'git', ['push', 'origin', 'HEAD:main']);
}

const runSync = (env, files) =>
  execHarness(script, ['sync', '--', ...files], { encoding: 'utf8', env });

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

// --- sync: incoming additions the caller never named --------------------------
//
// claude-config#175: the caller built its path list before sync's own fetch, so
// it named the PREVIOUS commit's paths. The two files the PR added sat untracked
// and identical on disk, were never classified, and ff-only aborted. sync now
// derives HEAD..origin/main's additions itself instead of trusting the list.

test('sync adopts an unnamed untracked file identical to an incoming addition', () => {
  const { root, origin, cfg, env } = scratchRepo({ 'a.md': 'v1\n' });
  pushUpstream(
    root,
    origin,
    { 'a.md': 'v2\n', 'scripts/session-name.mjs': 'export {};\n', 'scripts/test/session-name.test.mjs': 'ok\n' },
    'feat: session-name',
  );
  writeFileSync(join(cfg, 'a.md'), 'v2\r\n');
  mkdirSync(join(cfg, 'scripts', 'test'), { recursive: true });
  writeFileSync(join(cfg, 'scripts', 'session-name.mjs'), 'export {};\r\n');
  writeFileSync(join(cfg, 'scripts', 'test', 'session-name.test.mjs'), 'ok\r\n');

  runSync(env, ['a.md']); // the stale list: neither addition is named

  assert.ok(headsMatch(cfg), 'checkout should be fast-forwarded to origin/main');
  sh(cfg, 'git', ['ls-files', '--error-unmatch', 'scripts/session-name.mjs', 'scripts/test/session-name.test.mjs']);
  assert.equal(porcelain(cfg), '', 'the adopted files are clean tracked copies');
});

test('sync adopts an unnamed incoming addition despite CRLF-vs-LF storage', () => {
  const { root, origin, cfg, env } = scratchRepo({ 'a.md': 'v1\n' });
  pushUpstream(root, origin, { 'a.md': 'v2\n', 'hooks/new.mjs': 'alpha\nbeta\n' }, 'feat: add hook');
  writeFileSync(join(cfg, 'a.md'), 'v2\r\n');
  mkdirSync(join(cfg, 'hooks'), { recursive: true });
  writeFileSync(join(cfg, 'hooks', 'new.mjs'), 'alpha\r\nbeta\r\n');

  // Same fixture guard as the named-path case: a byte compare must disagree.
  const onDisk = readFileSync(join(cfg, 'hooks', 'new.mjs'));
  sh(cfg, 'git', ['fetch', 'origin']);
  const blob = sh(cfg, 'git', ['cat-file', '-p', 'origin/main:hooks/new.mjs']);
  assert.ok(onDisk.includes('\r\n') && !blob.includes('\r\n'), 'fixture must be CRLF on disk, LF in the blob');
  assert.notEqual(onDisk.length, Buffer.byteLength(blob));

  runSync(env, ['a.md']);

  assert.ok(headsMatch(cfg), 'checkout should be fast-forwarded to origin/main');
  sh(cfg, 'git', ['ls-files', '--error-unmatch', 'hooks/new.mjs']);
});

test('sync refuses, resetting nothing, when an unnamed incoming addition differs locally', () => {
  const { root, origin, cfg, env } = scratchRepo({ 'a.md': 'v1\n' });
  pushUpstream(root, origin, { 'a.md': 'v2\n', 'hooks/new.mjs': 'upstream version\n' }, 'feat: add hook');
  writeFileSync(join(cfg, 'a.md'), 'v2\r\n');
  const mine = join(cfg, 'hooks', 'new.mjs');
  mkdirSync(join(cfg, 'hooks'), { recursive: true });
  writeFileSync(mine, 'my unpushed work\r\n');
  const before = { head: head(cfg), a: readFileSync(join(cfg, 'a.md')) };

  const out = syncFails(env, ['a.md']);

  assert.match(out, /hooks\/new\.mjs differs from origin\/main/);
  assert.match(out, /never discard/);
  assert.equal(readFileSync(mine, 'utf8'), 'my unpushed work\r\n', 'the divergent file is untouched');
  assert.equal(head(cfg), before.head, 'no merge happened');
  assert.deepEqual(readFileSync(join(cfg, 'a.md')), before.a, 'not even the named path was reset');
});

// --- sync: another session's live edit in a file the incoming range touches --
//
// The main checkout is shared: while one session syncs, another can hold an
// uncommitted edit in a file the merged PR also changed (skills/agent-factory/
// SKILL.md vs a881a20, 2026-10-12). sync must carry that edit across the
// fast-forward — save it, reset it, merge, 3-way re-apply — and on every
// failure branch leave the edit recoverable.

const SHARED = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n';
const lf = (s) => s.replace(/\r\n/g, '\n');
const crlf = (s) => s.replace(/\n/g, '\r\n');
const porcelain = (cfg) => sh(cfg, 'git', ['status', '--porcelain', '--untracked-files=no']);
const head = (cfg) => sh(cfg, 'git', ['rev-parse', 'HEAD']).trim();

/** sync expected to fail: returns the child's combined output. */
function syncFails(env, files) {
  const r = spawnHarness(script, ['sync', '--', ...files], { encoding: 'utf8', env });
  assert.notEqual(r.status, 0, `sync was expected to stop:\n${r.stdout}`);
  return `${r.stdout}\n${r.stderr}`;
}

/** A repo where our PR (mine.md) merged alongside an upstream change to shared.md. */
function overlapRepo(upstreamShared) {
  const repo = scratchRepo({ 'mine.md': 'v1\n', 'shared.md': SHARED });
  pushUpstream(repo.root, repo.origin, { 'mine.md': 'v2\n', 'shared.md': upstreamShared }, 'chore: merged PR');
  writeFileSync(join(repo.cfg, 'mine.md'), 'v2\r\n'); // our live edit that became the PR
  return repo;
}

test('sync carries a foreign live edit through an ff-merge that touches the same file', () => {
  const { cfg, env } = overlapRepo(SHARED.replace('one', 'ONE upstream'));
  writeFileSync(join(cfg, 'shared.md'), crlf(SHARED.replace('seven', 'SEVEN foreign')));

  const out = runSync(env, ['mine.md']);

  assert.ok(headsMatch(cfg), 'checkout fast-forwarded to origin/main');
  assert.equal(
    lf(readFileSync(join(cfg, 'shared.md'), 'utf8')),
    SHARED.replace('one', 'ONE upstream').replace('seven', 'SEVEN foreign'),
    'both the incoming change and the foreign edit are present',
  );
  assert.equal(porcelain(cfg), ' M shared.md\n', 'the foreign edit is back as an unstaged worktree edit');
  assert.match(out, /carried.*shared\.md/s, 'says which path it carried');
});

test('sync stops on a 3-way conflict with main merged, the edit kept and the patch printed', () => {
  const { cfg, env } = overlapRepo(SHARED.replace('four', 'FOUR upstream'));
  writeFileSync(join(cfg, 'shared.md'), crlf(SHARED.replace('four', 'FOUR foreign')));

  const out = syncFails(env, ['mine.md']);

  assert.ok(headsMatch(cfg), 'main checkout is on the merged commit');
  assert.match(out, /conflict/i);
  assert.match(out, /shared\.md/, 'names the conflicting path');
  const patch = out.match(/(\S+\.patch)/);
  assert.ok(patch, `prints the saved patch path:\n${out}`);
  assert.ok(existsSync(patch[1]), 'the printed patch exists');
  assert.match(readFileSync(patch[1], 'utf8'), /^\+FOUR foreign/m, 'and holds the foreign edit');
  assert.match(readFileSync(join(cfg, 'shared.md'), 'utf8'), /FOUR foreign/, 'the edit is in the worktree, as conflict markers');
  assert.equal(
    sh(cfg, 'git', ['diff', '--name-only', '--diff-filter=U']),
    '',
    'the shared index is left operable, not unmerged',
  );
});

test('sync fast path: a live edit the incoming range does not touch is left byte-identical', () => {
  const { cfg, env } = overlapRepo(SHARED);
  writeFileSync(join(cfg, 'shared.md'), crlf(SHARED.replace('two', 'TWO foreign')));
  const before = readFileSync(join(cfg, 'shared.md'));

  const out = runSync(env, ['mine.md']);

  assert.ok(headsMatch(cfg));
  assert.deepEqual(readFileSync(join(cfg, 'shared.md')), before, 'untouched by the sync');
  assert.doesNotMatch(out, /carried/i, 'nothing was carried');
});

test('sync refuses, resetting nothing, when an overlapping edit is staged', () => {
  const { cfg, env } = overlapRepo(SHARED.replace('one', 'ONE upstream'));
  writeFileSync(join(cfg, 'shared.md'), crlf(SHARED.replace('seven', 'SEVEN staged')));
  sh(cfg, 'git', ['add', 'shared.md']);
  const before = {
    head: head(cfg),
    status: porcelain(cfg),
    shared: readFileSync(join(cfg, 'shared.md')),
    mine: readFileSync(join(cfg, 'mine.md')),
  };

  const out = syncFails(env, ['mine.md']);

  assert.match(out, /staged/i);
  assert.match(out, /shared\.md/);
  assert.equal(head(cfg), before.head, 'no merge happened');
  assert.equal(porcelain(cfg), before.status, 'index and worktree state unchanged');
  assert.deepEqual(readFileSync(join(cfg, 'shared.md')), before.shared);
  assert.deepEqual(readFileSync(join(cfg, 'mine.md')), before.mine, 'not even the named path was reset');
});

test('sync refuses, resetting nothing, when the incoming range deletes a locally modified file', () => {
  const { cfg, env } = overlapRepo(null);
  writeFileSync(join(cfg, 'shared.md'), crlf(SHARED.replace('seven', 'SEVEN foreign')));
  const before = { head: head(cfg), shared: readFileSync(join(cfg, 'shared.md')), mine: readFileSync(join(cfg, 'mine.md')) };

  const out = syncFails(env, ['mine.md']);

  assert.match(out, /delet/i);
  assert.match(out, /shared\.md/);
  assert.equal(head(cfg), before.head, 'no merge happened');
  assert.deepEqual(readFileSync(join(cfg, 'shared.md')), before.shared);
  assert.deepEqual(readFileSync(join(cfg, 'mine.md')), before.mine, 'not even the named path was reset');
});

test('sync refuses, resetting nothing, when an untracked file sits where incoming commits add a directory', () => {
  const { root, origin, cfg, env } = overlapRepo(SHARED.replace('one', 'ONE upstream'));
  pushUpstream(root, origin, { 'sub/deep/new.md': 'upstream\n' }, 'feat: add sub/deep/new.md');
  // claude-config#183: nothing sits at sub/deep/new.md itself, so only a prefix
  // walk sees that ff-only would refuse over the FILE `sub`.
  writeFileSync(join(cfg, 'sub'), 'someone else\r\n');
  writeFileSync(join(cfg, 'shared.md'), crlf(SHARED.replace('seven', 'SEVEN foreign')));
  const before = { head: head(cfg), shared: readFileSync(join(cfg, 'shared.md')), mine: readFileSync(join(cfg, 'mine.md')) };

  const out = syncFails(env, ['mine.md']);

  assert.match(out, /nothing was reset/);
  assert.match(out, /^ {2}sub {2}\(incoming sub\/deep\/new\.md\)$/m, 'names the blocking path');
  assert.equal(head(cfg), before.head, 'no merge happened');
  assert.deepEqual(readFileSync(join(cfg, 'shared.md')), before.shared, 'the overlapping edit was never reset');
  assert.deepEqual(readFileSync(join(cfg, 'mine.md')), before.mine, 'not even the named path was reset');
  assert.equal(readFileSync(join(cfg, 'sub'), 'utf8'), 'someone else\r\n');
});

test('sync puts a carried edit back when the ff-merge itself fails after the reset', () => {
  const { cfg, env } = overlapRepo(SHARED.replace('one', 'ONE upstream'));
  // A named path whose worktree matches origin/main (the drift check passes)
  // but whose index holds a third version: restore resets only the worktree,
  // so ff-only refuses the index entry AFTER sync reset shared.md.
  writeFileSync(join(cfg, 'mine.md'), 'v3\r\n');
  sh(cfg, 'git', ['add', 'mine.md']);
  writeFileSync(join(cfg, 'mine.md'), 'v2\r\n');
  const edited = crlf(SHARED.replace('seven', 'SEVEN foreign'));
  writeFileSync(join(cfg, 'shared.md'), edited);
  const before = head(cfg);

  const out = syncFails(env, ['mine.md']);

  assert.match(out, /merge --ff-only stopped/);
  assert.match(out, /Carried edits were put back\./, 'the reset-then-restore branch really ran');
  assert.equal(head(cfg), before, 'still on the old commit');
  assert.equal(lf(readFileSync(join(cfg, 'shared.md'), 'utf8')), lf(edited), 'the carried edit is back');
});

// --- sync with no path: fast-forward a clean, strictly-behind main (#220) -----

const runBareSync = (env) => execHarness(script, ['sync'], { encoding: 'utf8', env });

test('sync with no path fast-forwards a clean main that is strictly behind', () => {
  const { root, origin, cfg, env } = scratchRepo({ 'a.md': 'v1\n' });
  pushUpstream(root, origin, { 'a.md': 'v2\n', 'new.md': 'added\n' }, 'upstream');

  runBareSync(env);

  assert.ok(headsMatch(cfg));
  assert.equal(readFileSync(join(cfg, 'a.md'), 'utf8').replace(/\r\n/g, '\n'), 'v2\n');
  assert.ok(existsSync(join(cfg, 'new.md')));
});

test('sync with no path is a no-op success when already up to date', () => {
  const { cfg, env } = scratchRepo({ 'a.md': 'v1\n' });
  const before = sh(cfg, 'git', ['rev-parse', 'HEAD']);

  runBareSync(env);

  assert.equal(sh(cfg, 'git', ['rev-parse', 'HEAD']), before);
  assert.ok(headsMatch(cfg));
});

test('sync with no path refuses, resetting nothing, when a tracked file has a live edit', () => {
  const { root, origin, cfg, env } = scratchRepo({ 'a.md': 'v1\n', 'b.md': 'v1\n' });
  pushUpstream(root, origin, { 'a.md': 'v2\n' }, 'upstream');
  writeFileSync(join(cfg, 'b.md'), 'foreign edit\n');

  assert.throws(() => runBareSync(env), /live edits/);

  assert.ok(!headsMatch(cfg), 'HEAD did not move');
  assert.equal(readFileSync(join(cfg, 'b.md'), 'utf8'), 'foreign edit\n');
});

test('sync with no path refuses when main has diverged from origin/main', () => {
  const { root, origin, cfg, env } = scratchRepo({ 'a.md': 'v1\n' });
  writeFileSync(join(cfg, 'local.md'), 'local\n');
  sh(cfg, 'git', ['add', 'local.md']);
  sh(cfg, 'git', ['commit', '-m', 'local only']);
  const head = sh(cfg, 'git', ['rev-parse', 'HEAD']);
  pushUpstream(root, origin, { 'a.md': 'v2\n' }, 'upstream');

  assert.throws(() => runBareSync(env), /not an ancestor/);

  assert.equal(sh(cfg, 'git', ['rev-parse', 'HEAD']), head);
});

test('sync with no path refuses when the main checkout is off main', () => {
  const { root, origin, cfg, env } = scratchRepo({ 'a.md': 'v1\n' });
  pushUpstream(root, origin, { 'a.md': 'v2\n' }, 'upstream');
  sh(cfg, 'git', ['checkout', '-q', '-b', 'stray']);

  assert.throws(() => runBareSync(env), /stray/);

  assert.ok(!headsMatch(cfg));
});

test('sync with no path names a detached HEAD as such', () => {
  const { root, origin, cfg, env } = scratchRepo({ 'a.md': 'v1\n' });
  pushUpstream(root, origin, { 'a.md': 'v2\n' }, 'upstream');
  sh(cfg, 'git', ['checkout', '-q', '--detach']);

  assert.throws(() => runBareSync(env), /detached HEAD/);

  assert.ok(!headsMatch(cfg));
});

test('sync with no path keeps staged and unstaged edits distinguishable in the refusal', () => {
  const { root, origin, cfg, env } = scratchRepo({ 'a.md': 'v1\n', 'b.md': 'v1\n' });
  pushUpstream(root, origin, { 'a.md': 'v2\n' }, 'upstream');
  writeFileSync(join(cfg, 'a.md'), 'unstaged\n');
  writeFileSync(join(cfg, 'b.md'), 'staged\n');
  sh(cfg, 'git', ['add', 'b.md']);

  assert.throws(() => runBareSync(env), (e) => /live edits/.test(e.message) && /^ M a\.md$/m.test(e.message) && /^M {2}b\.md$/m.test(e.message));

  assert.ok(!headsMatch(cfg));
  assert.equal(readFileSync(join(cfg, 'b.md'), 'utf8'), 'staged\n');
});

test('sync with no path refuses a staged-but-uncommitted change', () => {
  const { root, origin, cfg, env } = scratchRepo({ 'a.md': 'v1\n' });
  pushUpstream(root, origin, { 'a.md': 'v2\n' }, 'upstream');
  writeFileSync(join(cfg, 'staged.md'), 'new\n');
  sh(cfg, 'git', ['add', 'staged.md']);

  assert.throws(() => runBareSync(env), /live edits/);

  assert.ok(!headsMatch(cfg));
  assert.equal(readFileSync(join(cfg, 'staged.md'), 'utf8').replace(/\r\n/g, '\n'), 'new\n');
});

test('sync with no path refuses, keeping the file, when an untracked file sits at an incoming addition', () => {
  const { root, origin, cfg, env } = scratchRepo({ 'a.md': 'v1\n' });
  pushUpstream(root, origin, { 'new.md': 'incoming\n' }, 'upstream');
  writeFileSync(join(cfg, 'new.md'), 'mine\n');
  const head = sh(cfg, 'git', ['rev-parse', 'HEAD']);

  assert.throws(() => runBareSync(env), /differs from origin\/main/);

  assert.equal(sh(cfg, 'git', ['rev-parse', 'HEAD']), head);
  assert.equal(readFileSync(join(cfg, 'new.md'), 'utf8'), 'mine\n');
});
