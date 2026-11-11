#!/usr/bin/env node
// grade.mjs: blind grading packets for the #271 A/B (the grading itself is a later, cleared live round).
//
//   node scripts/ab/grade.mjs [--out <dir>] [--manifest <file>]
//
// For each finished run under <out>/runs/<ticket>/<arm>-r<n>/ (result.json, diff.patch, gate-*.log),
// writes <out>/packets/<id>/packet.md (rubric, Done-when, gate rcs, anonymized failure lines and diff)
// and an unfilled grade.json. <id> is a salted hash, so a packet never names its arm; the mapping
// lives in <out>/blind-key.json, outside the packets dir. Hand a grader the packets dir only.
// Every packet is graded twice (#375): the same run again under its own id in <out>/packets-second/,
// for a second grader who never sees the first one's grades. <out>/packets-user/ holds the user's
// blind sample: USER_SAMPLE runs (all of them when fewer exist), balanced across arms, picked by the
// salt and kept across re-runs. Give each fresh grader one slot's packets, never two slots of one run;
// results.mjs joins the grades and checks their agreement.
// A run whose contamination scan flagged a reach into the real workspace, config or temp is excluded, not
// graded. A packet that still carries an identifying pattern after anonymizing is held, not written;
// the other runs still get theirs. Both lists, with reasons, go in blind-key.json.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { die, isMain, log, parseArgs, readIfExists, workspaceRoot } from '../lib.mjs';
import { ARMS, DEFAULT_OUT, doneWhen, loadManifest, readResult } from './ab-lib.mjs';
import { anonymize, dropFiles, leaks } from './anonymize.mjs';
import { USER_MIN } from './results-lib.mjs';

const AB_DIR = dirname(fileURLToPath(import.meta.url));
const RUBRIC = readFileSync(join(AB_DIR, 'RUBRIC.md'), 'utf8').trim();

/** The grading slots: where each slot's packets go and which blind-key.json field maps its ids. */
export const GRADE_SLOTS = [
  { name: 'first', dir: 'packets', key: 'packets' },
  { name: 'second', dir: 'packets-second', key: 'second' },
  { name: 'user', dir: 'packets-user', key: 'user' },
];
/** Runs in the user's blind sample. */
export const USER_SAMPLE = USER_MIN;

/** A run's packet id in one grading slot: stable for one salt, unguessable without it, and different
 *  per slot, so two slots' packets of one run can't be matched by id. The first slot keeps the id
 *  packets had before there were slots. */
export function blindId(salt, ticketId, arm, run, slot = 'first') {
  const tail = slot === 'first' ? '' : `|${slot}`;
  return createHash('sha256').update(`${salt}|${ticketId}|${arm}|${run}${tail}`).digest('hex').slice(0, 8);
}

const sameRun = (a) => (b) => a.ticket === b.ticket && a.arm === b.arm && a.run === b.run;

/** The user's blind sample of `eligible` runs: `n` of them (all when fewer), the arms as even as the
 *  runs allow, each arm's runs taken in salted-hash order. Runs in `kept` (an earlier sample) that are
 *  still eligible stay, so a re-run never moves a packet the user may have graded. */
export function userSample(eligible, salt, n = USER_SAMPLE, kept = []) {
  const picked = eligible.filter((r) => kept.some(sameRun(r))).slice(0, n);
  const rank = (r) => blindId(salt, r.ticket, r.arm, r.run, 'user-rank');
  const queues = new Map();
  for (const r of [...eligible].sort((a, b) => rank(a).localeCompare(rank(b)))) {
    if (!picked.some(sameRun(r))) queues.set(r.arm, [...(queues.get(r.arm) ?? []), r]);
  }
  const arms = [...queues.keys()].sort();
  const have = (a) => picked.filter((r) => r.arm === a).length;
  while (picked.length < n) {
    const open = arms.filter((a) => queues.get(a).length);
    if (!open.length) break;
    picked.push(queues.get(open.reduce((best, a) => (have(a) < have(best) ? a : best))).shift());
  }
  return picked;
}

/** The packet text. Only the run's own output (diff, gate lines) is anonymized; the ticket text is the same for every run.
 *  Harness-workflow files (COMMIT_MSG_<n>.txt) leave the diff whole. */
export function buildPacket({ id, ticket, body, diff, gates, ctx }) {
  const fails = anonymize(gates.filter((g) => g.rc !== 0 && g.excerpt).map((g) => `[${g.name}]\n${g.excerpt}`).join('\n'), ctx);
  const cleanDiff = anonymize(dropFiles(diff), ctx);
  const left = [...leaks(fails, ctx), ...leaks(cleanDiff, ctx)];
  if (left.length) throw new Error(`packet ${id} still identifies its arm: ${left.map((l) => `${l.pattern} (${l.sample})`).join(', ')}`);
  const boxes = doneWhen(body).map((b, i) => `${i + 1}. ${b}`);
  return [
    `# Grading packet ${id}`,
    '',
    `Ticket: ${basename(ticket.path)}#${ticket.issue}: ${ticket.title}`,
    '',
    '## How to grade',
    '',
    RUBRIC,
    '',
    '## Done when',
    '',
    ...boxes,
    '',
    "## Gates (the repo's own, run after the session)",
    '',
    '| gate | rc |',
    '|---|---|',
    ...gates.map((g) => `| ${g.name} | ${g.rc} |`),
    '',
    ...(fails.trim() ? ['### Gate failure lines', '', '```text', fails.trim(), '```', ''] : []),
    '## The changes (diff against the tree the session started from)',
    '',
    '```diff',
    cleanDiff.trimEnd() || '(empty: the run changed nothing)',
    '```',
    '',
  ].join('\n');
}

/** The grade.json a grader fills in. */
export function gradeTemplate(id, ticketId, boxes) {
  return {
    packet: id,
    ticket: ticketId,
    boxes: boxes.map((text, i) => ({ n: i + 1, text, verdict: null, evidence: '' })),
    quality: { score: null, note: '' },
  };
}

/** Why a run is left out of grading, or null. A run that reached the real workspace, config or temp is
 *  evidence for neither arm. A round-3 result's entries name no source; theirs was the transcripts. */
export function exclusionReason(result) {
  const found = result.contamination ?? [];
  return found.length ? `contaminated: ${found.map((x) => `${x.label} ${x.count}x in ${x.source ?? 'transcripts'}`).join(', ')}` : null;
}

/** Failure-looking lines of a gate log, capped like qa.mjs's console summary. */
const excerptOf = (text) => text.split(/\r?\n/).filter((l) => /(fail|error|✕|×|✗)/i.test(l)).slice(0, 40).join('\n');

if (isMain(import.meta.url)) main();

function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = args.out || DEFAULT_OUT;
  const manifest = loadManifest(args.manifest || join(AB_DIR, 'manifest.json'));
  const keyFile = join(out, 'blind-key.json');
  const key = JSON.parse(readIfExists(keyFile) ?? 'null') ?? { salt: randomBytes(16).toString('hex'), packets: {} };
  const runsDir = join(out, 'runs');
  if (!existsSync(runsDir)) die(`no runs under ${runsDir}`);
  const home = homedir();
  const workspace = workspaceRoot();
  let written = 0;
  key.excluded = [];
  key.held = [];
  key.second ??= {};
  const eligible = [];
  const writePacket = (slot, id, run, packet, ticket) => {
    key[slot.key][id] = run;
    const pdir = join(out, slot.dir, id);
    mkdirSync(pdir, { recursive: true });
    writeFileSync(join(pdir, 'packet.md'), packet);
    const gradeFile = join(pdir, 'grade.json');
    if (!existsSync(gradeFile)) writeFileSync(gradeFile, `${JSON.stringify(gradeTemplate(id, ticket.id, doneWhen(ticket.body)), null, 2)}\n`);
  };
  for (const ticket of manifest.tickets) {
    const dir = join(runsDir, ticket.id);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const runDir = join(dir, name);
      const result = readResult(join(runDir, 'result.json'));
      if (!result) continue;
      const run = { ticket: ticket.id, arm: result.arm, run: result.run };
      const excluded = exclusionReason(result);
      if (excluded) {
        key.excluded.push({ ...run, reason: excluded });
        continue;
      }
      const id = blindId(key.salt, ticket.id, result.arm, result.run);
      const roots = [
        { path: result.checkout, label: '<repo>' },
        { path: result.roundRoot, label: '<home>' },
        { path: tmpdir(), label: '<local>' },
        { path: workspace, label: '<local>' },
        { path: home, label: '<local>' },
      ].filter((r) => r.path);
      const gates = result.gates.map((g) => ({ name: g.name, rc: g.rc, excerpt: g.rc === 0 ? '' : excerptOf(readIfExists(join(runDir, `gate-${g.name}.log`)) ?? '') }));
      const diff = readIfExists(join(runDir, 'diff.patch')) ?? '';
      const build = (pid) => buildPacket({ id: pid, ticket, body: ticket.body, diff, gates, ctx: { roots, tmp: tmpdir() } });
      let packet;
      try {
        packet = build(id);
      } catch (e) {
        key.held.push({ ...run, reason: e.message });
        log(`held ${ticket.id} ${name}: ${e.message}`);
        continue;
      }
      writePacket(GRADE_SLOTS[0], id, run, packet, ticket);
      const second = blindId(key.salt, ticket.id, result.arm, result.run, 'second');
      writePacket(GRADE_SLOTS[1], second, run, build(second), ticket);
      eligible.push({ run, build, ticket });
      written++;
    }
  }
  const sample = userSample(eligible.map((e) => e.run), key.salt, USER_SAMPLE, Object.values(key.user ?? {}));
  key.user = {};
  for (const run of sample) {
    const e = eligible.find((x) => sameRun(run)(x.run));
    const id = blindId(key.salt, run.ticket, run.arm, run.run, 'user');
    writePacket(GRADE_SLOTS[2], id, run, e.build(id), e.ticket);
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(keyFile, `${JSON.stringify(key, null, 2)}\n`);
  // Per arm, so attrition that hits one arm harder shows.
  const byArm = (list) => ARMS.map((a) => `${a} ${list.filter((x) => x.arm === a).length}`).join(', ');
  log(`${written} packet(s) in ${join(out, 'packets')}; excluded as contaminated: ${byArm(key.excluded)}; held as still identifying their arm: ${byArm(key.held)} (reasons in the key); the arm key is ${keyFile} (never hand it to a grader)`);
  const short = sample.length < USER_SAMPLE ? ` (short of ${USER_SAMPLE}: only ${eligible.length} gradable run(s))` : '';
  log(`second grader: ${written} packet(s) in ${join(out, GRADE_SLOTS[1].dir)}; user sample: ${sample.length} packet(s) in ${join(out, GRADE_SLOTS[2].dir)}${short}. Give each slot's packets to its own fresh grader; results.mjs joins the grades`);
}
