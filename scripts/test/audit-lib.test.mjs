// scripts/test/audit-lib.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCollector, priceUsage, parseHookBlock, walkTranscripts, readJsonl, renderMarkdown } from '../audit-lib.mjs';

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
