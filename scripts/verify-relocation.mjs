#!/usr/bin/env node
/**
 * verify-relocation.mjs — zero-loss gate for the 2026-07-28 context-engineering restructure.
 *
 * Every paragraph present in the pre-change baselines must appear in exactly one
 * post-change destination file. Relocation is the wave's only real risk: a rule that
 * silently vanishes during a move is indistinguishable from a rule that was never
 * written. This detects that.
 *
 * Usage:
 *   node claude-config/scripts/verify-relocation.mjs            # normal run
 *   node ... --baseline <file> --dest <file> [--dest <file>]    # scoped run (self-test)
 *   node ... --verbose                                          # list every paragraph
 *
 * Exit 0 = every baseline paragraph found exactly once.
 * Exit 1 = at least one MISSING. Duplicates warn but do not fail: a paragraph legitimately
 *          reads as "found twice" mid-wave, while its source file is still to be trimmed.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const REPO = resolve(import.meta.dirname, '..', '..');
const BASELINE_DIR = resolve(import.meta.dirname, 'baseline');

/** Paragraphs shorter than this are structural (headings, table rows, list scaffolding)
 *  and too generic to match uniquely. Matching them produces noise, not signal. */
const MIN_PARAGRAPH_CHARS = 60;

const DEFAULT_DESTINATIONS = [
  'claude-config/workspace/CLAUDE.md',
  'claude-config/workspace/web/CLAUDE.md',
  'claude-config/workspace/games/CLAUDE.md',
  'claude-config/workspace/apps/CLAUDE.md',
  'claude-config/workspace/docs/SKILLS.md',
  'web/component-library/CLAUDE.md',
  'web/component-library/docs/WAVES.md',
];

/** Directories whose *.md files are all destinations, if present. */
const DEFAULT_DEST_DIRS = ['claude-config/skills', 'web/component-library/.claude/skills'];

/** Paragraphs that legitimately live in more than one file. Each domain's Definition of
 *  Done deliberately repeats the verification line — that is intentional duplication, not
 *  an untrimmed source. Substring match against the normalized paragraph. */
const INTENTIONAL_DUPLICATES = ['Run `superpowers:verification-before-completion` before declaring anything done.'];

function parseArgs(argv) {
  const out = { baselines: [], dests: [], verbose: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--baseline') out.baselines.push(argv[++i]);
    else if (argv[i] === '--dest') out.dests.push(argv[++i]);
    else if (argv[i] === '--verbose') out.verbose = true;
  }
  return out;
}

function walkMd(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkMd(full, acc);
    else if (entry.name.endsWith('.md')) acc.push(full);
  }
  return acc;
}

/** Collapse all whitespace so a reflowed line still matches its source. */
const normalize = (s) => s.replace(/\s+/g, ' ').trim();

function paragraphs(text) {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map(normalize)
    .filter((p) => p.length >= MIN_PARAGRAPH_CHARS);
}

const args = parseArgs(process.argv.slice(2));

// --- resolve baselines ---
let baselineFiles;
if (args.baselines.length) {
  baselineFiles = args.baselines.map((f) => resolve(f));
} else {
  if (!existsSync(BASELINE_DIR)) {
    console.error(`ABORT: no baseline directory at ${BASELINE_DIR}`);
    process.exit(1);
  }
  baselineFiles = readdirSync(BASELINE_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => join(BASELINE_DIR, f));
}

// --- resolve destinations ---
let destFiles;
if (args.dests.length) {
  destFiles = args.dests.map((f) => resolve(f));
} else {
  destFiles = DEFAULT_DESTINATIONS.map((f) => join(REPO, f)).filter((f) => existsSync(f));
  for (const d of DEFAULT_DEST_DIRS) destFiles.push(...walkMd(join(REPO, d)));
  // The baselines are copies of the sources; matching against them would make every
  // paragraph trivially "found" and the gate meaningless.
  destFiles = destFiles.filter((f) => !f.startsWith(BASELINE_DIR));
}

if (!destFiles.length) {
  console.error('ABORT: no destination files resolved.');
  process.exit(1);
}

const haystack = destFiles.map((f) => ({ file: f, text: normalize(readFileSync(f, 'utf8')) }));

let checked = 0;
const missing = [];
const duplicated = [];

for (const baseFile of baselineFiles) {
  for (const para of paragraphs(readFileSync(baseFile, 'utf8'))) {
    checked++;
    const hits = haystack.filter((h) => h.text.includes(para));
    const intentional = INTENTIONAL_DUPLICATES.some((d) => para.includes(d));
    if (hits.length === 0) missing.push({ baseFile, para });
    else if (hits.length > 1 && !intentional) duplicated.push({ para, files: hits.map((h) => h.file) });
    else if (args.verbose) {
      console.log(`  ok  ${relative(REPO, hits[0].file)}  ${para.slice(0, 70)}…`);
    }
  }
}

console.log(`\nbaselines:    ${baselineFiles.length} file(s)`);
console.log(`destinations: ${destFiles.length} file(s)`);
console.log(`paragraphs:   ${checked} checked (>= ${MIN_PARAGRAPH_CHARS} chars)`);

if (duplicated.length) {
  console.log(`\n--- FOUND IN MULTIPLE FILES (${duplicated.length}) ---`);
  console.log('Expected mid-wave while a source still holds text already copied to a skill.');
  console.log('At the Task 13 gate this list must be empty.\n');
  for (const d of duplicated) {
    console.log(`  ${d.para.slice(0, 78)}…`);
    for (const f of d.files) console.log(`      -> ${relative(REPO, f)}`);
  }
}

if (missing.length) {
  console.log(`\n--- MISSING (${missing.length}) — BLOCKER ---`);
  console.log('Present in a baseline, absent from every destination. A rule was lost.\n');
  for (const m of missing) {
    console.log(`  [${relative(REPO, m.baseFile)}] ${m.para.slice(0, 90)}…`);
  }
  console.log(`\nFAIL: ${missing.length} paragraph(s) missing.`);
  process.exit(1);
}

console.log(`\nPASS: all ${checked} paragraphs accounted for.`);
process.exit(0);
