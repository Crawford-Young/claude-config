// scripts/test/audit.test.mjs — the audit.mjs CLI's --session filter
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'audit.mjs');
const lines = (...r) => r.map((x) => JSON.stringify(x)).join('\n') + '\n';
const req = (id, sessionId, title) => [
  { type: 'assistant', uuid: `u-${id}`, requestId: id, timestamp: '2026-10-05T10:00:00Z', sessionId,
    message: { id: `m-${id}`, model: 'claude-opus-5', usage: { input_tokens: 10, output_tokens: 1 }, content: [] } },
  ...(title ? [{ type: 'custom-title', sessionId, customTitle: title }] : []),
];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'audit-cli-'));
  const proj = join(root, 'C--proj');
  mkdirSync(join(proj, 'a', 'subagents'), { recursive: true });
  writeFileSync(join(proj, 'a.jsonl'), lines(...req('a1', 'a', 'repo-7')));
  writeFileSync(join(proj, 'a', 'subagents', 'agent-x.jsonl'), lines(...req('a2', 'a')));
  writeFileSync(join(proj, 'b.jsonl'), lines(...req('b1', 'b', 'repo-7')));
  writeFileSync(join(proj, 'c.jsonl'), lines(...req('c1', 'c', 'other')));
  writeFileSync(join(proj, 'd.jsonl'), lines(...req('d1', 'd')));
  return root;
}

test('--session keeps only the windows renamed to that name, subagents included', () => {
  const root = fixture();
  try {
    const r = spawnSync(process.execPath, [cli, '--root', root, '--session', 'repo-7', '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.files, 3);
    assert.equal(j.totals.requests, 3);
    assert.deepEqual(j.names.map((g) => [g.name, g.windows]), [['repo-7', 2]]);
    assert.deepEqual(j.sessions.map((s) => s.sessionId).sort(), ['a', 'b']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--session with no matching window exits 1 and says so', () => {
  const root = fixture();
  try {
    const r = spawnSync(process.execPath, [cli, '--root', root, '--session', 'repo-404'], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no session named repo-404/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
