#!/usr/bin/env node
// stop-reflect-gate.mjs — Stop hook. Prompts (never forces) reflect when an
// issue's PR has just merged.
//
// Trigger (issue #72, checklists retired): the session's transcript holds a
// successful `gh pr merge` Bash or PowerShell call, parsed by bash-guard's
// command parser (so `gh -R x pr merge` counts and quoted text does not);
// `--auto` only queues a merge and is skipped. PRs carry `Closes #N`, so a
// merge closes the issue. The first Stop after it blocks with the reminder and
// adds the call's tool_use id to the handled set in
// ~/.claude/stop-reflect-gate.json (newest 200), so the gate fires ONCE per
// merge, even across parallel sessions: the old checklist gate re-fired at every turn end and cost
// three workstreams ~13 declines apiece (issue row 63). "A phase closed" is the
// reflect skill's other trigger; no mechanical signal marks it, so it stays
// prose. Every failure path (no transcript, unreadable state) passes.
//
// A merge within REFLECT_COVERS_MS of a reflect SKILL.md read (or reflect
// Skill call) is marked handled without blocking. That merge is the reflect's
// own landing PR. It fired falsely on PR #94 (2026-10-08, #76): 1 of the
// gate's 4 blocks on disk.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { block, claudeDir, readState, run, writeState } from './_hooklib.mjs';
import { clauses, gatedVerbs, scrub } from './bash-guard.mjs';

const stateFile = join(claudeDir, 'stop-reflect-gate.json');
const MERGE_TOOLS = new Set(['Bash', 'PowerShell']);
const REFLECT_COVERS_MS = 60 * 60_000;
const REFLECT_SKILL = /skills[\\/]reflect[\\/]SKILL\.md$/i;

/** Does this command run a real (not `--auto`-queued) `gh pr merge`? */
export function isMerge(command) {
  return clauses(scrub(command || '')).some((c) => gatedVerbs(c, null).includes('gh pr merge') && !/(?:^|\s)--auto(?:[\s=]|$)/.test(c));
}

/** tool_use id of the newest `gh pr merge` call whose result is not an error, else null. */
export function lastMerge(text) {
  const merges = new Map();
  for (const l of text.split('\n')) {
    if (!l.includes('merge') && !l.includes('tool_result')) continue;
    let o;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    for (const c of Array.isArray(o?.message?.content) ? o.message.content : []) {
      if (c.type === 'tool_use' && MERGE_TOOLS.has(c.name) && isMerge(c.input?.command)) merges.set(c.id, false);
      if (c.type === 'tool_result' && merges.has(c.tool_use_id)) merges.set(c.tool_use_id, !c.is_error);
    }
  }
  return [...merges].filter(([, ok]) => ok).pop()?.[0] ?? null;
}

/** Epoch ms of the newest reflect SKILL.md Read or reflect Skill call, else null. */
export function lastReflectAt(text) {
  let at = null;
  for (const l of text.split('\n')) {
    if (!l.includes('reflect')) continue;
    let o;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    const hit = (Array.isArray(o?.message?.content) ? o.message.content : []).some(
      (c) =>
        c.type === 'tool_use' &&
        ((c.name === 'Read' && REFLECT_SKILL.test(c.input?.file_path || '')) || (c.name === 'Skill' && c.input?.skill === 'reflect')),
    );
    const t = Date.parse(o?.timestamp);
    if (hit && !Number.isNaN(t)) at = Math.max(at ?? 0, t);
  }
  return at;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

function main() {
  run('stop-reflect-gate', (payload) => {
    if (payload?.stop_hook_active || !payload?.transcript_path) return;
    let text;
    try {
      text = readFileSync(payload.transcript_path, 'utf8');
    } catch {
      return; // unreadable transcript — never wedge a stop
    }
    const id = lastMerge(text);
    if (!id) return;
    const { ids } = readState(stateFile);
    const handled = Array.isArray(ids) ? ids : [];
    if (handled.includes(id)) return;
    writeState(stateFile, { ids: [...handled, id].slice(-200) });
    if (Date.now() - (lastReflectAt(text) ?? 0) < REFLECT_COVERS_MS) return;

    block(
      `A PR merged this session. Before ending: prompt the user to run reflect now — Read ~/code/claude-config/skills/reflect/SKILL.md — or to explicitly skip it. This fires once per merge. If the user has already declined, say that and end the turn; do not run reflect on a wave this session did not execute.`,
    );
  });
}
