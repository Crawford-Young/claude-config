#!/usr/bin/env node
// subagent-budget.mjs — PreToolUse hook (no matcher), the hand-back budget stop inside
// subagents (#381). A director cannot see a running agent's size; runs went to 431k
// before anyone looked. The subagent's own context is read the way budget-replay.mjs
// reads a run's peak: input + cache read + cache write of its latest request.
//
//   150k  soft  once per agent, a note into its context (PreToolUse additionalContext):
//               finish the current step, write the commit-message file, hand back.
//   200k  hard  every tool call outside ALLOWED_AT_HARD is blocked (exit 2), saying so.
// Env overrides: CLAUDE_CTX_AGENT_SOFT / CLAUDE_CTX_AGENT_HARD.
//
// Subagent = the payload carries `agent_id` (hooks docs, common input fields: PreToolUse
// and PostToolUse inside a subagent carry agent_id + agent_type). Main sessions have none
// and are context-gauge's. Only SubagentStop names the subagent's transcript
// (agent_transcript_path, `<session>/subagents/agent-<agent_id>.jsonl`), so a tool event
// derives that path from transcript_path + session_id + agent_id (agent-name-guard reads
// meta.json the same way). No file there: nothing to measure, the call passes.
//
// Fails OPEN (_hooklib's default): a budget, not a safety boundary. A crashed check must
// not wedge an agent that is trying to hand back.

import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { isMain } from '../scripts/lib.mjs';
import { block, claudeDir, pruneOlderThan, readState, run, WEEK_MS, withClaim, writeState } from './_hooklib.mjs';
import { contextTokens, readTail } from './context-gauge.mjs';

/** Default lines in tokens (user's choice, 2026-11-13, from the #381 replay). */
export const LINES = { soft: 150_000, hard: 200_000 };

/** What an agent needs at the hard line to write its commit-message file and hand back:
 *  Read (Edit and an overwriting Write need the file read first), the file tools, the
 *  hand-back, and ToolSearch in case the hand-back tool is deferred. An agent with no
 *  hand-back tool ends with its final message, which needs no tool call. */
export const ALLOWED_AT_HARD = ['Read', 'Write', 'Edit', 'MultiEdit', 'SubagentHandback', 'ToolSearch'];

const PLAIN_ID = /^[\w-]+$/;
const stateDir = join(claudeDir, 'subagent-budget');

const positive = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The soft and hard lines, env-overridable. */
export function lines(env = process.env) {
  return {
    soft: positive(env.CLAUDE_CTX_AGENT_SOFT) ?? LINES.soft,
    hard: positive(env.CLAUDE_CTX_AGENT_HARD) ?? LINES.hard,
  };
}

/** The subagent's own transcript, from a main or a subagent transcript_path; null when unknowable or absent. */
export function agentTranscript({ transcript_path: tp, session_id: sid, agent_id: id } = {}) {
  if (typeof tp !== 'string' || !tp || !PLAIN_ID.test(sid ?? '') || !PLAIN_ID.test(id ?? '')) return null;
  const dir = dirname(tp);
  const sessionDir = basename(dir) === 'subagents' ? dirname(dir) : join(dir, sid);
  const p = join(sessionDir, 'subagents', `${id.startsWith('agent-') ? id : `agent-${id}`}.jsonl`);
  return existsSync(p) ? p : null;
}

const fmt = (n) => `${Math.round(n / 1000)}k`;
const allowList = `${ALLOWED_AT_HARD.slice(0, -1).join(', ')} and ${ALLOWED_AT_HARD.at(-1)}`;

function softText(tokens, l) {
  return [
    `[subagent-budget] Your context is ~${fmt(tokens)} tokens (soft line ${fmt(l.soft)}).`,
    `Finish the current step, write your commit-message file (What / Verified / Next / Ruled out, with what is left under Next:), then hand back with what is left.`,
    `At ${fmt(l.hard)} every tool but ${allowList} is blocked.`,
  ].join(' ');
}

function hardText(tokens, l, tool) {
  return [
    `[subagent-budget] Your context is ~${fmt(tokens)} tokens, over the ${fmt(l.hard)} hard line: ${tool} is blocked.`,
    `Only ${allowList} still run.`,
    `Write your commit-message file now (What / Verified / Next / Ruled out, with what is left under Next:), then hand back with what is left: through SubagentHandback, or as your final message if you have no hand-back tool.`,
  ].join(' ');
}

/** Record the soft note as given → true when this call is the one to give it (once per agent, under withClaim). */
function claimSoft(sid, id, tokens) {
  const file = join(stateDir, `${sid}__${id}.json`);
  const claimed = withClaim(file, () => {
    if (readState(file).soft) return false;
    writeState(file, { soft: true, tokens });
    try {
      pruneOlderThan(stateDir, WEEK_MS, Date.now());
    } catch {
      // best-effort, like context-gauge's sweep
    }
    return true;
  });
  return claimed === true;
}

export function main(payload) {
  if (!payload?.agent_id) return; // main session: context-gauge's
  const path = agentTranscript(payload);
  if (!path) return;
  const tokens = contextTokens(readTail(path), { sidechain: true });
  const l = lines();
  if (tokens == null || tokens < l.soft) return;
  const tool = payload.tool_name || 'this tool';
  if (tokens >= l.hard) {
    if (!ALLOWED_AT_HARD.includes(tool)) block(hardText(tokens, l, tool));
    return;
  }
  if (!claimSoft(payload.session_id, payload.agent_id, tokens)) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: softText(tokens, l) } }));
}

// An imported module must not read stdin (the test suite imports this one).
if (isMain(import.meta.url)) {
  run('subagent-budget', main);
}
