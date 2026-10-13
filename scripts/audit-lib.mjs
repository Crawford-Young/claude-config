// audit-lib.mjs — transcript-replay audit (#62): pure accounting over Claude Code
// transcripts (~/.claude/projects/**/*.jsonl). The CLI is audit.mjs.
//
// Transcript facts this file relies on (verified 2026-10-08, CC 2.1.295):
// - One API response is written as several assistant records sharing a requestId
//   (one per content block, plus streaming partials whose output_tokens grow).
//   Summing every record overcounts ~2.2x: keep one per requestId, max output.
// - Subagents live in <session>/subagents/agent-<id>.jsonl next to a
//   .meta.json carrying agentType; their records never appear in the parent file.
// - Resumed/forked sessions replay earlier records into a new file. transcriptWindows
//   leaves a replayed uuid with the transcript read first, and reads the oldest file
//   first (by first and last stamp, #142), not in name order (strate stores a uuid once);
//   the collector still dedupes non-request records on uuid, tool calls on tool_use id.
// - A user-set name (/rename, or a launch name from claude -n / claude --bg -n,
//   2.1.280) is a {type:'custom-title'} record. One file can hold several units (a
//   rename without /clear), so it splits into a window at each change of name (#115;
//   the rule is strate's store/group.rs, settled on real data). Rows group per unit
//   on lib's sessionKey, so a legacy and a typed name of one unit join (#175).
//   ai-title and agent-name records carry auto names, not unit names (#73).
// - An assistant record carries the request's effort as a top-level `effort` field
//   (#113; on every subagent record of CC 2.1.26x-2.1.296 on disk 2026-10-13, except
//   Haiku 4.5, whose records have none: its effort is unknown, not a default).
//
// cost-state facts (#116, measured 2026-10-12 on 29 sessions, CC 2.1.263-2.1.295):
// - A {type:'cost-state'} record is Claude Code's running total for the session,
//   written at exit or /clear (work in a later resume that never exits has none).
// - It runs ~10% over what the transcripts hold, and none of the difference is on
//   disk: subagent requests that persist only a mid-stream usage (stop_reason null
//   on every record, output_tokens a partial) lose their output (~45% of the gap);
//   requests no transcript records (input and cache reads on the models of
//   background-subagent sessions, Haiku side calls) are ~55%. It also prices Sonnet
//   5.5 cache reads at 0.1x input through CC 2.1.295, where the published price is
//   0.05x; 2.1.296 prices them at 0.05x (#141, 18 of 20 cost-state records fit $0.20 exactly, the 2 on 2.1.296 fit $0.10).
// - Against cost-state's own per-model tokens prices.json matches within 0.25%, so
//   the gap is cost-state's wider scope, not a price error. That per-model match is
//   the price check (#141). modelUsage splits no cache-write tier, so the check takes
//   the 5m/1h ratio from the same file's transcript (point estimate, within 0.7% on
//   real data); a model with no writes in that file's transcript is only tested
//   against the 5m-to-1h range and labeled band-checked.
//
// Timing facts (#97, verified 2026-10-08, CC 2.1.280):
// - Every record is stamped when written: an assistant record per content block
//   as it finishes streaming, a tool_result when its tool returns. A tool starts at
//   its tool_use record (streamed execution), so parallel calls overlap.
// - A typed prompt carries origin.kind 'human'; a background agent finishing wakes
//   the session with origin.kind 'task-notification'. Older records have no origin.
// - Idle gap default 10 min: on disk, 98% of gaps between records are under 1 min
//   and gaps thin out sharply past 10 min (p90 human think time 10.8 min), and
//   Bash's 10-min timeout caps any foreground tool run, so no tool is cut as idle.

import { createReadStream, readdirSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { shellSkillReads } from '../hooks/_hooklib.mjs';
import { sessionKey } from './lib.mjs';

const MTOK = 1e6;

function priceFor(model, prices) {
  const m = prices.models || {};
  if (m[model]) return m[model];
  // dated snapshots (claude-haiku-4-5-20251001) price as their base id
  const base = Object.keys(m).find((id) => model.startsWith(`${id}-`) && /^\d{8}$/.test(model.slice(id.length + 1)));
  return base ? m[base] : null;
}

/** One request's usage as the five priced token kinds. A write with no tier split
 *  on the record is all 5m (the API default TTL). */
function tokensOf(u) {
  const cc = u.cache_creation;
  return {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    cacheWrite5m: cc ? cc.ephemeral_5m_input_tokens || 0 : u.cache_creation_input_tokens || 0,
    cacheWrite1h: cc?.ephemeral_1h_input_tokens || 0,
  };
}

/** Price one request's usage. usd is null when the model has no price — an
 *  unknown model is reported as unpriced, never folded in as $0. */
export function priceUsage(u, model, prices) {
  const p = priceFor(model, prices);
  if (!p) return { usd: null };
  const tk = tokensOf(u);
  const web = u.server_tool_use?.web_search_requests || 0;
  const usd =
    (tk.input * p.input + tk.output * p.output + tk.cacheRead * p.cacheRead + tk.cacheWrite5m * p.cacheWrite5m + tk.cacheWrite1h * p.cacheWrite1h) / MTOK +
    (web * (prices.webSearchPer1k || 0)) / 1000;
  return { usd };
}

/** Tolerance for the cost-state check, as a fraction. Measured 2026-10-12 on 82 model
 *  rows (37 files, point estimates from each file's own 5m/1h split, tolerance 0): every
 *  row is within 0.01% of the published price or of the Sonnet 5.5 exception except
 *  opus-5-5 (34 rows, max |miss| 0.54%) and opus-5 (6 rows, one at 0.67%), where
 *  cost-state's unrecorded requests skew the transcript's tier ratio. 1% is that max
 *  plus margin: a uniform 10% repricing is far outside, a sub-1% drift is not seen. */
export const PRICE_TOLERANCE = 0.01;

/** modelUsage → the usage record priceUsage reads, `share1h` of the cache writes at 1h. */
function usageOfModel(u, share1h) {
  const writes = u.cacheCreationInputTokens || 0;
  return {
    input_tokens: u.inputTokens,
    output_tokens: u.outputTokens,
    cache_read_input_tokens: u.cacheReadInputTokens,
    cache_creation: { ephemeral_5m_input_tokens: writes * (1 - share1h), ephemeral_1h_input_tokens: writes * share1h },
    server_tool_use: { web_search_requests: u.webSearchRequests },
  };
}

/** Relative miss of cost-state's $ for one model against prices.json. modelUsage splits
 *  no cache-write tier, so the split comes from `share1h`, the 1h share of the model's
 *  writes in the same file's transcript: a point estimate, miss = cost / priced - 1.
 *  Without it (null) cost-state's $ is only known to lie between every write priced 5m
 *  and every write priced 1h: a band, miss 0 inside it. null when the model has no price
 *  or no $. */
function priceMiss(u, model, prices, share1h) {
  if (!u.costUSD) return null;
  const lo = priceUsage(usageOfModel(u, share1h ?? 0), model, prices).usd;
  if (lo === null) return null;
  if (share1h !== null) return u.costUSD / lo - 1;
  const hi = priceUsage(usageOfModel(u, 1), model, prices).usd;
  return u.costUSD < lo ? u.costUSD / lo - 1 : u.costUSD > hi ? u.costUSD / hi - 1 : 0;
}

/** One model of a cost-state record: 'ok', 'excepted' (fits only the model's dated
 *  exception price), or 'drift' with the miss against the published price; `band` marks a
 *  row checked only against the 5m/1h band. null: unchecked. */
function checkModelUsage(u, model, prices, share1h, tolerance) {
  const miss = priceMiss(u, model, prices, share1h);
  if (miss === null) return null;
  const band = share1h === null;
  if (Math.abs(miss) <= tolerance) return { status: 'ok', band };
  const p = priceFor(model, prices);
  if (p.exception) {
    const withException = { ...prices, models: { [model]: { ...p, ...p.exception.price } } };
    if (Math.abs(priceMiss(u, model, withException, share1h)) <= tolerance) return { status: 'excepted', band };
  }
  return { status: 'drift', miss, band };
}

const depthOf = (u) => (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);

/** "PreToolUse:Bash hook error: [node "…/bash-guard.mjs"]: reason" → parts. */
export function parseHookBlock(text) {
  const m = /^(\w+):(\S+) hook error: \[(.+?)\]: ([\s\S]*)$/.exec(String(text).trim());
  if (!m) return null;
  return { event: m[1], tool: m[2], hook: hookName(m[3]), reason: m[4].trim() };
}

function hookName(command) {
  const script = /([\w.-]+\.(?:mjs|js|ps1|sh|py|exe))\b/.exec(command);
  return script ? script[1] : command;
}

const pct = (a, p) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)];
};
const bump = (o, k, by = 1) => (o[k] = (o[k] || 0) + by);
const textOf = (content) =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => (typeof c === 'string' ? c : c?.text || '')).join('') : '';

// ---- time (#97) ---------------------------------------------------------------

export const IDLE_GAP_MIN = 10;
const DAY_MS = 864e5;
// a tool that waits on a person is user time, not tool latency
const USER_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
const SHELLS = new Set(['Bash', 'PowerShell']);
const EDITS = new Set(['Edit', 'Write', 'NotebookEdit']); // #99: inline implementation
const DISPATCHES = new Set(['Agent', 'Task']);
// overlap priority: idle > asked > model > tools > waiting for the next prompt;
// a span none of them covers is other (background waits, stop hooks)
const ORDER = ['idle', 'ask', 'model', 'tools', 'wait'];
const BUCKET = { idle: 'idleMs', ask: 'userMs', model: 'modelMs', tools: 'toolsMs', wait: 'userMs' };
const SPLIT = ['idleMs', 'modelMs', 'toolsMs', 'userMs', 'otherMs'];
const zeroSplit = () => Object.fromEntries(SPLIT.map((k) => [k, 0]));
const MULTI = new Set(['git', 'gh', 'npm', 'pnpm', 'npx', 'yarn', 'node', 'bun', 'deno', 'just', 'cargo', 'docker', 'python', 'py', 'uv', 'go', 'claude']);
const VALUED = new Set(['-C', '-c']); // git flags whose value is not the subcommand

// shell steps that set up the real command rather than being it
const SETUP = new Set(['cd', 'pushd', 'export', 'set', 'source', '.', 'Set-Location']);

/** The program (and its subcommand or script) a shell command runs:
 *  "cd x && git -C repo log --oneline" → "git log". */
export function commandHead(command) {
  for (const seg of String(command || '').replace(/\\\r?\n/g, ' ').split(/\n|&&|\|\||;|\||\$\(/)) {
    if (/^\s*[\w-]+\(\)/.test(seg)) continue; // a shell function definition
    const words = seg.trim().split(/\s+/).filter((w) => w && !/^\w+=/.test(w)).map((w) => w.replace(/^["'(]+|["')]+$/g, ''));
    if (!words[0] || /^[#-]/.test(words[0]) || /^[{}]$/.test(words[0])) continue;
    const prog = words[0].split(/[\\/]/).pop().replace(/\.exe$/i, '');
    if (SETUP.has(prog)) continue;
    if (!MULTI.has(prog)) return prog;
    for (let i = 1; i < words.length; i++) {
      if (VALUED.has(words[i])) { i++; continue; }
      if (!words[i].startsWith('-')) return `${prog} ${words[i].split(/[\\/]/).pop()}`;
    }
    return prog;
  }
  return '?';
}

/** Splits [first, last] into bucket ms per UTC day; on overlap the earliest ORDER
 *  category wins, so parallel spans count once. intervals: [start, end, category]. */
function sweep(intervals, first, last) {
  const pts = [[first, null, 0], [last, null, 0]];
  for (const [a, b, cat] of intervals) {
    const s = Math.max(a, first), e = Math.min(b, last);
    if (e > s) pts.push([s, cat, 1], [e, cat, -1]);
  }
  for (let d = Math.floor(first / DAY_MS) * DAY_MS + DAY_MS; d < last; d += DAY_MS) pts.push([d, null, 0]);
  pts.sort((x, y) => x[0] - y[0]);
  const live = Object.fromEntries(ORDER.map((k) => [k, 0]));
  const days = new Map();
  for (let i = 0; i < pts.length - 1; i++) {
    const [t, cat, d] = pts[i];
    if (cat) live[cat] += d;
    const span = pts[i + 1][0] - t;
    if (span <= 0) continue;
    const top = ORDER.find((k) => live[k] > 0);
    const day = new Date(t).toISOString().slice(0, 10);
    const row = days.get(day) || zeroSplit();
    row[top ? BUCKET[top] : 'otherMs'] += span;
    days.set(day, row);
  }
  return days;
}

/** ms of [a, b] outside the idle gaps. */
const activeBetween = (a, b, idle) => idle.reduce((ms, [s, e]) => ms - Math.max(0, Math.min(b, e) - Math.max(a, s)), b - a);
const latency = (ms) => ({ calls: ms.length, p50: pct(ms, 50), p95: pct(ms, 95), totalMs: ms.reduce((x, y) => x + y, 0) });
const isHuman = (rec) => {
  const kind = rec.origin?.kind;
  if (kind) return kind === 'human';
  return !/^\s*<task-notification/.test(textOf(rec.message?.content));
};
const errorReason = (text) => text.replace(/<\/?[\w-]+>/g, '').trim().split('\n')[0].slice(0, 70);
// gates that refuse a call without being a hook; their refusals are blocks too
// [match, gate name, the part of the text that says why]
const GATES = [
  [/denied by the Claude Code auto mode classifier/, 'auto-mode classifier', /Reason: (.+?)\.(?:\s|$)/],
  [/^The user doesn't want to proceed with this tool use/, 'user denied'],
  [/^This session is isolated in the worktree/, 'worktree isolation', /, but (.+?)\.(?:\s|$)/],
];
/** A failed call's text → { gate, reason } when a hook or gate refused it. */
function refusal(text) {
  const blk = parseHookBlock(text);
  if (blk) return { gate: blk.hook, reason: blk.reason.slice(0, 70) };
  const plain = text.replace(/<\/?[\w-]+>/g, '').trim();
  const g = GATES.find(([re]) => re.test(plain));
  if (!g) return null;
  const why = g[2]?.exec(plain);
  return { gate: g[1], reason: why ? why[1].slice(0, 70) : errorReason(plain) };
}

/** Accumulates records (add) and produces the report (report). ctx is
 *  { sessionId, agent: null | { id, type, model }, window?, name?, timeOnly? } — from
 *  transcriptWindows. Rows key by window, else by sessionId (one window per file).
 *  A timeOnly record feeds its file's timeline and nothing else. */
export function createCollector({ prices, since, until, installedSkills = [], docPrefixes = [], idleGapMin = IDLE_GAP_MIN, tolerance = PRICE_TOLERANCE }) {
  const requests = new Map(); // requestId -> { u, model, day, ctx }
  const lines = new Map(); // sessionId or sessionId/agent -> timeline (#97), per file as windows share idle detection
  const timeOnly = new Set(); // windows fed only so their file's time is whole (--session)
  const timedUuid = new Set();
  const seenUuid = new Set();
  const seenTool = new Set();
  const custom = new Map(); // window -> its custom title
  const ai = new Map(); // sessionId -> auto title, a per-file fallback label
  const fileOf = new Map(); // window -> sessionId
  const titleOf = (key) => custom.get(key) || ai.get(fileOf.get(key)) || '';
  const reported = new Map(); // sessionId -> Claude Code's cost-state total (its max)
  const reportedModels = new Map(); // sessionId -> that record's modelUsage
  const skills = {}, skillReads = {}, slash = {}, docs = {};
  const hookBlocks = {}, hookTimes = {}, hookFires = {};
  const inRange = (ts) => {
    if (!ts) return true;
    const day = ts.slice(0, 10);
    return (!since || day >= since) && (!until || day <= until);
  };
  const prefixes = docPrefixes.map((p) => p.toLowerCase());

  function toolUse(b) {
    if (b?.type !== 'tool_use' || !b.id || seenTool.has(b.id)) return;
    seenTool.add(b.id);
    if (b.name === 'Skill' && b.input?.skill) bump(skills, b.input.skill);
    // #64: skills are disable-model-invocation and reached by Reading the SKILL.md the
    // session-start index names — that Read is the invocation
    const skillFile = b.name === 'Read' && /[\\/]skills[\\/]([^\\/]+)[\\/]SKILL\.md$/i.exec(b.input?.file_path || '');
    if (skillFile) bump(skillReads, skillFile[1]);
    // …or by cat/sed/Get-Content in a shell, which reads it just the same
    if (SHELLS.has(b.name)) {
      for (const s of shellSkillReads(b.input?.command)) if (s !== 'INDEX') bump(skillReads, s);
    }
    // docs only: Reads of source files are editing, not doc consumption
    if (b.name === 'Read' && /\.md$/i.test(b.input?.file_path || '') && prefixes.length) {
      const path = b.input.file_path.replace(/\\/g, '/');
      const lower = path.toLowerCase();
      for (const p of prefixes) {
        const i = lower.indexOf(p);
        if (i >= 0) { bump(docs, path.slice(i)); break; }
      }
    }
  }

  /** The context's timeline: a main file's carries its windows' starts, a
   *  subagent's the window it joined. */
  function timelineOf(ctx) {
    const key = ctx.agent ? `${ctx.sessionId}/${ctx.agent.id}` : ctx.sessionId;
    let tl = lines.get(key);
    if (!tl) {
      tl = { sessionId: ctx.sessionId, agent: ctx.agent, ts: [], reqs: new Map(), uses: [], byId: new Map(), prompts: [], lastInput: null, lastEnd: null };
      if (ctx.agent) tl.win = ctx.window ?? ctx.sessionId;
      else Object.assign(tl, { starts: [], floor: -Infinity });
      lines.set(key, tl);
    }
    return tl;
  }

  /** A main window starts at its first stamp at or after the previous window's start:
   *  stamps run backwards in real files, and the windows must still tile the file in
   *  order. A window with no such stamp keeps at null and gets an empty span. */
  function markStart(tl, win, t) {
    let s = tl.starts.at(-1);
    if (s?.win !== win) tl.starts.push((s = { win, at: null }));
    if (s.at === null && t >= tl.floor) s.at = tl.floor = t;
  }

  /** Collects one record's timestamp, request span, tool call or prompt into its
   *  context's timeline. Replayed records (a resumed session's file) count once. */
  function timeRecord(rec, ctx) {
    const t = Date.parse(rec.timestamp || '');
    if (!t) return;
    if (rec.uuid) {
      if (timedUuid.has(rec.uuid)) return;
      timedUuid.add(rec.uuid);
    }
    const tl = timelineOf(ctx);
    const win = ctx.window ?? ctx.sessionId;
    if (!ctx.agent) markStart(tl, win, t);
    tl.ts.push(t);
    if (rec.type === 'assistant') {
      const rid = rec.requestId || rec.message?.id || rec.uuid;
      let q = tl.reqs.get(rid);
      // a request runs from whatever fed it (the last prompt or tool result) to its last block
      if (!q) tl.reqs.set(rid, (q = { start: Math.min(t, Math.max(tl.lastInput ?? t, tl.lastEnd ?? -Infinity)), end: t }));
      q.end = Math.max(q.end, t);
      tl.lastEnd = Math.max(tl.lastEnd ?? t, t);
      for (const b of rec.message?.content || []) {
        if (b?.type !== 'tool_use' || !b.id || tl.byId.has(b.id)) continue;
        const u = { name: b.name, win, t, end: null, err: false, text: '', cmd: SHELLS.has(b.name) ? commandHead(b.input?.command) : null,
          file: EDITS.has(b.name) ? b.input?.file_path || b.input?.notebook_path || '' : null };
        tl.uses.push(u);
        tl.byId.set(b.id, u);
      }
    } else if (rec.type === 'user') {
      const c = rec.message?.content;
      const results = Array.isArray(c) ? c.filter((b) => b?.type === 'tool_result') : [];
      for (const b of results) {
        const u = tl.byId.get(b.tool_use_id);
        if (!u || u.end !== null) continue;
        u.end = t;
        u.err = !!b.is_error;
        if (u.err) u.text = textOf(b.content).slice(0, 400);
      }
      // the wait for a prompt starts at the last work, not at bookkeeping records
      // (queue-operation, away_summary, stop hooks) written in between
      const lastWork = Math.max(tl.lastEnd ?? -Infinity, tl.lastInput ?? -Infinity);
      if (!results.length && !rec.isMeta) tl.prompts.push({ t, from: lastWork > -Infinity ? lastWork : null, human: isHuman(rec) });
      if (results.length || !rec.isMeta) tl.lastInput = t;
    }
  }

  function add(rec, ctx) {
    if (!rec || typeof rec !== 'object') return;
    const sid = ctx.sessionId, win = ctx.window ?? sid;
    fileOf.set(win, sid);
    if (ctx.timeOnly) {
      timeOnly.add(win);
      if (inRange(rec.timestamp)) timeRecord(rec, ctx);
      return;
    }
    if (rec.type === 'custom-title') {
      // an empty title is no name, as windowSplitter reads it: it never clears one
      if (rec.customTitle) custom.set(win, rec.customTitle);
      return;
    }
    if (rec.type === 'ai-title') {
      ai.set(sid, rec.aiTitle);
      return;
    }
    if (rec.type === 'cost-state') {
      const total = rec.totalCostUSD || 0;
      if (total >= (reported.get(sid) || 0)) reportedModels.set(sid, rec.modelUsage || {});
      reported.set(sid, Math.max(reported.get(sid) || 0, total));
      return;
    }
    if (!inRange(rec.timestamp)) return;
    timeRecord(rec, ctx);

    if (rec.type === 'assistant') {
      const u = rec.message?.usage;
      const model = rec.message?.model;
      for (const b of rec.message?.content || []) toolUse(b);
      if (!u || !model || model === '<synthetic>') return;
      const key = rec.requestId || rec.message?.id || rec.uuid;
      const prev = requests.get(key);
      if (!prev || (u.output_tokens || 0) > (prev.u.output_tokens || 0)) {
        requests.set(key, { u, model, effort: rec.effort ?? prev?.effort ?? null, day: (rec.timestamp || '').slice(0, 10), ctx });
      }
      return;
    }

    if (rec.uuid) {
      if (seenUuid.has(rec.uuid)) return;
      seenUuid.add(rec.uuid);
    }
    if (rec.type === 'user') {
      const c = rec.message?.content;
      if (typeof c === 'string') {
        const m = /<command-name>\/?([^<]+)<\/command-name>/.exec(c);
        if (m) bump(slash, m[1].trim());
      } else if (Array.isArray(c)) {
        for (const b of c) {
          if (b?.type !== 'tool_result') continue;
          const blk = parseHookBlock(textOf(b.content));
          if (!blk) continue;
          const h = (hookBlocks[blk.hook] ||= { count: 0, reasons: {} });
          h.count++;
          bump(h.reasons, blk.reason.slice(0, 70));
        }
      }
    } else if (rec.type === 'system' && rec.subtype === 'stop_hook_summary') {
      for (const info of rec.hookInfos || []) {
        if (!info?.command || info.command === 'callback') continue;
        (hookTimes[hookName(info.command)] ||= []).push(info.durationMs ?? 0);
      }
    } else if (rec.type === 'attachment' && /^hook_/.test(rec.attachment?.type || '')) {
      bump(hookFires, `${rec.attachment.hookName || rec.attachment.hookEvent || '?'} ${rec.attachment.type}`);
    }
  }

  function report() {
    const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
    const writeTiers = new Map(); // file + model -> cache-write tokens its transcript records, by tier
    const totals = { requests: 0, usd: 0, tokens: zero() };
    const days = new Map(), sessions = new Map(), agents = {}, agentRuns = {}, unpriced = {}, runUsd = new Map();
    const runSettings = new Map(); // agent id -> { type, settings: model\neffort -> { model, effort, requests, usd } }
    for (const { u, model, effort, day, ctx } of requests.values()) {
      const { usd } = priceUsage(u, model, prices);
      const tk = tokensOf(u);
      if (usd === null) {
        const x = (unpriced[model] ||= { requests: 0, tokens: 0 });
        x.requests++;
        x.tokens += Object.values(tk).reduce((a, b) => a + b, 0);
      }
      const cost = usd ?? 0;
      totals.requests++;
      totals.usd += cost;
      for (const k of Object.keys(tk)) totals.tokens[k] += tk[k];

      const d = days.get(day) || { day, sessions: new Set(), requests: 0, usd: 0, peakDepth: 0 };
      const win = ctx.window ?? ctx.sessionId;
      const wk = `${fileOf.get(win)}\n${model}`;
      const w = writeTiers.get(wk) || writeTiers.set(wk, { m5: 0, h1: 0 }).get(wk);
      w.m5 += tk.cacheWrite5m;
      w.h1 += tk.cacheWrite1h;
      d.sessions.add(win);
      d.requests++;
      d.usd += cost;
      const s = sessions.get(win) || { sessionId: win, requests: 0, usd: 0, subagentUsd: 0, peakDepth: 0, first: day, last: day };
      s.requests++;
      s.usd += cost;
      if (day && (!s.first || day < s.first)) s.first = day;
      if (day > s.last) s.last = day;
      if (ctx.agent) {
        s.subagentUsd += cost;
        const a = (agents[ctx.agent.type] ||= { runs: 0, requests: 0, usd: 0, models: {} });
        a.requests++;
        a.usd += cost;
        bump(a.models, model);
        (agentRuns[ctx.agent.type] ||= new Set()).add(ctx.agent.id);
        runUsd.set(ctx.agent.id, (runUsd.get(ctx.agent.id) || 0) + cost);
        const run = runSettings.get(ctx.agent.id) || runSettings.set(ctx.agent.id, { type: ctx.agent.type, settings: new Map() }).get(ctx.agent.id);
        const sk = `${model}\n${effort}`;
        const st = run.settings.get(sk) || run.settings.set(sk, { model, effort, requests: 0, usd: 0 }).get(sk);
        st.requests++;
        st.usd += cost;
      } else {
        const depth = depthOf(u);
        s.peakDepth = Math.max(s.peakDepth, depth);
        d.peakDepth = Math.max(d.peakDepth, depth);
      }
      days.set(day, d);
      sessions.set(win, s);
    }
    for (const [type, ids] of Object.entries(agentRuns)) agents[type].runs = ids.size;
    const agentMix = agentMixOf(runSettings);

    // cost-state is per transcript file: Claude Code's total beside the sum of the file's
    // windows. It counts more than the transcripts hold (see the header), so it is shown
    // for coverage, not as a price check
    const windowsOf = new Map(); // sessionId -> its windows' cost rows
    for (const s of sessions.values()) {
      const sid = fileOf.get(s.sessionId);
      (windowsOf.get(sid) || windowsOf.set(sid, []).get(sid)).push(s);
    }
    const costState = { files: 0, reportedUsd: 0, computedUsd: 0 };
    // per model: files checked, files on the exception price, drift misses (%); exceptions: those in use
    const priceCheck = { models: {}, exceptions: {} };
    for (const [sid, total] of reported) {
      if (!total || !windowsOf.has(sid)) continue;
      for (const [model, u] of Object.entries(reportedModels.get(sid) || {})) {
        const wt = writeTiers.get(`${sid}\n${model}`);
        const share1h = wt && wt.m5 + wt.h1 > 0 ? wt.h1 / (wt.m5 + wt.h1) : null;
        const res = checkModelUsage(u, model, prices, share1h, tolerance);
        if (!res) continue;
        const m = (priceCheck.models[model] ||= { files: 0, excepted: 0, band: 0, drift: [] });
        m.files++;
        if (res.band) m.band++;
        if (res.status === 'excepted') {
          m.excepted++;
          const { price, since, waitsOn } = priceFor(model, prices).exception;
          priceCheck.exceptions[model] = { since, waitsOn, price, published: Object.fromEntries(Object.keys(price).map((k) => [k, priceFor(model, prices)[k]])) };
        }
        if (res.status === 'drift') m.drift.push(res.miss * 100);
      }
      costState.files++;
      costState.reportedUsd += total;
      costState.computedUsd += windowsOf.get(sid).reduce((a, s) => a + s.usd, 0);
    }

    const timed = {};
    for (const [h, ms] of Object.entries(hookTimes)) timed[h] = { fires: ms.length, p50: pct(ms, 50), p95: pct(ms, 95) };
    const names = new Map(); // session key -> one row over all its windows
    for (const s of sessions.values()) {
      const name = sessionKey(custom.get(s.sessionId));
      if (!name) continue;
      const g = names.get(name) || { name, windows: 0, requests: 0, usd: 0, subagentUsd: 0, first: s.first, last: s.last };
      g.windows++;
      g.requests += s.requests;
      g.usd += s.usd;
      g.subagentUsd += s.subagentUsd;
      if (s.first < g.first) g.first = s.first;
      if (s.last > g.last) g.last = s.last;
      names.set(name, g);
    }
    const used = new Set([...Object.keys(skills), ...Object.keys(skillReads), ...Object.keys(slash)].map((s) => s.split(':').pop()));

    return {
      pricesVerified: prices.verified,
      totals,
      unpriced,
      costState,
      priceCheck,
      days: [...days.values()].map((d) => ({ ...d, sessions: d.sessions.size })).sort((a, b) => a.day.localeCompare(b.day)),
      sessions: [...sessions.values()]
        .map((s) => ({ ...s, title: titleOf(s.sessionId) }))
        .sort((a, b) => b.usd - a.usd),
      names: [...names.values()].sort((a, b) => b.usd - a.usd),
      agents,
      agentMix,
      skills,
      skillReads,
      slash,
      unusedSkills: installedSkills.filter((s) => !used.has(s)).sort(),
      docs,
      hooks: { blocks: hookBlocks, timed, fires: hookFires },
      time: timeReport({ sessions, days, agents, runUsd }),
      inline: inlineReport(),
    };
  }

  /** #99's measure: per main window, Edit/Write calls against Agent dispatches,
   *  and the most distinct files edited between two dispatches. */
  function inlineReport() {
    const rows = [];
    for (const tl of lines.values()) {
      if (tl.agent) continue;
      for (const { win } of tl.starts) if (!timeOnly.has(win)) inlineRow(rows, win, tl.uses.filter((u) => u.win === win));
    }
    return rows.sort((a, b) => b.edits - a.edits);
  }

  function inlineRow(rows, win, uses) {
    const files = new Set();
    let edits = 0, dispatches = 0, run = new Set(), longestRun = 0;
    for (const u of uses.sort((a, b) => a.t - b.t)) {
      if (EDITS.has(u.name)) {
        edits++;
        files.add(u.file);
        run.add(u.file);
        longestRun = Math.max(longestRun, run.size);
      } else if (DISPATCHES.has(u.name)) {
        dispatches++;
        run = new Set();
      }
    }
    if (edits || dispatches) rows.push({ sessionId: win, title: titleOf(win), edits, editFiles: files.size, dispatches, longestRun });
  }

  /** Wall vs active time, the model/tools/user/other split per session, name and
   *  day, agent-run wall time, tool latency and retry cost (#97). $ is joined in
   *  from the cost rows so time and spend sit side by side. */
  function timeReport(cost) {
    const { sessions, days, totals, idleOf } = windowTimes(cost);
    const names = new Map();
    for (const s of sessions) {
      const name = sessionKey(custom.get(s.sessionId));
      if (!name) continue;
      const g = names.get(name) || { name, windows: 0, wallMs: 0, activeMs: 0, ...zeroSplit(), usd: 0 };
      g.windows++;
      for (const k of ['wallMs', 'activeMs', ...SPLIT, 'usd']) g[k] += s[k];
      names.set(name, g);
    }
    const { agents, agentRuns } = agentTimes(cost);
    const { tools, commands, retry } = toolTimes(idleOf);
    return {
      idleGapMin,
      totals,
      days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
      sessions: sessions.sort((a, b) => b.activeMs - a.activeMs),
      names: [...names.values()].sort((a, b) => b.activeMs - a.activeMs),
      agents,
      agentRuns: agentRuns.sort((a, b) => b.wallMs - a.wallMs),
      tools,
      commands,
      retry,
    };
  }

  /** Per main file: idle gaps over its records and its subagents' (a parent waiting
   *  on a running agent isn't idle), then the file's sweep partitioned at its window
   *  starts. Each window runs to the next one's start, the first from the file's
   *  first record, the last to its last. idleOf (sessionId -> gaps) feeds toolTimes. */
  function windowTimes(cost) {
    const idleGapMs = idleGapMin * 60e3;
    const subs = new Map(); // sessionId -> its subagent timelines
    for (const tl of lines.values()) if (tl.agent) (subs.get(tl.sessionId) || subs.set(tl.sessionId, []).get(tl.sessionId)).push(tl);
    const sessions = [], days = new Map(), idleOf = new Map();
    const totals = { wallMs: 0, activeMs: 0, ...zeroSplit() };
    for (const tl of lines.values()) {
      if (tl.agent || !tl.ts.length) continue;
      const ts = [...tl.ts, ...(subs.get(tl.sessionId) || []).flatMap((s) => s.ts)].sort((a, b) => a - b);
      const first = ts[0], last = ts.at(-1);
      const idle = [];
      for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > idleGapMs) idle.push([ts[i - 1], ts[i]]);
      idleOf.set(tl.sessionId, idle);
      const iv = idle.map(([a, b]) => [a, b, 'idle']);
      for (const q of tl.reqs.values()) iv.push([q.start, q.end, 'model']);
      for (const u of tl.uses) if (u.end !== null) iv.push([u.t, u.end, USER_TOOLS.has(u.name) ? 'ask' : 'tools']);
      for (const p of tl.prompts) if (p.human && p.from !== null) iv.push([p.from, p.t, 'wait']);
      // starts are in order by markStart. A window that never got one (at null) takes
      // the next window's start, filled from the back, so it is empty and the window
      // before it runs on to that start
      const bounds = [];
      for (let i = tl.starts.length - 1; i >= 0; i--) bounds[i] = i ? tl.starts[i].at ?? bounds[i + 1] ?? last : first;
      tl.starts.forEach(({ win }, i) => {
        if (timeOnly.has(win)) return;
        const span = [bounds[i], bounds[i + 1] ?? last];
        const row = { sessionId: win, title: titleOf(win),
          first: new Date(span[0]).toISOString().slice(0, 10), wallMs: span[1] - span[0], activeMs: 0, ...zeroSplit(), usd: cost.sessions.get(win)?.usd || 0 };
        for (const [day, split] of sweep(iv, ...span)) {
          const d = days.get(day) || { day, wallMs: 0, activeMs: 0, ...zeroSplit(), usd: cost.days.get(day)?.usd || 0 };
          for (const k of SPLIT) { row[k] += split[k]; d[k] += split[k]; }
          d.wallMs += SPLIT.reduce((a, k) => a + split[k], 0);
          d.activeMs = d.wallMs - d.idleMs;
          days.set(day, d);
        }
        row.activeMs = row.wallMs - row.idleMs;
        sessions.push(row);
        for (const k of Object.keys(totals)) totals[k] += row[k];
      });
    }
    return { sessions, days, totals, idleOf };
  }

  /** Wall time per subagent run, first record to last, and per agent type. */
  function agentTimes(cost) {
    const agentRuns = [], wallsOf = {};
    for (const tl of lines.values()) {
      if (!tl.agent || !tl.ts.length || timeOnly.has(tl.win)) continue;
      const first = tl.ts.reduce((a, b) => Math.min(a, b)), wallMs = tl.ts.reduce((a, b) => Math.max(a, b)) - first;
      agentRuns.push({ id: tl.agent.id, sessionId: tl.win, type: tl.agent.type, first: new Date(first).toISOString().slice(0, 10), wallMs, usd: cost.runUsd.get(tl.agent.id) || 0 });
      (wallsOf[tl.agent.type] ||= []).push(wallMs);
    }
    const agents = {};
    for (const [type, ms] of Object.entries(wallsOf)) {
      agents[type] = { runs: ms.length, wallMs: ms.reduce((a, b) => a + b, 0), p50: pct(ms, 50), p95: pct(ms, 95), usd: cost.agents[type]?.usd || 0 };
    }
    return { agents, agentRuns };
  }

  /** Tool and command latency, and what each failed call cost until a retry of
   *  the same tool succeeded. A timeOnly window's calls still end a chain, so a
   *  --session row matches its whole-root row, but its own failures aren't counted. */
  function toolTimes(idleOf) {
    const toolMs = {}, cmdMs = {}, blocks = {}, errors = {};
    for (const tl of lines.values()) {
      const idle = idleOf.get(tl.sessionId) || [];
      const byName = new Map();
      for (const u of tl.uses) {
        (byName.get(u.name) || byName.set(u.name, []).get(u.name)).push(u);
        if (timeOnly.has(u.win) || u.end === null || USER_TOOLS.has(u.name)) continue;
        (toolMs[u.name] ||= []).push(u.end - u.t);
        if (u.cmd) (cmdMs[u.cmd] ||= []).push(u.end - u.t);
      }
      // piecewise: a failed call is charged the time to the next call of the same
      // tool, when a success follows; a chain then sums to exactly fail → success
      for (const [name, list] of byName) {
        if (USER_TOOLS.has(name)) continue; // a declined question is an answer, not a retry
        list.sort((a, b) => a.t - b.t);
        let laterOk = false;
        const okAfter = [];
        for (let i = list.length - 1; i >= 0; i--) { okAfter[i] = laterOk; if (list[i].end !== null && !list[i].err) laterOk = true; }
        list.forEach((u, i) => {
          if (u.end === null || !u.err || timeOnly.has(u.win)) return;
          const no = refusal(u.text);
          const [table, key, reason] = no ? [blocks, no.gate, no.reason] : [errors, u.name, errorReason(u.text)];
          const row = (table[key] ||= { count: 0, retried: 0, unresolved: 0, ms: 0, reasons: {} });
          const why = (row.reasons[reason] ||= { count: 0, ms: 0 });
          row.count++;
          why.count++;
          if (!okAfter[i]) { row.unresolved++; return; }
          const ms = activeBetween(u.t, list[i + 1].t, idle);
          row.retried++;
          row.ms += ms;
          why.ms += ms;
        });
      }
    }
    const summarize = (o) => Object.fromEntries(Object.entries(o).map(([k, ms]) => [k, latency(ms)]));
    return { tools: summarize(toolMs), commands: summarize(cmdMs), retry: { blocks, errors } };
  }

  return { add, report };
}

/** Per agent type × model × effort (#113): runs, requests and $. A run is filed whole
 *  under the setting most of its requests used (ties: the costlier), so a type's rows add
 *  up to its per-type runs and $; mixedRuns counts the runs that also used another
 *  setting. effort is null where the records carry none. Sorted by type, then $. */
function agentMixOf(runSettings) {
  const rows = new Map();
  for (const { type, settings } of runSettings.values()) {
    const all = [...settings.values()];
    const main = all.reduce((a, b) => (b.requests > a.requests || (b.requests === a.requests && b.usd > a.usd) ? b : a));
    const key = `${type}\n${main.model}\n${main.effort}`;
    const row = rows.get(key) || rows.set(key, { type, model: main.model, effort: main.effort, runs: 0, mixedRuns: 0, requests: 0, usd: 0 }).get(key);
    row.runs++;
    if (all.length > 1) row.mixedRuns++;
    for (const s of all) {
      row.requests += s.requests;
      row.usd += s.usd;
    }
  }
  return [...rows.values()].sort((a, b) => a.type.localeCompare(b.type) || b.usd - a.usd);
}

// ---- model stamps (#113) -----------------------------------------------------

/** "claude-opus-5-5" -> ['opus', '5.5']; a dated snapshot's date is no version part. */
const MODEL_ID = /^claude-([a-z]+)-(\d+(?:-\d+)*?)(?:-\d{8})?$/;
const versionParts = (v) => v.split('.').map(Number);
function compareVersions(a, b) {
  const [x, y] = [versionParts(a), versionParts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

/** The current generation of each model line: the newest version prices.json prices. */
export function currentGenerations(prices) {
  const gens = {};
  for (const id of Object.keys(prices.models || {})) {
    const m = MODEL_ID.exec(id);
    if (!m) continue;
    const v = m[2].replace(/-/g, '.');
    if (!gens[m[1]] || compareVersions(v, gens[m[1]]) > 0) gens[m[1]] = v;
  }
  return gens;
}

/** The text a stamp covers: "(verified: 2026-10, Opus 5.5)" -> ", Opus 5.5"; a stamp
 *  whose models sit in their own parentheses, "verified: 2026-10 (Opus 5.5)", -> "Opus 5.5". */
function stampScope(rest) {
  const own = /^\s*\(([^)]*)\)/.exec(rest);
  return own ? own[1] : rest.split(')')[0];
}

/** Model mentions in `verified: YYYY-MM …` stamps that name an older version than the
 *  current generation of their line. A model of a line prices.json doesn't know, or a
 *  newer one, is not stale. A dated snapshot (claude-opus-5-20260101) reads as its base
 *  version; a model ending a sentence ("Opus 4.7.") is still read. -> [{ line (1-based), model, modelLine, current }] */
export function staleStamps(text, gens) {
  const lineNames = Object.keys(gens);
  if (!lineNames.length) return [];
  const mention = new RegExp(String.raw`\b(?:claude-)?(${lineNames.join('|')})[\s-]+(\d{1,2}(?:[.-]\d{1,2})?)(?:-\d{8})?(?!\d|\.\d)`, 'gi');
  const out = [];
  String(text).split(/\r?\n/).forEach((row, i) => {
    for (const stamp of row.matchAll(/verified:\s*\d{4}-\d{2}(?:-\d{2})?/g)) {
      const scope = stampScope(row.slice(stamp.index + stamp[0].length));
      for (const m of scope.matchAll(mention)) {
        const modelLine = m[1].toLowerCase();
        const current = gens[modelLine];
        if (compareVersions(m[2].replace(/-/g, '.'), current) < 0) out.push({ line: i + 1, model: m[0], modelLine, current });
      }
    }
  });
  return out;
}

/** Repo-relative .md files under dir (recursive); `only` keeps one file name. */
function markdownUnder(root, dir, only) {
  const out = [];
  const walk = (rel) => {
    let entries;
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const path = `${rel}/${e.name}`;
      if (e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.')) walk(path);
      else if (e.isFile() && (only ? e.name === only : e.name.endsWith('.md'))) out.push(path);
    }
  };
  walk(dir);
  return out;
}

/** Stale model stamps in the CLAUDE.md chain (workspace/), workspace/docs/, agents/ and skills/ of the
 *  claude-config checkout at root. -> [{ file, line, model, modelLine, current }] */
export function checkStamps(root, prices) {
  const gens = currentGenerations(prices);
  const files = [...markdownUnder(root, 'workspace', 'CLAUDE.md'), ...markdownUnder(root, 'workspace/docs'), ...markdownUnder(root, 'agents'), ...markdownUnder(root, 'skills')];
  return files.flatMap((file) => staleStamps(readFileSync(join(root, file), 'utf8'), gens).map((s) => ({ file, ...s })));
}

/** One stale stamp as a report line. */
export const stampLine = (s) => `${s.file}:${s.line} names ${s.model}, older than the current ${s.modelLine} ${s.current} in prices.json`;

/** readdir that treats an unreadable or vanished directory as empty. */
const safeReaddir = async (dir) => {
  try { return await readdir(dir, { withFileTypes: true }); } catch { return []; }
};

/** Yields { file, ctx } for every main-session and subagent transcript under root.
 *  A missing root throws (spend.mjs treats that as a failed refresh); unreadable
 *  directories below it are skipped one by one; symlinked/junction dirs are followed. */
export async function* walkTranscripts(root) {
  for (const proj of await readdir(root, { withFileTypes: true })) {
    if (!proj.isDirectory() && !proj.isSymbolicLink()) continue;
    const pdir = join(root, proj.name);
    for (const e of await safeReaddir(pdir)) {
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        yield { file: join(pdir, e.name), ctx: { sessionId: e.name.slice(0, -6), agent: null } };
      } else if (e.isDirectory() || e.isSymbolicLink()) {
        const sub = join(pdir, e.name, 'subagents');
        for (const f of (await safeReaddir(sub)).map((d) => d.name)) {
          if (!f.endsWith('.jsonl')) continue;
          const id = basename(f, '.jsonl').replace(/^agent-/, '');
          let meta = {};
          try { meta = JSON.parse(readFileSync(join(sub, `agent-${id}.meta.json`), 'utf8')); } catch { /* no meta: untyped */ }
          yield { file: join(sub, f), ctx: { sessionId: e.name, agent: { id, type: meta.agentType || 'unknown', model: meta.model } } };
        }
      }
    }
  }
}

const earliest = (a, b) => (a === null ? b : b === null ? a : Math.min(a, b));
const stampOf = (rec) => Date.parse(rec?.timestamp || '') || null;

/** Splits a main transcript into custom-title windows (#115), one record at a time in
 *  file order so the file is never held whole: push(rec) each record, then
 *  windows() -> [{ name, first (record index), startedAt (earliest ms stamp or null) }].
 *  A window starts at each change of custom-title (a repeat or an empty title is no
 *  change); records before the first title take it; a non-final window with no
 *  assistant record (the name /clear carries to the top of a new file) merges into
 *  the next. No title at all is one unnamed window. A null record holds its index
 *  and nothing else: transcriptWindows pushes a replay as one. */
export function windowSplitter() {
  const raw = [{ name: undefined, first: 0, startedAt: null, replied: false }];
  let i = 0;
  return {
    push(rec) {
      let w = raw.at(-1);
      const name = rec?.type === 'custom-title' ? rec.customTitle : undefined;
      if (name && w.name === undefined) w.name = name;
      else if (name && name !== w.name) raw.push((w = { name, first: i, startedAt: null, replied: false }));
      if (rec?.type === 'assistant') w.replied = true;
      w.startedAt = earliest(w.startedAt, stampOf(rec));
      i++;
    },
    windows() {
      const out = [];
      let prelude = null;
      raw.forEach((w, j) => {
        if (prelude) [w.first, w.startedAt] = [prelude.first, earliest(prelude.startedAt, w.startedAt)];
        if (w.replied || j === raw.length - 1) {
          out.push(w);
          prelude = null;
        } else prelude = w;
      });
      return out.map(({ name, first, startedAt }) => ({ name, first, startedAt }));
    },
  };
}

/** Main transcripts oldest first, so a replayed uuid stays with the original whatever
 *  the file names sort to (#142). A resume replays the original's records unchanged and
 *  appends later ones: it starts with the original's stamp (or later) and ends after it,
 *  so (first stamp, last stamp) orders an original before its resume; a file with no
 *  stamp goes last, and the path settles a tie. (No resume is on disk to confirm that
 *  replays keep their stamps; the fixture assumes they do, the harder case.) */
async function inReadOrder(mains) {
  const spans = new Map();
  for (const { file } of mains) {
    let lo = Infinity, hi = -Infinity;
    for await (const rec of readListed(file)) {
      const t = stampOf(rec);
      if (t !== null) [lo, hi] = [Math.min(lo, t), Math.max(hi, t)];
    }
    spans.set(file, [lo, hi]);
  }
  return mains.sort((a, b) => {
    const [x, y] = [spans.get(a.file), spans.get(b.file)];
    return x[0] === y[0] ? (x[1] === y[1] ? a.file.localeCompare(b.file) : x[1] - y[1]) : x[0] < y[0] ? -1 : 1;
  });
}

/** Yields { file, windows, records } for every transcript under root. windows is the
 *  ctx of each custom-title window, gaining window (the key its rows go under: the bare
 *  sessionId, then sessionId#2, #3…) and name (its custom-title). records streams
 *  { rec, ctx } in file order when iterated; each ctx is the very object in windows.
 *  A file is read twice, once to split it and once for its records, so none is held
 *  whole. The reads aren't atomic: records appended in between join the last window,
 *  and a file removed in between yields none. A uuid already read in a main
 *  transcript (a resume's replay, or a repeat in the same file) is read once: it
 *  stays where it came first, out of later splits and records (strate stores a uuid
 *  once). A subagent joins the
 *  window live at its earliest stamp (the latest started by then; with no stamp, the
 *  final one). Main transcripts come first so their windows are known when subagents
 *  are placed. */
export async function* transcriptWindows(root) {
  const mains = [], subs = [], windowsOf = new Map(), held = new Set();
  for await (const t of walkTranscripts(root)) (t.ctx.agent ? subs : mains).push(t);
  for (const { file, ctx } of await inReadOrder(mains)) {
    const split = windowSplitter(), replays = new Set();
    let i = 0;
    for await (const rec of readListed(file)) {
      const replay = rec?.uuid && held.has(rec.uuid);
      if (replay) replays.add(i);
      else if (rec?.uuid) held.add(rec.uuid);
      split.push(replay ? null : rec);
      i++;
    }
    const ws = split.windows().map((w, j) => ({ ...w, ctx: { ...ctx, window: j ? `${ctx.sessionId}#${j + 1}` : ctx.sessionId, name: w.name } }));
    windowsOf.set(ctx.sessionId, ws);
    yield { file, windows: ws.map((w) => w.ctx), records: windowRecords(file, ws, replays) };
  }
  for (const { file, ctx } of subs) {
    const ws = windowsOf.get(ctx.sessionId);
    let at = { window: ctx.sessionId, name: undefined };
    if (ws) {
      let first = null;
      for await (const rec of readListed(file)) first = earliest(first, stampOf(rec));
      const i = first === null ? ws.length - 1 : Math.max(0, ws.findLastIndex((w) => w.startedAt !== null && w.startedAt <= first));
      at = { window: ws[i].ctx.window, name: ws[i].name };
    }
    const sub = { ...ctx, ...at };
    yield { file, windows: [sub], records: windowRecords(file, [{ first: 0, ctx: sub }], new Set()) };
  }
}

/** A transcript's records in file order, each with the ctx of the window it falls
 *  in; the replays transcriptWindows found are skipped. */
async function* windowRecords(file, ws, replays) {
  let i = -1, w = 0;
  for await (const rec of readListed(file)) {
    if (replays.has(++i)) continue;
    while (w + 1 < ws.length && i >= ws[w + 1].first) w++;
    yield { rec, ctx: ws[w].ctx };
  }
}

/** readJsonl for a file listed earlier: one removed since reads as empty. */
async function* readListed(file) {
  try {
    yield* readJsonl(file);
  } catch (e) {
    if (e?.code !== 'ENOENT') throw e;
  }
}

/** Streams a JSONL file's records; malformed lines are skipped. */
export async function* readJsonl(file) {
  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try { yield JSON.parse(line); } catch { /* torn or partial line */ }
  }
}

// ---- rendering ----------------------------------------------------------------

const usd = (n) => `$${n.toFixed(2)}`;
const kt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const table = (head, rows) => (rows.length ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n') : '_none_');
const byCount = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);

/** The #141 check as report lines: drift warns, an exception is named and dated, a clean check is one line. */
function priceCheckLines({ models, exceptions }) {
  const lines = [];
  const rate = (o) => Object.entries(o).map(([k, v]) => `${k} $${v}`).join(', ');
  for (const [model, m] of Object.entries(models)) {
    if (m.drift.length) {
      const worst = m.drift.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a));
      lines.push(`⚠ price drift ${model}: ${m.drift.length} of ${m.files} cost-state files off by up to ${worst.toFixed(1)}% on their own tokens — re-verify prices.json`);
    }
  }
  for (const [model, e] of Object.entries(exceptions)) {
    lines.push(`exception ${model} (since ${e.since}): ${models[model].excepted} of ${models[model].files} cost-state files fit only ${rate(e.price)} (published ${rate(e.published)}); waits on ${e.waitsOn}`);
  }
  const clean = Object.values(models).filter((m) => !m.drift.length).length;
  const rows = Object.values(models).reduce((a, m) => a + m.files, 0);
  const band = Object.values(models).reduce((a, m) => a + m.band, 0);
  if (clean) {
    lines.push(`price check: ${clean} model${clean === 1 ? '' : 's'} within ${+(PRICE_TOLERANCE * 100).toFixed(3)}% of cost-state on its own tokens (${band} of ${rows} model-files band-checked: no cache writes in the transcript to split 5m/1h, so only the 5m-1h range is tested)`);
  }
  return lines;
}

export function renderMarkdown(r, { top = 15 } = {}) {
  const { totals: t, costState } = r;
  const delta = costState.reportedUsd ? ((costState.computedUsd - costState.reportedUsd) / costState.reportedUsd) * 100 : null;
  const out = [];
  out.push('## Totals');
  out.push(`${t.requests} requests · **${usd(t.usd)}** API-equivalent · prices verified ${r.pricesVerified}`);
  out.push(`tokens: input ${kt(t.tokens.input)} · output ${kt(t.tokens.output)} · cache read ${kt(t.tokens.cacheRead)} · cache write 5m ${kt(t.tokens.cacheWrite5m)} · 1h ${kt(t.tokens.cacheWrite1h)}`);
  if (costState.files) {
    out.push(`cost-state (${costState.files} transcripts): computed ${usd(costState.computedUsd)} vs Claude Code's ${usd(costState.reportedUsd)} (Δ ${delta.toFixed(1)}%) · cost-state also counts requests and subagent output the transcripts don't record, so ~10% under is normal (#116): not a price check`);
  }
  out.push(...priceCheckLines(r.priceCheck));
  for (const [m, x] of Object.entries(r.unpriced)) out.push(`⚠ unpriced model ${m}: ${x.requests} requests, ${kt(x.tokens)} tokens — add it to prices.json`);
  for (const s of r.staleStamps || []) out.push(`⚠ stale model stamp ${stampLine(s)} — re-verify the claim on the current model`);
  out.push('', '## Per day (UTC)');
  out.push(table(['day', 'sessions', 'requests', '$', 'peak depth'], r.days.map((d) => [d.day, d.sessions, d.requests, usd(d.usd), kt(d.peakDepth)])));
  out.push('', `## Sessions (top ${top} by $)`);
  out.push(table(['first day', 'title', 'requests', '$', 'subagent $', 'peak depth'],
    r.sessions.slice(0, top).map((s) => [s.first, (s.title || s.sessionId.slice(0, 8)).replace(/\|/g, '/').slice(0, 50), s.requests, usd(s.usd), usd(s.subagentUsd), kt(s.peakDepth)])));
  if (r.names?.length) {
    out.push('', '## Per session name');
    out.push(table(['name', 'windows', 'first day', 'last day', 'requests', '$', 'subagent $'],
      r.names.slice(0, top).map((g) => [g.name.replace(/\|/g, '/'), g.windows, g.first, g.last, g.requests, usd(g.usd), usd(g.subagentUsd)])));
  }
  out.push('', '## Per agent type');
  out.push(table(['type', 'runs', 'requests', '$', '$/run', 'models'],
    Object.entries(r.agents).sort((a, b) => b[1].usd - a[1].usd)
      .map(([k, a]) => [k, a.runs, a.requests, usd(a.usd), usd(a.usd / a.runs), byCount(a.models).map(([m, c]) => `${m}×${c}`).join(', ')])));
  out.push('', '## Per agent type × model × effort', '(a run is filed whole under the setting most of its requests used; mixed: runs that also used another)');
  out.push(table(['type', 'model', 'effort', 'runs', 'mixed', 'requests', '$', '$/run'],
    (r.agentMix || []).map((m) => [m.type, m.model, m.effort ?? 'not recorded', m.runs, m.mixedRuns, m.requests, usd(m.usd), usd(m.usd / m.runs)])));
  out.push('', '## Invocations');
  out.push('**Skill tool calls**', table(['skill', 'calls'], byCount(r.skills)));
  out.push('', '**SKILL.md reads**', table(['skill', 'reads'], byCount(r.skillReads)));
  out.push('', '**Slash commands**', table(['command', 'uses'], byCount(r.slash)));
  if (r.unusedSkills.length) out.push('', `**Installed skills with 0 invocations:** ${r.unusedSkills.join(', ')}`);
  out.push('', '**Doc reads**', table(['path', 'reads'], byCount(r.docs).slice(0, top)));
  out.push('', '## Hooks');
  out.push('**Blocks**', table(['hook', 'blocks', 'top reasons'],
    Object.entries(r.hooks.blocks).sort((a, b) => b[1].count - a[1].count)
      .map(([h, b]) => [h, b.count, byCount(b.reasons).slice(0, 3).map(([m, c]) => `${c}× ${m.replace(/\|/g, '/')}`).join('<br>')])));
  out.push('', '**Stop-hook runtime**', table(['hook', 'fires', 'p50 ms', 'p95 ms'], Object.entries(r.hooks.timed).map(([h, x]) => [h, x.fires, x.p50, x.p95])));
  out.push('', '**Other hook fires**', table(['hook event', 'fires'], byCount(r.hooks.fires)));
  if (r.time) out.push('', renderTime(r.time, top));
  if (r.inline) {
    out.push('', `## Inline edits vs dispatches (top ${top} main sessions by edits)`);
    out.push(table(['title', 'edits', 'files', 'dispatches', 'most files between dispatches'],
      r.inline.slice(0, top).map((s) => [cell(s.title || s.sessionId.slice(0, 8)).slice(0, 50), s.edits, s.editFiles, s.dispatches, s.longestRun])));
  }
  return out.join('\n');
}

const dur = (ms) => (ms == null ? '' : ms < 60e3 ? `${(ms / 1e3).toFixed(1)}s` : ms < 36e5 ? `${(ms / 60e3).toFixed(1)}m` : `${(ms / 36e5).toFixed(1)}h`);
const share = (ms, of) => (of ? `${Math.round((ms / of) * 100)}%` : '–');
const splitCells = (x) => [dur(x.wallMs), dur(x.activeMs), share(x.modelMs, x.activeMs), share(x.toolsMs, x.activeMs), share(x.userMs, x.activeMs), share(x.otherMs, x.activeMs)];
const SPLIT_HEAD = ['wall', 'active', 'model', 'tools', 'user', 'other'];
const cell = (s) => String(s).replace(/\|/g, '/');

function renderTime(t, top) {
  const x = t.totals, out = ['## Time'];
  out.push(`wall ${dur(x.wallMs)} · **active ${dur(x.activeMs)}** (idle gaps over ${t.idleGapMin} min removed) · of active: model ${share(x.modelMs, x.activeMs)} · tools ${share(x.toolsMs, x.activeMs)} · user ${share(x.userMs, x.activeMs)} · other ${share(x.otherMs, x.activeMs)}`);
  out.push('', '**Per day** (UTC; parallel sessions add)', table(['day', ...SPLIT_HEAD, '$'], t.days.map((d) => [d.day, ...splitCells(d), usd(d.usd)])));
  if (t.names.length) out.push('', '**Per session name**', table(['name', 'windows', ...SPLIT_HEAD, '$'], t.names.slice(0, top).map((g) => [cell(g.name), g.windows, ...splitCells(g), usd(g.usd)])));
  out.push('', `**Sessions** (top ${top} by active)`, table(['first day', 'title', ...SPLIT_HEAD, '$'],
    t.sessions.slice(0, top).map((s) => [s.first, cell(s.title || s.sessionId.slice(0, 8)).slice(0, 50), ...splitCells(s), usd(s.usd)])));
  out.push('', '**Agent time**', table(['type', 'runs', 'wall', 'p50 run', 'p95 run', '$'],
    Object.entries(t.agents).sort((a, b) => b[1].wallMs - a[1].wallMs).map(([k, a]) => [k, a.runs, dur(a.wallMs), dur(a.p50), dur(a.p95), usd(a.usd)])));
  out.push('', `**Slowest agent runs** (top ${top})`, table(['type', 'session', 'day', 'wall', '$'],
    t.agentRuns.slice(0, top).map((a) => [a.type, a.sessionId.slice(0, 8), a.first, dur(a.wallMs), usd(a.usd)])));
  const lat = (o) => Object.entries(o).sort((a, b) => b[1].p95 - a[1].p95).slice(0, top).map(([k, l]) => [cell(k), l.calls, dur(l.p50), dur(l.p95), dur(l.totalMs)]);
  out.push('', `**Tool latency** (top ${top} by p95)`, table(['tool', 'calls', 'p50', 'p95', 'total'], lat(t.tools)));
  out.push('', `**Slowest commands** (top ${top} by p95)`, table(['command', 'calls', 'p50', 'p95', 'total'], lat(t.commands)));
  const rows = [];
  for (const [kind, o] of [['block', t.retry.blocks], ['error', t.retry.errors]]) {
    for (const [k, r] of Object.entries(o)) for (const [why, w] of Object.entries(r.reasons)) rows.push([`${kind} ${cell(k)}`, cell(why), w.count, w.ms]);
  }
  out.push('', '**Retry and block cost** (each failure charged the time to the next call of its tool, when one later succeeds)',
    table(['source', 'reason', 'count', 'cost'], rows.sort((a, b) => b[3] - a[3]).slice(0, top).map(([s, why, n, ms]) => [s, why, n, dur(ms)])));
  const sum = (k) => [...Object.values(t.retry.blocks), ...Object.values(t.retry.errors)].reduce((a, r) => a + r[k], 0);
  out.push(`total: ${dur(sum('ms'))} over ${sum('retried')} retried failures · ${sum('unresolved')} never retried to success`);
  return out.join('\n');
}
