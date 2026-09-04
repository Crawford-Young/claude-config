#!/usr/bin/env node
// session-state.mjs — the mechanical half of a continuation prompt.
//
//   node session-state.mjs [--docs <docs-root>]
//
// Prints, as compact markdown: every active checklist (with its first
// unchecked task) and the state of every workspace repo that is dirty or off
// its default branch. The continuation skill pastes this block and writes
// only what no file carries: mission, unresolved decisions, traps.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { discoverRepos, findActiveChecklists, git, log, parseArgs, workspaceRoot } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const root = workspaceRoot();
const docsRoot = args.docs || join(root, 'docs');

log('### Active checklists');
const checklists = existsSync(docsRoot) ? findActiveChecklists(docsRoot) : [];
if (checklists.length === 0) log('(none)');
for (const f of checklists) {
  const text = readFileSync(f, 'utf8');
  const next = firstUnchecked(text);
  log(`- ${f}`);
  log(`  next: ${next || 'all tasks ticked'}`);
}

log('\n### Repos with state');
let any = false;
for (const repo of discoverRepos()) {
  const branch = git(repo, ['branch', '--show-current']).out;
  const dirty = git(repo, ['status', '--porcelain']).out.split('\n').filter(Boolean);
  const last = git(repo, ['log', '--oneline', '--no-decorate', '-1']).out;
  const onDefault = branch === 'main' || branch === 'master';
  if (dirty.length === 0 && onDefault) continue;
  any = true;
  log(`- ${repo} @ ${branch || 'detached'} — ${dirty.length} uncommitted — last: ${last}`);
}
if (!any) log('(all repos clean on their default branch)');

function firstUnchecked(text) {
  let fenced = false;
  for (const l of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(l)) fenced = !fenced;
    if (!fenced && /^\s*- \[ \]/.test(l)) return l.replace(/^\s*- \[ \]\s*/, '').slice(0, 120);
  }
  return null;
}
