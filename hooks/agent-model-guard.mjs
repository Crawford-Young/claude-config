#!/usr/bin/env node
// agent-model-guard.mjs — PreToolUse guard on Agent dispatches (port of
// agent-model-guard.ps1). Wire with matcher "Agent".
//
// Three rules:
//   1. A dispatch that omits `model:` on a type whose definition carries no
//      frontmatter model would silently inherit the session default (which
//      may be fable — usage-billed). Block and ask for an explicit model.
//   2. A fork runs on the *session's* model — the Agent tool ignores a fork's
//      `model:` — so its effective model is read from ~/.claude/current-model.json
//      (written by post-model-switch.mjs), falling back to the settings.json
//      model key. Rule 1 does not apply to forks: there is no model to set.
//   3. A billed model (fable/mythos, from rule 2 or from the dispatch) requires
//      a live user clearance marker (written by fable-clearance-grant.mjs when
//      the user types FABLE OK). Single use, 30-minute window; every decision
//      lands in the dispatch log.
//
// Fails CLOSED on script errors (H21/A2): this guard is the only thing between
// an unclearanced dispatch and a usage-billed run, and a guard that crashed has
// checked nothing. A silent allow there is invisible; a block is not.

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { appendTrimmed, block, claudeDir, run } from './_hooklib.mjs';

const markerFile = join(claudeDir, 'fable-clearance.json');
const dispatchLog = join(claudeDir, 'fable-dispatch.log');
const modelFile = join(claudeDir, 'current-model.json');
const settingsFile = join(claudeDir, 'settings.json');
const CLEARANCE_MS = 30 * 60 * 1000;

// H55: fable and mythos are the usage-billed families. Kept in step with
// pre-model-switch.mjs by hand — neither hook may import the other (each runs
// on import). Naming a family before it is reachable here is free; the cost of
// adding it late is one unclearanced billed run on the day it ships.
const BILLED_MODEL = /fable|mythos/;

function typeHasFrontmatterModel(type) {
  if (!type || type.includes(':')) return false; // plugin-namespaced or unknown
  for (const dir of [join(claudeDir, 'agents'), join(process.env.CLAUDE_WORKSPACE_ROOT || join(homedir(), 'code'), 'claude-config', 'agents')]) {
    const p = join(dir, `${type}.md`);
    if (!existsSync(p)) continue;
    const head = readFileSync(p, 'utf8').slice(0, 1000);
    if (/^model:\s*\S+/m.test(head)) return true;
  }
  return false;
}

function logLine(verdict, type, model) {
  try {
    appendTrimmed(dispatchLog, `${new Date().toISOString()} ${verdict} type=${type || '?'} model=${model || '(omitted)'}`);
  } catch {
    // audit trail is best-effort — logging never throws into the guard
  }
}

/**
 * The model this session is running on right now, or null when nothing can
 * name it. post-model-switch.mjs is the source of truth: it fires on every
 * model change including the ones Claude Code makes itself (session resume),
 * so its record is never expired by age — a session can sit on fable for hours
 * without another switch, and ageing the record out would hand exactly that
 * session back to the settings default. Only cross-session staleness is real,
 * and session_id keying handles it.
 */
function liveModel(sessionId) {
  try {
    const state = JSON.parse(readFileSync(modelFile, 'utf8'));
    const record = sessionId ? state?.sessions?.[sessionId] : state?.latest;
    // No session_id on the payload means we cannot tell whose switch the
    // newest record was — take it anyway, since guessing billed is the safe
    // guess. A record with a null model stays null: unknown, not clear.
    if (record) return record.model || null;
  } catch {
    // state file absent or corrupt — fall through, same as a session with no
    // record: what it started on is the settings default
  }
  try {
    return JSON.parse(readFileSync(settingsFile, 'utf8')).model || null;
  } catch {
    return null;
  }
}

run(
  'agent-model-guard',
  (payload) => {
    const input = payload?.tool_input || {};
    const type = input.subagent_type || '';
    const isFork = type === 'fork';
    const dispatchModel = (input.model || '').toLowerCase();

    // A fork always runs on the parent session's model and its own `model:` is
    // ignored by the tool, so reading the dispatch model here would let
    // `fork model: sonnet` launder a live fable session.
    const live = isFork ? liveModel(payload?.session_id) : null;
    const model = isFork ? (live || '').toLowerCase() : dispatchModel;

    if (isFork && !live) {
      block(
        'Cannot tell which model this session is on, so a fork — which always inherits it — might be usage-billed. No record in ~/.claude/current-model.json for this session and no settings.json model key: check that post-model-switch.mjs is wired, or dispatch a typed agent with an explicit model instead of a fork.',
      );
    }

    if (!isFork && !model && !typeHasFrontmatterModel(type)) {
      block(
        `Agent dispatch for type "${type || '(default)'}" omits model: and the type has no frontmatter default — it would silently inherit the session model. Set model: explicitly (see agents/ROUTING.md).`,
      );
    }

    if (BILLED_MODEL.test(model)) {
      let ok = false;
      try {
        if (existsSync(markerFile)) {
          const marker = JSON.parse(readFileSync(markerFile, 'utf8'));
          ok = Date.now() - Date.parse(marker.granted) < CLEARANCE_MS;
          unlinkSync(markerFile); // single use, consumed either way
        }
      } catch {
        ok = false;
      }
      logLine(ok ? 'ALLOW' : 'BLOCK', type, model);
      if (!ok) {
        const what = isFork
          ? `A fork of a session running "${model}" is usage-billed (a fork inherits the session model) and needs`
          : 'Fable and mythos dispatches are usage-billed and need';
        block(
          `${what} per-run user clearance: ask the user to reply with "FABLE OK" (grants one dispatch for 30 minutes), then re-dispatch.`,
        );
      }
    }
  },
  { failClosed: true },
);
