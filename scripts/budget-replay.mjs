#!/usr/bin/env node
// budget-replay.mjs — per subagent run, the figures #381 chooses its context-budget
// mechanism from: peak context, idle wakes and their cache-rewrite cost, and repeated
// full hand-backs. Report only; it changes nothing.
//
//   node scripts/budget-replay.mjs [--root <projects dir>] [--out <file.md>] [--json]
//
// Reads every <session>/subagents/agent-*.jsonl under --root (default ~/.claude/projects)
// through audit-lib's walker. Main sessions are not runs; they get their own section (box 2):
// one window per main transcript file, split where context falls (see mainWindows), with
// clear-at-cap priced for each cap in CAPS. Rules (also stated in the output):
// - A request is one requestId (several records share one; the last output count wins, as
//   in audit-lib). `<synthetic>` records are error stand-ins, not requests.
// - Peak context = the largest input + cache read + cache write on one request of the run.
// - Idle wake = a request sent more than IDLE_MS after the previous request's last record.
//   Its send time is the stamp of the last record before its first response record (the
//   tool result or message that triggered it), so its own generation time is not a gap.
//   Cause: `message` when that trigger is a new prompt (a resume, a notification), else
//   `tool`. Cost = its cache-write tokens at its own 5m/1h write rates (prices.json).
// - Hand-back = each SubagentHandback message; a run with none (older Claude Code) hands
//   back the text of each request that ends its turn. A hand-back repeats when it holds at
//   least REPEAT_SHARE of the 5-word shingles of an earlier hand-back of at least
//   REPEAT_MIN_WORDS words in the same run. A retry is a repeat right after a hand-back
//   the tool rejected (`"success":false`).
// - An unpriced model's requests are listed, never priced as $0.

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { priceUsage, readJsonl, walkTranscripts } from './audit-lib.mjs';
import { isMain, parseArgs } from './lib.mjs';

export const IDLE_MS = 5 * 60e3; // the subagent prompt cache lives 5 minutes
export const BANDS = [150e3, 200e3, 250e3, 300e3]; // context-gauge's bands plus the 300k line
export const CAPS = [150e3, 200e3, 250e3]; // context-gauge's three bands, the candidate clear-at-cap lines
export const CLEAR_DROP = 0.5; // a request whose context is under this share of the previous one starts a new main window
export const SHINGLE = 5;
export const REPEAT_SHARE = 0.5;
export const REPEAT_MIN_WORDS = 50;

const depthOf = (u) => (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
const stampOf = (rec) => Date.parse(rec?.timestamp || '') || null;
const writesOf = (u) => {
  const cc = u.cache_creation;
  return cc ? [cc.ephemeral_5m_input_tokens || 0, cc.ephemeral_1h_input_tokens || 0] : [u.cache_creation_input_tokens || 0, 0];
};

/** $ of a request's cache writes alone, each tier at its rate for this request's prompt size
 *  (priceUsage picks a long-prompt tier from the prompt total, so each rate is probed with a
 *  usage of that total). null when the model has no price. */
function writeUsd(u, model, prices) {
  const [w5, w1] = writesOf(u);
  const total = depthOf(u);
  if (!w5 && !w1) return priceUsage({}, model, prices).usd === null ? null : 0;
  const rate = (k) => priceUsage({ cache_creation: { ephemeral_5m_input_tokens: k === '5m' ? total : 0, ephemeral_1h_input_tokens: k === '1h' ? total : 0 } }, model, prices).usd;
  const [r5, r1] = [rate('5m'), rate('1h')];
  return r5 === null ? null : (w5 * r5 + w1 * r1) / total;
}

function shingles(text) {
  const w = String(text).toLowerCase().split(/\s+/).filter(Boolean);
  const out = new Set();
  for (let i = 0; i + SHINGLE <= w.length; i++) out.add(w.slice(i, i + SHINGLE).join(' '));
  return { words: w.length, set: out };
}

/** True when `later` re-sends `earlier`: earlier is a full report (>= REPEAT_MIN_WORDS words)
 *  and at least REPEAT_SHARE of its 5-word shingles reappear in later. */
export function isRepeat(earlier, later) {
  const a = shingles(earlier);
  if (a.words < REPEAT_MIN_WORDS || !a.set.size) return false;
  const b = shingles(later).set;
  let shared = 0;
  for (const s of a.set) if (b.has(s)) shared++;
  return shared / a.set.size >= REPEAT_SHARE;
}

const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((b) => b?.text || '').join('\n') : '');
const isToolResult =(rec) => Array.isArray(rec.message?.content) && rec.message.content.some((b) => b?.type === 'tool_result');

/** Folds one assistant record into reqs (one entry per requestId; the last output count wins).
 *  null for a record that is not a request (no usage, or a <synthetic> error stand-in). */
function takeRequest(reqs, rec) {
  const m = rec.message;
  if (!m?.usage || m.model === '<synthetic>') return null;
  const key = rec.requestId || m.id || rec.uuid;
  let q = reqs.get(key);
  const isNew = !q;
  if (isNew) reqs.set(key, (q = { u: m.usage, model: m.model, texts: [], ended: false }));
  else if ((m.usage.output_tokens || 0) >= (q.u.output_tokens || 0)) q.u = m.usage;
  return { key, q, isNew };
}

/** Replays one subagent run's records (any async iterable) into its figures. */
export async function replayRun(records, prices) {
  const reqs = new Map(); // key -> { u, model, texts, ended }
  const wakeAt = new Map(); // key -> { gapMs, cause }
  const handbacks = [], byToolId = new Map();
  let lastReply = null, sentAt = null, cause = null, first = null, last = null;
  for await (const rec of records) {
    const t = stampOf(rec);
    if (t !== null) [first, last] = [first === null ? t : Math.min(first, t), last === null ? t : Math.max(last, t)];
    if (rec?.type === 'assistant') {
      const m = rec.message;
      const took = takeRequest(reqs, rec);
      if (!took) continue;
      const { key, q, isNew } = took;
      if (isNew) {
        const send = sentAt ?? t;
        if (lastReply !== null && send !== null && send - lastReply > IDLE_MS) wakeAt.set(key, { gapMs: send - lastReply, cause: cause || 'tool' });
      }
      for (const b of m.content || []) {
        if (b?.type === 'text' && b.text && q.texts.at(-1) !== b.text) q.texts.push(b.text);
        if (b?.type === 'tool_use' && b.name === 'SubagentHandback' && !byToolId.has(b.id)) {
          const h = { text: String(b.input?.message ?? ''), rejected: false };
          handbacks.push(h);
          byToolId.set(b.id, h);
        }
      }
      if (m.stop_reason === 'end_turn') q.ended = true;
      if (t !== null) lastReply = t;
      sentAt = cause = null;
      continue;
    }
    if (rec?.type === 'user') {
      cause = isToolResult(rec) ? 'tool' : 'message';
      for (const b of Array.isArray(rec.message?.content) ? rec.message.content : []) {
        const h = b?.type === 'tool_result' && byToolId.get(b.tool_use_id);
        if (h) h.rejected = /"success"\s*:\s*false/.test(textOf(b.content));
      }
    }
    if (t !== null) sentAt = t;
  }
  const said = handbacks.length ? handbacks : [...reqs.values()].filter((q) => q.ended && q.texts.length).map((q) => ({ text: q.texts.join('\n'), rejected: false }));
  let repeats = 0, retries = 0, repeatBytes = 0;
  said.forEach((h, j) => {
    if (!said.slice(0, j).some((e) => isRepeat(e.text, h.text))) return;
    repeats++;
    repeatBytes += Buffer.byteLength(h.text);
    if (said[j - 1].rejected) retries++;
  });
  let usd = 0, peak = 0;
  const unpriced = {};
  for (const { u, model } of reqs.values()) {
    peak = Math.max(peak, depthOf(u));
    const p = priceUsage(u, model, prices).usd;
    if (p === null) unpriced[model] = (unpriced[model] || 0) + 1;
    else usd += p;
  }
  const wakes = [...wakeAt].map(([key, w]) => {
    const { u, model } = reqs.get(key);
    return { ...w, cacheWrite: writesOf(u)[0] + writesOf(u)[1], usd: writeUsd(u, model, prices) };
  });
  const priced = wakes.filter((w) => w.usd !== null);
  return {
    requests: reqs.size,
    peak,
    usd: Object.keys(unpriced).length ? null : usd,
    pricedUsd: usd,
    unpriced,
    models: [...new Set([...reqs.values()].map((q) => q.model))],
    wakes,
    wakeUsd: priced.length === wakes.length ? priced.reduce((s, w) => s + w.usd, 0) : null,
    handbacks: said.length,
    repeats,
    retries,
    repeatBytes,
    first,
    last,
  };
}

/** $ of request q if its context were newDepth tokens. The restart request writes the whole
 *  context (at 1h when q's own writes were 1h, else 5m); a later one keeps its own writes and
 *  input and reads the rest. Output is unchanged. null when the model has no price. */
function repriceUsd(q, newDepth, restart, prices) {
  const input = q.u.input_tokens || 0, [w5, w1] = writesOf(q.u);
  const out = { input_tokens: input, output_tokens: q.u.output_tokens || 0 };
  const usage = restart
    ? { ...out, cache_creation: { ephemeral_5m_input_tokens: w1 ? 0 : Math.max(0, newDepth - input), ephemeral_1h_input_tokens: w1 ? Math.max(0, newDepth - input) : 0 } }
    : { ...out, cache_read_input_tokens: Math.max(0, newDepth - input - w5 - w1), cache_creation: { ephemeral_5m_input_tokens: w5, ephemeral_1h_input_tokens: w1 } };
  return priceUsage(usage, q.model, prices).usd;
}

/** One cap's figures for a window's requests [{ q, depth, usd }] in order. The requests sent
 *  above the cap are priced as paid (actual) and as if the window had been cleared just
 *  before the first of them (counterfactual): the fresh window's context is the window's own
 *  first request (system prompt, CLAUDE.md, tools: what any new window opens with) plus the
 *  growth since the last request under the cap; the restart request writes all of it, later
 *  ones read what the restart wrote and keep their own writes. A window whose first request is
 *  already above the cap has no clear to price (startedAbove). Unpriced models are counted,
 *  never priced as $0. */
function capFigures(reqs, cap, prices) {
  const out = { cap, requests: 0, actual: 0, counterfactual: 0, unpriced: 0, startedAbove: reqs.length > 0 && reqs[0].depth > cap };
  const c = reqs.findIndex((r) => r.depth > cap);
  if (c <= 0) return out;
  const [base, before] = [reqs[0].depth, reqs[c - 1].depth];
  reqs.slice(c).forEach((r, i) => {
    if (r.depth <= cap) return;
    const fresh = repriceUsd(r.q, Math.max(base, base + r.depth - before), i === 0, prices);
    if (r.usd === null || fresh === null) return void out.unpriced++;
    out.requests++;
    out.actual += r.usd;
    out.counterfactual += fresh;
  });
  return out;
}

/** The context windows of one main-session transcript (any async iterable of records). A window
 *  is a run of requests; a request whose context is under CLEAR_DROP of the previous one's
 *  (a /compact, or a /clear that kept the file) starts a new one. Sidechain records and requests
 *  already in `seen` (a resumed session replays its parent's) are skipped; `seen` gains the
 *  keys taken. Each window: { requests, peak, usd (null if any request is unpriced), pricedUsd,
 *  unpriced, first, caps: capFigures per CAPS }. */
export async function mainWindows(records, prices, seen = new Set()) {
  const reqs = new Map();
  const stamp = new Map();
  for await (const rec of records) {
    if (rec?.type !== 'assistant' || rec.isSidechain) continue;
    const key = rec.requestId || rec.message?.id || rec.uuid;
    if (seen.has(key) && !reqs.has(key)) continue;
    const took = takeRequest(reqs, rec);
    if (took?.isNew) stamp.set(took.key, stampOf(rec));
  }
  const groups = [];
  let prev = null;
  for (const [key, q] of reqs) {
    seen.add(key);
    const depth = depthOf(q.u);
    if (!groups.length || depth < CLEAR_DROP * prev) groups.push([]);
    groups.at(-1).push({ q, depth, usd: priceUsage(q.u, q.model, prices).usd, at: stamp.get(key) });
    prev = depth;
  }
  return groups.map((g) => {
    const unpriced = {};
    let pricedUsd = 0;
    for (const r of g) r.usd === null ? (unpriced[r.q.model] = (unpriced[r.q.model] || 0) + 1) : (pricedUsd += r.usd);
    return {
      requests: g.length,
      peak: Math.max(...g.map((r) => r.depth)),
      usd: Object.keys(unpriced).length ? null : pricedUsd,
      pricedUsd,
      unpriced,
      first: g[0].at,
      caps: CAPS.map((cap) => capFigures(g, cap, prices)),
    };
  });
}

const day = (ms) => (ms === null ? null : new Date(ms).toISOString().slice(0, 10));

/** A run's agent type. An agent-teams teammate's meta carries its own name as agentType
 *  and the type it was spawned as in spawnedAgentType (customAgentType on some). */
function typeOf(file, agent) {
  let meta = {};
  try { meta = JSON.parse(readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { /* no meta: walker's type */ }
  if (meta.taskKind !== 'in_process_teammate') return agent.type;
  return meta.spawnedAgentType || meta.customAgentType || 'teammate (untyped)';
}

/** Every subagent run under root, oldest first, the date window covered, and every main-session
 *  window (mainWindows over each main transcript). */
export async function replay(root, prices) {
  const runs = [], windows = [], seen = new Set();
  for await (const { file, ctx } of walkTranscripts(root)) {
    if (!ctx.agent) {
      for (const w of await mainWindows(readJsonl(file), prices, seen)) windows.push({ sessionId: ctx.sessionId, ...w });
      continue;
    }
    const r = await replayRun(readJsonl(file), prices);
    if (!r.requests) continue;
    runs.push({ id: ctx.agent.id, sessionId: ctx.sessionId, name: ctx.agent.name || null, type: typeOf(file, ctx.agent), ...r });
  }
  runs.sort((a, b) => (a.first ?? Infinity) - (b.first ?? Infinity));
  const stamps = runs.map((r) => r.first).filter((x) => x !== null);
  return { runs, windows, first: day(stamps.length ? Math.min(...stamps) : null), last: day(stamps.length ? Math.max(...stamps) : null) };
}

/** Band counts per agent type and overall, and the wake / repeat totals. */
export function summarize(runs) {
  const tally = () => ({ runs: 0, over: BANDS.map(() => 0) });
  const byType = {}, all = tally();
  for (const r of runs) {
    for (const t of [(byType[r.type] ||= tally()), all]) {
      t.runs++;
      BANDS.forEach((b, i) => r.peak > b && t.over[i]++);
    }
  }
  const wakes = runs.flatMap((r) => r.wakes);
  return {
    byType,
    all,
    wakes: wakes.length,
    wakeUsd: wakes.reduce((s, w) => s + (w.usd ?? 0), 0),
    unpricedWakes: wakes.filter((w) => w.usd === null).length,
    wakeRuns: runs.filter((r) => r.wakes.length).length,
    messageWakes: wakes.filter((w) => w.cause === 'message').length,
    repeats: runs.reduce((s, r) => s + r.repeats, 0),
    retries: runs.reduce((s, r) => s + r.retries, 0),
    repeatBytes: runs.reduce((s, r) => s + r.repeatBytes, 0),
    repeatRuns: runs.filter((r) => r.repeats).length,
    spendUsd: runs.reduce((s, r) => s + (r.pricedUsd ?? r.usd ?? 0), 0),
  };
}

/** Main windows past each band, per-cap totals (actual, counterfactual, diff = actual - counterfactual:
 *  what clearing at the cap would have saved, negative when it would have cost more) and the priced
 *  spend they are a share of. */
export function summarizeMain(windows) {
  return {
    windows: windows.length,
    over: BANDS.map((b) => windows.filter((w) => w.peak > b).length),
    spendUsd: windows.reduce((s, w) => s + w.pricedUsd, 0),
    caps: CAPS.map((cap, i) => {
      const cs = windows.map((w) => w.caps[i]);
      const [actual, counterfactual] = [cs.reduce((s, c) => s + c.actual, 0), cs.reduce((s, c) => s + c.counterfactual, 0)];
      return { cap, windows: cs.filter((c) => c.requests).length, requests: cs.reduce((s, c) => s + c.requests, 0), actual, counterfactual, diff: actual - counterfactual };
    }),
  };
}

const kt = (n) => `${Math.round(n / 1e3)}k`;
const usd = (n) => (n === null ? 'unpriced' : `$${n.toFixed(2)}`);
const min = (ms) => (ms < 36e5 ? `${Math.round(ms / 60e3)}m` : `${(ms / 36e5).toFixed(1)}h`);
const cell = (s) => String(s).replace(/\|/g, '/');
const table = (head, rows) => (rows.length ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)] : ['_none_']);
const label = (r) => r.name || `${r.type} ${r.id.slice(0, 8)}`;

const signed = (n) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;

/** The main-session section: windows, the rules, the per-cap table and the replay's blind spots. */
function mainSection(windows) {
  const m = summarizeMain(windows);
  const started = CAPS.map((cap, i) => windows.filter((w) => w.caps[i].startedAbove).length);
  const unpriced = windows.reduce((n, w) => n + Object.values(w.unpriced).reduce((x, y) => x + y, 0), 0);
  return [
    '### Main sessions: clear at cap',
    '',
    `${m.windows} main-session windows (one per main transcript, split where a request's context falls under ${CLEAR_DROP * 100}% of the previous one's: a /compact, or a /clear that kept the file; sidechain records and requests an earlier file already holds are skipped), ${usd(m.spendUsd)} priced main-session spend.`,
    '',
    ...table(['windows', ...BANDS.map((b) => `peak > ${kt(b)}`)], [[m.windows, ...m.over]]),
    '',
    `Clear at cap C = the window is cleared just before its first request above C. Actual = those requests priced as paid. Clear-at-cap = the same requests re-priced from a fresh window: its context is the window's own first request (what a new window opens with) plus the growth since the last request under C; the restart request writes all of that to the cache (at its own 5m/1h tier), later ones read it back and keep their own writes and output. Saved = actual - clear-at-cap (negative: clearing costs more). A window already above C at its first request has nothing to clear (counted apart).`,
    '',
    ...table(['cap', 'windows past', 'requests above', 'actual $', 'clear-at-cap $', 'saved $', 'actual / total spend', 'opened above cap'], m.caps.map((c, i) => [kt(c.cap), c.windows, c.requests, usd(c.actual), usd(c.counterfactual), signed(c.diff), `${m.spendUsd ? ((c.actual / m.spendUsd) * 100).toFixed(1) : '0.0'}%`, started[i]])),
    '',
    `The replay cannot see: quality (a cleared window loses what the session knew; a long window may reason worse or better), the cost of writing the continuation (a checkpoint commit and resume block, then reading them back), re-reading the files the cleared window already held, whether the real cache stayed warm across idle gaps (the restart is assumed to write at the crossing request's own tier), or work that needed the context it carried. Requests on a model with no price are left out of every $${unpriced ? ` (${unpriced} requests)` : ''}.`,
    '',
  ];
}

/** The figures as markdown for an issue comment: window, rules, tables. */
export function renderFigures({ runs, windows, first, last }, { top = 15 } = {}) {
  const s = summarize(runs);
  const unpriced = {};
  for (const r of runs) for (const [m, n] of Object.entries(r.unpriced)) unpriced[m] = (unpriced[m] || 0) + n;
  const bandHead = ['type', 'runs', ...BANDS.map((b) => `> ${kt(b)}`)];
  const types = Object.entries(s.byType).sort((a, b) => b[1].runs - a[1].runs);
  const byPeak = [...runs].sort((a, b) => b.peak - a.peak);
  const woken = runs.filter((r) => r.wakes.length).sort((a, b) => (b.wakeUsd ?? -1) - (a.wakeUsd ?? -1) || b.wakes.length - a.wakes.length);
  const repeated = runs.filter((r) => r.repeats).sort((a, b) => b.repeatBytes - a.repeatBytes);
  return [
    `**Budget replay (#381):** ${runs.length} subagent runs, ${first} to ${last} (first request of each run), every transcript under the projects dir on this machine. \`node scripts/budget-replay.mjs\`.`,
    '',
    `Rules: peak = largest input + cache read + cache write on one request. Idle wake = a request sent > 5 min after the run's previous request ended (cause \`message\`: a resume or notification woke it; \`tool\`: a tool or wait ran past 5 min); cost = its cache-write tokens at its 5m/1h write rate. Repeated hand-back = a hand-back (SubagentHandback, else a turn's final text) holding >= ${REPEAT_SHARE * 100}% of the ${SHINGLE}-word shingles of an earlier hand-back of >= ${REPEAT_MIN_WORDS} words in the same run; a retry is one right after a rejected hand-back.`,
    '',
    '### Peak context: runs past each line, by agent type',
    '',
    ...table(bandHead, [...types.map(([t, x]) => [t, x.runs, ...x.over]), ['**all**', s.all.runs, ...s.all.over]]),
    '',
    `### Largest ${Math.min(top, runs.length)} runs by peak`,
    '',
    ...table(['run', 'type', 'first day', 'requests', 'peak', 'wakes', 'priced $'], byPeak.slice(0, top).map((r) => [label(r), r.type, day(r.first), r.requests, kt(r.peak), r.wakes.length, usd(r.usd ?? r.pricedUsd) + (r.usd === null ? ' (part)' : '')])),
    '',
    '### Idle wakes',
    '',
    `${s.wakes} wakes in ${s.wakeRuns} runs (${s.messageWakes} by a message, ${s.wakes - s.messageWakes} by a tool or wait), cache rewrites ${usd(s.wakeUsd)} priced${s.unpricedWakes ? ` + ${s.unpricedWakes} wakes on unpriced models` : ''}, of ${usd(s.spendUsd)} priced subagent spend.`,
    '',
    ...table(['run', 'type', 'wakes', 'longest gap', 'rewritten', 'rewrite $'], woken.slice(0, top).map((r) => [label(r), r.type, r.wakes.length, min(Math.max(...r.wakes.map((w) => w.gapMs))), kt(r.wakes.reduce((x, w) => x + w.cacheWrite, 0)), usd(r.wakeUsd)])),
    '',
    '### Repeated full hand-backs',
    '',
    `${s.repeats} repeats in ${s.repeatRuns} runs (${s.retries} retries after a rejected hand-back), ${(s.repeatBytes / 1e3).toFixed(1)} kB re-sent.`,
    '',
    ...table(['run', 'type', 'hand-backs', 'repeats', 'retries', 'bytes re-sent'], repeated.slice(0, top).map((r) => [label(r), r.type, r.handbacks, r.repeats, r.retries, r.repeatBytes])),
    '',
    ...(windows?.length ? mainSection(windows) : []),
    `Unpriced models (no prices.json entry; their requests are left out of every $): ${Object.keys(unpriced).length ? Object.entries(unpriced).map(([m, n]) => `${m} (${n} requests)`).join(', ') : 'none'}.`,
    '',
  ].join('\n');
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const here = dirname(fileURLToPath(import.meta.url));
  const prices = JSON.parse(readFileSync(join(here, 'prices.json'), 'utf8'));
  const r = await replay(typeof a.root === 'string' ? a.root : join(homedir(), '.claude', 'projects'), prices);
  const out = a.json ? JSON.stringify({ ...r, summary: summarize(r.runs), main: summarizeMain(r.windows) }, null, 2) : renderFigures(r);
  if (typeof a.out === 'string') writeFileSync(a.out, out);
  else process.stdout.write(`${out}\n`);
}

if (isMain(import.meta.url)) main();
