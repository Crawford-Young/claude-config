#!/usr/bin/env node
// checklist.mjs — scaffold, tick, and archive wave checklists.
//
//   node checklist.mjs new <project-docs-dir> <slug> [--branch feat/x] [--spec path] [--title "..."]
//   node checklist.mjs tick <file> <pattern> [--note "..."]
//   node checklist.mjs status <file>
//   node checklist.mjs done <file>
//
// Ticks stamp real UTC time at end-of-line (`<!-- done ...Z -->`) so OTel
// per-task attribution keeps working. `done` moves active/ → done/ via git mv
// when the file is tracked, plain rename otherwise.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { die, git, log, parseArgs, utcStamp } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (cmd === 'new') cmdNew();
  else if (cmd === 'tick') cmdTick();
  else if (cmd === 'status') cmdStatus();
  else if (cmd === 'done') cmdDone();
  else die('usage: checklist.mjs new <project-dir> <slug> | tick <file> <pattern> | status <file> | done <file>');
}

function cmdNew() {
  const projectDir = resolve(args._[1] || '');
  const slug = args._[2];
  if (!projectDir || !slug) die('usage: checklist.mjs new <project-docs-dir> <slug> [--branch] [--spec] [--title]');

  const activeDir = join(projectDir, 'checklists', 'active');
  mkdirSync(activeDir, { recursive: true });
  mkdirSync(join(projectDir, 'checklists', 'done'), { recursive: true });
  const file = join(activeDir, `${slug}.md`);
  if (existsSync(file)) die(`checklist already exists: ${file}`);

  const title = args.title || slug;
  const branch = args.branch || `feat/${slug}`;
  const spec = args.spec ? `\n**Spec:** ${args.spec}` : '';
  writeFileSync(
    file,
    `<!-- ORCHESTRATOR ONLY - subagents read-only. Tick via checklist.mjs so stamps stay real. -->
# ${title}
**Branch:** ${branch}${spec}

## Tasks

- [ ] **Task 1** — <fill from the approved plan>

<!-- COMPACT POINT -->

- [ ] **Reflect** — run the reflect skill at wave close

## Log
<!-- one line per dispatch, deviation, or decision - at the moment it happens -->
`,
  );
  log(file);
}

function loadChecklist(p) {
  const file = resolve(p || '');
  if (!existsSync(file)) die(`checklist not found: ${file}`);
  return { file, text: readFileSync(file, 'utf8') };
}

// Task lines outside code fences.
export function taskLines(text) {
  const out = [];
  let fenced = false;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) fenced = !fenced;
    if (!fenced && /^\s*- \[[ x]\]/.test(l)) out.push({ i, line: l, done: /^\s*- \[x\]/.test(l) });
  }
  return { lines, tasks: out };
}

function cmdTick() {
  const { file, text } = loadChecklist(args._[1]);
  const pattern = args._[2];
  if (!pattern) die('usage: checklist.mjs tick <file> <pattern> [--note "..."]');

  const { lines, tasks } = taskLines(text);
  const open = tasks.filter((t) => !t.done && t.line.toLowerCase().includes(pattern.toLowerCase()));
  if (open.length === 0) die(`no unticked task matches "${pattern}"`);
  if (open.length > 1) die(`pattern matches ${open.length} unticked tasks — be more specific:\n${open.map((t) => t.line.trim()).join('\n')}`);

  const t = open[0];
  const note = args.note ? ` — ${args.note}` : '';
  lines[t.i] = `${t.line.replace('- [ ]', '- [x]')}${note} <!-- done ${utcStamp()} -->`;
  writeFileSync(file, lines.join('\n'));
  log(`ticked: ${lines[t.i].trim()}`);
}

function cmdStatus() {
  const { file, text } = loadChecklist(args._[1]);
  const { tasks } = taskLines(text);
  const open = tasks.filter((t) => !t.done);
  log(`${file}: ${tasks.length - open.length}/${tasks.length} done`);
  for (const t of open) log(`  TODO ${t.line.trim()}`);
  process.exitCode = open.length === 0 ? 0 : 1;
}

function cmdDone() {
  const { file, text } = loadChecklist(args._[1]);
  const { tasks } = taskLines(text);
  const open = tasks.filter((t) => !t.done);
  if (open.length > 0 && !args.force) {
    die(`refusing to archive with ${open.length} unticked task(s) (use --force to override):\n${open.map((t) => t.line.trim()).join('\n')}`);
  }
  const activeDir = dirname(file);
  if (basename(activeDir) !== 'active') die(`expected the file to live in a checklists/active/ dir: ${file}`);
  const doneDir = join(dirname(activeDir), 'done');
  mkdirSync(doneDir, { recursive: true });
  const dest = join(doneDir, basename(file));

  const repoRoot = git(dirname(file), ['rev-parse', '--show-toplevel']);
  if (repoRoot.code === 0) {
    const mv = git(repoRoot.out, ['mv', file, dest]);
    if (mv.code !== 0) renameSync(file, dest);
    else log('note: git mv stages the index blob — later edits to the moved file need explicit git add.');
  } else {
    renameSync(file, dest);
  }
  log(`archived: ${dest}`);
}
