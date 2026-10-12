// scripts/test/reflect-gather.test.mjs — a unit's reflect payload, joined on session name
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { spawnHarness } from './_spawn.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'reflect-gather.mjs');
const lines = (...r) => r.map((x) => JSON.stringify(x)).join('\n') + '\n';
const window = (id, day, title) => lines(
  { type: 'assistant', uuid: `u-${id}`, requestId: id, timestamp: `${day}T10:00:00Z`, sessionId: id,
    message: { id: `m-${id}`, model: 'claude-opus-5', usage: { input_tokens: 10, output_tokens: 1 }, content: [] } },
  { type: 'custom-title', sessionId: id, customTitle: title },
);

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'reflect-gather-'));
  const proj = join(dir, 'projects', 'C--proj');
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, 'w1.jsonl'), window('w1', '2026-10-03', 'repo-7'));
  writeFileSync(join(proj, 'w2.jsonl'), window('w2', '2026-10-05', 'repo-7'));
  writeFileSync(join(proj, 'w3.jsonl'), window('w3', '2026-10-01', 'other-1'));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  // Backdated commits (the reflog takes the committer date too): one the day
  // before the unit's first window, one minutes into that same UTC day.
  const commit = (file, msg, when) => {
    const env = { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when };
    writeFileSync(join(repo, file), 'x');
    spawnSync('git', ['-C', repo, 'add', '.'], { env });
    spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', msg], { env });
  };
  spawnSync('git', ['-C', repo, 'init', '-q']);
  commit('old.txt', 'chore: before the unit', '2026-10-02T12:00:00Z');
  commit('f.txt', 'feat: unit work (#7)', '2026-10-03T00:00:05Z');
  commit('g.txt', 'fix: another unit, same day (#8)', '2026-10-03T00:00:10Z');
  return { dir, root: join(dir, 'projects'), repo, proj };
}

test('gathers every window of the unit through the audit filter, with repo activity since its first window', () => {
  const f = fixture();
  try {
    const r = spawnHarness(cli, ['repo-7', '--root', f.root, '--repo', f.repo]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /## Per session name[\s\S]*\| repo-7 \| 2 \| 2026-10-03 \| 2026-10-05 \|/);
    assert.match(r.stdout, /## Audit — 2 window\(s\) named repo-7, 2 transcripts · \$[\d.]+ over 0 min active of 0 min wall/);
    assert.match(r.stdout, /## Time[\s\S]*\*\*Per session name\*\*[\s\S]*\| repo-7 \| 2 \|/);
    assert.doesNotMatch(r.stdout, /other-1/);
    assert.match(r.stdout, /## Repo activity since 2026-10-03/);
    assert.match(r.stdout, /feat: unit work/, 'a commit on the first window\'s own UTC day is in the window');
    assert.doesNotMatch(r.stdout, /chore: before the unit/);
    assert.doesNotMatch(r.stdout, /another unit, same day/, 'a same-day commit naming another issue is not the unit\'s');
    assert.match(r.stdout, /1 file changed/, 'the diffstat covers only the unit\'s commit');
    assert.doesNotMatch(r.stdout, /checklist/i);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('a renamed window with no priced requests reports, not crashes', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.proj, 'w4.jsonl'), lines({ type: 'custom-title', sessionId: 'w4', customTitle: 'repo-9' }));
    const r = spawnHarness(cli, ['repo-9', '--root', f.root, '--repo', f.repo]);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /TypeError/);
    assert.match(r.stdout, /no priced requests in windows named repo-9/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('auditFailure: a failed spawn (null stderr) still yields text and a non-zero code', async () => {
  const { auditFailure } = await import('../reflect-gather.mjs');
  assert.deepEqual(auditFailure({ status: null, stderr: null, error: new Error('spawn ENOENT') }), { text: 'spawn ENOENT\n', code: 1 });
  assert.deepEqual(auditFailure({ status: 1, stderr: 'no session named x\n' }), { text: 'no session named x\n', code: 1 });
});

test('matchDebt: an issue matches when its title or body names a touched path, on a path boundary', async () => {
  const { matchDebt } = await import('../reflect-gather.mjs');
  const issues = [
    { number: 1, title: 'flaky retry in scripts/lib.mjs', body: '' },
    { number: 2, title: 'cleanup', body: 'see `hooks/a.mjs` and skills/x/SKILL.md' },
    { number: 3, title: 'unrelated', body: 'metadata.md is stale' },
    { number: 4, title: 'null body', body: null },
  ];
  const r = matchDebt(issues, ['scripts/lib.mjs', 'hooks/a.mjs', 'skills/x/SKILL.md', 'data.md', 'a.md']);
  assert.deepEqual(r.matched, [
    { number: 1, title: 'flaky retry in scripts/lib.mjs', paths: ['scripts/lib.mjs'] },
    { number: 2, title: 'cleanup', paths: ['hooks/a.mjs', 'skills/x/SKILL.md'] },
  ]);
  assert.equal(r.other, 2);
});

test('matchDebt: a path cited with a directory prefix or a blob URL still matches', async () => {
  const { matchDebt } = await import('../reflect-gather.mjs');
  const issues = [
    { number: 1, title: 'see claude-config/scripts/lib.mjs', body: '' },
    { number: 2, title: 'x', body: 'at ~/code/x/scripts/lib.mjs:12' },
    { number: 3, title: 'x', body: 'https://github.com/o/r/blob/main/scripts/lib.mjs#L3' },
    { number: 4, title: 'x', body: 'myscripts/lib.mjs is different' },
  ];
  const r = matchDebt(issues, ['scripts/lib.mjs']);
  assert.deepEqual(r.matched.map((m) => m.number), [1, 2, 3]);
});

test('matchDebt: a root-level touched file does not match a same-named file in a directory', async () => {
  const { matchDebt } = await import('../reflect-gather.mjs');
  const issues = [
    { number: 1, title: 'x', body: 'scripts/README.md is stale' },
    { number: 2, title: 'README.md is stale', body: '' },
  ];
  assert.deepEqual(matchDebt(issues, ['README.md']).matched.map((m) => m.number), [2]);
});

test('fetchDebt: passes a timeout to gh and flags a list at the limit as possibly truncated', async () => {
  const { fetchDebt, renderDebt } = await import('../reflect-gather.mjs');
  let opts;
  fetchDebt('/r', (_c, _a, o) => ((opts = o), { status: 0, stdout: '[]' }));
  assert.ok(opts.timeout > 0 && opts.timeout <= 30000);
  const full = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ number: i, title: 't', body: '' })));
  assert.equal(fetchDebt('/r', () => ({ status: 0, stdout: full })).truncated, true);
  assert.equal(fetchDebt('/r', () => ({ status: 0, stdout: '[]' })).truncated, false);
  assert.match(renderDebt({ matched: [], other: 200, truncated: true }), /may be truncated/);
  assert.match(fetchDebt('/r', () => ({ status: null, error: new Error('spawnSync gh ETIMEDOUT') })).error, /ETIMEDOUT/);
});

test('debtSection: files the fixture repo committed reach matchDebt, so the matching issue prints', async () => {
  const { debtSection } = await import('../reflect-gather.mjs');
  const f = fixture();
  try {
    const issues = [
      { number: 11, title: 'f.txt is a mess', body: '' },
      { number: 12, title: 'old.txt predates the unit', body: '' },
      { number: 13, title: 'elsewhere', body: 'nothing here' },
    ];
    const out = debtSection(f.repo, ['f.txt'], () => ({ status: 0, stdout: JSON.stringify(issues) }));
    assert.equal(out, '- #11 f.txt is a mess (f.txt)\n2 other open debt issue(s) not naming touched files');
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('parseUnit / namesIssue: the trailing number is the issue; (#N) and <prefix>#N match on a boundary', async () => {
  const { parseUnit, namesIssue } = await import('../reflect-gather.mjs');
  assert.deepEqual(parseUnit('claude-config-137'), { prefix: 'claude-config', issue: '137' });
  assert.equal(parseUnit('scratch'), null);
  const u = parseUnit('claude-config-17');
  assert.ok(namesIssue('fix x (#17)', u));
  assert.ok(namesIssue('rule-history line for claude-config#17', u));
  assert.ok(!namesIssue('fix x (#170)', u), '#17 is not #170');
  assert.ok(!namesIssue('fix x (#7)', parseUnit('r-17')) );
  assert.ok(!namesIssue('see strate#17', u), 'another repo\'s #17');
  assert.ok(!namesIssue('see claude-config#170', u));
  assert.ok(!namesIssue('fix x (#1)', parseUnit('claude-config-13')));
});

test('a repo with no commit naming the issue says so and counts the window\'s other commits; no debt matches', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.proj, 'w5.jsonl'), window('w5', '2026-10-03', 'repo-9'));
    const r = spawnHarness(cli, ['repo-9', '--root', f.root, '--repo', f.repo]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no commits naming #9 since 2026-10-03 \(2 other commit\(s\) in the window\)/);
    assert.match(r.stdout, /### .*repo\n\(no commits naming #9, so no debt matched\)/);
    const bounded = spawnHarness(cli, ['repo-7', '--root', f.root, '--repo', f.repo, '--since', '2026-10-09']);
    assert.match(bounded.stdout, /no commits naming #7 since 2026-10-09 \(0 other commit\(s\) in the window\)/, 'an explicit --since bounds the window');
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('--issue attributes commits to that issue whatever the session name ends in; a bad value fails', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.proj, 'w6.jsonl'), window('w6', '2026-10-03', 'repo-queue'));
    const r = spawnHarness(cli, ['repo-queue', '--issue', '8', '--root', f.root, '--repo', f.repo]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /fix: another unit, same day \(#8\)/);
    assert.doesNotMatch(r.stdout, /feat: unit work/);
    assert.match(r.stdout, /\(1 other commit\(s\) in the window, not naming #8\)/);
    const over = spawnHarness(cli, ['repo-7', '--issue', '8', '--root', f.root, '--repo', f.repo]);
    assert.match(over.stdout, /fix: another unit, same day \(#8\)/, '--issue overrides the trailing number');
    assert.doesNotMatch(over.stdout, /feat: unit work/);
    const bad = spawnHarness(cli, ['repo-queue', '--issue', 'abc', '--root', f.root, '--repo', f.repo]);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /--issue/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('fetchDebt: parses gh JSON, and turns every failure into an error string instead of throwing', async () => {
  const { fetchDebt } = await import('../reflect-gather.mjs');
  const ok = fetchDebt('/r', () => ({ status: 0, stdout: '[{"number":3,"title":"t","body":"b"}]' }));
  assert.deepEqual(ok, { issues: [{ number: 3, title: 't', body: 'b' }], truncated: false });
  assert.match(fetchDebt('/r', () => ({ status: null, error: new Error('spawn gh ENOENT') })).error, /spawn gh ENOENT/);
  assert.match(fetchDebt('/r', () => ({ status: 1, stderr: 'gh auth login required\n' })).error, /gh auth login required/);
  assert.match(fetchDebt('/r', () => ({ status: 0, stdout: 'not json' })).error, /./);
});

test('renderDebt: lists matches with paths and counts the rest; reports the empty and error cases', async () => {
  const { renderDebt } = await import('../reflect-gather.mjs');
  assert.equal(
    renderDebt({ matched: [{ number: 5, title: 'T', paths: ['a.mjs', 'b.mjs'] }], other: 2 }),
    '- #5 T (a.mjs, b.mjs)\n2 other open debt issue(s) not naming touched files',
  );
  assert.equal(renderDebt({ matched: [], other: 0 }), '(no open debt issues)');
  assert.equal(renderDebt({ matched: [], other: 3 }), '(none name touched files)\n3 other open debt issue(s) not naming touched files');
  assert.equal(renderDebt({ error: 'gh not found' }), '(debt lookup skipped: gh not found)');
});

test('the gather prints the debt section per repo whatever gh answers, and still exits 0', () => {
  const f = fixture();
  try {
    const r = spawnHarness(cli, ['repo-7', '--root', f.root, '--repo', f.repo]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /## Open debt in touched code\n[\s\S]*### .*repo\n(- #|\(|\d+ other)/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('an unknown session name fails with the audit filter\'s message', () => {
  const f = fixture();
  try {
    const r = spawnHarness(cli, ['repo-404', '--root', f.root]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no session named repo-404/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('commitChanges lists a renamed file under its new path, so a debt issue naming it still matches', async () => {
  const { commitChanges } = await import('../reflect-gather.mjs');
  const repo = mkdtempSync(join(tmpdir(), 'reflect-gather-mv-'));
  const g = (...a) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  try {
    g('init', '-q');
    writeFileSync(join(repo, 'old.mjs'), 'export const a = 1;\n'.repeat(20));
    g('add', '.'); g('commit', '-qm', 'base');
    g('mv', 'old.mjs', 'new.mjs'); g('commit', '-qm', 'move (#7)');
    const sha = g('rev-parse', '--short', 'HEAD').stdout.toString().trim();
    const { files } = commitChanges(repo, [{ sha }]);
    assert.ok(files.includes('new.mjs'), `files: ${JSON.stringify(files)}`);
    assert.ok(!files.some((f) => f.includes('=>')), 'no rename arrows');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
