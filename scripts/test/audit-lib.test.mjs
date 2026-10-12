// scripts/test/audit-lib.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandHead, createCollector, priceUsage, parseHookBlock, walkTranscripts, readJsonl, renderMarkdown, transcriptWindows, windowSplitter } from '../audit-lib.mjs';

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

test('costState: Claude Code\'s own running total per transcript file (its latest), beside the computed $', () => {
  const c = createCollector({ prices: PRICES });
  c.add(asst('r1', usage({ input_tokens: 1e6 })), MAIN);
  c.add({ type: 'cost-state', sessionId: 's1', totalCostUSD: 4 }, MAIN);
  c.add({ type: 'cost-state', sessionId: 's1', totalCostUSD: 5 }, MAIN);
  c.add({ type: 'cost-state', sessionId: 's9', totalCostUSD: 3 }, { sessionId: 's9', agent: null }); // no request: nothing to set beside
  c.add(asst('r8', usage({ input_tokens: 1e6 })), { sessionId: 's8', agent: null });
  c.add({ type: 'cost-state', sessionId: 's8', totalCostUSD: 0 }, { sessionId: 's8', agent: null }); // a zero total reports nothing
  const r = c.report();
  assert.equal(r.crossCheck, undefined);
  assert.deepEqual(r.costState, { files: 1, reportedUsd: 5, computedUsd: 5 });
});

test('the cost-state line states its wider scope and never sends you to prices.json (#116)', () => {
  const c = createCollector({ prices: PRICES });
  c.add(asst('r1', usage({ input_tokens: 1e6 })), MAIN);
  c.add({ type: 'cost-state', sessionId: 's1', totalCostUSD: 10 }, MAIN);
  const md = renderMarkdown(c.report());
  assert.match(md, /cost-state \(1 transcripts\): computed \$5\.00 vs Claude Code's \$10\.00 \(Δ -50\.0%\)/);
  assert.match(md, /not a price check/);
  assert.doesNotMatch(md, /check prices\.json/);
});

// ---- per-model price check on cost-state's own tokens (#141) ----------------------

/** A cost-state record whose modelUsage is opus-5 at PRICES: 1M in + 1M out = $30 */
const costStateOf = (modelUsage, totalCostUSD = 1) => ({ type: 'cost-state', sessionId: 's1', totalCostUSD, modelUsage });
const mu = (o = {}) => ({ inputTokens: 1e6, outputTokens: 1e6, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 30, ...o });
const checkOf = (prices, record) => {
  const c = createCollector({ prices });
  c.add(asst('r1', usage({ input_tokens: 1 })), MAIN);
  c.add(record, MAIN);
  return c.report().priceCheck;
};

test('priceCheck: a model whose cost-state $ matches prices.json on its own tokens is ok', () => {
  const pc = checkOf(PRICES, costStateOf({ 'claude-opus-5': mu() }));
  assert.deepEqual(pc.models['claude-opus-5'], { files: 1, excepted: 0, band: 1, drift: [] });
});

test('priceCheck: a $ beyond the 1% tolerance is drift, one inside it is not', () => {
  const off = checkOf(PRICES, costStateOf({ 'claude-opus-5': mu({ costUSD: 33 }) })); // priced $30 vs $33: cost-state is 10% above
  assert.equal(off.models['claude-opus-5'].drift.length, 1);
  assert.ok(Math.abs(off.models['claude-opus-5'].drift[0] - 10) < 0.01, `${off.models['claude-opus-5'].drift}`);
  const near = checkOf(PRICES, costStateOf({ 'claude-opus-5': mu({ costUSD: 30.05 }) })); // +0.17%
  assert.deepEqual(near.models['claude-opus-5'].drift, []);
});

test('priceCheck: cache writes carry no tier in modelUsage, so $ between the all-5m and all-1h price is ok', () => {
  const w = { cacheCreationInputTokens: 1e6 }; // 5m $6.25, 1h $10 on top of $30
  const at = (costUSD) => checkOf(PRICES, costStateOf({ 'claude-opus-5': mu({ ...w, costUSD }) })).models['claude-opus-5'].drift;
  assert.deepEqual(at(36.25), []);
  assert.deepEqual(at(40), []);
  assert.deepEqual(at(38), []); // a mix
  assert.equal(at(41).length, 1); // above the 1h price
  assert.equal(at(35).length, 1); // below the 5m price
});

test('priceCheck: web searches are priced', () => {
  const pc = checkOf(PRICES, costStateOf({ 'claude-opus-5': mu({ webSearchRequests: 100, costUSD: 31 }) })); // 100 x $10/1k
  assert.deepEqual(pc.models['claude-opus-5'].drift, []);
});

test('priceCheck: a dated exception is reported as an exception, never as drift, and still catches other drift', () => {
  const ex = { price: { cacheRead: 1 }, since: '2026-10-12', waitsOn: 'Claude Code pricing cache reads at the published price' };
  const prices = { ...PRICES, models: { ...PRICES.models, 'claude-opus-5': { ...PRICES.models['claude-opus-5'], exception: ex } } };
  const read = { cacheReadInputTokens: 1e6 }; // published $0.50, Claude Code $1
  const pc = checkOf(prices, costStateOf({ 'claude-opus-5': mu({ ...read, costUSD: 31 }) }));
  assert.deepEqual(pc.models['claude-opus-5'], { files: 1, excepted: 1, band: 1, drift: [] });
  const published = checkOf(prices, costStateOf({ 'claude-opus-5': mu({ ...read, costUSD: 30.5 }) }));
  assert.deepEqual(published.models['claude-opus-5'], { files: 1, excepted: 0, band: 1, drift: [] });
  const other = checkOf(prices, costStateOf({ 'claude-opus-5': mu({ ...read, costUSD: 40 }) }));
  assert.equal(other.models['claude-opus-5'].drift.length, 1);
});

test('priceCheck: models with no price or no $ are skipped (the unpriced warning covers them)', () => {
  const pc = checkOf(PRICES, costStateOf({ 'claude-mystery-9': mu(), 'claude-opus-5': mu({ costUSD: 0 }) }));
  assert.deepEqual(pc.models, {});
});

test('priceCheck: renders drift as a warning and an exception as a dated exception', () => {
  const ex = { price: { cacheRead: 1 }, since: '2026-10-12', waitsOn: 'Claude Code correcting the cache-read price' };
  const prices = { ...PRICES, models: { ...PRICES.models, 'claude-opus-5': { ...PRICES.models['claude-opus-5'], exception: ex } } };
  const c = createCollector({ prices });
  c.add(asst('r1', usage({ input_tokens: 1 })), MAIN);
  c.add(costStateOf({ 'claude-opus-5': mu({ cacheReadInputTokens: 1e6, costUSD: 31 }), 'claude-haiku-4-5': mu({ costUSD: 99 }) }, 130), MAIN);
  const md = renderMarkdown(c.report());
  assert.match(md, /⚠ price drift claude-haiku-4-5: 1 of 1 cost-state files off by/);
  assert.match(md, /exception claude-opus-5 \(since 2026-10-12\): 1 of 1 cost-state files fit only cacheRead \$1 \(published cacheRead \$0\.5\); waits on Claude Code correcting the cache-read price/);
  assert.doesNotMatch(md, /drift claude-opus-5/);
});

test('priceCheck: a clean check renders one line', () => {
  const c = createCollector({ prices: PRICES });
  c.add(asst('r1', usage({ input_tokens: 1 })), MAIN);
  c.add(costStateOf({ 'claude-opus-5': mu() }), MAIN);
  assert.match(renderMarkdown(c.report()), /price check: 1 model within [\d.]+% of cost-state on its own tokens \(1 of 1 model-files band-checked/);
});

// ---- point estimate from the transcript's own 5m/1h split --------------------------

/** One opus-5 request writing 1M at 5m and 1M at 1h (+1M input): $5 + $6.25 + $10 = $21.25; its band is $17.50-$25. */
const splitRequest = () => asst('r1', usage({ input_tokens: 1e6, cache_creation_input_tokens: 2e6, cache_creation: { ephemeral_5m_input_tokens: 1e6, ephemeral_1h_input_tokens: 1e6 } }));
const splitCheck = (costUSD) => {
  const c = createCollector({ prices: PRICES });
  c.add(splitRequest(), MAIN);
  c.add(costStateOf({ 'claude-opus-5': mu({ outputTokens: 0, cacheCreationInputTokens: 2e6, costUSD }) }), MAIN);
  return c.report().priceCheck.models['claude-opus-5'];
};

test('priceCheck: a uniform 10% repricing inside the 5m/1h band is drift once the file\'s own tier split prices it', () => {
  const exact = splitCheck(21.25);
  assert.deepEqual(exact, { files: 1, excepted: 0, band: 0, drift: [] });
  const off = splitCheck(21.25 * 1.1); // $23.375: inside the band, outside the point
  assert.equal(off.band, 0);
  assert.equal(off.drift.length, 1);
  assert.ok(Math.abs(off.drift[0] - 10) < 0.01, `${off.drift}`);
});

test('priceCheck: a file with no recorded writes for the model falls back to the band and says so', () => {
  const c = createCollector({ prices: PRICES });
  c.add(asst('r1', usage({ input_tokens: 1 })), MAIN);
  c.add(costStateOf({ 'claude-opus-5': mu({ cacheCreationInputTokens: 1e6, costUSD: 38 }) }), MAIN); // between $36.25 and $40
  const m = c.report().priceCheck.models['claude-opus-5'];
  assert.deepEqual(m, { files: 1, excepted: 0, band: 1, drift: [] });
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

// ---- /rename windows (#115) ----------------------------------------------------

const title = (customTitle) => ({ type: 'custom-title', customTitle });
const said = (ts) => ({ type: 'assistant', timestamp: ts });
const typed = (ts) => ({ type: 'user', timestamp: ts });
const splitWindows = (recs) => {
  const split = windowSplitter();
  for (const rec of recs) split.push(rec);
  return split.windows();
};
const shape = (recs) => splitWindows(recs).map((w) => [w.name, w.first]);

test('splitWindows: each change of custom-title starts a window; a repeat title does not', () => {
  assert.deepEqual(shape([title('a'), said(), title('a'), said(), title('b'), said(), title('c'), said()]), [['a', 0], ['b', 4], ['c', 6]]);
  assert.deepEqual(shape([title('a'), said(), title('b'), said(), title('a'), said()]), [['a', 0], ['b', 2], ['a', 4]]);
});

test('splitWindows: records before the first title take that title', () => {
  assert.deepEqual(shape([typed(), said(), title('late'), said()]), [['late', 0]]);
});

test('splitWindows: a reply-less window merges forward, a run of them all the way; the final one stays', () => {
  // the carried-name prelude a /clear writes at the top of a new file
  assert.deepEqual(shape([title('old'), typed(), title('new'), said()]), [['new', 0]]);
  assert.deepEqual(shape([title('a'), title('b'), typed(), title('c'), said()]), [['c', 0]]);
  assert.deepEqual(shape([title('a'), said(), title('b'), typed()]), [['a', 0], ['b', 2]]);
});

test('splitWindows: no custom-title is one unnamed window; startedAt is the earliest stamp, a prelude\'s included', () => {
  assert.deepEqual(shape([typed(), said()]), [[undefined, 0]]);
  assert.deepEqual(shape([]), [[undefined, 0]]);
  const w = splitWindows([title('old'), typed('2026-10-01T10:00:00Z'), title('new'), said('2026-10-01T10:05:00Z'), title('x'), said('2026-10-01T11:00:00Z')]);
  assert.deepEqual(w.map((x) => [x.name, x.startedAt]), [['new', Date.parse('2026-10-01T10:00:00Z')], ['x', Date.parse('2026-10-01T11:00:00Z')]]);
});

const T = (m) => `2026-10-05T10:${String(m).padStart(2, '0')}:00Z`;
const jsonl = (...r) => r.map((x) => JSON.stringify(x)).join('\n') + '\n';

/** f: a late-titled a, a repeat a, then b and c mid-file; g: a carried-name prelude (b) then d;
 *  subagent x starts while b is live, subagent y has no timestamp. */
function windowFixture() {
  const root = mkdtempSync(join(tmpdir(), 'audit-win-'));
  const proj = join(root, 'C--proj');
  mkdirSync(join(proj, 'f', 'subagents'), { recursive: true });
  writeFileSync(join(proj, 'f.jsonl'), jsonl(
    { type: 'user', uuid: 'f-u0', timestamp: T(0), message: { content: 'go' } },
    asst('f1', usage({ input_tokens: 1e6 }), { ts: T(1) }),
    title('a'), title('a'),
    asst('f2', usage({ input_tokens: 1e6 }), { ts: T(2) }),
    title('b'),
    { type: 'user', uuid: 'f-u1', timestamp: T(10), message: { content: 'next' } },
    asst('f3', usage({ input_tokens: 2e6 }), { ts: T(11) }),
    title('c'),
    asst('f4', usage({ input_tokens: 1e6 }), { ts: T(20) }),
    { type: 'cost-state', totalCostUSD: 27 },
  ));
  writeFileSync(join(proj, 'f', 'subagents', 'agent-x.jsonl'), jsonl(asst('x1', usage({ input_tokens: 2e5 }), { ts: T(12) })));
  writeFileSync(join(proj, 'f', 'subagents', 'agent-x.meta.json'), JSON.stringify({ agentType: 'recon' }));
  writeFileSync(join(proj, 'f', 'subagents', 'agent-y.jsonl'), jsonl({ ...asst('y1', usage({ input_tokens: 2e5 })), timestamp: undefined }));
  writeFileSync(join(proj, 'g.jsonl'), jsonl(
    title('b'),
    { type: 'user', uuid: 'g-u0', timestamp: T(30), message: { content: 'carried' } },
    title('d'),
    asst('g1', usage({ input_tokens: 1e6 }), { ts: T(31) }),
  ));
  writeFileSync(join(proj, 'h.jsonl'), jsonl({ type: 'ai-title', aiTitle: 'auto h' }, asst('h1', usage({ input_tokens: 1e6 }), { ts: T(40) })));
  return root;
}

async function auditRoot(root) {
  const c = createCollector({ prices: PRICES });
  for await (const { records } of transcriptWindows(root)) for await (const { rec, ctx } of records) c.add(rec, ctx);
  return c.report();
}

/** [file, window, name, record count] per window, sorted. */
async function windowShape(root) {
  const seen = [];
  for await (const { file, windows, records } of transcriptWindows(root)) {
    const n = new Map(windows.map((w) => [w, 0]));
    for await (const { ctx } of records) n.set(ctx, n.get(ctx) + 1);
    for (const [ctx, k] of n) seen.push([file.split(/[\\/]/).pop(), ctx.window, ctx.name, k]);
  }
  return seen.sort((x, y) => `${x[0]}${x[1]}`.localeCompare(`${y[0]}${y[1]}`));
}

test('transcriptWindows: one session row per window, titled by its name; subagents join the window live at their earliest stamp', async () => {
  const root = windowFixture();
  try {
    const r = await auditRoot(root);
    const rows = r.sessions.map((s) => [s.sessionId, s.title, s.requests, s.usd, s.subagentUsd]).sort((x, y) => x[0].localeCompare(y[0]));
    assert.deepEqual(rows, [
      ['f', 'a', 2, 10, 0],
      ['f#2', 'b', 2, 11, 1],
      ['f#3', 'c', 2, 6, 1],
      ['g', 'd', 1, 5, 0],
      ['h', 'auto h', 1, 5, 0],
    ]);
    assert.deepEqual(r.names.map((g) => [g.name, g.windows, g.requests, g.usd]).sort(), [['a', 1, 2, 10], ['b', 1, 2, 11], ['c', 1, 2, 6], ['d', 1, 1, 5]]);
    assert.deepEqual(r.time.names.map((g) => [g.name, g.windows]).sort(), [['a', 1], ['b', 1], ['c', 1], ['d', 1]]);
    assert.deepEqual(r.time.agentRuns.map((a) => [a.id, a.sessionId]), [['x', 'f#2']]);
    // cost-state stays per transcript file: f's reported total against the sum of its windows
    assert.deepEqual(r.costState, { files: 1, reportedUsd: 27, computedUsd: 27 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('transcriptWindows: ctx carries the window key and name; a subagent before every window joins the first, one stamped at a window\'s start joins it; one with no parent transcript stays unnamed', async () => {
  const root = windowFixture();
  try {
    mkdirSync(join(root, 'C--proj', 'orphan', 'subagents'), { recursive: true });
    writeFileSync(join(root, 'C--proj', 'orphan', 'subagents', 'agent-z.jsonl'), jsonl(asst('z1', usage(), { ts: T(50) })));
    writeFileSync(join(root, 'C--proj', 'f', 'subagents', 'agent-early.jsonl'), jsonl(asst('e1', usage(), { ts: '2026-10-05T09:59:00Z' })));
    writeFileSync(join(root, 'C--proj', 'f', 'subagents', 'agent-at.jsonl'), jsonl(asst('t1', usage(), { ts: T(10) }))); // b's first stamp
    assert.deepEqual(await windowShape(root), [
      ['agent-at.jsonl', 'f#2', 'b', 1],
      ['agent-early.jsonl', 'f', 'a', 1],
      ['agent-x.jsonl', 'f#2', 'b', 1],
      ['agent-y.jsonl', 'f#3', 'c', 1],
      ['agent-z.jsonl', 'orphan', undefined, 1],
      ['f.jsonl', 'f', 'a', 5],
      ['f.jsonl', 'f#2', 'b', 3],
      ['f.jsonl', 'f#3', 'c', 3],
      ['g.jsonl', 'g', 'd', 4],
      ['h.jsonl', 'h', undefined, 2],
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('transcriptWindows: a resumed file\'s replayed records stay with the transcript that holds them first, out of its split and its records (strate parity)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'audit-replay-'));
  try {
    const proj = join(root, 'C--proj');
    mkdirSync(proj, { recursive: true });
    const original = [{ type: 'user', uuid: 'a-u0', timestamp: T(0), message: { content: 'go' } }, asst('a1', usage({ input_tokens: 1e6 }), { ts: T(1) })];
    writeFileSync(join(proj, 'a.jsonl'), jsonl(...original, title('a')));
    // the resume replays a's records (same uuids) under the carried name, then renames
    writeFileSync(join(proj, 'b.jsonl'), jsonl(...original, title('a'), title('b'),
      { type: 'user', uuid: 'b-u0', timestamp: T(10), message: { content: 'resumed' } }, asst('b1', usage({ input_tokens: 1e6 }), { ts: T(11) })));
    assert.deepEqual(await windowShape(root), [['a.jsonl', 'a', 'a', 3], ['b.jsonl', 'b', 'b', 4]]);
    const r = await auditRoot(root);
    assert.deepEqual(r.sessions.map((s) => [s.sessionId, s.title, s.requests]).sort(), [['a', 'a', 1], ['b', 'b', 1]]);
    assert.deepEqual(r.time.sessions.map((s) => [s.sessionId, s.wallMs / 60e3]).sort(), [['a', 1], ['b', 1]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('transcriptWindows: a replay belongs to the original transcript whatever the files\' names sort to (#142)', async () => {
  // the original and its resume, written under names in both orders; the resume's replay
  // carries the original's records unchanged, so it is the file span that tells them apart
  const run = async (originalName, resumeName) => {
    const root = mkdtempSync(join(tmpdir(), 'audit-order-'));
    try {
      const proj = join(root, 'C--proj');
      mkdirSync(proj, { recursive: true });
      const original = [{ type: 'user', uuid: 'o-u0', timestamp: T(0), message: { content: 'go' } }, asst('o1', usage({ input_tokens: 1e6 }), { ts: T(1) })];
      writeFileSync(join(proj, `${originalName}.jsonl`), jsonl(...original, title('one')));
      writeFileSync(join(proj, `${resumeName}.jsonl`), jsonl(...original, title('one'), title('two'),
        { type: 'user', uuid: 'r-u0', timestamp: T(10), message: { content: 'resumed' } }, asst('r1', usage({ input_tokens: 1e6 }), { ts: T(11) })));
      const r = await auditRoot(root);
      const wall = new Map(r.time.sessions.map((s) => [s.sessionId, s.wallMs / 60e3]));
      return {
        shape: (await windowShape(root)).map(([file, , name, n]) => [file.replace(`${originalName}.jsonl`, 'ORIGINAL').replace(`${resumeName}.jsonl`, 'RESUME'), name, n]).sort(),
        rows: r.sessions.map((s) => [s.title, s.requests, wall.get(s.sessionId)]).sort(),
      };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
  const originalFirst = await run('a', 'b');
  const resumeFirst = await run('b', 'a'); // the resume sorts first by name
  assert.deepEqual(originalFirst.shape, [['ORIGINAL', 'one', 3], ['RESUME', 'two', 4]]);
  assert.deepEqual(originalFirst.rows, [['one', 1, 1], ['two', 1, 1]]);
  assert.deepEqual(resumeFirst, originalFirst);
});

test('transcriptWindows: a uuid repeated within one file is read once, as a replay is', async () => {
  const root = mkdtempSync(join(tmpdir(), 'audit-repeat-'));
  try {
    mkdirSync(join(root, 'C--proj'), { recursive: true });
    const said1 = asst('p1', usage({ input_tokens: 1e6 }), { ts: T(1) });
    writeFileSync(join(root, 'C--proj', 'p.jsonl'), jsonl({ type: 'user', uuid: 'p-u0', timestamp: T(0), message: { content: 'go' } }, said1, said1));
    assert.deepEqual(await windowShape(root), [['p.jsonl', 'p', undefined, 2]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('transcriptWindows: a file removed between its split and its records yields no records instead of throwing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'audit-gone-'));
  try {
    mkdirSync(join(root, 'C--proj'), { recursive: true });
    const file = join(root, 'C--proj', 'q.jsonl');
    writeFileSync(file, jsonl(asst('q1', usage(), { ts: T(1) })));
    let n = 0;
    for await (const { records } of transcriptWindows(root)) {
      rmSync(file);
      for await (const _ of records) n++;
    }
    assert.equal(n, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an empty custom-title is no name: it neither splits a window nor clears its name', () => {
  assert.deepEqual(shape([title('a'), said(), title(''), said()]), [['a', 0]]);
  const c = createCollector({ prices: PRICES });
  const ctx = { sessionId: 's1', agent: null, window: 's1', name: 'a' };
  feed(c, ctx, title('a'), asst('e1', usage({ input_tokens: 1e6 })), title(''), asst('e2', usage({ input_tokens: 1e6 })));
  const r = c.report();
  assert.deepEqual(r.sessions.map((s) => [s.sessionId, s.title]), [['s1', 'a']]);
  assert.deepEqual(r.names.map((g) => [g.name, g.windows, g.usd]), [['a', 1, 10]]);
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

test('time: windows tile their file; a subagent outliving its window keeps the parent\'s wait across a rename active (#115)', () => {
  const c = createCollector({ prices: PRICES, idleGapMin: 0.5 }); // 30 s: the parent alone would idle out
  const one = { sessionId: 's1', agent: null, window: 's1', name: 'one' };
  const two = { sessionId: 's1', agent: null, window: 's1#2', name: 'two' };
  feed(c, one, title('one'), human(0), say(2, 'r1', [use('g1', 'Agent', { subagent_type: 'recon' })]), say(3, 'r1b', [], 'end_turn'));
  feed(c, two, title('two'), human(10), say(12, 'r3', [], 'end_turn'),
    { type: 'user', uuid: 'tn9', timestamp: at(93), origin: { kind: 'task-notification' }, message: { content: '<task-notification>done</task-notification>' } },
    say(95, 'r4', [], 'end_turn'));
  // dispatched in one, still running long after two began
  for (const s of [4, 24, 44, 64, 84, 92]) c.add(say(s, `p${s}`), { sessionId: 's1', agent: { id: 'p1', type: 'recon' }, window: 's1', name: 'one' });
  const t = c.report().time;
  const rows = t.sessions.map((s) => [s.sessionId, ...[s.wallMs, s.idleMs, s.modelMs, s.userMs, s.otherMs].map(sec)]).sort((x, y) => x[0].localeCompare(y[0]));
  assert.deepEqual(rows, [['s1', 10, 0, 3, 7, 0], ['s1#2', 85, 0, 4, 0, 81]]);
  assert.equal(sec(t.totals.wallMs), 95, 'the windows tile the file: no overlap, no gap');
  assert.deepEqual(t.names.map((g) => [g.name, sec(g.wallMs)]).sort(), [['one', 10], ['two', 85]]);
  assert.deepEqual(t.agentRuns.map((a) => [a.id, a.sessionId]), [['p1', 's1']]);
});

test('time: a timeOnly window feeds its file\'s idle detection but reports nothing', () => {
  const c = createCollector({ prices: PRICES, idleGapMin: 0.5 });
  const one = { sessionId: 's1', agent: null, window: 's1', name: 'one', timeOnly: true };
  const two = { sessionId: 's1', agent: null, window: 's1#2', name: 'two' };
  feed(c, one, human(0), say(2, 'r1', [use('g1', 'Agent'), use('e1', 'Edit', { file_path: 'a' })]), result(3, 'e1'));
  feed(c, two, human(10), say(12, 'r3', [], 'end_turn'), human(95), say(96, 'r4', [], 'end_turn'));
  for (const s of [4, 30, 60, 90]) c.add(say(s, `p${s}`), { sessionId: 's1', agent: { id: 'p1', type: 'recon' }, window: 's1', name: 'one', timeOnly: true });
  const r = c.report();
  assert.deepEqual(r.time.sessions.map((s) => [s.sessionId, sec(s.wallMs), sec(s.idleMs)]), [['s1#2', 86, 0]]);
  assert.deepEqual([r.totals.requests, r.time.agentRuns.length, r.inline.length, Object.keys(r.time.tools)], [2, 0, 0, []]);
});

test('time: a window whose first stamp runs back before the previous window\'s start begins at its first stamp after it (#115)', () => {
  const c = createCollector({ prices: PRICES });
  const one = { sessionId: 's1', agent: null, window: 's1', name: 'one' };
  const two = { sessionId: 's1', agent: null, window: 's1#2', name: 'two' };
  feed(c, one, human(10), say(20, 'r1', [], 'end_turn'));
  // two's first record carries an earlier stamp: stamps run backwards in real files
  feed(c, two, { type: 'system', subtype: 'informational', uuid: 'late1', timestamp: at(5) }, human(30), say(40, 'r2', [], 'end_turn'));
  const t = c.report().time;
  assert.deepEqual(t.sessions.map((s) => [s.sessionId, sec(s.wallMs)]).sort((x, y) => x[0].localeCompare(y[0])), [['s1', 25], ['s1#2', 10]]);
  assert.equal(sec(t.totals.wallMs), 35, 'the windows still tile the file');
});

test('time: a window whose every stamp runs back before the previous start is empty; the window before it runs on to the next start', () => {
  const c = createCollector({ prices: PRICES });
  const w = (window) => ({ sessionId: 's1', agent: null, window });
  const sys = (s) => ({ type: 'system', subtype: 'informational', uuid: `y${tn++}`, timestamp: at(s) });
  feed(c, w('s1'), human(10), say(20, 'r1', [], 'end_turn'));
  feed(c, w('s1#2'), sys(5), sys(6));
  feed(c, w('s1#3'), human(30), say(40, 'r3', [], 'end_turn'));
  const t = c.report().time;
  assert.deepEqual(t.sessions.map((s) => [s.sessionId, sec(s.wallMs)]).sort((x, y) => x[0].localeCompare(y[0])), [['s1', 25], ['s1#2', 0], ['s1#3', 10]]);
  assert.equal(sec(t.totals.wallMs), 35);
});

test('time: a replayed record never starts a window; the window starts at its first record timed here', () => {
  const c = createCollector({ prices: PRICES });
  const w = (window) => ({ sessionId: 's1', agent: null, window });
  const old = human(25);
  c.add(old, { sessionId: 's0', agent: null }); // timed in the file that holds it first
  feed(c, w('s1'), human(10), say(20, 'r1', [], 'end_turn'));
  feed(c, w('s1#2'), old, human(30), say(40, 'r2', [], 'end_turn'));
  const rows = c.report().time.sessions.filter((s) => s.sessionId.startsWith('s1'));
  assert.deepEqual(rows.map((s) => [s.sessionId, sec(s.wallMs)]).sort((x, y) => x[0].localeCompare(y[0])), [['s1', 20], ['s1#2', 10]]);
});

test('time: a failure retried in a timeOnly window counts as retried, as in the whole-root run; the timeOnly failure is not counted', () => {
  const c = createCollector({ prices: PRICES });
  const one = { sessionId: 's1', agent: null, window: 's1', name: 'one' };
  const two = { sessionId: 's1', agent: null, window: 's1#2', name: 'two', timeOnly: true };
  feed(c, one, human(0), say(10, 'r1', [use('b1', 'Bash', { command: 'x' })]), result(11, 'b1', 'Exit code 1\nboom', true));
  feed(c, two, human(20), say(30, 'r2', [use('b2', 'Bash', { command: 'x' })]), result(31, 'b2', 'Exit code 2\nagain', true),
    say(40, 'r3', [use('b3', 'Bash', { command: 'x' })]), result(41, 'b3'));
  const { errors } = c.report().time.retry;
  assert.deepEqual(errors, { Bash: { count: 1, retried: 1, unresolved: 0, ms: 20000, reasons: { 'Exit code 1': { count: 1, ms: 20000 } } } });
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
