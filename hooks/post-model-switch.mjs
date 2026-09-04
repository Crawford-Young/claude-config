#!/usr/bin/env node
// post-model-switch.mjs — PostModelSwitch recorder. Wire with no matcher.
//
// PostModelSwitch fires after the session's model changes, including changes
// Claude Code makes on its own (restoring the model when a session resumes),
// and its output is ignored. So this hook is not a gate and not a log of user
// intent: it is the *source of truth* for "what model is this session running
// on right now", which agent-model-guard.mjs reads to catch a fork on a live
// fable session (a fork ignores the dispatch model and inherits the parent's).
//
// State: ~/.claude/current-model.json
//   { updated, latest: { session_id, model, from, at },
//     sessions: { <session_id>: { model, from, at } } }
//
// Keyed by session_id because several sessions run at once here — a switch in
// one must not describe another. `model: null` records a switch whose to_model
// was absent: the guard treats unknown as "not clear to fork", so an
// unreadable switch is loud, not silently fable-clear.
//
// Fail-open: a recorder that throws must not disturb the session. A missing
// record degrades to the settings.json default in the guard, which is the
// documented fallback.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { claudeDir, run } from './_hooklib.mjs';

const stateFile = join(claudeDir, 'current-model.json');
const MAX_SESSIONS = 50;

function readState() {
  try {
    const parsed = JSON.parse(readFileSync(stateFile, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.sessions && typeof parsed.sessions === 'object') return parsed;
  } catch {
    // absent or corrupt — a fresh record is better than no record at all
  }
  return { updated: null, latest: null, sessions: {} };
}

/** Keep the newest MAX_SESSIONS entries so the file stays bounded across months
 *  of sessions. Entries without a usable `at` sort oldest. */
function prune(sessions) {
  const entries = Object.entries(sessions);
  if (entries.length <= MAX_SESSIONS) return sessions;
  entries.sort((a, b) => (Date.parse(b[1]?.at) || 0) - (Date.parse(a[1]?.at) || 0));
  return Object.fromEntries(entries.slice(0, MAX_SESSIONS));
}

run('post-model-switch', (payload) => {
  const sessionId = payload?.session_id || 'unknown-session';
  const at = new Date().toISOString();
  const record = {
    model: payload?.to_model || null,
    from: payload?.from_model || null,
    at,
  };

  const state = readState();
  state.sessions[sessionId] = record;
  state.sessions = prune(state.sessions);
  state.latest = { session_id: sessionId, ...record };
  state.updated = at;

  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
});
