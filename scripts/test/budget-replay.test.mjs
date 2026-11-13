// node --test scripts/test/budget-replay.test.mjs — the #381 budget replay over small
// fixture runs: peak context, idle wakes past 5 minutes and their cache-rewrite cost,
// repeated full hand-backs, and the band/total figures the mechanism choice reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execHarness, tempDir } from './_spawn.mjs';
import { BANDS, isRepeat, mainWindows, renderFigures, replay, replayRun, summarize, summarizeMain } from '../budget-replay.mjs';

const prices = {
  models: {
    'claude-opus-5-5': { input: 4, output: 20, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2 },
  },
};
const OPUS = 'claude-opus-5-5';
const T0 = Date.parse('2026-11-10T12:00:00Z');
const at = (min) => new Date(T0 + min * 60e3).toISOString();

/** One assistant record of request `rid`; usage tokens in thousands for legibility. */
function reply(rid, min, { input = 1, read = 0, write = 0, write1h = 0, output = 1, model = OPUS, content = [], stop = 'tool_use' } = {}) {
  return {
    type: 'assistant',
    timestamp: at(min),
    requestId: rid,
    message: {
      id: `msg_${rid}`,
      model,
      stop_reason: stop,
      content,
      usage: {
        input_tokens: input * 1e3,
        output_tokens: output * 1e3,
        cache_read_input_tokens: read * 1e3,
        cache_creation_input_tokens: (write + write1h) * 1e3,
        cache_creation: { ephemeral_5m_input_tokens: write * 1e3, ephemeral_1h_input_tokens: write1h * 1e3 },
      },
    },
  };
}
const toolResult = (min, id = 'toolu_x', text = 'ok') => ({ type: 'user', timestamp: at(min), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] }] } });
const prompt = (min, text = 'Do the task.') => ({ type: 'user', timestamp: at(min), message: { role: 'user', content: text } });
const handback = (id, message) => ({ type: 'tool_use', id, name: 'SubagentHandback', input: { message } });
const words = (n, seed = 'w') => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(' ');

async function* iter(recs) {
  for (const r of recs) yield r;
}

test('peak context is the largest input + cache read + cache write on one request; a request split over records counts once', async () => {
  const run = await replayRun(iter([
    prompt(0),
    reply('r1', 0.1, { input: 10, write: 20 }),
    toolResult(0.2),
    reply('r2', 0.3, { input: 1, read: 30, write: 100, output: 1 }), // partial: output still growing
    reply('r2', 0.4, { input: 1, read: 30, write: 100, output: 4 }),
    toolResult(0.5),
    reply('r3', 0.6, { input: 1, read: 120, write: 2 }),
  ]), prices);
  assert.equal(run.requests, 3);
  assert.equal(run.peak, 131e3);
  // r2 priced once, at its final output: (1k*4 + 4k*20 + 30k*0.2 + 100k*5)/1e6 = 0.59
  const r2 = (1e3 * 4 + 4e3 * 20 + 30e3 * 0.2 + 100e3 * 5) / 1e6;
  const r1 = (10e3 * 4 + 1e3 * 20 + 20e3 * 5) / 1e6;
  const r3 = (1e3 * 4 + 1e3 * 20 + 120e3 * 0.2 + 2e3 * 5) / 1e6;
  assert.ok(Math.abs(run.usd - (r1 + r2 + r3)) < 1e-9);
});

test('an idle wake is a request sent more than 5 minutes after the previous request ended, priced at its cache writes', async () => {
  const run = await replayRun(iter([
    prompt(0),
    reply('r1', 0.5, { write: 50 }),
    toolResult(6.5), // tool came back 6 min after r1 ended: the cache is gone
    reply('r2', 7, { write: 100, read: 0 }),
    toolResult(11), // 4 min gap, then a slow response: not a wake (gap is measured to the send)
    reply('r3', 12.5, { read: 100, write: 1 }),
    prompt(80, 'Fix round: …'), // a resume an hour later rewrites at the 1h rate where the write is 1h
    reply('r4', 80.2, { write1h: 200 }),
  ]), prices);
  assert.deepEqual(run.wakes.map((w) => [Math.round(w.gapMs / 60e3), w.cause, w.cacheWrite]), [[6, 'tool', 100e3], [68, 'message', 200e3]]);
  assert.ok(Math.abs(run.wakes[0].usd - 0.5) < 1e-9); // 100k * $5/MTok
  assert.ok(Math.abs(run.wakes[1].usd - 1.6) < 1e-9); // 200k * $8/MTok
  assert.ok(Math.abs(run.wakeUsd - 2.1) < 1e-9);
});

test('a model with no price leaves usd null and is listed, never priced as $0', async () => {
  const run = await replayRun(iter([
    prompt(0),
    reply('r1', 0.1, { write: 10, model: 'claude-fable-5-2' }),
    toolResult(10),
    reply('r2', 10.1, { write: 10, model: 'claude-fable-5-2' }),
    reply('s', 10.2, { model: '<synthetic>' }), // an error stand-in, not a request
  ]), prices);
  assert.equal(run.requests, 2);
  assert.equal(run.usd, null);
  assert.equal(run.wakes.length, 1);
  assert.equal(run.wakes[0].usd, null);
  assert.deepEqual(run.unpriced, { 'claude-fable-5-2': 2 });
});

test('isRepeat: a later hand-back holding at least half of an earlier full report (5-word shingles) re-sends it', () => {
  const report = words(120);
  assert.equal(isRepeat(report, report), true);
  assert.equal(isRepeat(report, `delta: one line\n${words(70)}`), true); // 66 of 116 shingles
  assert.equal(isRepeat(report, words(40)), false); // 36 of 116
  assert.equal(isRepeat(report, words(80, 'x')), false);
  assert.equal(isRepeat('Waiting for the gate.', 'Waiting for the gate.'), false); // under 50 words: no full report
});

test('repeated full hand-backs: count and bytes, with retries after a rejected hand-back apart', async () => {
  const report = words(100);
  const run = await replayRun(iter([
    prompt(0),
    reply('r1', 1, { content: [handback('h1', report)] }),
    toolResult(1.1, 'h1', '{"success":true,"message":"Report delivered"}'),
    prompt(30, 'Send your report again.'),
    reply('r2', 30.5, { content: [handback('h2', report)] }),
    toolResult(30.6, 'h2', '{"success":false,"message":"Nothing was sent: the agent that spawned you is no longer running."}'),
    reply('r3', 30.7, { content: [handback('h3', report)] }),
    toolResult(30.8, 'h3', '{"success":true,"message":"Report delivered"}'),
    prompt(40, 'Fix this one item.'),
    reply('r4', 40.5, { content: [handback('h4', `delta: fixed. ${words(30, 'n')}`)] }),
  ]), prices);
  assert.equal(run.handbacks, 4);
  assert.equal(run.repeats, 2);
  assert.equal(run.retries, 1);
  assert.equal(run.repeatBytes, 2 * Buffer.byteLength(report));
});

test('a run with no SubagentHandback hands back the text of each turn that ends', async () => {
  const report = words(60);
  const run = await replayRun(iter([
    prompt(0),
    reply('r1', 1, { content: [{ type: 'text', text: report }], stop: 'end_turn' }),
    prompt(2, 'Again?'),
    reply('r2', 2.5, { content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 't', name: 'Bash', input: {} }] }),
    toolResult(2.6, 't'),
    reply('r3', 3, { content: [{ type: 'text', text: report }], stop: 'end_turn' }),
  ]), prices);
  assert.equal(run.handbacks, 2);
  assert.equal(run.repeats, 1);
});

function fixtureRoot() {
  const root = tempDir('br-root-');
  const sess = join(root, 'proj', 'sess-1');
  mkdirSync(join(sess, 'subagents'), { recursive: true });
  const jsonl = (recs) => recs.map((r) => JSON.stringify(r)).join('\n') + '\n';
  writeFileSync(join(root, 'proj', 'sess-1.jsonl'), jsonl([prompt(0), reply('m1', 0.1, { read: 400 })])); // a main session: not a subagent run
  writeFileSync(join(sess, 'subagents', 'agent-a1.jsonl'), jsonl([prompt(0), reply('a', 0.1, { write: 160 }), toolResult(0.2), reply('b', 0.3, { read: 160, write: 100 })]));
  writeFileSync(join(sess, 'subagents', 'agent-a1.meta.json'), JSON.stringify({ agentType: 'implementer-opus', description: 'impl_issue_claude-config-1' }));
  writeFileSync(join(sess, 'subagents', 'agent-a2.jsonl'), jsonl([prompt(1440), reply('c', 1440.1, { write: 90 })]));
  writeFileSync(join(sess, 'subagents', 'agent-a2.meta.json'), JSON.stringify({ agentType: 'reviewer', name: 'review_issue_claude-config-1' }));
  return root;
}

test('a teammate run (agentType is its own name) is typed by the agent type it was spawned as', async () => {
  const root = fixtureRoot();
  const sub = join(root, 'proj', 'sess-1', 'subagents');
  writeFileSync(join(sub, 'agent-a3.jsonl'), `${JSON.stringify(reply('d', 1, { write: 10 }))}\n`);
  writeFileSync(join(sub, 'agent-a3.meta.json'), JSON.stringify({ agentType: 'ticket-x-249', name: 'ticket-x-249', taskKind: 'in_process_teammate', spawnedAgentType: 'implementer-opus' }));
  writeFileSync(join(sub, 'agent-a4.jsonl'), `${JSON.stringify(reply('e', 1, { write: 10 }))}\n`);
  writeFileSync(join(sub, 'agent-a4.meta.json'), JSON.stringify({ agentType: 'unit-9', name: 'unit-9', taskKind: 'in_process_teammate' }));
  const types = Object.fromEntries((await replay(root, prices)).runs.map((r) => [r.name, r.type]));
  assert.equal(types['ticket-x-249'], 'implementer-opus');
  assert.equal(types['unit-9'], 'teammate (untyped)');
});

test('replay walks subagent transcripts only, naming each run from its meta', async () => {
  const r = await replay(fixtureRoot(), prices);
  assert.deepEqual(r.runs.map((x) => [x.name, x.type, x.peak]).sort(), [['impl_issue_claude-config-1', 'implementer-opus', 261e3], ['review_issue_claude-config-1', 'reviewer', 91e3]]);
  assert.equal(r.first, '2026-11-10');
  assert.equal(r.last, '2026-11-11');
});

test('summarize counts runs past each band per agent type and totals the wakes and repeats', async () => {
  assert.deepEqual(BANDS, [150e3, 200e3, 250e3, 300e3]);
  const runs = [
    { type: 'implementer-opus', peak: 431e3, wakes: [{ usd: 1 }], wakeUsd: 1, repeats: 0, repeatBytes: 0, retries: 0, usd: 11 },
    { type: 'implementer-opus', peak: 210e3, wakes: [], wakeUsd: 0, repeats: 1, repeatBytes: 2000, retries: 0, usd: 4 },
    { type: 'reviewer', peak: 151e3, wakes: [{ usd: null }], wakeUsd: null, repeats: 0, repeatBytes: 0, retries: 0, usd: null },
    { type: 'reviewer', peak: 90e3, wakes: [], wakeUsd: 0, repeats: 0, repeatBytes: 0, retries: 0, usd: 2 },
  ];
  const s = summarize(runs);
  assert.deepEqual(s.byType['implementer-opus'], { runs: 2, over: [2, 2, 1, 1] });
  assert.deepEqual(s.byType.reviewer, { runs: 2, over: [1, 0, 0, 0] });
  assert.deepEqual(s.all, { runs: 4, over: [3, 2, 1, 1] });
  assert.equal(s.wakes, 2);
  assert.equal(s.wakeUsd, 1); // the unpriced wake is counted, not priced
  assert.equal(s.unpricedWakes, 1);
  assert.deepEqual([s.repeats, s.repeatBytes, s.repeatRuns], [1, 2000, 1]);
  assert.equal(s.spendUsd, 17); // priced spend of every run; the unpriced run adds nothing
});

test('renderFigures states the window, the rules and every table the choice needs, with no recommendation', async () => {
  const r = await replay(fixtureRoot(), prices);
  const md = renderFigures(r);
  assert.match(md, /2 subagent runs.*2026-11-10 to 2026-11-11/);
  assert.match(md, /\| implementer-opus \| 1 \| 1 \| 1 \| 1 \| 0 \|/); // 261k: past 150k/200k/250k, not 300k
  assert.match(md, /\| reviewer \| 1 \| 0 \| 0 \| 0 \| 0 \|/);
  assert.match(md, /impl_issue_claude-config-1/);
  assert.match(md, /5-word shingles/); // the similarity rule is stated
  assert.match(md, /> 5 min/);
  assert.doesNotMatch(md, /recommend/i);
});

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'budget-replay.mjs');

test('CLI: markdown on stdout from ~/.claude/projects by default; --root, --json and --out', () => {
  const home = tempDir('br-home-');
  cpSync(fixtureRoot(), join(home, '.claude', 'projects'), { recursive: true });
  assert.match(execHarness(script, [], { home }), /\*\*Budget replay \(#381\):\*\* 2 subagent runs/);
  const out = join(tempDir('br-out-'), 'r.json');
  assert.equal(execHarness(script, ['--root', fixtureRoot(), '--json', '--out', out]), '');
  const j = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(j.runs.length, 2);
  assert.deepEqual(j.summary.all, { runs: 2, over: [1, 1, 1, 0] });
});

// ---- main sessions: windows and clear-at-cap (#381 box 2) ----
const cache = (rid, min, read, write, extra = {}) => reply(rid, min, { input: 0, output: 0, read, write, ...extra });
const kUsd = (read, write, rate = 5) => (read * 0.2 + write * rate) / 1e3; // $ of read/write k tokens on OPUS, no input/output

test('mainWindows: a request whose context falls below half the previous one starts a new window; sidechain and repeated requests are skipped', async () => {
  const seen = new Set(['dup']);
  const ws = await mainWindows(iter([
    prompt(0),
    cache('a', 1, 0, 100),
    cache('b', 2, 100, 20), // 120k
    cache('c', 3, 100, 10), // 110k: a dip, not a clear
    cache('d', 4, 0, 30), // 30k < 55k: /compact or /clear
    cache('e', 5, 30, 10),
    { ...cache('side', 5.5, 0, 500), isSidechain: true },
    cache('dup', 6, 0, 900), // seen in an earlier file (a resumed session replays it)
  ]), prices, seen);
  assert.deepEqual(ws.map((w) => [w.requests, w.peak]), [[3, 120e3], [2, 40e3]]);
  assert.ok(seen.has('a') && !seen.has('side'));
});

test('mainWindows prices clear-at-cap: requests above the cap as paid vs re-priced from a fresh baseline with the restart cache write', async () => {
  const [w] = await mainWindows(iter([
    cache('r1', 1, 0, 30), // 30k: the window's baseline
    cache('r2', 2, 30, 70), // 100k: last request under the cap
    cache('r3', 3, 100, 60), // 160k: crosses 150k
    cache('r4', 4, 160, 50), // 210k
  ]), prices, new Set());
  const c150 = w.caps.find((c) => c.cap === 150e3);
  assert.equal(c150.requests, 2);
  assert.ok(Math.abs(c150.actual - (kUsd(100, 60) + kUsd(160, 50))) < 1e-9);
  // restarted at r3: context 30k + 60k growth = 90k, all written; r4: 140k = 90k read + its own 50k write
  assert.ok(Math.abs(c150.counterfactual - (kUsd(0, 90) + kUsd(90, 50))) < 1e-9);
  const c200 = w.caps.find((c) => c.cap === 200e3);
  assert.equal(c200.requests, 1); // only r4 is above 200k
  assert.ok(Math.abs(c200.counterfactual - kUsd(0, 30 + 50)) < 1e-9); // 30k + r4's 50k growth, all written
  assert.equal(w.caps.find((c) => c.cap === 250e3).requests, 0);
});

test('mainWindows: restart written at the 1h rate when the crossing request wrote at 1h; a window that starts above the cap and unpriced requests stay out', async () => {
  const [w] = await mainWindows(iter([
    cache('r1', 1, 0, 30),
    cache('r2', 2, 30, 130, { write: 0, write1h: 130 }), // 190k, 1h writes
    cache('r3', 3, 190, 10, { model: 'claude-fable-5-2' }), // unpriced
  ]), prices, new Set());
  const [hi] = await mainWindows(iter([cache('x', 1, 0, 300)]), prices, new Set()); // opens above every cap
  const c = w.caps.find((x) => x.cap === 150e3);
  assert.equal(c.requests, 1);
  assert.equal(c.unpriced, 1);
  assert.ok(Math.abs(c.counterfactual - kUsd(0, 160, 8)) < 1e-9); // 30k + (160k - 30k) growth = 160k, all written at 1h
  assert.ok(Math.abs(c.actual - kUsd(30, 130, 8)) < 1e-9);
  assert.deepEqual(hi.caps.map((x) => x.startedAbove), [true, true, true]);
  assert.deepEqual(hi.caps.map((x) => x.requests), [0, 0, 0]);
});

test('summarizeMain totals windows past each band and, per cap, actual, counterfactual and their difference against total priced spend', () => {
  const caps = (n, a, c) => [150e3, 200e3, 250e3].map((cap) => ({ cap, requests: n, actual: a, counterfactual: c, unpriced: 0, startedAbove: false }));
  const s = summarizeMain([
    { peak: 320e3, requests: 9, usd: 10, pricedUsd: 10, caps: caps(3, 4, 5) },
    { peak: 160e3, requests: 4, usd: 2, pricedUsd: 2, caps: [{ ...caps(2, 1, 0.5)[0] }, ...caps(0, 0, 0).slice(1)] },
    { peak: 80e3, requests: 2, usd: 1, pricedUsd: 1, caps: caps(0, 0, 0) },
  ]);
  assert.deepEqual([s.windows, s.over, s.spendUsd], [3, [2, 1, 1, 1], 13]);
  assert.deepEqual(s.caps[0], { cap: 150e3, windows: 2, requests: 5, actual: 5, counterfactual: 5.5, diff: -0.5 });
  assert.deepEqual([s.caps[1].windows, s.caps[1].diff], [1, -1]);
});

test('renderFigures adds a main-session section with the rule, the per-cap table and what the replay cannot see; the subagent figures are unchanged', async () => {
  const r = await replay(fixtureRoot(), prices);
  assert.equal(r.windows.length, 1); // proj/sess-1.jsonl: one window, 401k peak
  const md = renderFigures(r);
  assert.match(md, /2 subagent runs.*2026-11-10 to 2026-11-11/);
  assert.match(md, /### Main sessions: clear at cap/);
  assert.match(md, /1 main-session windows/);
  assert.match(md, /\| 150k \|/);
  assert.match(md, /\| 250k \|/);
  assert.match(md, /cannot see/i);
  assert.match(md, /continuation/i);
  assert.doesNotMatch(md, /recommend/i);
});
