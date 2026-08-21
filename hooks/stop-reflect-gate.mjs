#!/usr/bin/env node
// stop-reflect-gate.mjs — Stop hook, RELAXED port of stop-reflect-gate.ps1.
//
// Old behavior: hard-block turn end (up to the platform's 8-block cap) when a
// recently-touched active checklist is all-ticked except its reflect line.
// New behavior (2026-08-21 restructure): remind exactly once — the first Stop
// attempt blocks with an instruction to PROMPT the user about reflect; the
// retry (stop_hook_active = true) passes. Reflect is prompted, never forced.
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
        `Checklist ${f} is complete except reflect. Before ending: prompt the user to run the reflect skill now (or to explicitly skip it). This gate reminds once and will not block again.`,
      );
    }
  }
});
}
