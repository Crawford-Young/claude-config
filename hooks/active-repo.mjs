#!/usr/bin/env node
// active-repo.mjs — PostToolUse(Write|Edit|MultiEdit|NotebookEdit): record the git
// checkout this session is actually editing, for the statusline (#77).
// The payload's current_dir stays wherever the session launched (often ~/code,
// not a repo), so without this the row names the wrong repo — or a worktree's dir
// instead of the repo it belongs to.
//
// Writes { top, ts } to ~/.claude/active-repo/<session_id>.json. Only the toplevel
// is recorded: the statusline reads branch and worktree from .git on each render,
// so a checkout or branch switch after the last edit still shows. Never blocks.

import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { claudeDir, run } from './_hooklib.mjs';
import { gitInfo } from '../statusline/statusline.mjs';

const WEEK_MS = 7 * 24 * 3600 * 1000;

export const activeRepoDir = (env = process.env) => env.CLAUDE_ACTIVE_REPO_DIR || join(claudeDir, 'active-repo');

/** Record the checkout holding the edited file; → the toplevel, or null. */
export function record(payload, dir = activeRepoDir(), now = Date.now()) {
  const file = payload?.tool_input?.file_path || payload?.tool_input?.notebook_path;
  const sid = payload?.session_id;
  if (typeof file !== 'string' || !file || typeof sid !== 'string' || !/^[\w-]+$/.test(sid)) return null;
  const g = gitInfo(dirname(file)); // the file may be new: resolve from its directory
  if (!g) return null;
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${sid}.json`);
  let fresh = false;
  try {
    statSync(out);
  } catch {
    fresh = true;
  }
  writeFileSync(out, JSON.stringify({ top: g.top, ts: now }));
  if (fresh) prune(dir, now); // one file per session and nothing else deletes them
  return g.top;
}

function prune(dir, now) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    try {
      if (now - statSync(p).mtimeMs > WEEK_MS) rmSync(p, { force: true });
    } catch {
      /* raced with another session */
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run('active-repo', (payload) => record(payload));
