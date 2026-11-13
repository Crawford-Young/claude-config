// node --test scripts/test/ab-results.test.mjs
// #375 A/B results: grade.mjs writes every packet twice (two separate graders) and a blind user
// sample; results.mjs unblinds the grades and writes the paired per-ticket comparison. The
// end-to-end tests run both scripts on the committed fixture (fixtures/ab-results.json), with
// expectations worked out by hand from its numbers. No model runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnHarness, tempDir } from './_spawn.mjs';
import { GRADE_SLOTS, USER_SAMPLE, blindId, userSample } from '../ab/grade.mjs';
import { cpSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import * as resultsLib from '../ab/results-lib.mjs';
import { KAPPA_MIN, bootstrapMean, bootstrapPairDiff, claudeLaunches, gradeAgreement, kappa, median, rng, runFlags, summarize, transcriptTokens } from '../ab/results-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const AB = join(HERE, '..', 'ab');
const GRADE = join(AB, 'grade.mjs');
const RESULTS = join(AB, 'results.mjs');
const FIXTURE = JSON.parse(readFileSync(join(HERE, 'fixtures', 'ab-results.json'), 'utf8'));
const near = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 1e-9, `${msg}: ${actual} != ${expected}`);

function put(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}
const sha = (c) => c.repeat(40);
const VERDICT = { P: 'pass', F: 'fail', U: 'unverifiable' };

/** The fixture as a results dir: manifest + tickets, and runs/<ticket>/<arm>-r<n>/ shaped like run.mjs's. */
function buildOut(out) {
  const m = join(out, 'm');
  put(join(m, 'manifest.json'), JSON.stringify({
    model: 'claude-opus-5-5', effort: 'high', permissionMode: 'auto', runsPerArm: 2, prior: { usdPerRun: 1, turnsPerRun: 10 },
    tickets: FIXTURE.tickets.map((t) => ({ id: t.id, path: 'claude-config', issue: t.issue, title: t.title, spawnExpected: t.spawnExpected, parent: sha('a'), merge: sha('b'), harness: sha('a'), lines: 10, gates: [{ name: 'test', cmd: 'x' }, { name: 'frontmatter', cmd: 'y' }] })),
  }));
  for (const t of FIXTURE.tickets) put(join(m, 'tickets', `${t.id}.md`), `# ${t.title}\n\n## Done when\n${t.boxes.map((b) => `- [ ] ${b}`).join('\n')}\n`);
  FIXTURE.runs.forEach((r, i) => {
    const dir = join(out, 'runs', r.ticket, `${r.arm}-r${r.run}`);
    put(join(dir, 'prompt.md'), 'the prompt\n');
    if (r.noResult) return;
    const roundId = `f${String(i).padStart(7, '0')}`;
    const roundRoot = join(out, 'tmp', 'ab', roundId);
    const ok = !r.timedOut;
    const result = {
      ticket: r.ticket, arm: r.arm, run: r.run, roundId, roundRoot, checkout: join(roundRoot, 'code', '.worktrees', 'claude-config-1'),
      parent: sha('a'), harness: r.arm === 'bare' ? null : sha('a'), command: ['claude', '-p'], startedAt: '2026-10-21T23:21:28.048Z', wallMs: r.wallS * 1000,
      claude: ok
        ? { ok: true, subtype: r.subtype ?? 'success', isError: Boolean(r.subtype), costUsd: r.cost, turns: r.turns, durationMs: r.wallS * 1000 - 500, sessionId: `s-${i}`, result: 'done', exit: r.subtype ? 1 : 0, timedOut: false }
        : { ok: false, subtype: null, isError: true, costUsd: null, turns: null, durationMs: null, sessionId: null, result: null, exit: null, timedOut: true },
      baseline: { tree: sha('c'), changedFromParent: 0 },
      diffStat: { files: 1, insertions: 1, deletions: 0 },
      gates: ['test', 'frontmatter'].map((name, g) => ({ name, cmd: 'x', exit: r.gates[g], rc: r.gates[g], reason: null })),
      contamination: r.contaminated ? [{ source: 'tool inputs', label: 'workspace', count: 2, paths: ['C:/x'] }] : [],
      contaminationExplained: [],
      estimate: { usd: 1, turns: 10, basis: 'prior', budgetUsd: 8 },
      tokenRedactions: 0,
      // run.mjs's #374 block; the fixture gives [spawned, cost share].
      ...(r.subagents && { subagents: { spawned: r.subagents[0], models: [], tokens: { subagent: 0, total: 0, share: null }, costUsd: { subagent: 0, total: r.cost, share: r.subagents[1] }, reportedSpawned: r.subagents[0], notes: [] } }),
    };
    put(join(dir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    put(join(dir, 'diff.patch'), `diff --git a/f.txt b/f.txt\n+fixed ${r.ticket}\n${r.held ? '+**What:** a commit template line\n' : ''}`);
    for (const g of result.gates) put(join(dir, `gate-${g.name}.log`), g.rc ? 'FAIL one test\n' : 'ok\n');
    const [input, output, cacheRead, cacheWrite] = r.tokens;
    const usage = { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite };
    const project = join(dir, 'transcripts', `C--fixture-ab-${roundId}`);
    // One assistant message carried on two content-block lines (same id, same usage), as Claude Code writes it.
    put(join(project, `s-${i}.jsonl`), [
      { type: 'user', message: { role: 'user', content: 'the prompt' } },
      { type: 'assistant', requestId: `req-${i}`, message: { id: `msg-${i}`, usage, content: [{ type: 'thinking' }] } },
      { type: 'assistant', requestId: `req-${i}`, message: { id: `msg-${i}`, usage, content: [{ type: 'text', text: 'done' }] } },
      ...(r.nestedClaude ? [{ type: 'assistant', message: { content: [{ type: 'tool_use', id: `tu-${i}`, name: 'Bash', input: { command: r.nestedClaude } }] } }] : []),
    ].map((l) => JSON.stringify(l)).join('\n'));
    put(join(project, `s-${i}`, 'subagents', 'agent-1.jsonl'), JSON.stringify({ type: 'assistant', isSidechain: true, requestId: `sub-${i}`, message: { id: `sub-${i}`, usage: { input_tokens: 0, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }));
  });
  return join(m, 'manifest.json');
}

const specOf = (run) => FIXTURE.runs.find((r) => r.ticket === run.ticket && r.arm === run.arm && r.run === run.run);
const slotDir = (out, slot, id) => join(out, GRADE_SLOTS.find((s) => s.name === slot).dir, id);

/** Fill every grade.json the key names from the fixture's grades (the user's grade is the first grader's). */
function fillGrades(out, { second, skipUser = 0 } = {}) {
  const key = JSON.parse(readFileSync(join(out, 'blind-key.json'), 'utf8'));
  for (const slot of GRADE_SLOTS) {
    let skipped = 0;
    for (const [id, run] of Object.entries(key[slot.key])) {
      if (slot.name === 'user' && skipped++ < skipUser) continue;
      const file = join(slotDir(out, slot.name, id), 'grade.json');
      const grade = JSON.parse(readFileSync(file, 'utf8'));
      const spec = specOf(run).grades;
      const [letters, score] = slot.name === 'second' && second ? second(spec.second) : spec[slot.name === 'user' ? 'first' : slot.name];
      grade.boxes.forEach((b, n) => Object.assign(b, { verdict: VERDICT[letters[n]], evidence: 'fixture' }));
      grade.quality = { score, note: 'fixture' };
      writeFileSync(file, JSON.stringify(grade));
    }
  }
  return key;
}

function gradedOut(prefix) {
  const out = tempDir(prefix);
  const manifest = buildOut(out);
  put(join(out, 'blind-key.json'), JSON.stringify({ salt: 'fixture-salt', packets: {} }));
  const g = spawnHarness(GRADE, ['--out', out, '--manifest', manifest]);
  assert.equal(g.status, 0, g.stderr);
  return { out, manifest, grade: g };
}
const results = (out, args = []) => {
  const r = spawnHarness(RESULTS, ['--out', out, '--manifest', join(out, 'm', 'manifest.json'), '--iterations', '2000', ...args]);
  assert.equal(r.status, 0, r.stderr);
  return { r, json: JSON.parse(readFileSync(join(out, 'results.json'), 'utf8')), md: readFileSync(join(out, 'results.md'), 'utf8') };
};

// ---- the maths ----------------------------------------------------------------------------

test('median and summarize take the middle of the values that exist, with the range', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.deepEqual(summarize([3, null, 1, 2]), { n: 3, median: 2, min: 1, max: 3 });
  assert.equal(summarize([null, undefined]), null);
});

test('rng is a seeded stream: the same seed repeats, another seed differs, every draw is in [0, 1)', () => {
  const a = rng(7);
  const b = rng(7);
  const c = rng(8);
  const xs = Array.from({ length: 50 }, () => a());
  assert.deepEqual(Array.from({ length: 50 }, () => b()), xs);
  assert.notDeepEqual(Array.from({ length: 50 }, () => c()), xs);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});

test('bootstrapMean resamples tickets: equal diffs give a point interval, and a seed repeats its interval', () => {
  assert.deepEqual(bootstrapMean([0.5, 0.5, 0.5], { iterations: 500, seed: 1 }), { mean: 0.5, lo: 0.5, hi: 0.5 });
  // Three tickets: a resample of all three the same happens 1 time in 27 (3.7%), more than the 2.5% tail,
  // so the 95% percentile interval runs from the smallest diff to the largest.
  const ci = bootstrapMean([0.625, 0, -1], { iterations: 10000, seed: 1 });
  near(ci.mean, -0.125, 'mean');
  assert.deepEqual([ci.lo, ci.hi], [-1, 0.625]);
  assert.deepEqual(bootstrapMean([3, 1, 4, 1, 5, 9, 2, 6], { iterations: 1000, seed: 3 }), bootstrapMean([3, 1, 4, 1, 5, 9, 2, 6], { iterations: 1000, seed: 3 }));
  assert.equal(bootstrapMean([], { iterations: 10, seed: 1 }), null);
});

test('bootstrapPairDiff is the difference of medians, with runs resampled within each arm', () => {
  assert.deepEqual(bootstrapPairDiff([1], [3], { iterations: 200, seed: 1 }), { d: -2, lo: -2, hi: -2 }, 'one run a side: the interval is the point');
  const r = bootstrapPairDiff([1, 2], [0], { iterations: 4000, seed: 1 });
  assert.equal(r.d, 1.5);
  assert.deepEqual([r.lo, r.hi], [1, 2], 'a resample of [1, 2] has median 1, 1.5 or 2');
});

test("kappa is Cohen's: raw agreement corrected for the agreement chance alone would give", () => {
  // Rater 1: 3 pass, 1 fail; rater 2: 2 and 2. po = 3/4, pe = 3/4*2/4 + 1/4*2/4 = 1/2, kappa = (3/4 - 1/2) / (1/2) = 1/2.
  assert.deepEqual(kappa([['pass', 'pass'], ['fail', 'fail'], ['pass', 'fail'], ['pass', 'pass']]), { n: 4, agreement: 0.75, kappa: 0.5 });
  assert.deepEqual(kappa([['pass', 'pass'], ['pass', 'pass']]), { n: 2, agreement: 1, kappa: 1 }, 'one category, full agreement');
  assert.deepEqual(kappa([['pass', 'fail'], ['fail', 'pass']]), { n: 2, agreement: 0, kappa: -1 });
  assert.equal(kappa([]), null);
});

test('transcriptTokens sums each API message once across the main and subagent transcripts', () => {
  const u = (i, o, r, w) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: r, cache_creation_input_tokens: w });
  const main = [
    { type: 'assistant', message: { id: 'm1', usage: u(2, 100, 1000, 50) } },
    { type: 'assistant', message: { id: 'm1', usage: u(2, 100, 1000, 50) } },
    { type: 'user', message: { content: 'x' } },
    { type: 'assistant', message: { id: 'm2', usage: u(1, 20, 2000, 0) } },
  ].map((l) => JSON.stringify(l)).join('\n');
  const sub = `${JSON.stringify({ type: 'assistant', isSidechain: true, message: { id: 's1', usage: u(5, 7, 0, 9) } })}\nnot json\n`;
  assert.deepEqual(transcriptTokens([main, sub]), { inputTokens: 8, outputTokens: 127, cacheReadTokens: 3000, cacheWriteTokens: 59 });
  assert.equal(transcriptTokens([]), null, 'no transcripts: unknown, not zero');
});

test('runFlags names a run the runner killed and one the spend cap stopped', () => {
  assert.deepEqual(runFlags({ claude: { timedOut: true, ok: false } }), { timedOut: true, budgetCapped: false });
  assert.deepEqual(runFlags({ claude: { subtype: 'error_max_budget_usd', costUsd: 7.9 }, estimate: { budgetUsd: 8 } }), { timedOut: false, budgetCapped: true });
  assert.deepEqual(runFlags({ claude: { subtype: 'success', costUsd: 8.01 }, estimate: { budgetUsd: 8 } }), { timedOut: false, budgetCapped: true }, 'spent at or over the cap');
  assert.deepEqual(runFlags({ claude: { subtype: 'success', costUsd: 1 }, estimate: { budgetUsd: 8 } }), { timedOut: false, budgetCapped: false });
});

const g = (verdicts, score = 3) => ({ boxes: verdicts.split('').map((c, i) => ({ n: i + 1, verdict: VERDICT[c] })), quality: { score } });

test('gradeAgreement withholds quality below the kappa floor, or with fewer than 10 user grades', () => {
  const runs = Array.from({ length: 10 }, (_, i) => ({ ticket: `t-${i}`, arm: i % 2 ? 'a' : 'b', run: 1, grades: { first: g(i % 3 ? 'PF' : 'PP'), second: g(i % 3 ? 'PF' : 'PP'), user: g(i % 3 ? 'PF' : 'PP') } }));
  const ok = gradeAgreement(runs);
  assert.equal(ok.qualityReported, true);
  assert.deepEqual([ok.graders.packets, ok.graders.n, ok.graders.kappa, ok.user.packets, ok.user.n], [10, 20, 1, 10, 40]);
  assert.equal(KAPPA_MIN, 0.6);

  const split = runs.map((r, i) => ({ ...r, grades: { ...r.grades, second: g(i % 2 ? 'FP' : 'PF') } }));
  const low = gradeAgreement(split);
  assert.equal(low.qualityReported, false);
  assert.ok(low.graders.kappa < KAPPA_MIN);
  assert.match(low.withheld.join('\n'), /graders agree at kappa -?\d\.\d\d, under 0\.60/);

  const fewUser = runs.map((r, i) => (i < 2 ? { ...r, grades: { ...r.grades, user: { ...g('PP'), quality: { score: null } } } } : r));
  const few = gradeAgreement(fewUser);
  assert.equal(few.qualityReported, false);
  assert.match(few.withheld.join('\n'), /the user graded 8 of the 10 sample packets/);
  assert.deepEqual(few.ungraded.map((u) => [u.ticket, u.slot]), [['t-0', 'user'], ['t-1', 'user']]);

  assert.match(gradeAgreement([]).withheld.join('\n'), /no packet is graded by both graders/);
});

// ---- grade.mjs: two graders and a user sample ---------------------------------------------

test('blindId gives each grading slot its own id, and the first keeps the original one', () => {
  assert.equal(blindId('s', 't-1', 'bare', 1, 'first'), blindId('s', 't-1', 'bare', 1));
  const ids = GRADE_SLOTS.map((s) => blindId('s', 't-1', 'bare', 1, s.name));
  assert.equal(new Set(ids).size, 3);
});

test('userSample picks 10 runs balanced across arms, repeats under a salt, and keeps an earlier pick', () => {
  const runs = [];
  for (const arm of ['bare', 'current', 'solo']) for (let i = 1; i <= (arm === 'solo' ? 3 : 6); i++) runs.push({ ticket: `t-${i}`, arm, run: 1 });
  const s = userSample(runs, 'salt');
  assert.equal(USER_SAMPLE, 10);
  assert.equal(s.length, 10);
  const per = (list) => Object.fromEntries(['bare', 'current', 'solo'].map((a) => [a, list.filter((r) => r.arm === a).length]));
  assert.deepEqual(per(s), { bare: 4, current: 3, solo: 3 });
  assert.deepEqual(userSample(runs, 'salt'), s);
  const kept = [runs[5], runs[11]];
  const again = userSample(runs, 'other-salt', 10, kept);
  assert.ok(kept.every((k) => again.some((r) => r.ticket === k.ticket && r.arm === k.arm)), 'an earlier pick stays');
  assert.equal(again.length, 10);
  assert.equal(userSample(runs.slice(0, 4), 'salt').length, 4, 'fewer runs than the sample: all of them');
});

test('grade.mjs writes every packet for two separate graders and a blind user sample, each in its own dir with its own ids', () => {
  const { out, manifest, grade } = gradedOut('ab-grade-');
  // 16 run dirs: one crashed (no result), one excluded, one held -> 13 packets per grader.
  assert.match(grade.stdout, /13 packet\(s\) in .*; excluded as contaminated: bare 1, current 0, solo 0, unit 0; held as still identifying their arm: bare 0, current 1, solo 0, unit 0/);
  assert.match(grade.stdout, /second grader: 13 packet\(s\) in .*packets-second; user sample: 10 packet\(s\) in .*packets-user/);
  const key = JSON.parse(readFileSync(join(out, 'blind-key.json'), 'utf8'));
  const runKey = (r) => `${r.ticket}/${r.arm}/${r.run}`;
  assert.deepEqual(Object.values(key.packets).map(runKey).sort(), Object.values(key.second).map(runKey).sort(), 'the second grader gets the same runs');
  const all = [...Object.keys(key.packets), ...Object.keys(key.second), ...Object.keys(key.user)];
  assert.equal(new Set(all).size, 13 + 13 + 10, 'no id repeats across slots');
  for (const slot of GRADE_SLOTS) {
    const dirs = readdirSync(join(out, slot.dir));
    assert.deepEqual(dirs.sort(), Object.keys(key[slot.key]).sort(), slot.name);
    for (const id of dirs) {
      const packet = readFileSync(join(out, slot.dir, id, 'packet.md'), 'utf8');
      assert.match(packet, new RegExp(`^# Grading packet ${id}`));
      assert.doesNotMatch(packet, /bare|current|solo/i);
    }
  }
  const perArm = Object.values(key.user).reduce((m, r) => ({ ...m, [r.arm]: (m[r.arm] ?? 0) + 1 }), {});
  assert.deepEqual(perArm, { bare: 4, current: 3, solo: 3 });

  // A re-run keeps the sample and never overwrites a filled grade.
  const firstUser = Object.keys(key.user)[0];
  const file = join(out, 'packets-user', firstUser, 'grade.json');
  writeFileSync(file, JSON.stringify({ filled: true }));
  const again = spawnHarness(GRADE, ['--out', out, '--manifest', manifest]);
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'blind-key.json'), 'utf8')).user, key.user);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { filled: true });
});

// ---- results.mjs on the fixture -----------------------------------------------------------

test('results.mjs unblinds the grades into one row per ticket, each arm as the median of its runs with the range', () => {
  const { out } = gradedOut('ab-results-');
  fillGrades(out);
  const { r, json, md } = results(out);
  assert.match(r.stdout, /results\.md/);
  assert.deepEqual(json.arms, ['bare', 'current', 'solo']);
  assert.deepEqual(json.tickets.map((t) => t.ticket), ['t-1', 't-2', 't-3']);
  const cell = (ticket, arm, metric) => json.tickets.find((t) => t.ticket === ticket).arms[arm][metric];
  // Pass rate per run: the mean of both graders' pass fractions (unverifiable is not a pass).
  assert.deepEqual(cell('t-1', 'bare', 'passRate'), { n: 2, median: 0.25, min: 0, max: 0.5 });
  assert.deepEqual(cell('t-1', 'current', 'passRate'), { n: 2, median: 0.875, min: 0.75, max: 1 });
  assert.deepEqual(cell('t-3', 'current', 'passRate'), { n: 1, median: 0, min: 0, max: 0 }, 'the held run has no grade');
  assert.deepEqual(cell('t-1', 'current', 'quality'), { n: 2, median: 4.25, min: 4, max: 4.5 });
  assert.deepEqual(cell('t-1', 'bare', 'gates'), { n: 2, median: 0.5, min: 0, max: 1, green: 1 });
  // Run-side metrics: a held run counts, an excluded one doesn't, a timed-out run has no cost or turns.
  near(cell('t-3', 'current', 'costUsd').median, 4.775, 't-3 current cost (8.05 capped, 1.5 held)');
  assert.deepEqual(cell('t-3', 'bare', 'costUsd'), { n: 1, median: 0.9, min: 0.9, max: 0.9 }, 'the contaminated run is dropped');
  assert.deepEqual(cell('t-2', 'bare', 'costUsd'), { n: 1, median: 0.5, min: 0.5, max: 0.5 });
  assert.deepEqual(cell('t-2', 'bare', 'wallMs'), { n: 2, median: 3625000, min: 50000, max: 7200000 });
  assert.deepEqual(cell('t-1', 'bare', 'outputTokens'), { n: 2, median: 1110, min: 1010, max: 1210 }, 'main + subagent, each message once');
  assert.deepEqual(cell('t-1', 'bare', 'cacheReadTokens'), { n: 2, median: 11000, min: 10000, max: 12000 });
  assert.deepEqual(cell('t-2', 'bare', 'outputTokens'), { n: 2, median: 1760, min: 510, max: 3010 }, 'the timed-out run still has transcripts');

  assert.match(md, /^# A\/B results/m);
  assert.match(md, /\| ticket \|/);
  for (const t of ['t-1', 't-2', 't-3']) assert.match(md, new RegExp(`^\\| ${t} \\|`, 'm'), `one row for ${t}`);
  assert.match(md, /bare 0\.25 \(0\.00–0\.50\)/);
  assert.match(md, /bare 1\/2 green/);
});

test('results.mjs gives the paired difference per ticket and per metric (current minus bare) with a bootstrap interval and won / tied / lost', () => {
  const { out } = gradedOut('ab-paired-');
  fillGrades(out);
  const { json, md } = results(out);
  const [pair] = json.pairs;
  assert.deepEqual([pair.a, pair.b], ['current', 'bare']);
  const pr = pair.metrics.passRate;
  assert.deepEqual(pr.perTicket.map((t) => [t.ticket, t.d, t.outcome]), [['t-1', 0.625, 'won'], ['t-2', 0, 'tied'], ['t-3', -1, 'lost']]);
  near(pr.mean, -0.125, 'mean pass-rate diff');
  assert.deepEqual([pr.lo, pr.hi, pr.won, pr.tied, pr.lost, pr.tickets], [-1, 0.625, 1, 1, 1, 3]);
  const cost = pair.metrics.costUsd;
  assert.deepEqual(cost.perTicket.map((t) => t.outcome), ['won', 'lost', 'lost'], 'lower cost wins');
  near(cost.mean, (-0.2 + 0.15 + 3.875) / 3, 'mean cost diff');
  assert.deepEqual(pair.metrics.wallMs.perTicket.map((t) => [t.d, t.outcome]), [[-10000, 'won'], [-3560000, 'won'], [295000, 'lost']]);
  assert.deepEqual(pair.metrics.gates.perTicket.map((t) => t.outcome), ['won', 'tied', 'lost']);
  near(pair.metrics.quality.mean, -1 / 3, 'mean quality diff');
  for (const m of Object.values(pair.metrics)) for (const t of m.perTicket) assert.ok(t.lo <= t.d && t.d <= t.hi, `${t.ticket}: ${t.lo} <= ${t.d} <= ${t.hi}`);
  assert.match(md, /^## current − bare/m);
  assert.match(md, /\| Done-when pass rate \| 3 \| -0\.13 \[-1\.00, 0\.63\] \| 1 \/ 1 \/ 1 \|/);

  // Any two named arms, deterministic under a seed.
  const solo = results(out, ['--pair', 'solo:bare,current:solo', '--seed', '5']);
  // #374: a pair with solo is reported over all tickets, then over the spawn-expected ones (t-1, t-3).
  assert.deepEqual(solo.json.pairs.map((p) => [p.a, p.b, p.scope]), [['solo', 'bare', 'all'], ['solo', 'bare', 'spawn-expected'], ['current', 'solo', 'all'], ['current', 'solo', 'spawn-expected']]);
  assert.deepEqual(solo.json.pairs[0].metrics.passRate.perTicket.map((t) => t.d), [0.75, 0, 0]);
  assert.deepEqual(solo.json.pairs[1].metrics.passRate.perTicket.map((t) => [t.ticket, t.d]), [['t-1', 0.75], ['t-3', 0]]);
  assert.deepEqual(results(out, ['--pair', 'solo:bare,current:solo', '--seed', '5']).json.pairs, solo.json.pairs);
  const bad = spawnHarness(RESULTS, ['--out', out, '--pair', 'current:nope']);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /no runs for arm nope \(arms: bare, current, solo\)/);
});

test('results.mjs reports grader agreement, and withholds quality when graders disagree or the user sample is short', () => {
  const { out } = gradedOut('ab-agree-');
  fillGrades(out);
  const ok = results(out).json.agreement;
  // 13 double-graded packets x 2 boxes; one disagreement (t-1 current r2, box 2: pass vs unverifiable).
  // Grader 1: 16 pass, 10 fail; grader 2: 15 pass, 10 fail, 1 unverifiable.
  // po = 25/26, pe = (16*15 + 10*10) / 26^2 = 340/676, kappa = (650 - 340) / (676 - 340) = 310/336.
  assert.deepEqual([ok.graders.packets, ok.graders.n], [13, 26]);
  near(ok.graders.agreement, 25 / 26, 'grader agreement');
  near(ok.graders.kappa, 310 / 336, 'grader kappa');
  assert.equal(ok.user.packets, 10);
  assert.ok(ok.user.kappa >= KAPPA_MIN);
  assert.equal(ok.qualityReported, true);

  // The second grader flips every verdict: kappa falls below the floor and quality is withheld.
  const flip = { P: 'F', F: 'P', U: 'U' };
  fillGrades(out, { second: ([v, q]) => [v.split('').map((c) => flip[c]).join(''), q] });
  const low = results(out);
  assert.equal(low.json.agreement.qualityReported, false);
  assert.equal(low.json.tickets[0].arms.bare.quality, null);
  assert.equal(low.json.pairs[0].metrics.quality, undefined);
  assert.match(low.json.pairs[0].withheld, /quality/);
  assert.match(low.md, /Quality scores are withheld/);
  assert.match(low.md, /graders agree at kappa -\d\.\d\d, under 0\.60/);
  assert.doesNotMatch(low.md, /\| quality \(1-5\) \| \d/);

  // Graders agree again, but the user graded only 9 of the 10.
  fillGrades(out);
  const key = JSON.parse(readFileSync(join(out, 'blind-key.json'), 'utf8'));
  const [skip] = Object.keys(key.user);
  const file = join(out, 'packets-user', skip, 'grade.json');
  const blank = JSON.parse(readFileSync(file, 'utf8'));
  blank.boxes.forEach((b) => (b.verdict = null));
  writeFileSync(file, JSON.stringify(blank));
  const short = results(out).json.agreement;
  assert.equal(short.qualityReported, false);
  assert.match(short.withheld.join('\n'), /the user graded 9 of the 10 sample packets/);
});

test('results.mjs lists every excluded, held, timed-out, budget-capped and resultless run per arm', () => {
  const { out } = gradedOut('ab-left-');
  fillGrades(out);
  const { json, md } = results(out);
  const list = (arm) => json.leftOut[arm].map((x) => `${x.ticket} r${x.run} ${x.kind}`);
  assert.deepEqual(list('bare'), ['t-2 r2 timed out', 't-3 r2 excluded']);
  assert.deepEqual(list('current'), ['t-3 r1 budget-capped', 't-3 r2 held', 't-3 r3 no result']);
  // #374: a claude launched from the session's Bash escapes solo and the subagent metrics, so it is flagged.
  assert.deepEqual(list('solo'), ['t-2 r1 nested claude']);
  assert.match(json.leftOut.solo[0].reason, /^Bash ran claude: cd sub && claude -p "finish the ticket"$/);
  assert.match(json.leftOut.bare[1].reason, /^contaminated: workspace 2x in tool inputs/);
  assert.match(json.leftOut.current[1].reason, /commit-body vocabulary/);
  assert.match(md, /^## Runs left out or flagged, per arm/m);
  assert.match(md, /^### bare: 2$/m);
  assert.match(md, /^- t-3 r2 excluded \(dropped from every metric\): contaminated/m);
  assert.match(md, /^- t-3 r2 held \(no grade; run-side metrics count\)/m);
  assert.match(md, /^### solo: 1$/m);
  assert.match(md, /^- t-2 r1 nested claude \(counts; a nested claude escapes the solo arm and the subagent metrics\)/m);
});

test('#374: with a solo arm the default pairs are current:bare and current:solo, and current:solo is reported again over the spawn-expected tickets', () => {
  const { out } = gradedOut('ab-solo-pairs-');
  fillGrades(out);
  const { json, md } = results(out);
  assert.deepEqual(json.pairs.map((p) => [p.a, p.b, p.scope]), [['current', 'bare', 'all'], ['current', 'solo', 'all'], ['current', 'solo', 'spawn-expected']]);
  const [, all, spawn] = json.pairs;
  // current pass rate: t-1 median(1, 0.75) = 0.875, t-2 median(1, 0) = 0.5, t-3 0 (r2 held); solo: 1, 0.5, 1.
  assert.deepEqual(all.metrics.passRate.perTicket.map((t) => [t.ticket, t.d]), [['t-1', -0.125], ['t-2', 0], ['t-3', -1]]);
  assert.deepEqual(spawn.tickets, ['t-1', 't-3']);
  assert.deepEqual(spawn.metrics.passRate.perTicket.map((t) => t.ticket), ['t-1', 't-3']);
  near(spawn.metrics.passRate.mean, -0.5625, 'spawn-expected mean');
  assert.match(md, /^## current − solo$/m);
  assert.match(md, /^## current − solo, spawn-expected tickets only \(t-1, t-3\)$/m);
});

test('#385: defaultPairs is current:bare, then current:solo with solo, unit:solo with unit and solo, unit:current with unit', () => {
  const { defaultPairs } = resultsLib;
  assert.equal(typeof defaultPairs, 'function');
  assert.deepEqual(defaultPairs(['bare', 'current']), [['current', 'bare']]);
  assert.deepEqual(defaultPairs(['bare', 'current', 'solo']), [['current', 'bare'], ['current', 'solo']]);
  assert.deepEqual(defaultPairs(['bare', 'current', 'unit']), [['current', 'bare'], ['unit', 'current']]);
  assert.deepEqual(defaultPairs(['bare', 'current', 'solo', 'unit']), [['current', 'bare'], ['current', 'solo'], ['unit', 'solo'], ['unit', 'current']]);
});

test('#385: with a unit arm the default pairs add unit:solo and unit:current, each over all tickets and again over the spawn-expected ones', () => {
  const out = tempDir('ab-unit-pairs-');
  buildOut(out);
  // The unit runs are the solo run dirs under the unit name, so every unit value equals solo's.
  for (const t of ['t-1', 't-2', 't-3']) {
    const from = join(out, 'runs', t, 'solo-r1');
    const to = join(out, 'runs', t, 'unit-r1');
    cpSync(from, to, { recursive: true });
    const file = join(to, 'result.json');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), arm: 'unit' }));
  }
  const { json, md } = results(out);
  assert.deepEqual(json.arms, ['bare', 'current', 'solo', 'unit']);
  assert.deepEqual(json.pairs.map((p) => [p.a, p.b, p.scope]), [
    ['current', 'bare', 'all'],
    ['current', 'solo', 'all'], ['current', 'solo', 'spawn-expected'],
    ['unit', 'solo', 'all'], ['unit', 'solo', 'spawn-expected'],
    ['unit', 'current', 'all'], ['unit', 'current', 'spawn-expected'],
  ]);
  const unitSolo = json.pairs.filter((p) => p.a === 'unit' && p.b === 'solo');
  assert.deepEqual(unitSolo.map((p) => p.tickets), [['t-1', 't-2', 't-3'], ['t-1', 't-3']]);
  assert.deepEqual(unitSolo[0].metrics.costUsd.perTicket.map((t) => [t.ticket, t.d, t.outcome]), [['t-1', 0, 'tied'], ['t-2', 0, 'tied'], ['t-3', 0, 'tied']]);
  assert.deepEqual(unitSolo[1].metrics.costUsd.perTicket.map((t) => t.ticket), ['t-1', 't-3']);
  assert.match(md, /^## unit − current$/m);
  assert.match(md, /^## unit − current, spawn-expected tickets only \(t-1, t-3\)$/m);
});

test('#374: the per-ticket table shows each run\'s subagents, spawned and share of cost', () => {
  const { out } = gradedOut('ab-subagents-');
  fillGrades(out);
  const { json, md } = results(out);
  const t1 = json.tickets.find((t) => t.ticket === 't-1');
  assert.deepEqual(t1.arms.current.subagents, [{ run: 1, spawned: 2, costShare: 0.31 }, { run: 2, spawned: 0, costShare: 0 }]);
  assert.deepEqual(t1.arms.bare.subagents, [], 'a result without the block shows nothing');
  assert.match(md, /\| subagents \(spawned, \$ share\) \|/);
  assert.match(md, /current r1 2 \(31%\), r2 0 \(0%\)/);
});

test('a ticket missing one arm of a pair is named with the reason, not just a lower count', async () => {
  const { out } = gradedOut('ab-missing-');
  fillGrades(out);
  const dir = join(out, 'runs', 't-2', 'solo-r1');
  await rm(join(dir, 'result.json'));
  let { json, md } = results(out, ['--pair', 'current:solo']);
  assert.deepEqual(json.pairs[0].missing, [{ ticket: 't-2', arm: 'solo', reason: 'no counted solo run: r1 has no result' }]);
  assert.deepEqual(json.pairs[0].metrics.passRate.missing, [{ ticket: 't-2', reason: 'no counted solo run: r1 has no result' }]);
  assert.match(md, /^Not compared: t-2 \(no counted solo run: r1 has no result\)\.$/m);
  await rm(dir, { recursive: true });
  ({ json } = results(out, ['--pair', 'current:solo']));
  assert.deepEqual(json.pairs[0].missing, [{ ticket: 't-2', arm: 'solo', reason: 'no solo run' }]);
  assert.deepEqual(results(out, ['--pair', 'current:bare']).json.pairs[0].missing, []);
});

test('claudeLaunches finds a claude started from Bash or PowerShell, not a mention of claude', () => {
  const call = (name, command, id = command) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: { command } }] } });
  const launches = [
    'claude -p "x"',
    'cd a && claude --bg do it',
    '~/.local/bin/claude.exe -p hi',
    'FOO=1 claude -p',
    'npx @anthropic-ai/claude-code -p go',
  ];
  // The last: round 1's sed that edits a comment naming the `claude -n` launch line (a markdown code span).
  const quiet = ['git log --grep claude', 'ls ~/.claude', 'cat claude-config/x.md', 'echo claude', 'node scripts/claude.mjs', 'sed -i "s|^// prints the `claude -n` launch line|x|" a.mjs'];
  const text = [...launches.map((c) => call('Bash', c)), call('PowerShell', '& "C:\\u\\.local\\bin\\claude.exe" -p x'), ...quiet.map((c) => call('Bash', c)), call('Bash', 'claude -p "x"'), call('Read', 'claude -p')].join('\n');
  assert.deepEqual(claudeLaunches([text]), [...launches, '& "C:\\u\\.local\\bin\\claude.exe" -p x']);
});

test('#380: claudeLaunches also finds a claude started through a wrapper, and stays quiet on a wrapper around something else', () => {
  const call = (name, command) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `${name}:${command}`, name, input: { command } }] } });
  const wrapped = [
    ['Bash', 'bash -c "claude -p x"'],
    ['Bash', "sh -c 'claude -p x'"],
    ['Bash', 'nohup claude -p x &'],
    ['Bash', 'timeout 60 claude -p x'],
    ['PowerShell', 'Start-Process claude -ArgumentList "-p x"'],
    ['PowerShell', 'Start-Process "C:\\u\\.local\\bin\\claude.exe" -ArgumentList "-p x"'],
    ['PowerShell', 'Start-Process -FilePath claude -ArgumentList "-p x"'],
  ];
  const quiet = [
    ['Bash', 'timeout 60 node claude.mjs'],
    ['Bash', 'bash -c "echo claude"'],
    ['Bash', "sh -c 'ls ~/.claude'"],
    ['Bash', 'nohup node scripts/claude.mjs &'],
    ['PowerShell', 'Start-Process notepad claude.txt'],
    ['PowerShell', 'Start-Process node -ArgumentList "claude.mjs"'],
  ];
  for (const [name, command] of wrapped) assert.deepEqual(claudeLaunches([call(name, command)]), [command], `flags: ${command}`);
  for (const [name, command] of quiet) assert.deepEqual(claudeLaunches([call(name, command)]), [], `quiet: ${command}`);
});

test('results.mjs without a blind key still writes the run-side table and says the grades are not joined', () => {
  const out = tempDir('ab-nokey-');
  buildOut(out);
  const { json, md } = results(out);
  assert.equal(json.tickets[0].arms.bare.passRate, null);
  near(json.tickets[0].arms.bare.costUsd.median, 1.1, 't-1 bare cost');
  assert.equal(json.agreement.qualityReported, false);
  assert.match(md, /no blind-key\.json/);
  assert.ok(existsSync(join(out, 'results.json')));
  // Counted runs on both sides but no value for a metric: each ticket is named per metric.
  const pr = json.pairs[0].metrics.passRate;
  assert.equal(pr.tickets, 0);
  assert.deepEqual(pr.missing.map((x) => x.ticket), ['t-1', 't-2', 't-3']);
  assert.equal(pr.missing[0].reason, 'no Done-when pass rate value for current and bare');
  assert.deepEqual(json.pairs[0].missing, [], 'every ticket has counted runs of both arms');
});
