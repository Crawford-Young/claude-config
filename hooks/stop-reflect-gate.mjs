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
//
// Second gate (issue #122): once reflect has run for the merge (read after it,
// or the merge is reflect's own landing PR), the turn may not end until an
// AskUserQuestion offering clear-or-continue (question or option text matching
// both /clear/ and /continu/) was asked after that read and the merge. The tool call is
// matched, not a marker word: the continuation skill mandates the call. One
// block per merge, tracked under `cont` in the same state file.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { block, claudeDir, readState, run, shellSkillReads, writeState } from './_hooklib.mjs';
import { clauses, gatedVerbs, scrub } from './bash-guard.mjs';

const stateFile = join(claudeDir, 'stop-reflect-gate.json');
const MERGE_TOOLS = new Set(['Bash', 'PowerShell']);
const REFLECT_COVERS_MS = 60 * 60_000;
const REFLECT_SKILL = /skills[\\/]reflect[\\/]SKILL\.md$/i;

/** Does this command run a real (not `--auto`-queued) `gh pr merge`? */
export function isMerge(command) {
  return clauses(scrub(command || '')).some((c) => gatedVerbs(c, null).includes('gh pr merge') && !/(?:^|\s)--auto(?:[\s=]|$)/.test(c));
}

/** {id, at} of the newest `gh pr merge` call whose result is not an error, else null; `at` is epoch ms or null. */
export function newestMerge(text) {
  const merges = new Map();
  const times = new Map();
  for (const l of text.split('\n')) {
    if (!l.includes('merge') && !l.includes('tool_result')) continue;
    let o;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    for (const c of Array.isArray(o?.message?.content) ? o.message.content : []) {
      if (c.type === 'tool_use' && MERGE_TOOLS.has(c.name) && isMerge(c.input?.command)) {
        merges.set(c.id, false);
        const t = Date.parse(o?.timestamp);
        times.set(c.id, Number.isNaN(t) ? null : t);
      }
      if (c.type === 'tool_result' && merges.has(c.tool_use_id)) merges.set(c.tool_use_id, !c.is_error);
    }
  }
  const id = [...merges].filter(([, ok]) => ok).pop()?.[0];
  return id ? { id, at: times.get(id) } : null;
}

/** tool_use id of the newest successful `gh pr merge` call, else null. */
export function lastMerge(text) {
  return newestMerge(text)?.id ?? null;
}

/** Epoch ms of the newest reflect SKILL.md Read, shell read (cat / Get-Content), or reflect Skill call, else null. */
export function lastReflectAt(text) {
  let at = null;
  for (const l of text.split('\n')) {
    if (!l.toLowerCase().includes('reflect')) continue;
    let o;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    const hit = (Array.isArray(o?.message?.content) ? o.message.content : []).some(
      (c) =>
        c.type === 'tool_use' &&
        ((c.name === 'Read' && REFLECT_SKILL.test(c.input?.file_path || '')) ||
          (c.name === 'Skill' && c.input?.skill === 'reflect') ||
          (MERGE_TOOLS.has(c.name) && shellSkillReads(scrub(c.input?.command)).some((n) => n.toLowerCase() === 'reflect'))),
    );
    const t = Date.parse(o?.timestamp);
    if (hit && !Number.isNaN(t)) at = Math.max(at ?? 0, t);
  }
  return at;
}

/** Was an AskUserQuestion mentioning both clear and continue asked after `after` (epoch ms)? */
export function continuationAsked(text, after) {
  for (const l of text.split('\n')) {
    if (!l.includes('AskUserQuestion')) continue;
    let o;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    const t = Date.parse(o?.timestamp);
    if (Number.isNaN(t) || t <= after) continue;
    for (const c of Array.isArray(o?.message?.content) ? o.message.content : []) {
      if (c.type !== 'tool_use' || c.name !== 'AskUserQuestion') continue;
      for (const q of Array.isArray(c.input?.questions) ? c.input.questions : []) {
        const words = [q?.question, ...(Array.isArray(q?.options) ? q.options.flatMap((x) => [x?.label, x?.description]) : [])]
          .filter((x) => typeof x === 'string')
          .join('\n');
        if (/\bclear\b/i.test(words) && /\bcontinu/i.test(words)) return true;
      }
    }
  }
  return false;
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
    const merge = newestMerge(text);
    if (!merge) return;
    const { id } = merge;
    const state = readState(stateFile);
    const handled = Array.isArray(state.ids) ? state.ids : [];
    const reflectAt = lastReflectAt(text);
    if (!handled.includes(id)) {
      writeState(stateFile, { ...state, ids: [...handled, id].slice(-200) });
      if (Date.now() - (reflectAt ?? 0) >= REFLECT_COVERS_MS) {
        block(
          `A PR merged this session. Before ending: prompt the user to run reflect now — Read ~/code/claude-config/skills/reflect/SKILL.md — or to explicitly skip it. This fires once per merge. If the user has already declined, say that and end the turn; do not run reflect on a wave this session did not execute.`,
        );
        return;
      }
    }

    // Second gate: reflect ran for this merge, but no clear-or-continue ask followed it.
    const mergeAt = merge.at ?? Date.now();
    if (reflectAt === null || !(reflectAt > mergeAt || mergeAt - reflectAt < REFLECT_COVERS_MS)) return;
    const cur = readState(stateFile);
    const asked = Array.isArray(cur.cont) ? cur.cont : [];
    if (asked.includes(id) || continuationAsked(text, Math.max(reflectAt, mergeAt))) return;
    writeState(stateFile, { ...cur, cont: [...asked, id].slice(-200) });
    block(
      `Reflect has run for the merged PR. Before ending: run the continuation skill now — Read ~/code/claude-config/skills/continuation/SKILL.md and ask its clear-or-continue AskUserQuestion. If reflect's dialogue is still waiting on the user, finish that first and ask clear-or-continue as reflect's last step. This fires once per merge.`,
    );
  });
}
