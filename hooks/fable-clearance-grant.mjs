#!/usr/bin/env node
// fable-clearance-grant.mjs — UserPromptSubmit hook (port of
// fable-clearance-grant.ps1). When the user's own prompt contains the token
// FABLE OK, write the single-use 30-minute clearance marker that
// agent-model-guard.mjs consumes. Speed bump + audit trail, not a hard gate.

import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudeDir, run } from './_hooklib.mjs';

run('fable-clearance-grant', (payload) => {
  const prompt = payload?.prompt || payload?.user_prompt || '';
  if (!/\bFABLE OK\b/.test(prompt)) return;
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(join(claudeDir, 'fable-clearance.json'), JSON.stringify({ granted: new Date().toISOString() }));
  appendFileSync(join(claudeDir, 'fable-dispatch.log'), `${new Date().toISOString()} GRANT (FABLE OK in user prompt)\n`);
});
