#!/usr/bin/env node
// context-gauge.mjs — UserPromptSubmit hook. Watches the session's context
// size and forces a deliberate checkpoint before auto-compact can fire.
//
// Why a gauge at all: auto-compact compacts SILENTLY, which is precisely what
// the doctrine forbids — a wave boundary is a /clear with a continuation
// prompt, never a compact. Auto-compact is the failure mode, so the hard stop
// sits just under the window rather than at some round number.
//
// Bands are FRACTIONS of the live context window, never fixed token counts:
// a hardcoded 250k made every band and every message wrong the day the window
// became 1M. Fractions (of the window):
//   0.40  nudge  quiet note into context, once
//   0.70  warn   loud note naming /clear + continuation, once
//   0.94  block  exit 2 — the last gate before the window fills
//
// The window itself, first source that answers (see `contextWindow`):
//   1. CLAUDE_CTX_WINDOW env
//   2. `contextGaugeWindow` in ~/.claude/settings.json
//   3. `context_window_size` in ~/.claude/usage-history/<YYYY-MM>.jsonl —
//      the CLI's own statusline figure, written there by
//      statusline/usage-statusline.ps1 on every render (live value: 1000000)
//   4. nothing: the gauge stays silent. It never invents a window.
// Absolute overrides per band stay available (CLAUDE_CTX_NUDGE / _WARN / _BLOCK).
//
// Escape hatches, because a hard stop that can wedge a session is a bug:
//   * any prompt starting with `/` passes (slash commands must always work)
//   * `CONTEXT OK` in the prompt bypasses the block for the rest of the session
//   * every failure path is fail-open (see _hooklib.run)
//
// Bands re-arm on their own: when context drops back under the nudge line
// (a /clear or /compact landed), the session's state file is dropped.

import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  closeSync,
  statSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { block, claudeDir, run } from './_hooklib.mjs';

const stateDir = join(claudeDir, 'context-gauge');

/** Band lines as a share of the live window. 0.40/0.70/0.94 of 250k are the
 *  100k/175k/235k this hook shipped with, so the ratios are unchanged. */
export const BANDS = { nudge: 0.4, warn: 0.7, blockAt: 0.94 };

const positive = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Read at most `bytes` from the end of a file — these logs grow unbounded. */
export function readTail(path, bytes = 256 * 1024) {
  const size = statSync(path).size;
  const len = Math.min(size, bytes);
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function settingsWindow(dir) {
  try {
    return positive(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).contextGaugeWindow);
  } catch {
    return null; // absent or unreadable settings are the normal case, not an error
  }
}

/**
 * Newest `context_window_size` in the usage-history log the statusline writes
 * (`statusline/usage-statusline.ps1`, `context_window_size` field — the CLI's
 * own statusline payload figure). The session's own most recent record wins
 * when there is one; otherwise the newest record of any session, since a
 * session that has not rendered a statusline yet still shares the window.
 */
export function historyWindow(dir, sessionId, env = process.env) {
  try {
    const historyDir = env.CLAUDE_USAGE_HISTORY_DIR || join(dir, 'usage-history');
    const files = readdirSync(historyDir)
      .filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f))
      .sort();
    if (!files.length) return null;
    const lines = readTail(join(historyDir, files[files.length - 1]), 128 * 1024).split('\n');
    let newest = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      if (!l || l[0] !== '{') continue; // tail read can slice a line in half
      let o;
      try {
        o = JSON.parse(l);
      } catch {
        continue;
      }
      const n = positive(o.context_window_size);
      if (n == null) continue;
      if (sessionId && o.session_id === sessionId) return n;
      if (newest == null) newest = n;
    }
    return newest;
  } catch {
    return null;
  }
}

/** The live context window in tokens, or null when no source can say. */
export function contextWindow({ dir = claudeDir, env = process.env, sessionId } = {}) {
  return positive(env.CLAUDE_CTX_WINDOW) ?? settingsWindow(dir) ?? historyWindow(dir, sessionId, env);
}

/**
 * Context size from transcript JSONL text.
 *
 * The live context is the last MAIN-CHAIN assistant message's
 * input + cache_read + cache_creation. Sidechain (subagent) lines carry their
 * own, much smaller, usage — counting one of those reads a subagent's context
 * as the session's and under-reports, so they are skipped.
 *
 * Returns null when the transcript carries no usable usage line.
 */
export function contextTokens(text) {
  const lines = (text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!l || l[0] !== '{') continue; // tail read can slice a line in half
    let o;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    if (o.isSidechain) continue;
    const u = o?.message?.usage;
    if (!u) continue;
    const n =
      (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    if (n > 0) return n;
  }
  return null;
}

/**
 * Band lines for `window`, env-overridable per band. Returns null when no band
 * can be justified — an unknown window plus a partial set of overrides is no
 * set at all, and a gauge that guesses its own thresholds is the bug this
 * function exists to prevent.
 */
export function thresholds(window, env = process.env) {
  const w = positive(window);
  const pick = (name, frac) => positive(env[name]) ?? (w == null ? null : Math.round(w * frac));
  const t = {
    nudge: pick('CLAUDE_CTX_NUDGE', BANDS.nudge),
    warn: pick('CLAUDE_CTX_WARN', BANDS.warn),
    blockAt: pick('CLAUDE_CTX_BLOCK', BANDS.blockAt),
  };
  return t.nudge && t.warn && t.blockAt ? t : null;
}

/** Which band `tokens` falls in. */
export function classify(tokens, t) {
  if (tokens == null || !t) return 'unknown';
  if (tokens >= t.blockAt) return 'block';
  if (tokens >= t.warn) return 'warn';
  if (tokens >= t.nudge) return 'nudge';
  return 'ok';
}

const stateFile = (sid) => join(stateDir, `${String(sid).replace(/[^\w-]/g, '_')}.json`);

function readState(sid) {
  try {
    const f = stateFile(sid);
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
  } catch {
    return {};
  }
}

function writeState(sid, state) {
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(stateFile(sid), JSON.stringify(state));
  } catch {
    // advisory state only — losing it costs a duplicate nudge, nothing more
  }
}

/**
 * Should this band announce itself? Bands fire once each, and only ever
 * escalate — crossing `warn` does not re-fire `nudge`.
 */
export function shouldFire(band, state) {
  const rank = { ok: 0, nudge: 1, warn: 2, block: 3 };
  return rank[band] > (rank[state.fired] || 0);
}

const fmt = (n) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`);

export function nudgeText(tokens, t, window) {
  return [
    `[context-gauge] Session context is ~${fmt(tokens)} of the ~${fmt(window)} window (nudge line ${fmt(t.nudge)}).`,
    `Never artificially stop a task early for this — the gate is auto-compact avoidance, not cost.`,
    `Carry on, and take the next COMPACT POINT deliberately rather than drifting past it. Hard stop at ${fmt(t.blockAt)}.`,
  ].join(' ');
}

export function warnText(tokens, t, window) {
  return [
    `[context-gauge] Session context is ~${fmt(tokens)} of the ~${fmt(window)} window (warn line ${fmt(t.warn)}).`,
    `Checkpoint now: tick the checklist, record open blockers and the gate-baseline SHA, emit a paste-ready continuation prompt, then /clear.`,
    `A wave boundary is a /clear, never a compact. Blocking at ${fmt(t.blockAt)}.`,
  ].join(' ');
}

export function blockText(tokens, t, window) {
  return [
    `Context is ~${fmt(tokens)} of the ~${fmt(window)} window — over the ${fmt(t.blockAt)} hard stop, and auto-compact fires as the window fills.`,
    ``,
    `Auto-compact would silently do the thing the doctrine forbids: compact a wave boundary instead of clearing it.`,
    `Close out deliberately instead:`,
    `  1. Tick the active checklist; write open blockers, deviations, and the gate-baseline origin/main SHA to disk.`,
    `  2. Emit a paste-ready continuation prompt (never a file).`,
    `  3. /clear  — or  /compact <focus for the NEXT task>  if unrecorded conversational state remains.`,
    ``,
    `To override and keep going in this session, include CONTEXT OK in your message.`,
  ].join('\n');
}

export function main(payload) {
  const prompt = payload?.prompt || payload?.user_prompt || '';
  const sid = payload?.session_id || 'unknown';
  const path = payload?.transcript_path;

  if (!path || !existsSync(path)) return; // nothing to measure

  // No window, no bands: a gauge that guesses is worse than a quiet one.
  const window = contextWindow({ sessionId: payload?.session_id });
  const t = thresholds(window);
  if (!t) return;

  const tokens = contextTokens(readTail(path));
  const band = classify(tokens, t);

  // Context fell back under the nudge line: a /clear or /compact landed, so
  // re-arm every band (and drop any bypass) for the fresh window.
  if (band === 'ok') {
    try {
      const f = stateFile(sid);
      if (existsSync(f)) unlinkSync(f);
    } catch {
      // best effort
    }
    return;
  }
  if (band === 'unknown') return;

  const state = readState(sid);

  if (band === 'block') {
    const bypassed = state.bypass || /\bCONTEXT OK\b/.test(prompt);
    // Slash commands must always reach the CLI — /clear is the way out.
    if (!bypassed && !prompt.trimStart().startsWith('/')) {
      writeState(sid, { ...state, fired: 'block', lastTokens: tokens });
      block(blockText(tokens, t, window));
    }
    if (/\bCONTEXT OK\b/.test(prompt)) writeState(sid, { ...state, bypass: true, fired: 'block', lastTokens: tokens });
    return;
  }

  if (!shouldFire(band, state)) return;
  writeState(sid, { ...state, fired: band, lastTokens: tokens });
  process.stdout.write(`${band === 'warn' ? warnText(tokens, t, window) : nudgeText(tokens, t, window)}\n`);
}

// Only act when executed as a hook. The test suite imports this module, and an
// import that ran the body would block forever on an empty stdin.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run('context-gauge', main);
}
