#!/usr/bin/env node
// agent-model-guard.mjs — PreToolUse guard on Agent dispatches (port of
// agent-model-guard.ps1). Wire with matcher "Agent".
//
// Two rules:
//   1. A dispatch that omits `model:` on a type whose definition carries no
//      frontmatter model would silently inherit the session default (which
//      may be fable — usage-billed). Block and ask for an explicit model.
//   2. An explicit fable model requires a live user clearance marker (written
//      by fable-clearance-grant.mjs when the user types FABLE OK). Single
//      use, 30-minute window; every decision lands in the dispatch log.
//
// Fail-open on script errors.

import { existsSync, readFileSync, unlinkSync, appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { block, claudeDir, run } from './_hooklib.mjs';

const markerFile = join(claudeDir, 'fable-clearance.json');
const dispatchLog = join(claudeDir, 'fable-dispatch.log');
const CLEARANCE_MS = 30 * 60 * 1000;

function typeHasFrontmatterModel(type) {
  if (!type || type.includes(':')) return false; // plugin-namespaced or unknown
  for (const dir of [join(claudeDir, 'agents'), join(process.env.CLAUDE_WORKSPACE_ROOT || join(homedir(), 'code'), 'claude-config', 'agents')]) {
    const p = join(dir, `${type}.md`);
    if (!existsSync(p)) continue;
    const head = readFileSync(p, 'utf8').slice(0, 1000);
    if (/^model:\s*\S+/m.test(head)) return true;
  }
  return false;
}

function logLine(verdict, type, model) {
  try {
    mkdirSync(claudeDir, { recursive: true });
    appendFileSync(dispatchLog, `${new Date().toISOString()} ${verdict} type=${type || '?'} model=${model || '(omitted)'}\n`);
  } catch {
    // audit trail is best-effort
  }
}

run('agent-model-guard', (payload) => {
  const input = payload?.tool_input || {};
  const type = input.subagent_type || '';
  const model = (input.model || '').toLowerCase();

  if (!model && !typeHasFrontmatterModel(type)) {
    block(
      `Agent dispatch for type "${type || '(default)'}" omits model: and the type has no frontmatter default — it would silently inherit the session model. Set model: explicitly (see agents/ROUTING.md).`,
    );
  }

  if (model.includes('fable')) {
    let ok = false;
    try {
      if (existsSync(markerFile)) {
        const marker = JSON.parse(readFileSync(markerFile, 'utf8'));
        ok = Date.now() - Date.parse(marker.granted) < CLEARANCE_MS;
        unlinkSync(markerFile); // single use, consumed either way
      }
    } catch {
      ok = false;
    }
    logLine(ok ? 'ALLOW' : 'BLOCK', type, model);
    if (!ok) {
      block('Fable dispatches are usage-billed and need per-run user clearance: ask the user to reply with "FABLE OK" (grants one dispatch for 30 minutes), then re-dispatch.');
    }
  }
});
