// scripts/test/audit.test.mjs — the audit.mjs CLI's --session filter
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnHarness, tempDir } from './_spawn.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
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
  const root = tempDir('audit-cli-');
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
  const r = spawnHarness(cli, ['--root', root, '--session', 'repo-7', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.files, 3);
  assert.equal(j.totals.requests, 3);
  assert.deepEqual(j.names.map((g) => [g.name, g.windows]), [['ticket-repo-7', 2]]);
  assert.deepEqual(j.sessions.map((s) => s.sessionId).sort(), ['a', 'b']);
});

test('--session --json carries the time dimension for the named windows; --idle-gap sets the threshold', () => {
  const root = fixture();
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
  assert.deepEqual(dflt.names.map((g) => [g.name, g.windows]), [['ticket-repo-8', 1]]);
  for (const k of ['days', 'sessions', 'agents', 'agentRuns', 'tools', 'commands', 'retry']) assert.ok(k in dflt, k);
  const lenient = run('--idle-gap', '30');
  assert.deepEqual([lenient.idleGapMin, lenient.totals.activeMs, lenient.totals.userMs], [30, 21 * 60e3, 19 * 60e3]);
  const bad = spawnHarness(cli, ['--root', root, '--idle-gap', '0']);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /--idle-gap wants minutes > 0/);
});

test('--session keeps only the /rename windows of that name inside a renamed transcript (#115)', () => {
  const root = fixture();
  const proj = join(root, 'C--proj');
  const at = (m) => `2026-10-05T11:${String(m).padStart(2, '0')}:00Z`;
  const say = (id, m) => ({ type: 'assistant', uuid: `u-${id}`, requestId: id, timestamp: at(m), sessionId: 'r',
    message: { id: `m-${id}`, model: 'claude-opus-5', usage: { input_tokens: 10, output_tokens: 1 }, content: [] } });
  const title = (t) => ({ type: 'custom-title', sessionId: 'r', customTitle: t });
  mkdirSync(join(proj, 'r', 'subagents'), { recursive: true });
  writeFileSync(join(proj, 'r.jsonl'), lines(
    say('r1', 0), title('unit-10'), say('r2', 1), title('unit-11'), say('r3', 10), say('r4', 11), title('unit-12'), say('r5', 20),
    { type: 'cost-state', sessionId: 'r', totalCostUSD: 1 }, say('r6', 40)));
  // dispatched in unit-11, it runs on through unit-12's 20-min wait
  writeFileSync(join(proj, 'r', 'subagents', 'agent-s.jsonl'), lines(say('s1', 12), { ...say('s1', 25), uuid: 'u-s1b' }, { ...say('s1', 35), uuid: 'u-s1c' }));
  const run = (name) => {
    const r = spawnHarness(cli, ['--root', root, '--session', name, '--json']);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const ten = run('unit-10');
  assert.deepEqual([ten.files, ten.totals.requests, ten.sessions.map((s) => s.sessionId)], [1, 2, ['r']]);
  const eleven = run('unit-11');
  assert.deepEqual([eleven.files, eleven.totals.requests, eleven.sessions.map((s) => s.sessionId)], [2, 3, ['r#2']]);
  assert.deepEqual(eleven.names.map((g) => [g.name, g.windows, g.requests]), [['ticket-unit-11', 1, 3]]);
  const twelve = run('unit-12');
  // a slice of a transcript is not checked against the whole file's cost-state
  assert.equal(twelve.costState.files, 0);
  // unit-11's subagent still keeps unit-12's wait active, as in a whole-root run
  assert.deepEqual([twelve.totals.requests, twelve.time.totals.wallMs, twelve.time.totals.idleMs], [2, 20 * 60e3, 0]);
  assert.equal(twelve.time.agentRuns.length, 0);
});

test('--session joins on the parsed name: legacy repo-5, typed ticket-repo-5 and tree harness_repo_t5_impl windows are one unit', () => {
  const root = fixture();
  const proj = join(root, 'C--proj');
  writeFileSync(join(proj, 'l.jsonl'), lines(...req('l1', 'l', 'repo-5')));
  writeFileSync(join(proj, 't.jsonl'), lines(...req('t1', 't', 'ticket-repo-5')));
  writeFileSync(join(proj, 'e.jsonl'), lines(...req('e1', 'e', 'epic-repo-5')));
  writeFileSync(join(proj, 'x.jsonl'), lines(...req('x1', 'x', 'harness_repo_t5_impl')));
  for (const name of ['ticket-repo-5', 'repo-5', 'harness_repo_e9_t5_review']) {
    const r = spawnHarness(cli, ['--root', root, '--session', name, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.deepEqual(j.sessions.map((s) => s.sessionId).sort(), ['l', 't', 'x'], name);
    assert.deepEqual(j.names.map((g) => [g.name, g.windows]), [['ticket-repo-5', 3]], name);
    assert.deepEqual(j.time.names.map((g) => [g.name, g.windows]), [['ticket-repo-5', 3]], name);
  }
  const epic = JSON.parse(spawnHarness(cli, ['--root', root, '--session', 'epic-repo-5', '--json']).stdout);
  assert.deepEqual(epic.sessions.map((s) => s.sessionId), ['e'], 'an epic on the same issue is its own unit');
  // a custom name still groups by itself, and an unnamed window stays out of the grouping
  const all = JSON.parse(spawnHarness(cli, ['--root', root, '--json']).stdout);
  assert.deepEqual(all.names.map((g) => g.name).sort(), ['epic-repo-5', 'other', 'ticket-repo-5', 'ticket-repo-7']);
});

test('--session on a tree name keeps the named subagents keyed to it, and a director\'s row no longer holds them (#272)', () => {
  const root = tempDir('audit-cli-');
  const proj = join(root, 'C--proj');
  const sub = join(proj, 'd', 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(proj, 'd.jsonl'), lines(...req('d1', 'd', 'director-harness')));
  writeFileSync(join(sub, 'agent-a01.jsonl'), lines(...req('t1', 'd')));
  writeFileSync(join(sub, 'agent-a01.meta.json'), JSON.stringify({ agentType: 'implementer', name: 'harness_repo_t5_impl' }));
  writeFileSync(join(sub, 'agent-a02.jsonl'), lines(...req('t2', 'd')));
  writeFileSync(join(sub, 'agent-a02.meta.json'), JSON.stringify({ agentType: 'recon' }));
  const run = (name) => {
    const r = spawnHarness(cli, ['--root', root, '--session', name, '--json']);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const ticket = run('harness_repo_e9_t5_review');
  assert.deepEqual([ticket.files, ticket.totals.requests, ticket.names.map((g) => [g.name, g.requests])], [1, 1, [['ticket-repo-5', 1]]]);
  const director = run('director-harness');
  assert.deepEqual([director.files, director.totals.requests, director.names.map((g) => [g.name, g.requests])], [2, 2, [['director-harness', 2]]]);
});

test('--session with no matching window exits 1 and says so', () => {
  const root = fixture();
  const r = spawnHarness(cli, ['--root', root, '--session', 'repo-404']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no session named repo-404/);
  assert.match(r.stderr, /session-name\.mjs/, 'points at the launch line');
  assert.doesNotMatch(r.stderr, /\/rename/);
});

test('--json carries agentMix: a subagent run under its model and the effort its records carry (#113)', () => {
  const root = fixture();
  const proj = join(root, 'C--proj');
  const [rec] = req('x2', 'a');
  writeFileSync(join(proj, 'a', 'subagents', 'agent-x.jsonl'), lines({ ...rec, effort: 'low' }));
  writeFileSync(join(proj, 'a', 'subagents', 'agent-x.meta.json'), JSON.stringify({ agentType: 'recon' }));
  const r = spawnHarness(cli, ['--root', root, '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).agentMix.map(({ type, model, effort, runs }) => [type, model, effort, runs]), [['recon', 'claude-opus-5', 'low', 1]]);
});

test('--stamps checks model stamps against prices.json: exit 1 naming each stale one, 0 when clean (#113)', () => {
  const repo = tempDir('audit-stamps-');
  mkdirSync(join(repo, 'agents'), { recursive: true });
  writeFileSync(join(repo, 'agents', 'ROUTING.md'), 'a\nrule (verified: 2026-08, Opus 4.7)\n');
  const stale = spawnHarness(cli, ['--stamps', '--repo', repo]);
  assert.equal(stale.status, 1, stale.stderr);
  assert.match(stale.stdout, /agents\/ROUTING\.md:2 .*Opus 4\.7.*opus 5\.5/);
  writeFileSync(join(repo, 'agents', 'ROUTING.md'), 'rule (verified: 2026-10, Opus 5.5)\n');
  const clean = spawnHarness(cli, ['--stamps', '--repo', repo]);
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /no stale model stamps/);
});
