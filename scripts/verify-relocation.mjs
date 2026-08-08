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
    match: 'prompted by `reflect` at project end only',
    task: 'harness-evolution P3, T3 (G30 + support set)',
    reason:
      'Baseline §7 is one paragraph (seven bullets, no blank lines). Two bullets rewritten in place, not relocated: (1) /clear-at-project-end-only inverted to /clear-at-every-wave-boundary (G30 shape B, user-approved spec 2026-08-08-p3-context-overhaul-design.md, trial-gated); the guards "safety net; marker discipline unchanged" and "/rewind partial summarize is optional, never replaces markers" byte-retained in the new bullet, /rewind recovery scope tightened to same-process (checkpointing.md); absorbed one-liners G15/G33/G7/G8. (2) Grep-before-Read bullet extended with /context, /mcp, /btw, CLI-over-MCP (G35/G40); original sentences byte-retained at bullet start. Bullets 1-5 of the paragraph byte-unchanged, verified by diff at edit time (T3 S6). Prior text + revert procedure recorded in the P3 trial log (docs/harness-evolution/issues/2026-08-08-p3-issues.md). P5 (2026-08-08) appended the G45 ToolSearch-batching sentence to the Grep-before-Read bullet — same paragraph, same entry.',
  },
  // Emptied 2026-07-30 at the claim+cite compression epoch reset: the workspace baselines
  // (root.md, web.md, games.md) were refreshed to the compressed post-relocation files, so
  // every prior entry — all keyed on pre-compression baseline text — stopped firing and was
  // removed per the stale-exemption rule below. The retired entries and their audit reasons
  // live in git history (pre-refresh revision of this file). Rule-preservation for the
  // compression itself was verified rule-by-rule in PR #13 and the payload-landing PR.
  {
    match: 'each overriding the last on conflict',
    task: 'harness-evolution P4b, T4 (G11)',
    reason:
      'Header wording rewritten in place, not relocated: "each overriding the last on conflict" overstated the documented semantics (features-overview.md: levels are additive, reconciliation is judgment, more-specific typically wins). The rule stayed in the same paragraph of the same file; only the override claim softened. Gap report G11, spec 2026-08-07-p4b-quick-wins-design.md.',
  },
  {
    match: 'copy `.env.local` AND `.env` from the main checkout',
    task: 'harness-evolution P4b, T4 (G52)',
    reason:
      'Manual-copy rule rewritten in place, not relocated: `.worktreeinclude` files (added this wave to repos with env files) automate the copy for Claude-created worktrees, so the rule became "verify .worktreeinclude covers env files", retaining the manual-copy clause for repos without the file and for plain `git worktree add` worktrees. This block runs as consecutive rule lines, so the whole block match breaks on this one edit — the other rules in the block (port holder, env-var staleness, env-injection surfaces) are byte-unchanged, verified by diff at edit time. Gap report G52, spec 2026-08-07-p4b-quick-wins-design.md. P5 T11 (2026-08-08) additionally deleted the squash-integration sub-bullet from this paragraph (G18 retirement — zero live pre-2026-07-21 unmerged branches; evidence table in docs/harness-evolution/issues/2026-08-08-p5-issues.md; the procedure stays live in skills/git-recovery-ops SKILL.md Signature 1).',
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
