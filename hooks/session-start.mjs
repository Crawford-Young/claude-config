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
//   - after a compaction: the re-orientation reminders that compaction drops
//     (domain CLAUDE.md reload, marker discipline)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './_hooklib.mjs';

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

run('session-start', (payload) => {
  const lines = [];
  try {
    const index = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'INDEX.md');
    lines.push(readFileSync(index, 'utf8').replace(/\r\n/g, '\n').trim());
  } catch {
    // no index — verify-frontmatter.mjs fails CI on that; never break a session start
  }

  const issues = inProgressIssues();
  if (issues.length) lines.push('In progress:', ...issues);

  if (payload?.source === 'compact') {
    lines.push(
      "Post-compaction: re-read the domain CLAUDE.md for the cwd (compaction drops it) and Read again a SKILL.md you were mid-way through only if its body exceeds ~5k tokens (none here does today). Re-orient from the issue's Done-when and the last commit's Next: line, not the summary.",
    );
  }

  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
});
