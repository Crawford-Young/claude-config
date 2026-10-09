// scripts/test/audit-lib.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandHead, createCollector, priceUsage, parseHookBlock, walkTranscripts, readJsonl, renderMarkdown, sessionNames } from '../audit-lib.mjs';

// $/MTok — round numbers so expected costs are easy to read
const PRICES = {
  verified: '2026-10-08',
  webSearchPer1k: 10,
  models: {
    'claude-opus-5': { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
    'claude-haiku-4-5': { input: 1, output: 5, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1 },
  },
};

const usage = (o = {}) => ({
  input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, ...o,
});
let n = 0;
const asst = (requestId, u, { model = 'claude-opus-5', ts = '2026-10-01T12:00:00Z', content = [] } = {}) => ({
  type: 'assistant', uuid: `u${n++}`, requestId, timestamp: ts, sessionId: 's1',
  message: { id: `m-${requestId}`, model, usage: u, content },
});
const MAIN = { sessionId: 's1', agent: null };

test('streaming partials of one request count once, at their final output', () => {
  const c = createCollector({ prices: PRICES });
  c.add(asst('r1', usage({ input_tokens: 1000, output_tokens: 4 })), MAIN);
  c.add(asst('r1', usage({ input_tokens: 1000, output_tokens: 400 })), MAIN);
  c.add(asst('r1', usage({ input_tokens: 1000, output_tokens: 400 })), MAIN);
  const r = c.report();
  assert.equal(r.totals.requests, 1);
  assert.equal(r.totals.tokens.input, 1000);
  assert.equal(r.totals.tokens.output, 400);
  // 1000 * 5/1e6 + 400 * 25/1e6
  assert.equal(r.totals.usd.toFixed(6), (0.005 + 0.01).toFixed(6));
});

test('5m and 1h cache writes are priced at their own rates', () => {
  const five = priceUsage(usage({ cache_creation: { ephemeral_5m_input_tokens: 1e6, ephemeral_1h_input_tokens: 0 } }), 'claude-opus-5', PRICES);
  const hour = priceUsage(usage({ cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1e6 } }), 'claude-opus-5', PRICES);
  assert.equal(five.usd, 6.25);
  assert.equal(hour.usd, 10);
});

test('a write with no tier split falls back to the 5m rate', () => {
  const r = priceUsage({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1e6 }, 'claude-opus-5', PRICES);
  assert.equal(r.usd, 6.25);
});

test('dated model ids resolve to their base price; unknown models are unpriced, never $0', () => {
  assert.equal(priceUsage(usage({ input_tokens: 1e6 }), 'claude-haiku-4-5-20251001', PRICES).usd, 1);
  const unknown = priceUsage(usage({ input_tokens: 1e6 }), 'claude-mystery-9', PRICES);
  assert.equal(unknown.usd, null);
  const c = createCollector({ prices: PRICES });
  c.add(asst('r9', usage({ input_tokens: 1e6 }), { model: 'claude-mystery-9' }), MAIN);
  const r = c.report();
  assert.equal(r.totals.usd, 0);
  assert.deepEqual(Object.keys(r.unpriced), ['claude-mystery-9']);
  assert.equal(r.unpriced['claude-mystery-9'].requests, 1);
});

test('<synthetic> messages are not requests', () => {
  const c = createCollector({ prices: PRICES });
  c.add(asst('rs', usage({ input_tokens: 5 }), { model: '<synthetic>' }), MAIN);
  assert.equal(c.report().totals.requests, 0);
});

test('subagent cost lands on its agent type and its parent session, not the main thread', () => {
  const c = createCollector({ prices: PRICES });
  c.add(asst('r1', usage({ input_tokens: 1e6 })), MAIN);
  const sub = { sessionId: 's1', agent: { id: 'a1', type: 'reviewer', model: 'opus' } };
  c.add(asst('r2', usage({ input_tokens: 2e6 })), sub);
  c.add(asst('r3', usage({ input_tokens: 2e6 })), { sessionId: 's1', agent: { id: 'a2', type: 'reviewer', model: 'opus' } });
  const r = c.report();
  assert.equal(r.agents.reviewer.runs, 2);
  assert.equal(r.agents.reviewer.requests, 2);
  assert.equal(r.agents.reviewer.usd, 20);
  const s = r.sessions.find((x) => x.sessionId === 's1');
  assert.equal(s.usd, 25);
  assert.equal(s.subagentUsd, 20);
});

test('context depth is input + cache read + cache write, peaked over the main thread only', () => {
  const c = createCollector({ prices: PRICES });
  c.add(asst('r1', usage({ input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 5,
    cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 0 } })), MAIN);
  c.add(asst('r2', usage({ input_tokens: 999999 })), { sessionId: 's1', agent: { id: 'a1', type: 'recon' } });
  const r = c.report();
  assert.equal(r.sessions[0].peakDepth, 115);
  assert.equal(r.days[0].peakDepth, 115);
});

test('since/until filter requests by their UTC day', () => {
  const c = createCollector({ prices: PRICES, since: '2026-10-02', until: '2026-10-02' });
  c.add(asst('r1', usage({ input_tokens: 1 }), { ts: '2026-10-01T23:59:59Z' }), MAIN);
  c.add(asst('r2', usage({ input_tokens: 1 }), { ts: '2026-10-02T00:00:00Z' }), MAIN);
  c.add(asst('r3', usage({ input_tokens: 1 }), { ts: '2026-10-03T00:00:00Z' }), MAIN);
  assert.equal(c.report().totals.requests, 1);
});

test('skill calls, slash commands and doc reads are counted once per tool_use id; installed-but-unused skills listed', () => {
  const c = createCollector({ prices: PRICES, installedSkills: ['plan', 'reflect', 'qa'], docPrefixes: ['code/docs/'] });
  const skill = { type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'plan' } };
  const read = { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'C:\\Users\\young\\code\\docs\\web\\TESTING-TRAPS.md' } };
  const other = { type: 'tool_use', id: 't3', name: 'Read', input: { file_path: 'C:/elsewhere/x.md' } };
  const source = { type: 'tool_use', id: 't4', name: 'Read', input: { file_path: 'C:/Users/young/code/docs/tool.mjs' } };
  c.add(asst('r1', usage(), { content: [skill] }), MAIN);
  c.add(asst('r1', usage({ output_tokens: 9 }), { content: [skill] }), MAIN); // partial repeat
  c.add(asst('r2', usage(), { content: [read, other, source] }), MAIN);
  c.add({ type: 'user', uuid: 'x1', timestamp: '2026-10-01T12:00:00Z', message: { content: '<command-name>/reflect</command-name>\n<command-args></command-args>' } }, MAIN);
  const r = c.report();
  assert.deepEqual(r.skills, { plan: 1 });
  assert.deepEqual(r.slash, { reflect: 1 });
  assert.deepEqual(r.unusedSkills, ['qa']);
  assert.deepEqual(r.docs, { 'code/docs/web/TESTING-TRAPS.md': 1 });
});

// #64: skills carry disable-model-invocation and are reached by Reading their SKILL.md from the
// session-start index — a Read of skills/<name>/SKILL.md is an invocation, or every skill reads as dead.
test('a Read of skills/<name>/SKILL.md counts as that skill being invoked, once per tool_use id', () => {
  const c = createCollector({ prices: PRICES, installedSkills: ['plan', 'qa', 'reflect'] });
  const win = { type: 'tool_use', id: 'k1', name: 'Read', input: { file_path: 'C:\\Users\\young\\code\\claude-config\\skills\\qa\\SKILL.md' } };
  const junction = { type: 'tool_use', id: 'k2', name: 'Read', input: { file_path: '/home/u/.claude/skills/plan/SKILL.md' } };
  const sibling = { type: 'tool_use', id: 'k3', name: 'Read', input: { file_path: 'C:/x/skills/reflect/gotchas.md' } };
  c.add(asst('r1', usage(), { content: [win, junction, sibling] }), MAIN);
  c.add(asst('r1', usage({ output_tokens: 3 }), { content: [win] }), MAIN); // partial repeat
  const r = c.report();
  assert.deepEqual(r.skillReads, { qa: 1, plan: 1 });
  assert.deepEqual(r.unusedSkills, ['reflect']);
  assert.match(renderMarkdown(r, { top: 5 }), /\*\*SKILL\.md reads\*\*[\s\S]*\| qa \| 1 \|/);
});

test('a shell command naming skills/<name>/SKILL.md counts as reading that skill, once per skill per call', () => {
  const c = createCollector({ prices: PRICES, installedSkills: ['plan', 'qa', 'reflect', 'worktree'] });
  const cat = { type: 'tool_use', id: 'c1', name: 'Bash', input: { command: 'cd ~/code/claude-config && cat skills/worktree/SKILL.md skills/plan/SKILL.md skills/plan/SKILL.md' } };
  const sed = { type: 'tool_use', id: 'c2', name: 'PowerShell', input: { command: 'Get-Content "C:\\Users\\y\\code\\claude-config\\skills\\qa\\SKILL.md"' } };
  const other = { type: 'tool_use', id: 'c3', name: 'Bash', input: { command: 'cat skills/INDEX.md; wc -c skills/reflect/gotchas.md; echo skills' } };
  c.add(asst('r1', usage(), { content: [cat, sed, other] }), MAIN);
  c.add(asst('r1', usage({ output_tokens: 2 }), { content: [cat] }), MAIN); // partial repeat
  const r = c.report();
  assert.deepEqual(r.skillReads, { worktree: 1, plan: 1, qa: 1 });
  assert.deepEqual(r.unusedSkills, ['reflect']);
});

test('hook block text parses to event, tool, hook script and reason', () => {
  const b = parseHookBlock('PreToolUse:Bash hook error: [node "C:/Users/young/code/claude-config/hooks/bash-guard.mjs"]: A pipe after a gate reports the pipe\'s exit code.\n');
  assert.deepEqual(b, { event: 'PreToolUse', tool: 'Bash', hook: 'bash-guard.mjs', reason: "A pipe after a gate reports the pipe's exit code." });
  assert.equal(parseHookBlock('plain tool error'), null);
});

test('hook blocks, stop-hook durations and attachment fires are tallied; replayed records count once', () => {
  const c = createCollector({ prices: PRICES });
  const block = { type: 'user', uuid: 'b1', timestamp: '2026-10-01T12:00:00Z', message: { content: [{ type: 'tool_result', is_error: true, tool_use_id: 'x',
    content: 'PreToolUse:Agent hook error: [node "C:/h/agent-model-guard.mjs"]: Agent dispatch omits model: and the type has no default' }] } };
  c.add(block, MAIN);
  c.add(block, MAIN); // same uuid replayed into a resumed session's file
  for (const [uuid, ms] of [['s1', 80], ['s2', 120]]) {
    c.add({ type: 'system', subtype: 'stop_hook_summary', uuid, timestamp: '2026-10-01T12:00:00Z',
      hookInfos: [{ command: 'node "C:/h/stop-reflect-gate.mjs"', durationMs: ms }, { command: 'callback' }] }, MAIN);
  }
  c.add({ type: 'attachment', uuid: 'a1', timestamp: '2026-10-01T12:00:00Z', attachment: { type: 'hook_success', hookName: 'SessionStart:startup', hookEvent: 'SessionStart' } }, MAIN);
  const r = c.report();
  assert.equal(r.hooks.blocks['agent-model-guard.mjs'].count, 1);
  assert.equal(r.hooks.timed['stop-reflect-gate.mjs'].fires, 2);
  assert.equal(r.hooks.timed['stop-reflect-gate.mjs'].p50, 80);
  assert.equal(r.hooks.timed['stop-reflect-gate.mjs'].p95, 120);
  assert.equal(r.hooks.fires['SessionStart:startup hook_success'], 1);
});

test('cost-state cross-check compares computed $ with Claude Code\'s own total per session', () => {
  const c = createCollector({ prices: PRICES });
  c.add(asst('r1', usage({ input_tokens: 1e6 })), MAIN);
  c.add({ type: 'cost-state', sessionId: 's1', totalCostUSD: 4 }, MAIN);
  c.add({ type: 'cost-state', sessionId: 's1', totalCostUSD: 5 }, MAIN);
  const r = c.report();
  assert.equal(r.crossCheck.sessions, 1);
  assert.equal(r.crossCheck.reportedUsd, 5);
  assert.equal(r.crossCheck.computedUsd, 5);
});

test('session titles come from custom-title over ai-title', () => {
  const c = createCollector({ prices: PRICES });
  c.add(asst('r1', usage({ input_tokens: 1 })), MAIN);
  c.add({ type: 'ai-title', sessionId: 's1', aiTitle: 'auto' }, MAIN);
  c.add({ type: 'custom-title', sessionId: 's1', customTitle: 'claude-config-62' }, MAIN);
  c.add({ type: 'ai-title', sessionId: 's1', aiTitle: 'auto later' }, MAIN);
  assert.equal(c.report().sessions[0].title, 'claude-config-62');
});

test('sessions group by their custom-title name across windows; unnamed sessions stay out of the grouping', () => {
  const c = createCollector({ prices: PRICES });
  c.add(asst('a1', usage({ input_tokens: 1e6 }), { ts: '2026-10-02T09:00:00Z' }), { sessionId: 'w1', agent: null });
  c.add({ type: 'custom-title', sessionId: 'w1', customTitle: 'claude-config-67' }, { sessionId: 'w1', agent: null });
  c.add(asst('a2', usage({ input_tokens: 2e6 }), { ts: '2026-10-04T09:00:00Z' }), { sessionId: 'w2', agent: null });
  c.add({ type: 'custom-title', sessionId: 'w2', customTitle: 'claude-config-67' }, { sessionId: 'w2', agent: null });
  c.add({ type: 'agent-name', sessionId: 'w3', agentName: 'auto-name' }, { sessionId: 'w3', agent: null });
  c.add({ type: 'ai-title', sessionId: 'w3', aiTitle: 'Auto title' }, { sessionId: 'w3', agent: null });
  c.add(asst('a3', usage({ input_tokens: 1e6 })), { sessionId: 'w3', agent: null });
  const r = c.report();
  assert.deepEqual(r.names, [{ name: 'claude-config-67', windows: 2, requests: 2, usd: 15, subagentUsd: 0, first: '2026-10-02', last: '2026-10-04' }]);
  assert.match(renderMarkdown(r), /## Per session name[\s\S]*\| claude-config-67 \| 2 \| 2026-10-02 \| 2026-10-04 \| 2 \| \$15\.00 \|/);
});

test('sessionNames maps each session to its last custom-title (a /rename), ignoring auto titles', async () => {
  const root = mkdtempSync(join(tmpdir(), 'audit-'));
  try {
    const proj = join(root, 'C--proj');
    mkdirSync(proj, { recursive: true });
    const lines = (...r) => r.map((x) => JSON.stringify(x)).join('\n') + '\n';
    writeFileSync(join(proj, 'a.jsonl'), lines(
      { type: 'custom-title', sessionId: 'a', customTitle: 'first' },
      asst('n1', usage()),
      { type: 'custom-title', sessionId: 'a', customTitle: 'repo-12' },
    ));
    writeFileSync(join(proj, 'b.jsonl'), lines({ type: 'ai-title', sessionId: 'b', aiTitle: 'x' }, { type: 'agent-name', sessionId: 'b', agentName: 'y' }));
    const names = await sessionNames(root);
    assert.deepEqual([...names], [['a', 'repo-12']]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('walkTranscripts finds main sessions and subagents with their meta agentType', async () => {
  const root = mkdtempSync(join(tmpdir(), 'audit-'));
  try {
    const proj = join(root, 'C--proj');
    mkdirSync(join(proj, 'sess-1', 'subagents'), { recursive: true });
    writeFileSync(join(proj, 'sess-1.jsonl'), `${JSON.stringify(asst('w1', usage({ input_tokens: 1 })))}\nnot json\n`);
    writeFileSync(join(proj, 'sess-1', 'subagents', 'agent-abc.jsonl'), `${JSON.stringify(asst('w2', usage({ input_tokens: 1 })))}\n`);
    writeFileSync(join(proj, 'sess-1', 'subagents', 'agent-abc.meta.json'), JSON.stringify({ agentType: 'recon', model: 'sonnet' }));
    const found = [];
    for await (const f of walkTranscripts(root)) found.push(f);
    found.sort((a, b) => a.file.localeCompare(b.file));
    assert.equal(found.length, 2);
    const sub = found.find((f) => f.ctx.agent);
    assert.deepEqual(sub.ctx, { sessionId: 'sess-1', agent: { id: 'abc', type: 'recon', model: 'sonnet' } });
    const main = found.find((f) => !f.ctx.agent);
    assert.deepEqual(main.ctx, { sessionId: 'sess-1', agent: null });
    const recs = [];
    for await (const r of readJsonl(main.file)) recs.push(r);
    assert.equal(recs.length, 1); // the malformed line is skipped
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('renderMarkdown prints every section header', () => {
  const c = createCollector({ prices: PRICES });
  c.add(asst('r1', usage({ input_tokens: 1 })), MAIN);
  const md = renderMarkdown(c.report());
  for (const h of ['## Totals', '## Per day', '## Sessions', '## Per agent type', '## Invocations', '## Hooks']) assert.ok(md.includes(h), h);
});

// ---- time dimension (#97) ------------------------------------------------------

const BASE = Date.parse('2026-10-01T12:00:00Z');
const at = (s) => new Date(BASE + s * 1000).toISOString();
let tn = 0;
const human = (s, text = 'go') => ({ type: 'user', uuid: `h${tn++}`, timestamp: at(s), origin: { kind: 'human' }, message: { content: text } });
const say = (s, rid, content = [], stop = 'tool_use') => ({
  type: 'assistant', uuid: `a${tn++}`, requestId: rid, timestamp: at(s),
  message: { id: `m-${rid}`, model: 'claude-opus-5', stop_reason: stop, usage: usage({ output_tokens: 1 }), content },
});
const use = (id, name, input = {}) => ({ type: 'tool_use', id, name, input });
const result = (s, id, text = 'ok', isError = false) => ({
  type: 'user', uuid: `t${tn++}`, timestamp: at(s), message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: text }] },
});
const feed = (c, ctx, ...recs) => recs.forEach((r) => c.add(r, ctx));
const sec = (ms) => ms / 1000;

test('time: a turn splits into model, tools and waiting on the user, summing to active time', () => {
  const c = createCollector({ prices: PRICES });
  feed(c, MAIN,
    human(0),
    say(2, 'r1'), say(3, 'r1', [use('b1', 'Bash', { command: 'git status' })]),
    result(13, 'b1'),
    say(15, 'r2', [{ type: 'text', text: 'done' }], 'end_turn'),
    human(75));
  const s = c.report().time.sessions[0];
  assert.deepEqual([s.wallMs, s.activeMs, s.idleMs].map(sec), [75, 75, 0]);
  // model: prompt→r1 end (0–3) + result→r2 end (13–15); tools 3–13; user 15–75
  assert.deepEqual([s.modelMs, s.toolsMs, s.userMs, s.otherMs].map(sec), [5, 10, 60, 0]);
});

test('time: bookkeeping records between turn end and the prompt stay waiting on the user', () => {
  const c = createCollector({ prices: PRICES });
  feed(c, MAIN,
    human(0), say(5, 'r1', [], 'end_turn'),
    { type: 'system', subtype: 'away_summary', uuid: 'aw1', timestamp: at(185), content: 'recap' },
    { type: 'queue-operation', timestamp: at(300) },
    human(301));
  const s = c.report().time.sessions[0];
  assert.deepEqual([s.userMs, s.otherMs].map(sec), [296, 0]);
});

test('time: a task-notification wakes the session as other time, not as waiting on the user', () => {
  const c = createCollector({ prices: PRICES });
  feed(c, MAIN,
    human(0), say(5, 'r1', [], 'end_turn'),
    { type: 'user', uuid: 'tn1', timestamp: at(65), origin: { kind: 'task-notification' }, message: { content: '<task-notification>done</task-notification>' } },
    say(70, 'r2', [], 'end_turn'));
  const s = c.report().time.sessions[0];
  assert.deepEqual([s.modelMs, s.userMs, s.otherMs].map(sec), [10, 0, 60]);
});

test('time: a gap over the idle threshold is removed from active time, never from wall time', () => {
  const c = createCollector({ prices: PRICES }); // default threshold: 10 min
  feed(c, MAIN,
    human(0), say(5, 'r1', [], 'end_turn'),
    human(5 + 9 * 60), say(5 + 9 * 60 + 5, 'r2', [], 'end_turn'), // 9 min think: active
    human(5 + 9 * 60 + 5 + 30 * 60), say(5 + 9 * 60 + 5 + 30 * 60 + 5, 'r3', [], 'end_turn')); // 30 min away: idle
  const r = c.report();
  const s = r.time.sessions[0];
  assert.equal(r.time.idleGapMin, 10);
  assert.equal(sec(s.wallMs), 5 + 540 + 5 + 1800 + 5);
  assert.equal(sec(s.idleMs), 1800);
  assert.equal(sec(s.activeMs), 15 + 540);
  assert.equal(sec(s.userMs), 540);
  assert.equal(s.modelMs + s.toolsMs + s.userMs + s.otherMs, s.activeMs);
});

test('time: parallel subagents count once toward session time, each toward its own run', () => {
  const c = createCollector({ prices: PRICES, idleGapMin: 0.5 }); // 30 s: main alone would idle out
  feed(c, MAIN,
    human(0),
    say(2, 'r1', [use('g1', 'Agent', { subagent_type: 'recon' })]),
    say(3, 'r1', [use('g2', 'Agent', { subagent_type: 'recon' })]),
    result(63, 'g1'), result(93, 'g2'),
    say(95, 'r2', [], 'end_turn'));
  const sub = (id) => ({ sessionId: 's1', agent: { id, type: 'recon' } });
  for (const s of [4, 24, 44, 62]) c.add(say(s, `p${s}`), sub('p1'));
  for (const s of [4, 24, 44, 64, 84, 92]) c.add(say(s, `q${s}`), sub('p2'));
  const t = c.report().time;
  const s = t.sessions[0];
  assert.equal(sec(s.idleMs), 0, 'subagent activity keeps the parent session active');
  assert.equal(sec(s.wallMs), 95);
  assert.equal(sec(s.toolsMs), 93 - 3, 'overlapping Agent calls are one span, not 60 s + 91 s');
  assert.equal(sec(s.modelMs), 3 + 2);
  assert.deepEqual(t.agentRuns.map((x) => [x.id, sec(x.wallMs)]).sort(), [['p1', 58], ['p2', 88]]);
  assert.equal(sec(t.agents.recon.wallMs), 58 + 88);
  assert.equal(t.agents.recon.runs, 2);
});

test('time: a hook block and a failed call are charged piecewise up to the successful retry', () => {
  const c = createCollector({ prices: PRICES });
  const blockText = 'PreToolUse:Bash hook error: [node "C:/h/bash-guard.mjs"]: A pipe after a gate reports the pipe\'s exit code.';
  feed(c, MAIN,
    human(0),
    say(10, 'r1', [use('b1', 'Bash', { command: 'node --test x | tail' })]), result(10, 'b1', blockText, true),
    say(40, 'r2', [use('b2', 'Bash', { command: 'node --test x' })]), result(41, 'b2', 'Exit code 1\nfail', true),
    say(70, 'r3', [use('b3', 'Bash', { command: 'node --test x' })]), result(71, 'b3', 'ok'),
    say(72, 'r4', [use('e1', 'Edit', { file_path: 'a' })]),
    result(72, 'e1', 'PreToolUse:Edit hook error: [node "C:/h/main-guard.mjs"]: main checkout', true),
    say(80, 'r5', [], 'end_turn'));
  const { blocks, errors } = c.report().time.retry;
  assert.deepEqual(blocks['bash-guard.mjs'], { count: 1, retried: 1, unresolved: 0, ms: 30000,
    reasons: { "A pipe after a gate reports the pipe's exit code.": { count: 1, ms: 30000 } } });
  assert.deepEqual(errors.Bash, { count: 1, retried: 1, unresolved: 0, ms: 30000, reasons: { 'Exit code 1': { count: 1, ms: 30000 } } });
  assert.deepEqual(blocks['main-guard.mjs'], { count: 1, retried: 0, unresolved: 1, ms: 0, reasons: { 'main checkout': { count: 1, ms: 0 } } });
});

test('time: non-hook gates are blocks by gate name; a declined question is not a retry', () => {
  const c = createCollector({ prices: PRICES });
  feed(c, MAIN,
    human(0),
    say(1, 'r1', [use('q1', 'AskUserQuestion')]), result(5, 'q1', "The user doesn't want to proceed with this tool use.", true),
    say(6, 'r2', [use('q2', 'AskUserQuestion')]), result(9, 'q2'),
    say(10, 'r3', [use('b1', 'Bash', { command: 'git push' })]),
    result(11, 'b1', 'Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Git Push]. If you have other tasks…', true),
    say(12, 'r4', [use('b2', 'Bash', { command: 'cd x' })]),
    result(12, 'b2', '<tool_use_error>This session is isolated in the worktree C:\\w, but this command is too complex to verify. Refusing.</tool_use_error>', true),
    say(20, 'r5', [use('b3', 'Bash', { command: 'git status' })]), result(21, 'b3'),
    say(22, 'r6', [], 'end_turn'));
  const { blocks, errors } = c.report().time.retry;
  assert.deepEqual(Object.keys(blocks).sort(), ['auto-mode classifier', 'worktree isolation']);
  assert.equal(blocks['auto-mode classifier'].ms, 2000);
  assert.deepEqual(Object.keys(blocks['auto-mode classifier'].reasons), ['[Git Push]']);
  assert.deepEqual(Object.keys(blocks['worktree isolation'].reasons), ['this command is too complex to verify']);
  assert.equal(blocks['worktree isolation'].ms, 8000);
  assert.deepEqual(errors, {});
});

test('time: retry cost excludes an idle gap between the block and the retry', () => {
  const c = createCollector({ prices: PRICES });
  const blockText = 'PreToolUse:Bash hook error: [node "C:/h/bash-guard.mjs"]: nope';
  feed(c, MAIN,
    human(0),
    say(10, 'r1', [use('b1', 'Bash', { command: 'x' })]), result(10, 'b1', blockText, true),
    say(20, 'r2', [], 'end_turn'),
    human(20 + 3600),
    say(3630, 'r3', [use('b2', 'Bash', { command: 'y' })]), result(3631, 'b2'));
  assert.equal(c.report().time.retry.blocks['bash-guard.mjs'].ms, (3630 - 10 - 3600) * 1000);
});

test('time: tool latency by tool and by command head; AskUserQuestion is user time, not tool latency', () => {
  const c = createCollector({ prices: PRICES });
  feed(c, MAIN,
    human(0),
    say(1, 'r1', [use('q1', 'AskUserQuestion')]), result(61, 'q1'),
    say(62, 'r2', [use('b1', 'Bash', { command: 'cd /x && git -C repo status --short' })]), result(64, 'b1'),
    say(65, 'r3', [use('b2', 'Bash', { command: 'git status' })]), result(69, 'b2'),
    say(70, 'r4', [use('m1', 'mcp__claude-in-chrome__navigate')]), result(73, 'm1'),
    say(74, 'r5', [], 'end_turn'));
  const t = c.report().time;
  assert.equal(t.tools.AskUserQuestion, undefined);
  assert.deepEqual(t.tools.Bash, { calls: 2, p50: 2000, p95: 4000, totalMs: 6000 });
  assert.deepEqual(t.commands['git status'], { calls: 2, p50: 2000, p95: 4000, totalMs: 6000 });
  assert.equal(t.tools['mcp__claude-in-chrome__navigate'].p50, 3000);
  assert.equal(sec(t.sessions[0].userMs), 60);
});

test('commandHead keeps the program and its subcommand, dropping cd prefixes, env and flags', () => {
  assert.equal(commandHead('cd C:/x && git -C repo log --oneline'), 'git log');
  assert.equal(commandHead('FOO=1 node "C:/a/scripts/audit.mjs" --json'), 'node audit.mjs');
  assert.equal(commandHead('ls -la'), 'ls');
  assert.equal(commandHead('Get-ChildItem -Recurse'), 'Get-ChildItem');
  assert.equal(commandHead('export PATH=/x:$PATH; pnpm test'), 'pnpm test');
  assert.equal(commandHead('cd ~/code\nnode --test a.mjs'), 'node a.mjs');
  assert.equal(commandHead('check() {\n  rg foo\n}'), 'rg');
  assert.equal(commandHead('check() {\n  out=$(nslookup -type=NS \\\n  x.com)\n}'), 'nslookup');
  assert.equal(commandHead('# note\nls'), 'ls');
  assert.equal(commandHead('cd x'), '?');
  assert.equal(commandHead(''), '?');
});

test('time: replayed records in a resumed session\'s file are timed once', () => {
  const c = createCollector({ prices: PRICES });
  const recs = [human(0), say(5, 'r1', [], 'end_turn')];
  feed(c, MAIN, ...recs);
  feed(c, { sessionId: 's2', agent: null }, ...recs, human(100), say(110, 'r2', [], 'end_turn'));
  const t = c.report().time;
  assert.deepEqual(t.sessions.map((s) => [s.sessionId, sec(s.wallMs)]).sort(), [['s1', 5], ['s2', 10]]);
});

test('inline: main-session Edit/Write calls vs Agent dispatches, with the longest no-dispatch run of files (#99)', () => {
  const c = createCollector({ prices: PRICES });
  feed(c, MAIN,
    human(0),
    say(1, 'r1', [use('e1', 'Edit', { file_path: 'a' }), use('e2', 'Edit', { file_path: 'b' }), use('w1', 'Write', { file_path: 'a' })]),
    say(2, 'r2', [use('g1', 'Agent', { subagent_type: 'implementer' })]),
    say(3, 'r3', [use('e3', 'Edit', { file_path: 'c' }), use('n1', 'NotebookEdit', { notebook_path: 'd.ipynb' })]),
    say(4, 'r4', [], 'end_turn'));
  c.add(say(2.5, 'x1', [use('e9', 'Edit', { file_path: 'z' })]), { sessionId: 's1', agent: { id: 'p1', type: 'implementer' } });
  const r = c.report();
  assert.deepEqual(r.inline, [{ sessionId: 's1', title: '', edits: 5, editFiles: 4, dispatches: 1, longestRun: 2 }]);
  assert.match(renderMarkdown(r), /## Inline edits vs dispatches[\s\S]*\| s1 \| 5 \| 4 \| 1 \| 2 \|/);
});

test('time: per-day and per-name rows split at UTC midnight and sum every window of the name', () => {
  const c = createCollector({ prices: PRICES });
  const w = (sessionId) => ({ sessionId, agent: null });
  const mid = (Date.parse('2026-10-02T00:00:00Z') - BASE) / 1000;
  feed(c, w('w1'), human(mid - 60), say(mid + 60, 'n1', [], 'end_turn'), { type: 'custom-title', sessionId: 'w1', customTitle: 'repo-5' });
  feed(c, w('w2'), human(mid + 3600), say(mid + 3630, 'n2', [], 'end_turn'), { type: 'custom-title', sessionId: 'w2', customTitle: 'repo-5' });
  const r = c.report();
  const t = r.time;
  assert.deepEqual(t.days.map((d) => [d.day, sec(d.activeMs)]), [['2026-10-01', 60], ['2026-10-02', 90]]);
  assert.deepEqual(t.names.map((g) => [g.name, g.windows, sec(g.activeMs), sec(g.wallMs)]), [['repo-5', 2, 150, 150]]);
  assert.equal(sec(t.totals.activeMs), 150);
  const md = renderMarkdown(r);
  for (const h of ['## Time', '**Per day**', '**Per session name**', '**Agent time**', '**Tool latency**', '**Retry and block cost**']) assert.ok(md.includes(h), h);
  assert.match(md, /idle gaps over 10 min removed/);
});

test('walkTranscripts skips an unreadable directory and keeps walking', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-bad-'));
  mkdirSync(join(root, 'a-proj', 'sess'), { recursive: true });
  writeFileSync(join(root, 'a-proj', 'sess', 'subagents'), 'not a dir');
  mkdirSync(join(root, 'b-proj'));
  writeFileSync(join(root, 'b-proj', 's.jsonl'), '{}\n');
  const found = [];
  for await (const f of walkTranscripts(root)) found.push(f.file);
  assert.deepEqual(found, [join(root, 'b-proj', 's.jsonl')]);
  rmSync(root, { recursive: true, force: true });
});

test('walkTranscripts follows a symlinked project directory', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'wt-link-'));
  const real = mkdtempSync(join(tmpdir(), 'wt-real-'));
  writeFileSync(join(real, 's.jsonl'), '{}\n');
  try {
    symlinkSync(real, join(root, 'linked'), 'junction');
  } catch {
    t.skip('cannot create a link here');
    return;
  }
  const found = [];
  for await (const f of walkTranscripts(root)) found.push(f.file);
  assert.deepEqual(found, [join(root, 'linked', 's.jsonl')]);
});
