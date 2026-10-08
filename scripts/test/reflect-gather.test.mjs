// scripts/test/reflect-gather.test.mjs — a unit's reflect payload, joined on session name
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
  commit('f.txt', 'feat: unit work', '2026-10-03T00:00:05Z');
  return { dir, root: join(dir, 'projects'), repo, proj };
}

test('gathers every window of the unit through the audit filter, with repo activity since its first window', () => {
  const f = fixture();
  try {
    const r = spawnSync(process.execPath, [cli, 'repo-7', '--root', f.root, '--repo', f.repo], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /## Per session name[\s\S]*\| repo-7 \| 2 \| 2026-10-03 \| 2026-10-05 \|/);
    assert.match(r.stdout, /## Audit — 2 window\(s\) named repo-7, 2 transcripts · \$[\d.]+ over 0 min active of 0 min wall/);
    assert.match(r.stdout, /## Time[\s\S]*\*\*Per session name\*\*[\s\S]*\| repo-7 \| 2 \|/);
    assert.doesNotMatch(r.stdout, /other-1/);
    assert.match(r.stdout, /## Repo activity since 2026-10-03/);
    assert.match(r.stdout, /feat: unit work/, 'a commit on the first window\'s own UTC day is in the window');
    assert.doesNotMatch(r.stdout, /chore: before the unit/);
    assert.match(r.stdout, /1 file changed/, 'the diffstat spans the same-day commit');
    assert.doesNotMatch(r.stdout, /checklist/i);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('a renamed window with no priced requests reports, not crashes', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.proj, 'w4.jsonl'), lines({ type: 'custom-title', sessionId: 'w4', customTitle: 'repo-9' }));
    const r = spawnSync(process.execPath, [cli, 'repo-9', '--root', f.root, '--repo', f.repo], { encoding: 'utf8' });
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

test('an unknown session name fails with the audit filter\'s message', () => {
  const f = fixture();
  try {
    const r = spawnSync(process.execPath, [cli, 'repo-404', '--root', f.root], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no session named repo-404/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
