#!/usr/bin/env node
// session-start.mjs — SessionStart hook.
//
// Emits to stdout (which SessionStart adds as context):
//   - the skill index (skills/INDEX.md, on every source) — skills carry
//     disable-model-invocation, so their descriptions are not resident and the
//     model Reads the SKILL.md the index names (issue #64). SessionStart does
//     not fire for subagents (no SessionStart hook_success in any of 46 subagent
//     transcripts, 2026-10-08), so there is no agent_id guard here.
//   - open issues labelled `in-progress` across the owner (issue #72) — one
//     `gh search` call, at most 10, 3 s cap, silent on any failure (no gh, offline, auth).
//     SESSION_START_GH (a JSON argv prefix) replaces `gh` in tests.
//   - one line when hook-errors.log gained entries from THIS hooks/ directory since the
//     previous session start (#300): count + newest hook. The marker is
//     ~/.claude/hook-errors.seen (an ISO time, rewritten every start); no marker → silent.
//   - after a compaction: the re-orientation reminders that compaction drops
//     (domain CLAUDE.md reload, marker discipline)
//
// On startup or resume in a ticket worktree (a linked worktree on a branch like
// chore/344-x), it also names the session `ticket-<repo>-<N>` via
// hookSpecificOutput.sessionTitle (#344), so a ticket window needs no `claude -n`. It
// never overwrites a title the session already has (input session_title, set by -n,
// /rename or an earlier hook), because an unguarded sessionTitle replaces them (#343 probe).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { errorLog, run } from './_hooklib.mjs';
import { worktreeTicketName } from '../scripts/lib.mjs';

/** The title to give this session, or null: only on startup/resume, only untitled, only in a ticket worktree. */
function ticketTitle(payload) {
  if (!['startup', 'resume'].includes(payload?.source) || payload.session_title || !payload.cwd) return null;
  return worktreeTicketName(payload.cwd);
}

function inProgressIssues() {
  try {
    const [cmd, ...pre] = process.env.SESSION_START_GH ? JSON.parse(process.env.SESSION_START_GH) : ['gh'];
    const out = execFileSync(
      cmd,
      [...pre, 'search', 'issues', '--owner', 'Crawford-Young', '--label', 'in-progress', '--state', 'open', '--limit', '10', '--json', 'repository,number,title'],
      { encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return JSON.parse(out).map((i) => `- ${i.repository.name}#${i.number} ${i.title}`);
  } catch {
    return [];
  }
}

/** Entries logged since the marker whose stack points into this hooks/ dir (not worktrees, scratch or copies). */
function newHookErrors(hooksDir) {
  const marker = join(dirname(errorLog), 'hook-errors.seen');
  let since = NaN;
  try {
    since = Date.parse(readFileSync(marker, 'utf8').trim());
  } catch {
    // first run
  }
  try {
    writeFileSync(marker, new Date().toISOString());
  } catch {
    return null;
  }
  if (Number.isNaN(since) || !existsSync(errorLog)) return null;
  const live = `${pathToFileURL(hooksDir).href.toLowerCase()}/`;
  const hits = [];
  for (const block of readFileSync(errorLog, 'utf8').split(/\r?\n(?=\d{4}-\d\d-\d\dT)/)) {
    const m = /^(\S+Z) ([\w-]+): /.exec(block);
    if (m && Date.parse(m[1]) > since && block.toLowerCase().includes(live)) hits.push(m[2]);
  }
  return hits.length ? `${hits.length} hook error${hits.length > 1 ? 's' : ''} since last session (newest: ${hits.at(-1)}) — see ~/.claude/hook-errors.log` : null;
}

run('session-start', (payload) => {
  const lines = [];
  const hooksDir = dirname(fileURLToPath(import.meta.url));
  try {
    const index = join(hooksDir, '..', 'skills', 'INDEX.md');
    lines.push(readFileSync(index, 'utf8').replace(/\r\n/g, '\n').trim());
  } catch {
    // no index — verify-frontmatter.mjs fails CI on that; never break a session start
  }

  const issues = inProgressIssues();
  if (issues.length) lines.push('In progress:', ...issues);

  try {
    const errs = newHookErrors(hooksDir);
    if (errs) lines.push(errs);
  } catch {
    // best-effort
  }

  if (payload?.source === 'compact') {
    lines.push(
      "Post-compaction: re-read the domain CLAUDE.md for the cwd (compaction drops it) and Read again a SKILL.md you were mid-way through only if its body exceeds ~5k tokens (none here does today). Re-orient from the issue's Done-when and the last commit's Next: line, not the summary.",
    );
  }

  let title = null;
  try {
    title = ticketTitle(payload);
  } catch {
    // best-effort: an unnamed window is the old behaviour
  }
  const context = lines.join('\n');
  if (title) {
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context, sessionTitle: title } })}\n`);
  } else if (lines.length) process.stdout.write(`${context}\n`);
});
