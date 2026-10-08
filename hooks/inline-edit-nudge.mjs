#!/usr/bin/env node
// inline-edit-nudge.mjs — PostToolUse(Edit|Write|NotebookEdit): one reminder when
// the MAIN session has edited N distinct files since its last Agent dispatch (or
// session start), once per run; a new dispatch starts a new run (#99).
// Baseline (2026-10-08, #99): p50 6 distinct files between dispatches, p75 10.
//
// Subagent calls are skipped: the hook input carries `agent_id` only when the
// hook fires inside a subagent (code.claude.com/docs/en/hooks.md, common input
// fields). `agent_type` is NOT used: it is also set on a `--agent` main session.
//
// Cost: fires on every edit, so the transcript is read backward in chunks and
// only until the last Agent/Task tool_use. Fired runs are remembered in
// ~/.claude/inline-edit-nudge.json (CLAUDE_INLINE_NUDGE_STATE overrides), keyed
// by session, value = the run id (the dispatch's tool_use id, or "start").
// Fail-open: advisory, never blocks.

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { claudeDir, readState, run, writeState } from './_hooklib.mjs';

export const THRESHOLD = 6;
const EDITS = new Set(['Edit', 'Write', 'NotebookEdit']);
const DISPATCHES = new Set(['Agent', 'Task']);
const CHUNK = 256 * 1024;

export const MESSAGE = `${THRESHOLD} files edited inline since the last dispatch — agent-factory: dispatch multi-file work; inline is for ≤2-file docs/config.`;

export const stateFile = () => process.env.CLAUDE_INLINE_NUDGE_STATE || join(claudeDir, 'inline-edit-nudge.json');

/** Walk the transcript backward to the last dispatch. → { runId, files } where
 *  files are the distinct paths edited after it (or since the start). */
export function currentRun(transcriptPath) {
  const files = new Set();
  const fd = openSync(transcriptPath, 'r');
  try {
    let pos = fstatSync(fd).size;
    let carry = Buffer.alloc(0);
    while (pos > 0) {
      const len = Math.min(CHUNK, pos);
      pos -= len;
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, pos);
      const joined = Buffer.concat([buf, carry]);
      const nl = pos > 0 ? joined.indexOf(10) : -1; // first line may be cut by the chunk edge
      carry = nl >= 0 ? joined.subarray(0, nl) : Buffer.alloc(0);
      const lines = joined.subarray(nl + 1).toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i];
        if (!l || !l.includes('"tool_use"')) continue;
        let o;
        try {
          o = JSON.parse(l);
        } catch {
          continue;
        }
        if (o.isSidechain || !Array.isArray(o.message?.content)) continue;
        const uses = o.message.content.filter((b) => b?.type === 'tool_use');
        for (let j = uses.length - 1; j >= 0; j--) {
          const b = uses[j];
          if (DISPATCHES.has(b.name)) return { runId: b.id || 'dispatch', files };
          if (EDITS.has(b.name)) {
            const f = b.input?.file_path || b.input?.notebook_path;
            if (f) files.add(f);
          }
        }
      }
      if (nl < 0 && pos > 0) carry = joined; // no newline yet: keep growing the partial line
    }
  } finally {
    closeSync(fd);
  }
  return { runId: 'start', files };
}

/** → the reminder JSON to print, or null. Records the run as fired. */
export function nudge(payload, file = stateFile()) {
  const sid = payload?.session_id;
  const path = payload?.transcript_path;
  if (payload?.agent_id || typeof sid !== 'string' || !sid || typeof path !== 'string' || !path) return null;
  const { runId, files } = currentRun(path);
  const own = payload.tool_input?.file_path || payload.tool_input?.notebook_path;
  if (own) files.add(own); // the transcript may not hold the in-flight call yet
  if (files.size < THRESHOLD) return null;
  const state = readState(file);
  if (state[sid] === runId) return null;
  delete state[sid]; // re-insert last so the newest 200 survive the trim
  state[sid] = runId;
  const keys = Object.keys(state);
  for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete state[k];
  writeState(file, state);
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: MESSAGE } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run('inline-edit-nudge', (payload) => {
    const out = nudge(payload);
    if (out) process.stdout.write(JSON.stringify(out));
  });
}
