#!/usr/bin/env node
// session-start.mjs — SessionStart hook. Replaces the prose duty "scan
// checklists at session start" with mechanism (extends the old
// sessionstart-compact-reminder.ps1, which only fired post-compact).
//
// Emits to stdout (which SessionStart adds as context):
//   - the skill index (skills/INDEX.md, on every source) — skills carry
//     disable-model-invocation, so their descriptions are not resident and the
//     model Reads the SKILL.md the index names (issue #64). SessionStart does
//     not fire for subagents (no SessionStart hook_success in any of 46 subagent
//     transcripts, 2026-10-08), so there is no agent_id guard here.
//   - every active checklist with its first unchecked task
//   - after a compaction: the re-orientation reminders that compaction drops
//     (domain CLAUDE.md reload, marker discipline)

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findActiveChecklists } from '../scripts/lib.mjs';
import { run } from './_hooklib.mjs';

run('session-start', (payload) => {
  const docsRoot =
    process.env.STOP_GATE_DOCS_ROOT ||
    join(process.env.CLAUDE_WORKSPACE_ROOT || join(homedir(), 'code'), 'docs');

  const lines = [];
  try {
    const index = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'INDEX.md');
    lines.push(readFileSync(index, 'utf8').replace(/\r\n/g, '\n').trim());
  } catch {
    // no index — verify-frontmatter.mjs fails CI on that; never break a session start
  }

  let checklists = [];
  try {
    checklists = findActiveChecklists(docsRoot);
  } catch {
    checklists = [];
  }
  if (checklists.length > 0) {
    lines.push('Active checklists (in-flight phases — resume at the first unchecked task):');
    for (const f of checklists) {
      let next = null;
      try {
        let fenced = false;
        for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) {
          if (/^\s*(```|~~~)/.test(l)) fenced = !fenced;
          if (!fenced && /^\s*- \[ \]/.test(l)) {
            next = l.replace(/^\s*- \[ \]\s*/, '').slice(0, 100);
            break;
          }
        }
      } catch {
        // unreadable checklist — still list it
      }
      lines.push(`- ${f}${next ? ` — next: ${next}` : ' — all ticked'}`);
    }
  }

  if (payload?.source === 'compact') {
    lines.push(
      'Post-compaction: re-read the domain CLAUDE.md for the cwd (compaction drops it) and Read again a SKILL.md you were mid-way through only if its body exceeds ~5k tokens (none here does today). The checklist is the source of truth — re-orient from it, not the summary.',
    );
  }

  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
});
