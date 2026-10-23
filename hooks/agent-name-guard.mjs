#!/usr/bin/env node
// agent-name-guard.mjs — PreToolUse guard on Agent spawns (#272). Wire with matcher "Agent".
//
// In tree context, every spawn carries a tree name that spells its lineage, dir → repo →
// epic → ticket → worker (lib's grammar, built by session-name.mjs tree), so audit and
// reflect join a subagent to its ticket. Tree context is the main session under a director
// title (<session>/custom-title.json, e.g. director-harness), or a subagent caller (the
// payload carries its agent_id) whose <session>/subagents/agent-<agent_id>.meta.json name
// is a tree name. Everywhere else a spawn passes untouched, named or not (Explore, Plan,
// claude-code-guide, a fork, any session outside a director's tree). In tree context:
//   1. The spawn's name must be a tree name, lowercase as built: tool_input.name, else
//      tool_input.description. The Desktop and 2026-10 CLI Agent tools have no `name`
//      parameter, so a director puts the tree name in `description`, and the subagent's
//      meta.json records it there too (no `name` field); the caller's lineage reads meta.json
//      name, else description (#318).
//   2. A subagent caller spawns only below itself: the child's name strictly extends the
//      caller's. A worker is a leaf (no tree name extends one), so its refusal names the
//      lead to report to.
//   3. The director spawns only into its own scope: under director-harness the child's dir
//      is `harness`.
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
import { parseSessionName } from '../scripts/lib.mjs';

const BUILD = 'Build it with `node ~/code/claude-config/scripts/session-name.mjs tree <dir> <repo> [--epic N] [--ticket N] [--worker impl|review|recon [--round K]]`.';
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

/** A spawn's name from an Agent tool_input or a subagent's meta.json: `name`, else `description`
 *  (#318: the Desktop and 2026-10 CLI Agent tools have no `name`, so the tree name rides in description). */
function spawnName(o) {
  const named = typeof o?.name === 'string' && o.name.trim();
  return named ? o.name : o?.description;
}

/** The caller's tree context: { parent } for a subagent with a tree name, { director } for
 *  the main session under a director title; null outside the tree. */
function treeContext(payload) {
  const dir = sessionDir(payload.transcript_path, payload.session_id);
  if (!dir) return null;
  const agentId = payload.agent_id;
  if (agentId) {
    const parent = PLAIN_ID.test(agentId) ? spawnName(readJson(join(dir, 'subagents', `agent-${agentId}.meta.json`)))?.trim() : null;
    const p = parseSessionName(parent);
    return p.tree ? { parent: parent.toLowerCase(), worker: Boolean(p.role) } : null;
  }
  const director = parseSessionName(readJson(join(dir, 'custom-title.json'))?.customTitle);
  return director.type === 'director' ? { director } : null;
}

/** Why this spawn's name is refused, or null when it passes. */
function refusal(payload) {
  const ctx = treeContext(payload);
  if (!ctx) return null;
  const name = spawnName(payload?.tool_input);
  if (ctx.worker) return `${ctx.parent} is a worker, a leaf of the tree: it spawns nothing, so report the need to your lead, ${ctx.parent.slice(0, ctx.parent.lastIndexOf('_'))}.`;
  if (typeof name !== 'string' || !name.trim()) return `Name every Agent spawn with its tree name (dir → repo → epic → ticket → worker, e.g. harness_claude-config_t264_impl). ${BUILD}`;
  if (!parseSessionName(name).tree || name !== name.trim().toLowerCase()) return `"${name}" is not a tree name: <dir>_<repo>[_e<N>][_t<N>][_<impl|review|recon>[-r<K>]], lowercase. ${BUILD}`;
  if (ctx.parent) {
    if (name.startsWith(`${ctx.parent}_`)) return null;
    return `"${name}" is not in your subtree: a spawn from ${ctx.parent} extends its name (${ctx.parent}_…). Work outside it goes back up to its lead. ${BUILD}`;
  }
  if (name.startsWith(`${ctx.director.scope}_`)) return null;
  return `"${name}" is outside this director's tree: under ${ctx.director.name} every spawn starts with ${ctx.director.scope}_. ${BUILD}`;
}

run('agent-name-guard', (payload) => {
  const reason = refusal(payload);
  if (reason) block(reason);
});
