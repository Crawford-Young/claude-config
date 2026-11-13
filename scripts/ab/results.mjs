#!/usr/bin/env node
// results.mjs: unblind the #271 A/B and write the paired comparison (#375).
//
//   node scripts/ab/results.mjs [--out <dir>] [--manifest <file>] [--pair current:bare[,current:solo]] [--seed 1] [--iterations 10000]
//
// Joins <out>/runs/<ticket>/<arm>-r<n>/result.json (and the run's transcripts, for tokens) with
// blind-key.json and the grade.json of every packet slot grade.mjs wrote. Writes <out>/results.md and
// <out>/results.json: one row per ticket with each arm's median and range per metric; for each pair
// (default current minus bare, plus current minus solo when the runs hold solo, unit minus solo when
// they hold unit and solo, unit minus current when they hold unit; any two arms the runs hold) the
// per-ticket difference and the mean over tickets with seeded bootstrap intervals and tickets won /
// tied / lost, a pair with solo or unit again over the manifest's spawnExpected tickets, and every ticket
// a pair can't compare, with why; each run's subagents (spawned, share of cost); grader agreement on
// Done-when verdicts, which withholds the quality scores below its floor; and every excluded, held,
// timed-out, budget-capped and resultless run per arm, and each run whose Bash launched claude itself.
// Run it after grading: it names the arms, so its output never goes to a grader. Reads only; touches
// nothing but the two output files.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { die, isMain, log, parseArgs, readIfExists } from '../lib.mjs';
import { DEFAULT_OUT, parseManifest, readResult } from './ab-lib.mjs';
import { GRADE_SLOTS, exclusionReason } from './grade.mjs';
import { claudeLaunches, compare, defaultPairs, renderResults, runFlags, runValues, transcriptTokens } from './results-lib.mjs';

const AB_DIR = dirname(fileURLToPath(import.meta.url));

/** Every .jsonl text under `dir` (main and subagent transcripts). */
function jsonlTexts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map((f) => join(dir, String(f)))
    .filter((f) => f.endsWith('.jsonl') && statSync(f).isFile())
    .map((f) => readFileSync(f, 'utf8'));
}

/** Each run dir under <out>/runs as a compare() run, its grades joined from the blind key. */
function loadRuns(out, key) {
  const runsDir = join(out, 'runs');
  if (!existsSync(runsDir)) throw new Error(`no runs under ${runsDir}`);
  const grades = new Map();
  for (const slot of GRADE_SLOTS) {
    for (const [id, r] of Object.entries(key?.[slot.key] ?? {})) {
      const g = JSON.parse(readIfExists(join(out, slot.dir, id, 'grade.json')) ?? 'null');
      const k = `${r.ticket}|${r.arm}|${r.run}`;
      grades.set(k, { ...grades.get(k), [slot.name]: g });
    }
  }
  const held = new Map((key?.held ?? []).map((h) => [`${h.ticket}|${h.arm}|${h.run}`, h.reason]));
  const runs = [];
  for (const ticket of readdirSync(runsDir)) {
    for (const name of readdirSync(join(runsDir, ticket))) {
      const m = /^(.+)-r(\d+)$/.exec(name);
      if (!m) continue;
      const dir = join(runsDir, ticket, name);
      const result = readResult(join(dir, 'result.json'));
      const base = { ticket, arm: result?.arm ?? m[1], run: result?.run ?? Number(m[2]) };
      if (!result) {
        runs.push({ ...base, status: 'no-result' });
        continue;
      }
      const k = `${base.ticket}|${base.arm}|${base.run}`;
      const reason = exclusionReason(result);
      const texts = jsonlTexts(join(dir, 'transcripts'));
      const s = result.subagents;
      runs.push({
        ...base,
        status: reason ? 'excluded' : 'counted',
        reason,
        held: held.has(k),
        heldReason: held.get(k),
        flags: runFlags(result),
        values: runValues(result, transcriptTokens(texts)),
        grades: grades.get(k) ?? {},
        // #374: run.mjs's subagents block (a result from before it has none), and any claude the session launched itself.
        subagents: s ? { spawned: s.spawned, costShare: s.costUsd?.share ?? null } : null,
        claudeLaunches: claudeLaunches(texts),
      });
    }
  }
  return runs;
}

/** `--pair a:b[,c:d]` as [[a, b], ...], each arm checked against the runs. */
function parsePairs(text, arms) {
  return String(text)
    .split(',')
    .map((p) => p.split(':').map((s) => s.trim()))
    .map((p) => {
      if (p.length !== 2 || !p[0] || !p[1] || p[0] === p[1]) throw new Error(`--pair takes two different arms as a:b, got ${JSON.stringify(p.join(':'))}`);
      for (const arm of p) if (!arms.includes(arm)) throw new Error(`no runs for arm ${arm} (arms: ${arms.join(', ')})`);
      return p;
    });
}

if (isMain(import.meta.url)) main();

function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = args.out || DEFAULT_OUT;
  const keyText = readIfExists(join(out, 'blind-key.json'));
  let runs;
  let pairs;
  let spawnExpected;
  try {
    const manifest = parseManifest(readFileSync(args.manifest || join(AB_DIR, 'manifest.json'), 'utf8'));
    spawnExpected = manifest.tickets.filter((t) => t.spawnExpected).map((t) => t.id);
    runs = loadRuns(out, keyText ? JSON.parse(keyText) : null);
    const arms = [...new Set(runs.map((r) => r.arm))].sort();
    pairs = parsePairs(args.pair || defaultPairs(arms).map((p) => p.join(':')).join(','), arms);
  } catch (e) {
    die(e.message);
  }
  const res = compare(runs, { pairs, spawnExpected, iterations: Number(args.iterations ?? 10000), seed: Number(args.seed ?? 1), joined: Boolean(keyText) });
  writeFileSync(join(out, 'results.json'), `${JSON.stringify(res, null, 2)}\n`);
  writeFileSync(join(out, 'results.md'), renderResults(res, { source: out }));
  const a = res.agreement;
  log(`${res.tickets.length} ticket(s), arms ${res.arms.join(', ')}; quality ${a.qualityReported ? 'reported' : `withheld (${a.withheld.join('; ')})`}`);
  log(`results: ${join(out, 'results.md')} and results.json (they name the arms: never hand them to a grader)`);
}
