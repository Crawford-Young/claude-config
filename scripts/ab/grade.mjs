#!/usr/bin/env node
// grade.mjs: blind grading packets for the #271 A/B (the grading itself is a later, cleared live round).
//
//   node scripts/ab/grade.mjs [--out <dir>] [--manifest <file>]
//
// For each finished run under <out>/runs/<ticket>/<arm>-r<n>/ (result.json, diff.patch, gate-*.log),
// writes <out>/packets/<id>/packet.md (rubric, Done-when, gate rcs, anonymized failure lines and diff)
// and an unfilled grade.json. <id> is a salted hash, so a packet never names its arm; the mapping
// lives in <out>/blind-key.json, outside the packets dir. Hand a grader the packets dir only.
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

const AB_DIR = dirname(fileURLToPath(import.meta.url));
const RUBRIC = readFileSync(join(AB_DIR, 'RUBRIC.md'), 'utf8').trim();

/** A run's packet id: stable for one salt, unguessable without it. */
export function blindId(salt, ticketId, arm, run) {
  return createHash('sha256').update(`${salt}|${ticketId}|${arm}|${run}`).digest('hex').slice(0, 8);
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
      let packet;
      try {
        packet = buildPacket({ id, ticket, body: ticket.body, diff: readIfExists(join(runDir, 'diff.patch')) ?? '', gates, ctx: { roots, tmp: tmpdir() } });
      } catch (e) {
        key.held.push({ ...run, reason: e.message });
        log(`held ${ticket.id} ${name}: ${e.message}`);
        continue;
      }
      key.packets[id] = run;
      const pdir = join(out, 'packets', id);
      mkdirSync(pdir, { recursive: true });
      writeFileSync(join(pdir, 'packet.md'), packet);
      const gradeFile = join(pdir, 'grade.json');
      if (!existsSync(gradeFile)) writeFileSync(gradeFile, `${JSON.stringify(gradeTemplate(id, ticket.id, doneWhen(ticket.body)), null, 2)}\n`);
      written++;
    }
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(keyFile, `${JSON.stringify(key, null, 2)}\n`);
  // Per arm, so attrition that hits one arm harder shows.
  const byArm = (list) => ARMS.map((a) => `${a} ${list.filter((x) => x.arm === a).length}`).join(', ');
  log(`${written} packet(s) in ${join(out, 'packets')}; excluded as contaminated: ${byArm(key.excluded)}; held as still identifying their arm: ${byArm(key.held)} (reasons in the key); the arm key is ${keyFile} (never hand it to a grader)`);
}
