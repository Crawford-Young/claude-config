#!/usr/bin/env node
// context-gauge.mjs — UserPromptSubmit + PostToolUse hook. Watches the
// session's context size and forces a deliberate checkpoint before it gets
// expensive and low-quality.
//
// Why a gauge at all: cost and quality. The user works at a ~200k max per
// session, and $/request rises from $0.083 (100-200k) to $0.105-0.144 above
// 200k. A wave boundary is a /clear with a continuation prompt, not a drift.
//
// Bands are ABSOLUTE tokens, independent of the window size:
//   150k  nudge  quiet note into context, once: stop at the next green commit
//   200k  warn   loud note: checkpoint, then run the continuation skill, once
//   250k  block  exit 2 on UserPromptSubmit — the last gate
// Env overrides per band: CLAUDE_CTX_NUDGE / _WARN / _BLOCK.
//
// The window is only a FLOOR: when one is known, blockAt = min(250k, 0.94 x
// window), and warn/nudge are clamped so they never exceed it. Window, first
// source that answers (see `contextWindow`):
//   1. CLAUDE_CTX_WINDOW env
//   2. `contextGaugeWindow` in ~/.claude/settings.json
//   3. `context_window_size` in ~/.claude/usage-history/<YYYY-MM>.jsonl
//      (statusline/statusline.mjs writes it). Resolving this reads a 128 KB
//      tail, so it is consulted lazily: only once tokens reach a band line.
//   4. nothing: the bands stand as they are. No window is required.
//
// Two triggers share ~/.claude/context-gauge/<sid>.json, so each band fires
// once per session across both:
//   * UserPromptSubmit — nudge/warn print to stdout; block exits 2.
//   * PostToolUse — so long autonomous turns see the gauge. Emits
//     additionalContext JSON (exit 0; a tool that already ran can't be
//     blocked). Subagent calls (payload.agent_id) are skipped.
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

/** Absolute band lines in tokens; the window only ever lowers blockAt (see `thresholds`). */
export const BANDS = { nudge: 150_000, warn: 200_000, blockAt: 250_000 };
/** Share of a known window the hard stop may not exceed. */
const WINDOW_FLOOR = 0.94;

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
 * (`statusline/statusline.mjs`, `context_window_size` field — the CLI's
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
export function contextWindow({ dir = claudeDir, env = process.env, sessionId, skipHistory = false } = {}) {
  return (
    positive(env.CLAUDE_CTX_WINDOW) ??
    settingsWindow(dir) ??
    (skipHistory ? null : historyWindow(dir, sessionId, env))
  );
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

/** Hard stop from the window floor, or null when no window is known. */
const floorBlock = (w) => (w == null ? null : Math.round(w * WINDOW_FLOOR));

/**
 * Band lines: absolute tokens, env-overridable per band. A known window is a
 * floor: blockAt = min(250k, 0.94 x window), and warn/nudge are clamped so the
 * bands stay ordered under it.
 */
export function thresholds(window, env = process.env) {
  const w = positive(window);
  const floor = floorBlock(w);
  const blockAt = positive(env.CLAUDE_CTX_BLOCK) ?? Math.min(BANDS.blockAt, floor ?? Infinity);
  return {
    nudge: positive(env.CLAUDE_CTX_NUDGE) ?? Math.min(BANDS.nudge, Math.round(0.6 * blockAt)),
    warn: positive(env.CLAUDE_CTX_WARN) ?? Math.min(BANDS.warn, Math.round(0.8 * blockAt)),
    blockAt,
  };
}

/** True when the window floor (not the 250k band or an override) set the hard stop. */
export function blockFloored(window, env = process.env) {
  const floor = floorBlock(positive(window));
  return floor != null && !positive(env.CLAUDE_CTX_BLOCK) && floor < BANDS.blockAt;
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

/** Mention the window only when the floor applied (`window` is then non-null). */
const floorNote = (window) => (window ? ` (the ${fmt(window)} window floors the bands)` : '');

export function nudgeText(tokens, t, window = null) {
  return [
    `[context-gauge] Session context is ~${fmt(tokens)} tokens (nudge line ${fmt(t.nudge)})${floorNote(window)}.`,
    `Sessions get slower and costlier as context grows. Carry on, but stop at the next green commit rather than drifting past it.`,
    `Hard stop at ${fmt(t.blockAt)}.`,
  ].join(' ');
}

export function warnText(tokens, t, window = null) {
  return [
    `[context-gauge] Session context is ~${fmt(tokens)} tokens (warn line ${fmt(t.warn)})${floorNote(window)}.`,
    `Checkpoint now: commit with the resume block (What/Verified/Next/Ruled out) and comment open blockers on the issue.`,
    `Then run the continuation skill: Read ~/code/claude-config/skills/continuation/SKILL.md and ask the clear-or-continue AskUserQuestion.`,
    `Blocking at ${fmt(t.blockAt)}.`,
  ].join(' ');
}

export function blockText(tokens, t, window = null) {
  return [
    `Context is ~${fmt(tokens)} tokens — over the ${fmt(t.blockAt)} hard stop${floorNote(window)}.`,
    ``,
    `Past ~200k a session costs more per request ($0.083 at 100-200k, $0.105-0.144 above) and its answers degrade. Close out deliberately:`,
    `  1. Commit with the resume block (What/Verified/Next/Ruled out); comment open blockers and deviations on the issue.`,
    `  2. Run the continuation skill (it asks clear-vs-continue).`,
    `  3. /clear  — or  /compact <focus for the NEXT task>  if unrecorded conversational state remains.`,
    ``,
    `To override and keep going in this session, include CONTEXT OK in your message.`,
  ].join('\n');
}

/** Emit `text` to the model: additionalContext JSON on PostToolUse, plain stdout otherwise. */
function announce(text, post) {
  process.stdout.write(
    post ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } }) : `${text}\n`,
  );
}

export function main(payload) {
  // A tool-call payload with no event name is PostToolUse too: never block a tool that already ran.
  const post = payload?.hook_event_name === 'PostToolUse' || (!payload?.hook_event_name && !!payload?.tool_name);
  if (post && payload.agent_id) return; // subagent tool calls: not the session's context
  const prompt = payload?.prompt || payload?.user_prompt || '';
  const sid = payload?.session_id || 'unknown';
  const path = payload?.transcript_path;

  if (!path || !existsSync(path)) return; // nothing to measure

  const tokens = contextTokens(readTail(path));
  if (tokens == null) return;

  // The 128 KB usage-history tail is the expensive window source, so it is read
  // only once tokens reach a band line. Assumption: a window known only from
  // history and under ~160k is not floored until 150k (CLAUDE_CTX_WINDOW and
  // settings floor at any token count).
  let window = contextWindow({ sessionId: payload?.session_id, skipHistory: true });
  let t = thresholds(window);
  let band = classify(tokens, t);
  if (band !== 'ok' && window == null) {
    window = contextWindow({ sessionId: payload?.session_id });
    t = thresholds(window);
    band = classify(tokens, t);
  }
  const floored = blockFloored(window) ? window : null; // named in messages only then

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

  const state = readState(sid);

  if (band === 'block') {
    const bypassed = state.bypass || /\bCONTEXT OK\b/.test(prompt);
    if (post) {
      // A tool that already ran can't be blocked: announce once.
      if (!state.bypass && shouldFire('block', state)) {
        writeState(sid, { ...state, fired: 'block', lastTokens: tokens });
        announce(blockText(tokens, t, floored), true);
      }
      return;
    }
    // Slash commands must always reach the CLI — /clear is the way out.
    if (!bypassed && !prompt.trimStart().startsWith('/')) {
      writeState(sid, { ...state, fired: 'block', lastTokens: tokens });
      block(blockText(tokens, t, floored));
    }
    if (/\bCONTEXT OK\b/.test(prompt)) writeState(sid, { ...state, bypass: true, fired: 'block', lastTokens: tokens });
    return;
  }

  if (!shouldFire(band, state)) return;
  writeState(sid, { ...state, fired: band, lastTokens: tokens });
  announce(band === 'warn' ? warnText(tokens, t, floored) : nudgeText(tokens, t, floored), post);
}

// Only act when executed as a hook. The test suite imports this module, and an
// import that ran the body would block forever on an empty stdin.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run('context-gauge', main);
}
