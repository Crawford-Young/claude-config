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

/** Accumulates records (add) and produces the report (report). ctx is
 *  { sessionId, agent: null | { id, type, model } } — from walkTranscripts. */
export function createCollector({ prices, since, until, installedSkills = [], docPrefixes = [] }) {
  const requests = new Map(); // requestId -> { u, model, day, ctx }
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
    const days = new Map(), sessions = new Map(), agents = {}, agentRuns = {}, unpriced = {};
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
      const s = sessions.get(ctx.sessionId) || { sessionId: ctx.sessionId, requests: 0, usd: 0, subagentUsd: 0, peakDepth: 0, first: day };
      s.requests++;
      s.usd += cost;
      if (day && (!s.first || day < s.first)) s.first = day;
      if (ctx.agent) {
        s.subagentUsd += cost;
        const a = (agents[ctx.agent.type] ||= { runs: 0, requests: 0, usd: 0, models: {} });
        a.requests++;
        a.usd += cost;
        bump(a.models, model);
        (agentRuns[ctx.agent.type] ||= new Set()).add(ctx.agent.id);
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
      agents,
      skills,
      skillReads,
      slash,
      unusedSkills: installedSkills.filter((s) => !used.has(s)).sort(),
      docs,
      hooks: { blocks: hookBlocks, timed, fires: hookFires },
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
  return out.join('\n');
}
