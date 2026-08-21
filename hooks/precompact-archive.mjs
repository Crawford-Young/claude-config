#!/usr/bin/env node
// precompact-archive.mjs — PreCompact hook (port of precompact-archive.ps1).
// Copies the transcript to ~/.claude/compact-archives/ before every
// compaction, so the pre-compact conversation is always recoverable.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { claudeDir, run } from './_hooklib.mjs';

run('precompact-archive', (payload) => {
  const src = payload?.transcript_path;
  if (!src || !existsSync(src)) return;
  const dir = join(claudeDir, 'compact-archives');
  mkdirSync(dir, { recursive: true });
  const sid = payload?.session_id || 'session';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  copyFileSync(src, join(dir, `${sid}-${stamp}.jsonl`));
});
