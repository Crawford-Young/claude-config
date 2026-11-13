#!/usr/bin/env node
// budget-replay.mjs — per subagent run, the figures #381 chooses its context-budget
// mechanism from: peak context, idle wakes and their cache-rewrite cost, and repeated
// full hand-backs. Report only; it changes nothing.
//
//   node scripts/budget-replay.mjs [--root <projects dir>] [--out <file.md>] [--json]
//
// Reads every <session>/subagents/agent-*.jsonl under --root (default ~/.claude/projects)
// through audit-lib's walker; main sessions are not runs. Rules (also stated in the output):
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
      if (!m?.usage || m.model === '<synthetic>') continue;
      const key = rec.requestId || m.id || rec.uuid;
      let q = reqs.get(key);
      if (!q) {
        reqs.set(key, (q = { u: m.usage, model: m.model, texts: [], ended: false }));
        const send = sentAt ?? t;
        if (lastReply !== null && send !== null && send - lastReply > IDLE_MS) wakeAt.set(key, { gapMs: send - lastReply, cause: cause || 'tool' });
      } else if ((m.usage.output_tokens || 0) >= (q.u.output_tokens || 0)) q.u = m.usage;
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

const day = (ms) => (ms === null ? null : new Date(ms).toISOString().slice(0, 10));

/** A run's agent type. An agent-teams teammate's meta carries its own name as agentType
 *  and the type it was spawned as in spawnedAgentType (customAgentType on some). */
function typeOf(file, agent) {
  let meta = {};
  try { meta = JSON.parse(readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { /* no meta: walker's type */ }
  if (meta.taskKind !== 'in_process_teammate') return agent.type;
  return meta.spawnedAgentType || meta.customAgentType || 'teammate (untyped)';
}

/** Every subagent run under root, oldest first, plus the date window covered. */
export async function replay(root, prices) {
  const runs = [];
  for await (const { file, ctx } of walkTranscripts(root)) {
    if (!ctx.agent) continue;
    const r = await replayRun(readJsonl(file), prices);
    if (!r.requests) continue;
    runs.push({ id: ctx.agent.id, sessionId: ctx.sessionId, name: ctx.agent.name || null, type: typeOf(file, ctx.agent), ...r });
  }
  runs.sort((a, b) => (a.first ?? Infinity) - (b.first ?? Infinity));
  const stamps = runs.map((r) => r.first).filter((x) => x !== null);
  return { runs, first: day(stamps.length ? Math.min(...stamps) : null), last: day(stamps.length ? Math.max(...stamps) : null) };
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

const kt = (n) => `${Math.round(n / 1e3)}k`;
const usd = (n) => (n === null ? 'unpriced' : `$${n.toFixed(2)}`);
const min = (ms) => (ms < 36e5 ? `${Math.round(ms / 60e3)}m` : `${(ms / 36e5).toFixed(1)}h`);
const cell = (s) => String(s).replace(/\|/g, '/');
const table = (head, rows) => (rows.length ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)] : ['_none_']);
const label = (r) => r.name || `${r.type} ${r.id.slice(0, 8)}`;

/** The figures as markdown for an issue comment: window, rules, tables. */
export function renderFigures({ runs, first, last }, { top = 15 } = {}) {
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
    `Unpriced models (no prices.json entry; their requests are left out of every $): ${Object.keys(unpriced).length ? Object.entries(unpriced).map(([m, n]) => `${m} (${n} requests)`).join(', ') : 'none'}.`,
    '',
  ].join('\n');
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const here = dirname(fileURLToPath(import.meta.url));
  const prices = JSON.parse(readFileSync(join(here, 'prices.json'), 'utf8'));
  const r = await replay(typeof a.root === 'string' ? a.root : join(homedir(), '.claude', 'projects'), prices);
  const out = a.json ? JSON.stringify({ ...r, summary: summarize(r.runs) }, null, 2) : renderFigures(r);
  if (typeof a.out === 'string') writeFileSync(a.out, out);
  else process.stdout.write(`${out}\n`);
}

if (isMain(import.meta.url)) main();
