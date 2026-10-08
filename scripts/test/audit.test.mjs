// scripts/test/audit.test.mjs — the audit.mjs CLI's --session filter
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnHarness } from './_spawn.mjs';
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
    const r = spawnHarness(cli, ['--root', root, '--session', 'repo-7', '--json']);
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

test('--session --json carries the time dimension for the named windows; --idle-gap sets the threshold', () => {
  const root = fixture();
  try {
    const proj = join(root, 'C--proj');
    const at = (m) => `2026-10-05T10:${String(m).padStart(2, '0')}:00Z`;
    const ask = (m, kind) => ({ type: 'user', uuid: `p${m}`, timestamp: at(m), sessionId: 'e', origin: { kind }, message: { content: 'go' } });
    const say = (m) => ({ type: 'assistant', uuid: `s${m}`, requestId: `e${m}`, timestamp: at(m), sessionId: 'e',
      message: { id: `m-e${m}`, model: 'claude-opus-5', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [] } });
    // prompts at :00 and :20 (a 19-min think), answers a minute later
    writeFileSync(join(proj, 'e.jsonl'), lines(ask(0, 'human'), say(1), ask(20, 'human'), say(21), { type: 'custom-title', sessionId: 'e', customTitle: 'repo-8' }));
    const run = (...extra) => JSON.parse(spawnHarness(cli, ['--root', root, '--session', 'repo-8', '--json', ...extra]).stdout).time;
    const dflt = run();
    assert.equal(dflt.idleGapMin, 10);
    assert.deepEqual([dflt.totals.wallMs, dflt.totals.activeMs, dflt.totals.modelMs], [21 * 60e3, 2 * 60e3, 2 * 60e3]);
    assert.deepEqual(dflt.names.map((g) => [g.name, g.windows]), [['repo-8', 1]]);
    for (const k of ['days', 'sessions', 'agents', 'agentRuns', 'tools', 'commands', 'retry']) assert.ok(k in dflt, k);
    const lenient = run('--idle-gap', '30');
    assert.deepEqual([lenient.idleGapMin, lenient.totals.activeMs, lenient.totals.userMs], [30, 21 * 60e3, 19 * 60e3]);
    const bad = spawnHarness(cli, ['--root', root, '--idle-gap', '0']);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /--idle-gap wants minutes > 0/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--session with no matching window exits 1 and says so', () => {
  const root = fixture();
  try {
    const r = spawnHarness(cli, ['--root', root, '--session', 'repo-404']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no session named repo-404/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
