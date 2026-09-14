#!/usr/bin/env node
// stop-reflect-gate.mjs — Stop hook, RELAXED port of stop-reflect-gate.ps1.
//
// Old behavior: hard-block turn end (up to the platform's 8-block cap) when a
// recently-touched active checklist is all-ticked except its reflect line.
// New behavior (2026-08-21 restructure): remind once PER TURN END — the first
// Stop attempt blocks with an instruction to PROMPT the user about reflect; the
// retry (stop_hook_active = true) passes. Reflect is prompted, never forced.
//
// "Once" is scoped to one stop, not to the session: `stop_hook_active` resets at
// every turn end, and the gate persists no decision, so it re-fires on every
// turn end while the checklist stays in this state and inside WINDOW_MS. The
// message says so — prose claiming a single lifetime reminder cost three
// workstreams ~13 declines apiece (issue row 63) and, worse, invited a session
// to run reflect on a wave it had not executed. Persisting a decline is the
// open follow-up; this only stops the gate from lying about what it does.
//
// Env: STOP_GATE_DOCS_ROOT overrides the docs root (tests/fixtures).

import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findActiveChecklists } from '../scripts/lib.mjs';
import { block, run } from './_hooklib.mjs';

const WINDOW_MS = 6 * 60 * 60 * 1000;

export function needsReflect(text) {
  let fenced = false;
  let sawTask = false;
  for (const l of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(l)) fenced = !fenced;
    if (fenced) continue;
    const m = l.match(/^\s*- \[([ x])\]/);
    if (!m) continue;
    sawTask = true;
    if (m[1] === ' ' && !/reflect/i.test(l)) return false; // real work still open
  }
  if (!sawTask) return false;
  // all non-reflect tasks ticked — does an unticked reflect line remain?
  fenced = false;
  for (const l of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(l)) fenced = !fenced;
    if (!fenced && /^\s*- \[ \]/.test(l) && /reflect/i.test(l)) return true;
  }
  return false;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

function main() {
run('stop-reflect-gate', (payload) => {
  if (payload?.stop_hook_active) return; // already reminded this stop — let it end

  const docsRoot =
    process.env.STOP_GATE_DOCS_ROOT ||
    join(process.env.CLAUDE_WORKSPACE_ROOT || join(homedir(), 'code'), 'docs');

  const now = Date.now();
  for (const f of findActiveChecklists(docsRoot)) {
    let st;
    try {
      st = statSync(f);
    } catch {
      continue;
    }
    if (now - st.mtimeMs > WINDOW_MS) continue;
    if (needsReflect(readFileSync(f, 'utf8'))) {
      block(
        `Checklist ${f} is complete except reflect. Before ending: prompt the user to run the reflect skill now (or to explicitly skip it). This gate blocks once per turn end — the retry passes — but it stores no decision, so it fires again at every turn end until that reflect line is ticked or the checklist moves to done/. If the user has already declined, say that and end the turn; do not re-decide silently, and do not run reflect on a wave this session did not execute.`,
      );
    }
  }
});
}
