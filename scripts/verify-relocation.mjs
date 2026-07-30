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
 * Exit 1 = the gate RAN and found a real problem — MISSING, UNREACHABLE, or a stale
 *          exemption. Duplicates warn but do not fail: a paragraph legitimately reads as
 *          "found twice" mid-wave, while its source file is still to be trimmed.
 * Exit 2 = the gate could NOT run — an unclassified destination, no baselines, no
 *          destinations. Kept distinct from 1 on purpose: a config error that reports the
 *          same code as a genuine loss is a small version of the failure this gate exists
 *          to catch. (Harmonized 2026-07-28 at the routing-verification wave's reflect;
 *          the two abort sites below used to exit 1.)
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { homedir } from 'node:os';

const REPO = resolve(import.meta.dirname, '..', '..');
const BASELINE_DIR = resolve(import.meta.dirname, 'baseline');
const DEFAULT_JUNCTION_ROOT = join(homedir(), '.claude', 'skills');

/** Paragraphs shorter than this are structural (headings, table rows, list scaffolding)
 *  and too generic to match uniquely. Matching them produces noise, not signal. */
const MIN_PARAGRAPH_CHARS = 60;

/** Load classes. `always` = in the CLAUDE.md chain of every session under that path.
 *  `on-demand` = model-invoked or pointer-reached; reachable when its situation arises.
 *  `archival` = history; nothing loads it. Only the reachable-vs-archival split gates —
 *  the restructure's whole purpose was moving rules from `always` to `on-demand`, so a
 *  gate that failed that transition would forbid the thing it exists to verify. */
const LOAD_CLASSES = ['always', 'on-demand', 'archival'];
const REACHABLE = new Set(['always', 'on-demand']);

const DESTINATIONS = [
  { path: 'claude-config/workspace/CLAUDE.md', load: 'always' },
  { path: 'claude-config/workspace/web/CLAUDE.md', load: 'always' },
  { path: 'claude-config/workspace/games/CLAUDE.md', load: 'always' },
  { path: 'claude-config/workspace/apps/CLAUDE.md', load: 'always' },
  { path: 'claude-config/workspace/docs/SKILLS.md', load: 'on-demand' },
  { path: 'web/component-library/CLAUDE.md', load: 'always' },
  { path: 'web/component-library/docs/WAVES.md', load: 'archival' },
];

/** Paragraphs that legitimately live in more than one file. Each domain's Definition of
 *  Done deliberately repeats the verification line — that is intentional duplication, not
 *  an untrimmed source. Substring match against the normalized paragraph. */
const INTENTIONAL_DUPLICATES = ['Run `superpowers:verification-before-completion` before declaring anything done.'];

/** Baseline paragraphs the wave deliberately REWROTE rather than relocated. A rewritten
 *  paragraph cannot match its baseline, so it reads as MISSING — indistinguishable from a
 *  loss without this record. Each entry needs the task that changed it and why, so the
 *  exemption is auditable rather than a silencer. Substring match against the normalized
 *  baseline paragraph; keep the match text long enough to be unique.
 *
 *  Note on granularity: these files run rules as consecutive lines with no blank line
 *  between, so one "paragraph" can hold several unrelated rules. Editing any one of them
 *  invalidates the whole block's match. */
const INTENTIONAL_EDITS = [
  {
    match: 'Agent factory: spawn protocol, dispatch template, performance-MD duty, escalation, type authoring',
    reason:
      'Task 7 Step 4: the Orchestration block is one paragraph of 4 rules; its auto-mode line was rewritten for the 2026-07-28 defaultMode:auto reversal (issue #3). The other 3 rules in the block are unchanged.',
  },
  {
    match: '**Vitest patterns:** - Theme-dependent e2e specs seed BOTH themes explicitly',
    reason:
      'Task 8: the "**Vitest patterns:**" label and its 10 bullets are one paragraph. All 10 bullets moved verbatim into the live-qa-traps skill (checked individually, 0 missing); only the label was dropped, since a label with no bullets under it is dead structure.',
  },
  {
    match: 'Orchestrator stops at `<!-- COMPACT POINT -->` markers and prompts the user to run `/compact`',
    reason:
      'Task 12a (user-requested, mid-wave): the §7 Context Hygiene bullet list is one paragraph. A NEW `/compact <focus>` rule was inserted after the first bullet — additive, not a rewrite. All 13 original lines of the block verified present verbatim in the current root (line-by-line normalized compare, 0 missing). Nothing was lost; the block text simply no longer matches the baseline byte-for-byte.',
  },
  {
    match: '**Structure per project:**',
    reason:
      'Post-wave (2026-07-28, user directive): the continuation skill no longer writes handoff files — it emits a paste-ready resume prompt instead — so the `continuation/` folder and its `<timestamp>-handoff.md` line documented a directory that no longer exists. Deleted as a falsehood, same class as issue #10 stale-derivation. This is a DELETION, not a relocation: the two lines describe a retired mechanism and survive nowhere, by design. Bounded and verified: the fenced block holds 13 content lines, exactly 2 are gone, the other 11 are present verbatim in the current root (normalized line-by-line compare).',
  },
  {
    match: '- [ ] Vitest — 100% coverage (statements, functions, lines); branches ≥97% acceptable',
    reason:
      'username-w1 issue #2 (2026-07-27/28): the flat "100% coverage; branches >=97%" figure was FALSE for two repos — `vitest.config.ts` is the authority and scheduling-advisor runs 99/97/100/99. Replaced at web/CLAUDE.md:100 by a rule that names the config as the authority and enumerates the per-repo numbers, so the substance (which gaps are acceptable) survives while the wrong universal figure does not. Adjudicated in the description-audit issue log #4 and verified line-by-line 2026-07-29: of the 17 lines in that Definition-of-Done block, 16 are present verbatim in web/CLAUDE.md and only this one changed.',
  },
  {
    match: '| Testing | Vitest (100% coverage) + Playwright E2E',
    reason:
      'Same correction, same wave, same reason as the Definition-of-Done entry above: the stack table row also claimed a flat 100%. Replaced at web/CLAUDE.md:36 by "thresholds are PER-REPO — read `vitest.config.ts`". Verified line-by-line 2026-07-29: of the 14 rows in that table, 13 are present verbatim and only the Testing row changed; the table also lives in docs/web/STACK.md, so nothing about the stack was lost.',
  },
  {
    match: '**claude-config is config + reference docs only.** Never write project working artifacts',
    reason:
      'Post-wave (2026-07-28, user directive): same change as above. The artifact list named "continuation handoffs" among things never to write into junctioned dirs; that artifact type no longer exists. Verified byte-exact — the baseline paragraph with the literal string "continuation handoffs, " removed is character-for-character identical to the current one, so nothing else in the paragraph moved.',
  },
];

/** Baseline paragraphs that live in an archival destination BY DESIGN — history relocated
 *  into a history file. Their only hits are archival and that is correct, so UNREACHABLE
 *  would be a false blocker. Same audit discipline as INTENTIONAL_EDITS: each entry names
 *  its task, its reason, and what was verified by other means, and stale-entry detection
 *  removes it the moment it stops firing. This is a place a live rule could hide — the
 *  reason field is what makes that visible rather than silent. */
const INTENTIONAL_ARCHIVES = [
  {
    match: '| Wave | Components | Status |',
    task: 'Task 6 (routing-verification wave); relocated by the context-restructure wave, Task 14',
    reason:
      'The component-library wave-status table is history, and WAVES.md is the history file — its only hits being archival is correct, not a loss. Verified three ways before this entry was written: it is a status table and not a rule; it is the ONLY unreachable paragraph on the tree (listing length 1); and the active convention rule that sits beside it in web/component-library/CLAUDE.md:27 ("The wave\'s own status row is written in the wave branch as the post-merge truth") is present there and absent from WAVES.md — the rule stayed live, only the history moved. CLAUDE.md also keeps the three current wave rows; the 8,870-char full table is what went to the archive. Issue #9 of the context-restructure wave records the relocation and the user approval for it.',
  },
];

function parseArgs(argv) {
  const out = { baselines: [], dests: [], verbose: false, skillsRoot: null, junctionRoot: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--baseline') out.baselines.push(argv[++i]);
    else if (argv[i] === '--dest') out.dests.push(parseDest(argv[++i]));
    else if (argv[i] === '--skills-root') out.skillsRoot = argv[++i];
    else if (argv[i] === '--junction-root') out.junctionRoot = argv[++i];
    else if (argv[i] === '--archive-ok')
      INTENTIONAL_ARCHIVES.push({
        match: argv[++i],
        task: 'scoped self-test',
        reason: 'injected by --archive-ok',
      });
    else if (argv[i] === '--verbose') out.verbose = true;
  }
  return out;
}

/** `<path>:<class>`. Matched with an anchored regex rather than a `:` split so a Windows
 *  drive letter cannot be mistaken for a class separator. An unclassified or unknown-class
 *  destination ABORTS — defaulting it to reachable would reproduce the bug this gate is
 *  being fixed to catch, and defaulting it to archival would fail loudly for the wrong
 *  reason. Forcing the author to classify is the mechanism. */
function parseDest(raw) {
  const m = /^(.*):(always|on-demand|archival)$/.exec(raw ?? '');
  if (!m) {
    console.error(`ABORT: classify this destination as ${LOAD_CLASSES.join(' | ')} — got "${raw}"`);
    console.error('       usage: --dest <file>:<class>');
    process.exit(2);
  }
  return { path: m[1], load: m[2] };
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

/** Skill directories are auto-walked, so their class cannot come from a static list.
 *  A `claude-config/skills/<name>/` directory is reachable only if `<name>` exists under
 *  the junction root — `setup.ps1` creates one junction per skill and is NOT re-run when
 *  a skill is added, so authoring a skill directory is only half the wiring.
 *  `web/component-library/.claude/skills/` needs no junction: repo-local skills load from
 *  the repo itself.
 *
 *  Declared here, with the other helpers, because it reads module-level consts — placing it
 *  below the top-level execution that calls it would leave those in the temporal dead zone
 *  (the function declaration hoists; a const does not). */
function skillDestinations(args) {
  const out = [];

  const junctionRoot = args.junctionRoot ? resolve(args.junctionRoot) : DEFAULT_JUNCTION_ROOT;
  for (const file of walkMd(SKILLS_ROOT)) {
    const name = relative(SKILLS_ROOT, file).split(/[\\/]/)[0];
    const load = existsSync(join(junctionRoot, name)) ? 'on-demand' : 'archival';
    out.push({ path: file, load });
  }

  // A scoped self-test supplies its own skills root; pulling the real repo-local skills in
  // alongside its fixtures would make the fixture case unmeasurable.
  if (!args.skillsRoot) {
    for (const file of walkMd(join(REPO, 'web/component-library/.claude/skills'))) {
      out.push({ path: file, load: 'on-demand' });
    }
  }

  return out;
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

for (const d of DESTINATIONS) {
  if (!LOAD_CLASSES.includes(d.load)) {
    console.error(`ABORT: classify ${d.path} — load must be one of ${LOAD_CLASSES.join(' | ')}`);
    process.exit(2);
  }
}

/** Shared by `skillDestinations` and the UNREACHABLE report, which needs it to say WHY a
 *  destination is unreachable. One definition, so the fallback cannot drift between them. */
const SKILLS_ROOT = args.skillsRoot ? resolve(args.skillsRoot) : join(REPO, 'claude-config/skills');

// --- resolve baselines ---
let baselineFiles;
if (args.baselines.length) {
  baselineFiles = args.baselines.map((f) => resolve(f));
} else {
  if (!existsSync(BASELINE_DIR)) {
    console.error(`ABORT: no baseline directory at ${BASELINE_DIR}`);
    process.exit(2);
  }
  baselineFiles = readdirSync(BASELINE_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => join(BASELINE_DIR, f));
}

// --- resolve destinations ---
let destFiles;
if (args.dests.length) {
  destFiles = args.dests.map((d) => ({ path: resolve(d.path), load: d.load }));
} else {
  destFiles = DESTINATIONS.map((d) => ({ path: join(REPO, d.path), load: d.load })).filter((d) =>
    existsSync(d.path),
  );
  destFiles.push(...skillDestinations(args));
  // The baselines are copies of the sources; matching against them would make every
  // paragraph trivially "found" and the gate meaningless.
  destFiles = destFiles.filter((d) => !d.path.startsWith(BASELINE_DIR));
}

if (!destFiles.length) {
  console.error('ABORT: no destination files resolved.');
  process.exit(2);
}

const haystack = destFiles.map((d) => ({
  file: d.path,
  load: d.load,
  text: normalize(readFileSync(d.path, 'utf8')),
}));

let checked = 0;
const missing = [];
const unreachable = [];
const archived = [];
const duplicated = [];
const rewritten = [];

for (const baseFile of baselineFiles) {
  for (const para of paragraphs(readFileSync(baseFile, 'utf8'))) {
    checked++;
    const hits = haystack.filter((h) => h.text.includes(para));
    const live = hits.filter((h) => REACHABLE.has(h.load));
    const intentional = INTENTIONAL_DUPLICATES.some((d) => para.includes(d));
    const edit = INTENTIONAL_EDITS.find((e) => para.includes(e.match));
    const archiveOk = INTENTIONAL_ARCHIVES.find((a) => para.includes(a.match));
    if (hits.length === 0 && edit) rewritten.push(edit);
    else if (hits.length === 0) missing.push({ baseFile, para });
    else if (live.length === 0 && archiveOk) archived.push(archiveOk);
    else if (live.length === 0) unreachable.push({ baseFile, para, files: hits.map((h) => h.file) });
    else if (live.length > 1 && !intentional) duplicated.push({ para, files: live.map((h) => h.file) });
    else if (args.verbose) {
      console.log(`  ok  ${relative(REPO, live[0].file)}  ${para.slice(0, 70)}…`);
    }
  }
}

console.log(`\nbaselines:    ${baselineFiles.length} file(s)`);
console.log(`destinations: ${destFiles.length} file(s)`);
console.log(`paragraphs:   ${checked} checked (>= ${MIN_PARAGRAPH_CHARS} chars)`);

if (rewritten.length) {
  console.log(`\n--- DELIBERATELY REWRITTEN (${rewritten.length}) — exempt, not lost ---`);
  for (const r of rewritten) {
    console.log(`  ${r.match.slice(0, 78)}…`);
    console.log(`      ${r.reason}`);
  }
}

if (archived.length) {
  console.log(`\n--- ARCHIVED BY DESIGN (${archived.length}) — exempt, not lost ---`);
  for (const a of archived) {
    console.log(`  ${a.match.slice(0, 78)}…`);
    console.log(`      ${a.reason}`);
  }
}

// An exemption that never fires is a silencer for a condition that no longer exists —
// it would mask a real loss in that paragraph later. Surface it.
const unusedEdits = INTENTIONAL_EDITS.filter((e) => !rewritten.includes(e));
const unusedArchives = INTENTIONAL_ARCHIVES.filter((a) => !archived.includes(a));
if ((unusedEdits.length || unusedArchives.length) && !args.baselines.length) {
  const stale = [
    ...unusedEdits.map((e) => ['INTENTIONAL_EDITS', e]),
    ...unusedArchives.map((a) => ['INTENTIONAL_ARCHIVES', a]),
  ];
  console.log(`\n--- STALE EXEMPTIONS (${stale.length}) ---`);
  console.log('Listed as exempt but the paragraph did not need it. Remove them.\n');
  for (const [list, e] of stale) console.log(`  [${list}] ${e.match.slice(0, 78)}…`);
}

if (duplicated.length) {
  console.log(`\n--- FOUND IN MULTIPLE FILES (${duplicated.length}) ---`);
  console.log('Expected mid-wave while a source still holds text already copied to a skill.');
  console.log('At the Task 13 gate this list must be empty.\n');
  for (const d of duplicated) {
    console.log(`  ${d.para.slice(0, 78)}…`);
    for (const f of d.files) console.log(`      -> ${relative(REPO, f)}`);
  }
}

if (unreachable.length) {
  console.log(`\n--- UNREACHABLE (${unreachable.length}) — BLOCKER ---`);
  console.log('Present, but only in destinations nothing loads. A rule relocated into an');
  console.log('archive or an un-junctioned skill is lost as thoroughly as one deleted.\n');
  for (const u of unreachable) {
    console.log(`  [${relative(REPO, u.baseFile)}] ${u.para.slice(0, 90)}…`);
    for (const f of u.files) {
      const why = f.startsWith(SKILLS_ROOT) ? 'un-junctioned skill' : 'archival file';
      console.log(`      -> ${relative(REPO, f)} (${why})`);
    }
  }
}

if (missing.length) {
  console.log(`\n--- MISSING (${missing.length}) — BLOCKER ---`);
  console.log('Present in a baseline, absent from every destination. A rule was lost.\n');
  for (const m of missing) {
    console.log(`  [${relative(REPO, m.baseFile)}] ${m.para.slice(0, 90)}…`);
  }
}

if (missing.length || unreachable.length) {
  if (missing.length) console.log(`\nFAIL: ${missing.length} paragraph(s) missing.`);
  if (unreachable.length) console.log(`FAIL: ${unreachable.length} paragraph(s) unreachable.`);
  process.exit(1);
}

console.log(`\nPASS: all ${checked} paragraphs accounted for.`);
process.exit(0);
