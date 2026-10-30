#!/usr/bin/env node
// agent-name-guard.mjs — PreToolUse guard on Agent spawns (#272, #360). Wire with matcher "Agent".
//
// Under the company model every spawn is named <role>_<kind>_<target> (lib.mjs's header
// holds the grammar; session-name.mjs builds it), so audit and reflect charge its spend to
// what it worked on. The rule applies in company context, read from the caller's own name:
//   - the main session: its <session>/custom-title.json customTitle is an agent name
//     (role + charge) or a legacy director-<s> title;
//   - a subagent caller (the payload carries its agent_id): its
//     <session>/subagents/agent-<agent_id>.meta.json name, else description, is an agent
//     name, a legacy tree name, or a legacy typed name with a role.
// Under any other title (a free /rename, a tree, ticket, epic, general, bare or charge-key
// title, or none) every spawn passes untouched, named or not: Explore, Plan,
// claude-code-guide, a fork. In company context the spawn's name (tool_input.name, else
// tool_input.description: the Desktop and 2026-10 CLI Agent tools have no `name`
// parameter, #318) must be an agent name, or a tree name with a worker (in-flight
// batches), lowercase and trimmed as given; a name that would pass but for its case or
// spaces is told its fixed form. Who may spawn what is not this guard's call: any agent
// spawns any role, within the harness's depth limit.
//
// Beside agent-model-guard on the same matcher: a block here holds even when that guard
// answers allow with updatedInput. The rule as documented for the Agent SDK ("If any hook
// returns deny, the operation is blocked regardless of other hooks", code.claude.com/docs/
// en/agent-sdk/hooks.md, quoted in docs/harness-evolution/research/2026-09-04/
// sdk-headless.md:74), and seen live in the CLI: an unnamed, model-omitted spawn was blocked
// while agent-model-guard filled its model (#272).
//
// Fails OPEN (_hooklib's default): naming isn't a safety boundary, unlike
// agent-model-guard, and a crashed check must not stop every dispatch.

import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { block, run } from './_hooklib.mjs';
import { parseAgentName } from '../scripts/lib.mjs';

const RULE = 'Name every Agent spawn <role>_<kind>_<target>, lowercase: kind is repo | epic | issue | pr | topic, e.g. impl_issue_claude-config-360. Build it with `node ~/code/claude-config/scripts/session-name.mjs <role> <kind> <target…>`.';
const PLAIN_ID = /^[\w-]+$/;

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** The session's own dir (`<project>/<session_id>`), from a main or a subagent transcript path; null when unknowable. */
function sessionDir(transcriptPath, sessionId) {
  if (typeof transcriptPath !== 'string' || !transcriptPath || typeof sessionId !== 'string' || !PLAIN_ID.test(sessionId)) return null;
  const dir = dirname(transcriptPath);
  return basename(dir) === 'subagents' ? dirname(dir) : join(dir, sessionId);
}

/** A spawn's name from an Agent tool_input or a subagent's meta.json: `name`, else `description` (#318). */
function spawnName(o) {
  const named = typeof o?.name === 'string' && o.name.trim();
  return named ? o.name : o?.description;
}

/** Whether the caller works in company context. The main session: its custom title is an
 *  agent name or a legacy director title. A subagent: its own name (meta.json name, else
 *  description) is an agent name, a tree name, or a typed name with a role. */
function companyContext(payload) {
  const dir = sessionDir(payload.transcript_path, payload.session_id);
  if (!dir) return false;
  const agentId = payload.agent_id;
  if (!agentId) {
    const p = parseAgentName(readJson(join(dir, 'custom-title.json'))?.customTitle);
    return p?.form === 'agent' || (p?.form === 'typed' && p.role === 'director');
  }
  const p = PLAIN_ID.test(agentId) ? parseAgentName(spawnName(readJson(join(dir, 'subagents', `agent-${agentId}.meta.json`)))) : null;
  return p?.form === 'agent' || p?.form === 'tree' || (p?.form === 'typed' && Boolean(p.role));
}

/** Whether a parsed name passes as a spawn's: an agent name, or a tree name with a worker (in-flight batches). */
const spawnable = (p) => Boolean(p?.role) && (p.form === 'agent' || p.form === 'tree');

/** Why this spawn's name is refused, or null when it passes. */
function refusal(payload) {
  if (!companyContext(payload)) return null;
  const name = spawnName(payload?.tool_input);
  if (typeof name !== 'string' || !name.trim()) return RULE;
  if (!spawnable(parseAgentName(name))) return `"${name}" names no role and charge. ${RULE}`;
  const fixed = name.trim().toLowerCase();
  return name === fixed ? null : `"${name}" must be lowercase with no surrounding spaces: ${fixed}`;
}

run('agent-name-guard', (payload) => {
  const reason = refusal(payload);
  if (reason) block(reason);
});
