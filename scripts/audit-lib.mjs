// audit-lib.mjs — transcript-replay audit (#62): pure accounting over Claude Code
// transcripts (~/.claude/projects/**/*.jsonl). The CLI is audit.mjs.
//
// Transcript facts this file relies on (verified 2026-10-08, CC 2.1.295):
// - One API response is written as several assistant records sharing a requestId
//   (one per content block, plus streaming partials whose output_tokens grow).
//   Summing every record overcounts ~2.2x: keep one per requestId, max output.
// - Subagents live in <session>/subagents/agent-<id>.jsonl next to a
//   .meta.json carrying agentType; their records never appear in the parent file.
// - Resumed/forked sessions replay earlier records into a new file: non-request
//   records dedupe on uuid, tool calls on tool_use id.
// - A user-set name (/rename) is a {type:'custom-title'} record; the last wins.
//   ai-title and agent-name records carry auto names, not unit names (#73).
//   A launch name (claude --bg -n <name>) writes the same record (2.1.280).
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

import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';

const MTOK = 1e6;

function priceFor(model, prices) {
  const m = prices.models || {};
  if (m[model]) return m[model];
  // dated snapshots (claude-haiku-4-5-20251001) price as their base id
  const base = Object.keys(m).find((id) => model.startsWith(`${id}-`) && /^\d{8}$/.test(model.slice(id.length + 1)));
  return base ? m[base] : null;
}

/** Price one request's usage. usd is null when the model has no price — an
 *  unknown model is reported as unpriced, never folded in as $0. */
export function priceUsage(u, model, prices) {
  const p = priceFor(model, prices);
  if (!p) return { usd: null };
  const cc = u.cache_creation || {};
  const w1h = cc.ephemeral_1h_input_tokens || 0;
  // no tier split on the record: the whole write is 5m (the API default TTL)
  const w5m = u.cache_creation ? cc.ephemeral_5m_input_tokens || 0 : u.cache_creation_input_tokens || 0;
  const web = u.server_tool_use?.web_search_requests || 0;
  const usd =
    ((u.input_tokens || 0) * p.input +
      (u.output_tokens || 0) * p.output +
      (u.cache_read_input_tokens || 0) * p.cacheRead +
      w5m * p.cacheWrite5m +
      w1h * p.cacheWrite1h) / MTOK +
    (web * (prices.webSearchPer1k || 0)) / 1000;
  return { usd };
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
 *  { sessionId, agent: null | { id, type, model } } — from walkTranscripts. */
export function createCollector({ prices, since, until, installedSkills = [], docPrefixes = [], idleGapMin = IDLE_GAP_MIN }) {
  const requests = new Map(); // requestId -> { u, model, day, ctx }
  const lines = new Map(); // session or session/agent -> timeline (#97)
  const timedUuid = new Set();
  const seenUuid = new Set();
  const seenTool = new Set();
  const titles = new Map(); // sessionId -> { custom, ai }
  const costState = new Map(); // sessionId -> max totalCostUSD
  const skills = {}, skillReads = {}, slash = {}, docs = {};
  const hookBlocks = {}, hookTimes = {}, hookFires = {};
  const inWindow = (ts) => {
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
      const named = new Set([...String(b.input?.command || '').matchAll(/[\\/]?skills[\\/]+([\w.-]+)[\\/]+SKILL\.md/gi)].map((m) => m[1]));
      for (const s of named) bump(skillReads, s);
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

  /** Collects one record's timestamp, request span, tool call or prompt into its
   *  context's timeline. Replayed records (a resumed session's file) count once. */
  function timeRecord(rec, ctx) {
    const t = Date.parse(rec.timestamp || '');
    if (!t) return;
    if (rec.uuid) {
      if (timedUuid.has(rec.uuid)) return;
      timedUuid.add(rec.uuid);
    }
    const key = ctx.agent ? `${ctx.sessionId}/${ctx.agent.id}` : ctx.sessionId;
    let tl = lines.get(key);
    if (!tl) lines.set(key, (tl = { sessionId: ctx.sessionId, agent: ctx.agent, ts: [], reqs: new Map(), uses: [], byId: new Map(), prompts: [], lastInput: null, lastEnd: null }));
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
        const u = { name: b.name, t, end: null, err: false, text: '', cmd: SHELLS.has(b.name) ? commandHead(b.input?.command) : null,
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
    const sid = ctx.sessionId;
    if (rec.type === 'custom-title' || rec.type === 'ai-title') {
      const t = titles.get(sid) || {};
      if (rec.type === 'custom-title') t.custom = rec.customTitle; else t.ai = rec.aiTitle;
      titles.set(sid, t);
      return;
    }
    if (rec.type === 'cost-state') {
      costState.set(sid, Math.max(costState.get(sid) || 0, rec.totalCostUSD || 0));
      return;
    }
    if (!inWindow(rec.timestamp)) return;
    timeRecord(rec, ctx);

    if (rec.type === 'assistant') {
      const u = rec.message?.usage;
      const model = rec.message?.model;
      for (const b of rec.message?.content || []) toolUse(b);
      if (!u || !model || model === '<synthetic>') return;
      const key = rec.requestId || rec.message?.id || rec.uuid;
      const prev = requests.get(key);
      if (!prev || (u.output_tokens || 0) > (prev.u.output_tokens || 0)) {
        requests.set(key, { u, model, day: (rec.timestamp || '').slice(0, 10), ctx });
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
    const totals = { requests: 0, usd: 0, tokens: zero() };
    const days = new Map(), sessions = new Map(), agents = {}, agentRuns = {}, unpriced = {}, runUsd = new Map();
    for (const { u, model, day, ctx } of requests.values()) {
      const { usd } = priceUsage(u, model, prices);
      const cc = u.cache_creation;
      const tk = {
        input: u.input_tokens || 0,
        output: u.output_tokens || 0,
        cacheRead: u.cache_read_input_tokens || 0,
        cacheWrite5m: cc ? cc.ephemeral_5m_input_tokens || 0 : u.cache_creation_input_tokens || 0,
        cacheWrite1h: cc?.ephemeral_1h_input_tokens || 0,
      };
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
      d.sessions.add(ctx.sessionId);
      d.requests++;
      d.usd += cost;
      const s = sessions.get(ctx.sessionId) || { sessionId: ctx.sessionId, requests: 0, usd: 0, subagentUsd: 0, peakDepth: 0, first: day, last: day };
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
      } else {
        const depth = depthOf(u);
        s.peakDepth = Math.max(s.peakDepth, depth);
        d.peakDepth = Math.max(d.peakDepth, depth);
      }
      days.set(day, d);
      sessions.set(ctx.sessionId, s);
    }
    for (const [type, ids] of Object.entries(agentRuns)) agents[type].runs = ids.size;

    let checked = 0, reportedUsd = 0, computedUsd = 0;
    for (const [sid, reported] of costState) {
      const s = sessions.get(sid);
      if (!s || !reported) continue;
      checked++;
      reportedUsd += reported;
      computedUsd += s.usd;
    }

    const timed = {};
    for (const [h, ms] of Object.entries(hookTimes)) timed[h] = { fires: ms.length, p50: pct(ms, 50), p95: pct(ms, 95) };
    const names = new Map(); // custom-title -> one row over all its windows
    for (const s of sessions.values()) {
      const name = titles.get(s.sessionId)?.custom;
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
      crossCheck: { sessions: checked, reportedUsd, computedUsd },
      days: [...days.values()].map((d) => ({ ...d, sessions: d.sessions.size })).sort((a, b) => a.day.localeCompare(b.day)),
      sessions: [...sessions.values()]
        .map((s) => ({ ...s, title: titles.get(s.sessionId)?.custom || titles.get(s.sessionId)?.ai || '' }))
        .sort((a, b) => b.usd - a.usd),
      names: [...names.values()].sort((a, b) => b.usd - a.usd),
      agents,
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

  /** #99's measure: per main session, Edit/Write calls against Agent dispatches,
   *  and the most distinct files edited between two dispatches. */
  function inlineReport() {
    const rows = [];
    for (const tl of lines.values()) {
      if (tl.agent) continue;
      const files = new Set();
      let edits = 0, dispatches = 0, run = new Set(), longestRun = 0;
      for (const u of [...tl.uses].sort((a, b) => a.t - b.t)) {
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
      if (edits || dispatches) rows.push({ sessionId: tl.sessionId, title: titles.get(tl.sessionId)?.custom || titles.get(tl.sessionId)?.ai || '', edits, editFiles: files.size, dispatches, longestRun });
    }
    return rows.sort((a, b) => b.edits - a.edits);
  }

  /** Wall vs active time, the model/tools/user/other split per session, name and
   *  day, agent-run wall time, tool latency and retry cost (#97). $ is joined in
   *  from the cost rows so time and spend sit side by side. */
  function timeReport(cost) {
    const idleGapMs = idleGapMin * 60e3;
    const subs = new Map(); // sessionId -> its subagent timelines
    for (const tl of lines.values()) if (tl.agent) (subs.get(tl.sessionId) || subs.set(tl.sessionId, []).get(tl.sessionId)).push(tl);
    const idleOf = new Map(), sessions = [], dayRows = new Map();
    const totals = { wallMs: 0, activeMs: 0, ...zeroSplit() };

    for (const tl of lines.values()) {
      if (tl.agent || !tl.ts.length) continue;
      // subagent records count as activity: a parent waiting on a running agent isn't idle
      const ts = [...tl.ts, ...(subs.get(tl.sessionId) || []).flatMap((s) => s.ts)].sort((a, b) => a - b);
      const first = ts[0], last = ts.at(-1);
      const idle = [];
      for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > idleGapMs) idle.push([ts[i - 1], ts[i]]);
      idleOf.set(tl.sessionId, idle);
      const iv = idle.map(([a, b]) => [a, b, 'idle']);
      for (const q of tl.reqs.values()) iv.push([q.start, q.end, 'model']);
      for (const u of tl.uses) if (u.end !== null) iv.push([u.t, u.end, USER_TOOLS.has(u.name) ? 'ask' : 'tools']);
      for (const p of tl.prompts) if (p.human && p.from !== null) iv.push([p.from, p.t, 'wait']);
      const row = { sessionId: tl.sessionId, title: titles.get(tl.sessionId)?.custom || titles.get(tl.sessionId)?.ai || '',
        first: new Date(first).toISOString().slice(0, 10), wallMs: last - first, activeMs: 0, ...zeroSplit(), usd: cost.sessions.get(tl.sessionId)?.usd || 0 };
      for (const [day, split] of sweep(iv, first, last)) {
        const d = dayRows.get(day) || { day, wallMs: 0, activeMs: 0, ...zeroSplit(), usd: cost.days.get(day)?.usd || 0 };
        for (const k of SPLIT) { row[k] += split[k]; d[k] += split[k]; }
        d.wallMs += SPLIT.reduce((a, k) => a + split[k], 0);
        d.activeMs = d.wallMs - d.idleMs;
        dayRows.set(day, d);
      }
      row.activeMs = row.wallMs - row.idleMs;
      sessions.push(row);
      for (const k of Object.keys(totals)) totals[k] += row[k];
    }

    const names = new Map();
    for (const s of sessions) {
      const name = titles.get(s.sessionId)?.custom;
      if (!name) continue;
      const g = names.get(name) || { name, windows: 0, wallMs: 0, activeMs: 0, ...zeroSplit(), usd: 0 };
      g.windows++;
      for (const k of ['wallMs', 'activeMs', ...SPLIT, 'usd']) g[k] += s[k];
      names.set(name, g);
    }

    const agentRuns = [], agentTypes = {};
    for (const tl of lines.values()) {
      if (!tl.agent || !tl.ts.length) continue;
      const first = tl.ts.reduce((a, b) => Math.min(a, b)), wallMs = tl.ts.reduce((a, b) => Math.max(a, b)) - first;
      agentRuns.push({ id: tl.agent.id, sessionId: tl.sessionId, type: tl.agent.type, first: new Date(first).toISOString().slice(0, 10), wallMs, usd: cost.runUsd.get(tl.agent.id) || 0 });
      (agentTypes[tl.agent.type] ||= []).push(wallMs);
    }
    const agentsOut = {};
    for (const [type, ms] of Object.entries(agentTypes)) {
      agentsOut[type] = { runs: ms.length, wallMs: ms.reduce((a, b) => a + b, 0), p50: pct(ms, 50), p95: pct(ms, 95), usd: cost.agents[type]?.usd || 0 };
    }

    const toolMs = {}, cmdMs = {}, blocks = {}, errors = {};
    for (const tl of lines.values()) {
      const idle = idleOf.get(tl.sessionId) || [];
      const byName = new Map();
      for (const u of tl.uses) {
        (byName.get(u.name) || byName.set(u.name, []).get(u.name)).push(u);
        if (u.end === null || USER_TOOLS.has(u.name)) continue;
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
          if (u.end === null || !u.err) return;
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

    return {
      idleGapMin,
      totals,
      days: [...dayRows.values()].sort((a, b) => a.day.localeCompare(b.day)),
      sessions: sessions.sort((a, b) => b.activeMs - a.activeMs),
      names: [...names.values()].sort((a, b) => b.activeMs - a.activeMs),
      agents: agentsOut,
      agentRuns: agentRuns.sort((a, b) => b.wallMs - a.wallMs),
      tools: summarize(toolMs),
      commands: summarize(cmdMs),
      retry: { blocks, errors },
    };
  }

  return { add, report };
}

/** Yields { file, ctx } for every main-session and subagent transcript under root. */
export async function* walkTranscripts(root) {
  for (const proj of await readdir(root, { withFileTypes: true })) {
    if (!proj.isDirectory()) continue;
    const pdir = join(root, proj.name);
    for (const e of await readdir(pdir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        yield { file: join(pdir, e.name), ctx: { sessionId: e.name.slice(0, -6), agent: null } };
      } else if (e.isDirectory()) {
        const sub = join(pdir, e.name, 'subagents');
        if (!existsSync(sub)) continue;
        for (const f of await readdir(sub)) {
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

/** Maps sessionId -> its last custom-title over the main transcripts under root.
 *  A pre-pass: /rename can land mid-file, after records it must still claim. */
export async function sessionNames(root) {
  const names = new Map();
  for await (const { file, ctx } of walkTranscripts(root)) {
    if (ctx.agent) continue;
    for await (const rec of readJsonl(file)) if (rec?.type === 'custom-title' && rec.customTitle) names.set(ctx.sessionId, rec.customTitle);
  }
  return names;
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

export function renderMarkdown(r, { top = 15 } = {}) {
  const t = r.totals, cc = r.crossCheck;
  const delta = cc.reportedUsd ? ((cc.computedUsd - cc.reportedUsd) / cc.reportedUsd) * 100 : null;
  const out = [];
  out.push('## Totals');
  out.push(`${t.requests} requests · **${usd(t.usd)}** API-equivalent · prices verified ${r.pricesVerified}`);
  out.push(`tokens: input ${kt(t.tokens.input)} · output ${kt(t.tokens.output)} · cache read ${kt(t.tokens.cacheRead)} · cache write 5m ${kt(t.tokens.cacheWrite5m)} · 1h ${kt(t.tokens.cacheWrite1h)}`);
  if (cc.sessions) {
    out.push(`cross-check vs Claude Code's cost-state (${cc.sessions} sessions): computed ${usd(cc.computedUsd)} vs reported ${usd(cc.reportedUsd)} (Δ ${delta.toFixed(1)}%)${Math.abs(delta) > 5 ? ' ⚠ over 5% — check prices.json' : ''}`);
  }
  for (const [m, x] of Object.entries(r.unpriced)) out.push(`⚠ unpriced model ${m}: ${x.requests} requests, ${kt(x.tokens)} tokens — add it to prices.json`);
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
