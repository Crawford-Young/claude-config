#!/usr/bin/env node
// statusline.mjs — Claude Code statusLine entry point (#77; replaces
// usage-statusline.ps1, which spent ≈260 ms per render in PowerShell 5.1 — #78).
// stdin: statusline JSON. stdout: two rows. Also appends a throttled usage sample
// to the history log (hooks/context-gauge.mjs reads its context_window_size).
// Fail-open: every piece degrades on its own; never exits non-zero.
//
// Render budget is 50 ms including Node's ≈36 ms startup, so the hot path spawns
// nothing: git state is read from .git files directly, not via `git`.

import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ESC = '\x1b';
const RST = `${ESC}[0m`;
const DOT = '·';
const TICK = '▰';
const BLANK = '▱';

/** Threshold color for a usage percentage: green, yellow >=70, red >=90. */
export function usageColor(pct) {
  return pct >= 90 ? `${ESC}[31m` : pct >= 70 ? `${ESC}[33m` : `${ESC}[32m`;
}

/** 10-cell bar, 1 cell = 10%, ceiling so any nonzero usage shows one cell. */
export function fillBar(pct) {
  const cells = Math.max(0, Math.min(10, Math.ceil(pct / 10)));
  return `${usageColor(pct)}${TICK.repeat(cells)}${RST}${ESC}[90m${BLANK.repeat(10 - cells)}${RST}`;
}

/** Compact token count: 101889 -> 102k, 1000000 -> 1M, 1500000 -> 1.5M. */
export function formatTokens(n) {
  if (n >= 1e6) {
    const m = n / 1e6;
    return Number.isInteger(m) ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pad2 = (n) => String(n).padStart(2, '0');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Git identity of the checkout containing dir, from .git files alone (a `git`
 * spawn costs 30–50 ms on Windows — most of the render budget).
 * → { top, branch, worktree, owner } | null. branch is the short SHA when
 * detached; worktree/owner are set only in a linked worktree.
 */
export function gitInfo(dir) {
  for (let d = resolve(dir); ; d = dirname(d)) {
    const dotgit = join(d, '.git');
    let st = null;
    try {
      st = statSync(dotgit);
    } catch {
      /* not here */
    }
    if (st) {
      let gitdir = dotgit;
      if (st.isFile()) {
        const m = /^gitdir:\s*(.+?)\s*$/m.exec(readText(dotgit) || '');
        if (!m) return null;
        gitdir = isAbsolute(m[1]) ? m[1] : resolve(d, m[1]);
      }
      const common = readText(join(gitdir, 'commondir'));
      const commondir = common ? resolve(gitdir, common.trim()) : gitdir;
      const head = (readText(join(gitdir, 'HEAD')) || '').trim();
      const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
      const branch = ref ? ref[1] : /^[0-9a-f]{7,}$/i.test(head) ? head.slice(0, 7) : '';
      const linked = resolve(gitdir) !== resolve(commondir);
      return { top: d, branch, worktree: linked ? basename(gitdir) : '', owner: linked ? dirname(commondir) : '' };
    }
    if (dirname(d) === d) return null;
  }
}

// C0, DEL and C1 (U+009B is an 8-bit CSI) let a name paint the terminal; bidi
// overrides let it reorder the row.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/**
 * Session name from the registry (~/.claude/sessions/<pid>.json) matched on
 * sessionId — the id follows /clear while the pid file stays. nameSource is
 * 'user' (/rename) or 'peer' (claude --bg -n); anything else is an auto title.
 * → { name, auto } | null.
 */
export function sessionName(sessionId, dir) {
  if (!sessionId) return null;
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return null;
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const raw = readText(join(dir, f));
    if (!raw || !raw.includes(sessionId)) continue; // never parse other sessions' files
    try {
      const j = JSON.parse(raw);
      const name = j.sessionId === sessionId && typeof j.name === 'string' ? j.name.replace(UNSAFE, '').trim() : '';
      if (name) return { name, auto: j.nameSource !== 'user' && j.nameSource !== 'peer' };
    } catch {
      /* half-written registry entry */
    }
  }
  return null;
}

/** Bold for a chosen name; dim, ~-prefixed and cut to 24 for an auto title, so
 *  an un-renamed session shows at a glance. */
function namePiece(status, env) {
  const dir = env.CLAUDE_SESSIONS_DIR || join(homedir(), '.claude', 'sessions');
  let n = sessionName(status.session_id, dir);
  if (!n && typeof status.session_name === 'string') {
    const name = status.session_name.replace(UNSAFE, '').trim();
    if (name) n = { name, auto: true }; // its source is unknown here, so it stays marked
  }
  if (!n) return null;
  if (!n.auto) return `${ESC}[1m${n.name}${RST}`;
  const cut = n.name.length > 24 ? `${n.name.slice(0, 23)}…` : n.name;
  return `${ESC}[2m~${cut}${RST}`;
}

/** Toplevel the active-repo hook last recorded for this session, or null. */
function activeTop(sessionId, env) {
  if (typeof sessionId !== 'string' || !/^[\w-]+$/.test(sessionId)) return null;
  const dir = env.CLAUDE_ACTIVE_REPO_DIR || join(homedir(), '.claude', 'active-repo');
  try {
    const top = JSON.parse(readText(join(dir, `${sessionId}.json`)) || 'null')?.top;
    return typeof top === 'string' && top ? top : null;
  } catch {
    return null;
  }
}

/**
 * repo@branch for the checkout being edited (active-repo hook), else the
 * session's directory. A linked worktree names the repo it belongs to plus a dim
 * `wt`; the label turns yellow on main/master. Bare folder name outside git.
 */
function locationPiece(status, env) {
  const top = activeTop(status.session_id, env);
  const g = (top && gitInfo(top)) || null;
  const dir = status.workspace?.current_dir || status.cwd;
  if (!g && !dir) return null;
  const info = g || gitInfo(dir);
  if (!info) {
    try {
      return statSync(dir).isDirectory() ? basename(dir) : null;
    } catch {
      return null;
    }
  }
  const name = basename(info.owner || info.top);
  const label = info.branch ? `${name}@${info.branch}` : name;
  const shown = info.branch === 'main' || info.branch === 'master' ? `${ESC}[33m${label}${RST}` : label;
  return info.worktree ? `${shown} ${ESC}[2mwt${RST}` : shown;
}

// ---- day spend -----------------------------------------------------------------
// statusline/spend.mjs prices today's transcripts into day-<date>.json; the render
// only reads that file, and spawns the worker detached when it is stale.

const SPEND_STALE_MS = 60_000;
const LOCK_STALE_MS = 120_000; // a crashed worker's lock stops blocking after this

export const localDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const spendDir = (env = process.env) => env.CLAUDE_SPEND_DIR || join(homedir(), '.claude', 'spend');
export const spendLock = (dir) => join(dir, 'refresh.lock');

function kickRefresh(dir, env, now) {
  const lock = spendLock(dir);
  try {
    if (now - statSync(lock).mtimeMs < LOCK_STALE_MS) return;
  } catch {
    /* no lock */
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(lock, String(now));
  const worker = fileURLToPath(new URL('./spend.mjs', import.meta.url));
  spawn(process.execPath, [worker], { detached: true, stdio: 'ignore', windowsHide: true, env }).unref();
}

/** `day $48` — today's spend across sessions; absent until the first refresh. */
function dayPiece(env, now = Date.now()) {
  const dir = spendDir(env);
  const cache = JSON.parse(readText(join(dir, `day-${localDay(new Date(now))}.json`)) || 'null');
  if (!env.CLAUDE_SPEND_NO_REFRESH && !(now - (cache?.ts || 0) < SPEND_STALE_MS)) kickRefresh(dir, env, now);
  const usd = num(cache?.usd);
  if (usd === null) return null;
  return `day $${usd >= 10 ? usd.toFixed(0) : usd.toFixed(2)}`;
}

function contextPiece(cw) {
  const pct = num(cw?.used_percentage);
  if (pct === null) return null;
  const p = Math.trunc(pct);
  let counts = '';
  if (cw.current_usage && num(cw.context_window_size) !== null) {
    const u = cw.current_usage;
    const used = [u.input_tokens, u.output_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens]
      .map((v) => num(v) || 0)
      .reduce((a, b) => a + b, 0);
    counts = ` ${formatTokens(used)}/${formatTokens(cw.context_window_size)}`;
  }
  return `ctx ${fillBar(p)}${counts} ${usageColor(p)}${p}%${RST}`;
}

/** prompt_cache: warm/cold, hit ratio, last miss cause. Absent → dropped. */
function cachePiece(pc) {
  if (!pc || typeof pc.warm !== 'boolean') return null;
  const color = pc.warm ? `${ESC}[32m` : `${ESC}[31m`;
  const hit = num(pc.hit_ratio) !== null ? ` ${Math.round(pc.hit_ratio * 100)}%` : '';
  const miss = pc.last_miss_cause ? ` miss:${pc.last_miss_cause}` : '';
  return `cache ${color}${pc.warm ? 'warm' : 'cold'}${hit}${RST}${miss}`;
}

function windowPieces(rl) {
  const out = [];
  for (const [key, label, fmt] of [
    ['five_hour', '5h', (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`],
    ['seven_day', '7d', (d) => DAYS[d.getDay()]],
  ]) {
    const w = rl?.[key];
    const pct = num(w?.used_percentage);
    if (pct === null) continue;
    const p = Math.trunc(pct);
    const when = num(w.resets_at) !== null ? `→${fmt(new Date(w.resets_at * 1000))}` : '';
    out.push(`${label} ${fillBar(p)} ${usageColor(p)}${p}%${RST}${when}`);
  }
  return out;
}

/** Rows for one status payload. Never empty: a blank statusline is
 *  indistinguishable from a crashed one, so it degrades to a sentinel. */
export function render(status, env = process.env) {
  const top = [];
  const bars = [];
  if (status && typeof status === 'object') {
    const piece = (fn) => {
      try {
        return fn();
      } catch {
        return null;
      }
    };
    const name = piece(() => namePiece(status, env));
    if (name) top.push(name);
    const loc = piece(() => locationPiece(status, env));
    if (loc) top.push(loc);
    if (status.model?.display_name) top.push(String(status.model.display_name));
    if (status.effort?.level) top.push(String(status.effort.level));
    if (status.fast_mode === true) top.push('fast');
    if (num(status.cost?.total_cost_usd) !== null) top.push(`$${status.cost.total_cost_usd.toFixed(2)}`);
    const day = piece(() => dayPiece(env));
    if (day) top.push(day);
    const ctx = piece(() => contextPiece(status.context_window));
    if (ctx) bars.push(ctx);
    const cache = piece(() => cachePiece(status.prompt_cache));
    if (cache) bars.push(cache);
    bars.push(...(piece(() => windowPieces(status.rate_limits)) || []));
  }
  const rows = [top, bars].filter((r) => r.length).map((r) => r.join(` ${DOT} `));
  return rows.length ? rows.join('\n') : '[statusline]';
}

// ---- history log ---------------------------------------------------------------

/** One usage sample, schema documented in statusline/README.md. */
export function historySample(s, now = new Date()) {
  const rl = s.rate_limits;
  const cw = s.context_window;
  const pc = s.prompt_cache;
  const v = (x) => (x === undefined ? null : x);
  return {
    ts: localIso(now),
    session_id: s.session_id,
    cwd: v(s.cwd),
    model_id: v(s.model?.id),
    effort: v(s.effort?.level),
    fast_mode: v(s.fast_mode),
    five_hour_pct: v(rl?.five_hour?.used_percentage),
    five_hour_resets_at: v(rl?.five_hour?.resets_at),
    seven_day_pct: v(rl?.seven_day?.used_percentage),
    seven_day_resets_at: v(rl?.seven_day?.resets_at),
    cost_usd: v(s.cost?.total_cost_usd),
    context_pct: v(cw?.used_percentage),
    context_window_size: v(cw?.context_window_size),
    cache_read_tokens: v(cw?.current_usage?.cache_read_input_tokens),
    cache_creation_tokens: v(cw?.current_usage?.cache_creation_input_tokens),
    cache_warm: v(pc?.warm),
    cache_hit_ratio: v(pc?.hit_ratio),
    cache_miss_cause: v(pc?.last_miss_cause),
    exceeds_200k: v(s.exceeds_200k_tokens),
  };
}

/** ISO-8601 with the local offset (2026-10-08T14:03:00.000-06:00). */
function localIso(d) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const local = new Date(d.getTime() + off * 60000).toISOString().slice(0, -1);
  return `${local}${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** Append a sample at most once per 60 s per session. Best-effort by design:
 *  concurrent appends can collide, and absence of a sample proves nothing. */
export function logHistory(s, env = process.env, now = new Date()) {
  if (!s?.session_id) return;
  const historyDir = env.CLAUDE_USAGE_HISTORY_DIR || join(homedir(), '.claude', 'usage-history');
  const throttleDir = env.CLAUDE_USAGE_THROTTLE_DIR || env.TEMP || tmpdir();
  const epoch = Math.floor(now.getTime() / 1000);
  const state = join(throttleDir, `claude-usage-throttle-${s.session_id}.txt`);
  const last = Number.parseInt(readText(state) || '', 10);
  if (Number.isFinite(last) && epoch - last < 60) return;
  mkdirSync(historyDir, { recursive: true });
  const month = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  appendFileSync(join(historyDir, `${month}.jsonl`), `${JSON.stringify(historySample(s, now))}\n`);
  writeFileSync(state, String(epoch));
}

function main() {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    /* no stdin */
  }
  let status = null;
  try {
    if (raw.trim()) status = JSON.parse(raw);
  } catch {
    status = null;
  }
  process.stdout.write(render(status));
  try {
    logHistory(status);
  } catch {
    /* logging never breaks the display */
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
