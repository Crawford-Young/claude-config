#!/usr/bin/env node
// context-gauge.mjs — UserPromptSubmit hook. Watches the session's context
// size and forces a deliberate checkpoint before auto-compact can fire.
//
// Why a gauge at all: `autoCompactWindow` (250k) compacts SILENTLY, which is
// precisely what the doctrine forbids — a wave boundary is a /clear with a
// continuation prompt, never a compact. Auto-compact is the failure mode, so
// the hard stop sits just under it rather than at some round number.
//
// Bands (all env-tunable, tokens):
//   CLAUDE_CTX_NUDGE  100_000  quiet note into context, once
//   CLAUDE_CTX_WARN   175_000  loud note naming /clear + continuation, once
//   CLAUDE_CTX_BLOCK  235_000  exit 2 — last gate before auto-compact at 250k
//
// Escape hatches, because a hard stop that can wedge a session is a bug:
//   * any prompt starting with `/` passes (slash commands must always work)
//   * `CONTEXT OK` in the prompt bypasses the block for the rest of the session
//   * every failure path is fail-open (see _hooklib.run)
//
// Bands re-arm on their own: when context drops back under the nudge line
// (a /clear or /compact landed), the session's state file is dropped.

import { existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { block, claudeDir, run } from './_hooklib.mjs';

const stateDir = join(claudeDir, 'context-gauge');

export const DEFAULTS = { nudge: 100_000, warn: 175_000, blockAt: 235_000 };

/** Thresholds, env-overridable. A non-numeric or non-positive override is ignored. */
export function thresholds(env = process.env) {
  const pick = (name, fallback) => {
    const n = Number(env[name]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    nudge: pick('CLAUDE_CTX_NUDGE', DEFAULTS.nudge),
    warn: pick('CLAUDE_CTX_WARN', DEFAULTS.warn),
    blockAt: pick('CLAUDE_CTX_BLOCK', DEFAULTS.blockAt),
  };
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

/** Which band `tokens` falls in. */
export function classify(tokens, t = thresholds()) {
  if (tokens == null) return 'unknown';
  if (tokens >= t.blockAt) return 'block';
  if (tokens >= t.warn) return 'warn';
  if (tokens >= t.nudge) return 'nudge';
  return 'ok';
}

/** Read at most `bytes` from the end of a file — transcripts grow unbounded. */
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

const fmt = (n) => `${Math.round(n / 1000)}k`;

/**
 * The auto-compact trigger this gauge exists to preempt. Read from settings so
 * the message can't claim a threshold the user has since changed.
 */
export function autoCompactWindow(dir = claudeDir) {
  try {
    const n = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).autoCompactWindow;
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    // fall through to the shipped default
  }
  return 250_000;
}

export function nudgeText(tokens, t) {
  return [
    `[context-gauge] Session context is ~${fmt(tokens)} tokens (nudge line ${fmt(t.nudge)}).`,
    `Finish the task in flight, then take the next COMPACT POINT deliberately rather than drifting past it.`,
    `Hard stop at ${fmt(t.blockAt)}, ahead of the ${fmt(autoCompactWindow())} auto-compact.`,
  ].join(' ');
}

export function warnText(tokens, t) {
  return [
    `[context-gauge] Session context is ~${fmt(tokens)} tokens (warn line ${fmt(t.warn)}).`,
    `Checkpoint now: tick the checklist, record open blockers and the gate-baseline SHA, emit a paste-ready continuation prompt, then /clear.`,
    `A wave boundary is a /clear, never a compact. Blocking at ${fmt(t.blockAt)}.`,
  ].join(' ');
}

export function blockText(tokens, t) {
  return [
    `Context is ~${fmt(tokens)} tokens — over the ${fmt(t.blockAt)} hard stop, and auto-compact fires at ${fmt(autoCompactWindow())}.`,
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
  const t = thresholds();
  const prompt = payload?.prompt || payload?.user_prompt || '';
  const sid = payload?.session_id || 'unknown';
  const path = payload?.transcript_path;

  if (!path || !existsSync(path)) return; // nothing to measure

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
      block(blockText(tokens, t));
    }
    if (/\bCONTEXT OK\b/.test(prompt)) writeState(sid, { ...state, bypass: true, fired: 'block', lastTokens: tokens });
    return;
  }

  if (!shouldFire(band, state)) return;
  writeState(sid, { ...state, fired: band, lastTokens: tokens });
  process.stdout.write(`${band === 'warn' ? warnText(tokens, t) : nudgeText(tokens, t)}\n`);
}

// Only act when executed as a hook. The test suite imports this module, and an
// import that ran the body would block forever on an empty stdin.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run('context-gauge', main);
}
