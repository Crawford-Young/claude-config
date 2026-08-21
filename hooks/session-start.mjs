#!/usr/bin/env node
// session-start.mjs — SessionStart hook. Replaces the prose duty "scan
// checklists at session start" with mechanism (extends the old
// sessionstart-compact-reminder.ps1, which only fired post-compact).
//
// Emits to stdout (which SessionStart adds as context):
//   - every active checklist with its first unchecked task
//   - after a compaction: the re-orientation reminders that compaction drops
//     (domain CLAUDE.md reload, marker discipline)

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findActiveChecklists } from '../scripts/lib.mjs';
import { run } from './_hooklib.mjs';

run('session-start', (payload) => {
  const docsRoot =
    process.env.STOP_GATE_DOCS_ROOT ||
    join(process.env.CLAUDE_WORKSPACE_ROOT || join(homedir(), 'code'), 'docs');

  const lines = [];
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
      'Post-compaction: re-read the domain CLAUDE.md for the cwd (compaction drops it) and re-invoke any heavy skill you are mid-way through. The checklist is the source of truth — re-orient from it, not the summary.',
    );
  }

  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
});
