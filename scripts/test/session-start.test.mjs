// node --test scripts/test/session-start.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { execHarness, tempDir } from './_spawn.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const hook = join(repo, 'hooks', 'session-start.mjs');
const index = readFileSync(join(repo, 'skills', 'INDEX.md'), 'utf8').replace(/\r\n/g, '\n').trim();

/** A node script standing in for `gh`; it records its argv and runs `body`. */
function ghStub(body) {
  const dir = tempDir('ss-gh-');
  const script = join(dir, 'gh.mjs');
  writeFileSync(
    script,
    `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(join(dir, 'argv.json'))}, JSON.stringify(process.argv.slice(2)));\n${body}\n`,
  );
  return { cmd: JSON.stringify([process.execPath, script]), argv: join(dir, 'argv.json') };
}

const failingGh = ghStub('process.exit(1);').cmd;

/** Run the hook with `gh` stubbed (never the network); default stub fails. */
function runHook(payload, gh = failingGh) {
  return execHarness(hook, [], {
    input: JSON.stringify(payload),
    env: { SESSION_START_GH: gh },
  }).replace(/\r\n/g, '\n');
}

test('the skill index leads with the Read-not-Skill-tool instruction and stays within 1 KB', () => {
  assert.match(index.split('\n')[0], /Read the path; skills are not Skill-tool invocable\./);
  assert.ok(Buffer.byteLength(index, 'utf8') <= 1024, `INDEX.md is ${Buffer.byteLength(index, 'utf8')} B`);
});

for (const source of ['startup', 'clear', 'resume', 'compact']) {
  test(`the skill index is injected on source=${source}`, () => {
    assert.ok(runHook({ source }).includes(index));
  });
}

test('the post-compaction reminder says Read, never re-invoke, and re-orients from the issue', () => {
  const out = runHook({ source: 'compact' }).split('\n').find((l) => l.startsWith('Post-compaction'));
  assert.ok(out);
  assert.doesNotMatch(out, /invoke|checklist/i);
  assert.match(out, /Done-when/);
});

test('in-progress issues across the owner are listed one line each', () => {
  const issues = [
    { repository: { name: 'claude-config', nameWithOwner: 'Crawford-Young/claude-config' }, number: 72, title: 'Issues tracker' },
    { repository: { name: 'portfolio', nameWithOwner: 'Crawford-Young/portfolio' }, number: 5, title: 'Hero' },
  ];
  const stub = ghStub(`process.stdout.write(${JSON.stringify(JSON.stringify(issues))});`);
  const out = runHook({ source: 'startup' }, stub.cmd);
  assert.match(out, /^In progress:\n- claude-config#72 Issues tracker\n- portfolio#5 Hero$/m);
  assert.deepEqual(JSON.parse(readFileSync(stub.argv, 'utf8')), [
    'search', 'issues', '--owner', 'Crawford-Young', '--label', 'in-progress', '--state', 'open',
    '--limit', '10', '--json', 'repository,number,title',
  ]);
});

test('no in-progress issues → no header', () => {
  const out = runHook({ source: 'startup' }, ghStub("process.stdout.write('[]');").cmd);
  assert.doesNotMatch(out, /In progress/);
});

test('gh failing, missing or hanging fails open silently', () => {
  for (const gh of [failingGh, JSON.stringify([join(tmpdir(), 'no-such-gh.exe')]), ghStub('setTimeout(() => {}, 10000);').cmd]) {
    const out = runHook({ source: 'startup' }, gh);
    assert.ok(out.includes(index));
    assert.doesNotMatch(out, /In progress/);
  }
});

// ---- hook-errors.log reader (#300) ----
const hooksUrl = pathToFileURL(join(repo, 'hooks')).href;
const entry = (ts, name, dirUrl) =>
  `${ts} ${name}: Error: boom\n    at f (${dirUrl}/${name}.mjs:1:1)\n    at g (${dirUrl}/_hooklib.mjs:2:2)\n`;

/** Run the hook in a home whose .claude holds `files`; returns { out, home }. */
function runWithClaudeDir(files) {
  const home = tempDir('ss-home-');
  mkdirSync(join(home, '.claude'), { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(home, '.claude', name), body);
  const out = execHarness(hook, [], { home, input: JSON.stringify({ source: 'startup' }), env: { SESSION_START_GH: failingGh } }).replace(/\r\n/g, '\n');
  return { out, home };
}

test('live-hook errors since the last session start add one line: count and newest hook', () => {
  const log =
    entry('2026-10-01T00:00:00.000Z', 'old-hook', hooksUrl) +
    entry('2026-10-10T00:00:00.000Z', 'bash-guard', hooksUrl) +
    entry('2026-10-11T00:00:00.000Z', 'context-gauge', hooksUrl);
  const { out } = runWithClaudeDir({ 'hook-errors.log': log, 'hook-errors.seen': '2026-10-05T00:00:00.000Z' });
  const lines = out.split('\n').filter((l) => /hook-errors\.log/.test(l));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /2 hook errors/);
  assert.match(lines[0], /context-gauge/);
});

test('worktree, scratch and compiled-copy entries are not counted', () => {
  const log =
    entry('2026-10-10T00:00:00.000Z', 'bash-guard', 'file:///C:/Users/x/code/.worktrees/claude-config-1-foo/hooks') +
    entry('2026-10-10T00:00:01.000Z', 'bash-guard', 'file:///C:/tmp/scratch/hooks') +
    entry('2026-10-10T00:00:02.000Z', 'bash-guard', `${hooksUrl}-copy`);
  const { out } = runWithClaudeDir({ 'hook-errors.log': log, 'hook-errors.seen': '2026-10-05T00:00:00.000Z' });
  assert.doesNotMatch(out, /hook-errors\.log/);
});

test('each start advances the marker, so the same errors are reported once', () => {
  const log = entry('2026-10-10T00:00:00.000Z', 'bash-guard', hooksUrl);
  const { out, home } = runWithClaudeDir({ 'hook-errors.log': log, 'hook-errors.seen': '2026-10-05T00:00:00.000Z' });
  assert.match(out, /1 hook error\b/);
  const second = execHarness(hook, [], { home, input: JSON.stringify({ source: 'startup' }), env: { SESSION_START_GH: failingGh } });
  assert.doesNotMatch(second, /hook-errors\.log/);
  assert.ok(Date.parse(readFileSync(join(home, '.claude', 'hook-errors.seen'), 'utf8')) > Date.parse('2026-10-10'));
});

test('first run (no marker) and a missing log stay silent but leave a marker', () => {
  const first = runWithClaudeDir({ 'hook-errors.log': entry('2026-10-10T00:00:00.000Z', 'bash-guard', hooksUrl) });
  assert.doesNotMatch(first.out, /hook-errors\.log/);
  assert.ok(existsSync(join(first.home, '.claude', 'hook-errors.seen')));
  assert.doesNotMatch(runWithClaudeDir({}).out, /hook-errors\.log/);
});

// ---- sessionTitle in a ticket worktree (#344) ----

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });

/** A temp repo `app` with a linked worktree on `branch`; returns { repo, wt }. */
function ticketWorktree(branch = 'chore/12-x') {
  const repo = join(tempDir('ss-wt-'), 'app');
  mkdirSync(repo);
  git(repo, 'init', '-b', 'main');
  git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init');
  const wt = join(dirname(repo), 'app-wt');
  git(repo, 'worktree', 'add', '-b', branch, wt);
  return { repo, wt };
}

for (const source of ['startup', 'resume']) {
  test(`source=${source} in an untitled ticket worktree: one JSON line titles it and carries the context`, () => {
    const { wt } = ticketWorktree();
    const out = JSON.parse(runHook({ source, cwd: wt }));
    assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.equal(out.hookSpecificOutput.sessionTitle, 'ticket-app-12');
    assert.ok(out.hookSpecificOutput.additionalContext.includes(index));
  });
}

test('a session that already has a title (-n, /rename, an earlier hook) is never re-titled', () => {
  const { wt } = ticketWorktree();
  for (const source of ['startup', 'resume']) {
    const out = runHook({ source, cwd: wt, session_title: 'manual' });
    assert.doesNotMatch(out, /sessionTitle/, source);
    assert.ok(out.includes(index), source);
  }
});

test('no title on clear or compact, outside a ticket worktree, or with no cwd', () => {
  const { repo, wt } = ticketWorktree();
  const { wt: plain } = ticketWorktree('feat/no-number');
  for (const payload of [{ source: 'clear', cwd: wt }, { source: 'compact', cwd: wt }, { source: 'startup', cwd: repo }, { source: 'startup', cwd: plain }, { source: 'startup' }]) {
    const out = runHook(payload);
    assert.doesNotMatch(out, /sessionTitle/, JSON.stringify(payload));
    assert.ok(out.includes(index), JSON.stringify(payload));
  }
});
