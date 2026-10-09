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
// Sidecars next to the state file: `<state>.lock` is an exclusive claim held for the
// read-check-write (a parallel hook that finds it fresh stays silent; a lock older than
// 10 s or dated in the future is broken), and writeState's `<state>.<pid>.tmp` is the
// temp file it renames into place. Both are removed after use.
// Fail-open: advisory, never blocks.

import { closeSync, fstatSync, openSync, readSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { claudeDir, readState, run, writeState } from './_hooklib.mjs';

export const THRESHOLD = 6;
const EDITS = new Set(['Edit', 'Write', 'NotebookEdit']);
const DISPATCHES = new Set(['Agent', 'Task']);
const CHUNK = 256 * 1024;
const ERR_RE = /"is_error"\s*:\s*true/;
const LOCK_STALE_MS = 10_000;

export const MESSAGE = `${THRESHOLD} files edited inline since the last dispatch — agent-factory: dispatch multi-file work; inline is for ≤2-file docs/config.`;

const norm = (p) => p.replaceAll('\\', '/').toLowerCase();
// Scratchpad, commit-message and PR-body drafts live under the OS temp dir: not implementation.
const TMP = norm(tmpdir()).replace(/\/?$/, '/');

export const stateFile = () => process.env.CLAUDE_INLINE_NUDGE_STATE || join(claudeDir, 'inline-edit-nudge.json');

/** Walk the transcript backward to the last dispatch. → null when unreadable, else { runId, files } where
 *  files are the distinct paths edited after it (or since the start). */
export function currentRun(transcriptPath) {
  const files = new Set();
  let fd;
  try {
    fd = openSync(transcriptPath, 'r');
  } catch {
    return null; // missing or unreadable transcript: nothing to count, and no hook-errors.log entry
  }
  try {
    let pos = fstatSync(fd).size;
    let carry = []; // buffers continuing the next-read line; a line longer than a chunk is joined and decoded once
    const failed = new Set(); // tool_use ids whose tool_result is_error (results follow their use, so a backward walk sees them first)
    while (pos > 0) {
      const len = Math.min(CHUNK, pos);
      pos -= len;
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, pos);
      const nl = pos > 0 ? buf.indexOf(10) : -1; // first line may be cut by the chunk edge
      if (nl < 0 && pos > 0) {
        carry.unshift(buf); // no newline yet: keep growing the partial line, undecoded
        continue;
      }
      const lines = Buffer.concat([buf.subarray(nl + 1), ...carry]).toString('utf8').split('\n');
      carry = nl >= 0 ? [buf.subarray(0, nl)] : [];
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i];
        if (!l) continue;
        const isUse = l.includes('"tool_use"');
        const isErr = !isUse && ERR_RE.test(l);
        if (!isUse && !isErr) continue;
        let o;
        try {
          o = JSON.parse(l);
        } catch {
          continue;
        }
        if (!Array.isArray(o.message?.content)) continue;
        if (isErr) {
          for (const b of o.message.content) if (b?.type === 'tool_result' && b.is_error === true && b.tool_use_id) failed.add(b.tool_use_id);
          continue;
        }
        const uses = o.message.content.filter((b) => b?.type === 'tool_use');
        for (let j = uses.length - 1; j >= 0; j--) {
          const b = uses[j];
          if (DISPATCHES.has(b.name)) return { runId: b.id || 'dispatch', files };
          if (EDITS.has(b.name) && !failed.has(b.id)) {
            const f = b.input?.file_path || b.input?.notebook_path;
            if (f) files.add(norm(f));
          }
        }
      }
    }
  } finally {
    closeSync(fd);
  }
  return { runId: 'start', files };
}

/** Record (sid, runId) as fired. False when already fired, or when a parallel hook holds a
 *  fresh claim lock right now (it is firing this very run). The lock is global across
 *  sessions, so another session holding it delays this one's nudge by an edit. Fail-open:
 *  a lock that cannot be created, a stale or future-dated one, or one that cannot be
 *  removed never silences the nudge — it proceeds without the lock. */
function claimRun(file, sid, runId) {
  const lock = `${file}.lock`;
  let held = false;
  for (let attempt = 0; attempt < 2 && !held; attempt++) {
    try {
      writeFileSync(lock, String(process.pid), { flag: 'wx' });
      held = true;
    } catch (err) {
      if (err?.code !== 'EEXIST') break;
      try {
        const age = Date.now() - statSync(lock).mtimeMs;
        if (age > -2000 && age < LOCK_STALE_MS) return false;
        unlinkSync(lock); // stale or future-dated: a crashed hook
      } catch {
        break; // cannot inspect or remove it: proceed without the lock
      }
    }
  }
  try {
    const state = readState(file); // re-read under the lock
    if (state[sid] === runId) return false;
    delete state[sid]; // re-insert last so the newest 200 survive the trim
    state[sid] = runId;
    const keys = Object.keys(state);
    for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete state[k];
    writeState(file, state);
    return true;
  } finally {
    if (held) {
      try {
        unlinkSync(lock);
      } catch {
        // already gone
      }
    }
  }
}

/** → the reminder JSON to print, or null. Records the run as fired. */
export function nudge(payload, file = stateFile()) {
  const sid = payload?.session_id;
  const path = payload?.transcript_path;
  if (payload?.agent_id || typeof sid !== 'string' || !sid || typeof path !== 'string' || !path) return null;
  const cur = currentRun(path);
  if (!cur) return null;
  const { runId, files } = cur;
  const own = payload.tool_input?.file_path || payload.tool_input?.notebook_path;
  if (own) files.add(norm(own)); // the transcript may not hold the in-flight call yet
  if ([...files].filter((f) => !f.startsWith(TMP)).length < THRESHOLD) return null;
  if (!claimRun(file, sid, runId)) return null;
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: MESSAGE } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run('inline-edit-nudge', (payload) => {
    const out = nudge(payload);
    if (out) process.stdout.write(JSON.stringify(out));
  });
}
