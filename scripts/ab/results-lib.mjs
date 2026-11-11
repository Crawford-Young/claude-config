// The #375 A/B results, side-effect free: per-run values, the median and range per ticket and arm, the
// paired difference between two named arms with seeded bootstrap intervals, grader agreement and the
// rule that withholds quality, the runs left out or flagged, and the markdown. results.mjs reads the
// files and hands the runs in.

import { modelCalls } from './ab-lib.mjs';

/** Kappa floor for both grader-grader and user-grader agreement on Done-when verdicts. Raw agreement
 *  is inflated when most boxes pass (two graders who each pass 90% of boxes at random agree 82% of
 *  the time); Cohen's kappa takes chance out. 0.6 is the floor of "substantial" agreement (Landis &
 *  Koch 1977): below it, grader noise is the size of the arm differences this A/B can show. */
export const KAPPA_MIN = 0.6;
/** The user's blind sample: at least this many packets graded before quality is reported. */
export const USER_MIN = 10;
const TIE = 1e-9;

/** The metrics, in table order; `better` says which way a paired difference wins. */
export const METRICS = [
  { key: 'passRate', label: 'Done-when pass rate', better: 'higher', graded: true },
  { key: 'gates', label: 'gates green', better: 'higher' },
  { key: 'quality', label: 'quality (1-5)', better: 'higher', graded: true },
  { key: 'costUsd', label: 'cost ($)', better: 'lower' },
  { key: 'turns', label: 'turns', better: 'lower' },
  { key: 'wallMs', label: 'wall time (min)', better: 'lower' },
  { key: 'inputTokens', label: 'input tokens', better: 'lower' },
  { key: 'outputTokens', label: 'output tokens', better: 'lower' },
  { key: 'cacheReadTokens', label: 'cache-read tokens', better: 'lower' },
  { key: 'cacheWriteTokens', label: 'cache-write tokens', better: 'lower' },
];

const present = (xs) => xs.filter((x) => typeof x === 'number' && Number.isFinite(x));

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** {n, median, min, max} of the values that exist, or null when none do. */
export function summarize(xs) {
  const v = present(xs);
  return v.length ? { n: v.length, median: median(v), min: Math.min(...v), max: Math.max(...v) } : null;
}

/** mulberry32: a seeded stream of floats in [0, 1), so an interval repeats under its seed. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const resample = (xs, next) => xs.map(() => xs[Math.floor(next() * xs.length)]);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
/** The 95% percentile interval of sorted draws. */
const interval = (draws) => {
  const s = draws.sort((a, b) => a - b);
  return { lo: s[Math.floor(0.025 * (s.length - 1))], hi: s[Math.ceil(0.975 * (s.length - 1))] };
};

/** Mean of the per-ticket diffs with a 95% interval from resampling tickets; null for no tickets. */
export function bootstrapMean(diffs, { iterations, seed }) {
  if (!diffs.length) return null;
  const next = rng(seed);
  return { mean: mean(diffs), ...interval(Array.from({ length: iterations }, () => mean(resample(diffs, next)))) };
}

/** One ticket's median(a) - median(b), with a 95% interval from resampling each arm's runs. One run
 *  a side gives a point interval. */
export function bootstrapPairDiff(a, b, { iterations, seed }) {
  const next = rng(seed);
  return { d: median(a) - median(b), ...interval(Array.from({ length: iterations }, () => median(resample(a, next)) - median(resample(b, next)))) };
}

/** Cohen's kappa over [verdict, verdict] pairs: {n, agreement, kappa}, or null for no pairs. When chance
 *  agreement is total (both raters used one category), the raters agree fully and kappa is 1. */
export function kappa(pairs) {
  if (!pairs.length) return null;
  const n = pairs.length;
  const count = (i) => pairs.reduce((m, p) => m.set(p[i], (m.get(p[i]) ?? 0) + 1), new Map());
  const [r1, r2] = [count(0), count(1)];
  const po = pairs.filter(([x, y]) => x === y).length / n;
  let pe = 0;
  for (const [c, k] of r1) pe += (k / n) * ((r2.get(c) ?? 0) / n);
  return { n, agreement: po, kappa: pe === 1 ? 1 : (po - pe) / (1 - pe) };
}

/** Token totals over a run's transcripts (main and subagent .jsonl texts), each model call counted by
 *  the run metrics' own rule (ab-lib's modelCalls). Null when there are no transcripts: unknown, not zero. */
export function transcriptTokens(texts) {
  if (!texts.length) return null;
  const calls = modelCalls(texts.join('\n'));
  const sum = (k) => calls.reduce((s, { usage: u }) => s + (u[k] ?? 0), 0);
  return { inputTokens: sum('input_tokens'), outputTokens: sum('output_tokens'), cacheReadTokens: sum('cache_read_input_tokens'), cacheWriteTokens: sum('cache_creation_input_tokens') };
}

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
// A command segment whose program is claude: at the start, or after ; & | ( $( or a newline, past any
// VAR=value prefixes, PowerShell's call operator and a quoted or bare path; or npx of the package. Not
// after a backtick: round 1's sed script named "`claude -n`" as a markdown code span.
const CLAUDE_LAUNCH =
  /(?:(?:^|[;&|(\n]|\$\()\s*(?:&\s*)?(?:[A-Za-z_]\w*=\S*\s+)*["']?(?:[^\s"';&|]*[\\/])?claude(?:\.exe)?["']?(?=\s|$|[;&|)])|\bnpx\s+(?:-\S+\s+)*@anthropic-ai\/claude-code\b)/i;

/** The shell commands in a run's transcripts that launch claude (Bash or PowerShell tool calls, each
 *  once by tool_use id). A nested `claude -p` or `--bg` runs outside the session: solo's tool deny
 *  doesn't reach it and the subagent metrics don't see it (#374), so results.mjs flags the run. */
export function claudeLaunches(texts) {
  const seen = new Set();
  const found = [];
  const visit = (o) => {
    if (Array.isArray(o)) return o.forEach(visit);
    if (!o || typeof o !== 'object') return;
    if (o.type === 'tool_use' && SHELL_TOOLS.has(o.name) && typeof o.input?.command === 'string') {
      const key = o.id ?? o.input.command;
      if (!seen.has(key) && CLAUDE_LAUNCH.test(o.input.command)) found.push(o.input.command);
      seen.add(key);
      return;
    }
    Object.values(o).forEach(visit);
  };
  for (const text of texts) {
    for (const line of text.split(/\r?\n/)) {
      try {
        visit(JSON.parse(line));
      } catch {
        // not a transcript line
      }
    }
  }
  return found;
}

/** A run the runner killed at its timeout, and one the spend cap stopped (claude's own subtype, or
 *  spend at or over the cap). */
export function runFlags(result) {
  const c = result.claude ?? {};
  const cap = result.estimate?.budgetUsd;
  return { timedOut: Boolean(c.timedOut), budgetCapped: c.subtype === 'error_max_budget_usd' || (typeof cap === 'number' && typeof c.costUsd === 'number' && c.costUsd >= cap) };
}

const VERDICTS = new Set(['pass', 'fail', 'unverifiable']);
/** A grade.json is graded when every box has a verdict and the quality score is 1-5. */
export const gradeFilled = (g) =>
  Boolean(g?.boxes?.length) && g.boxes.every((b) => VERDICTS.has(b.verdict)) && Number.isFinite(g.quality?.score) && g.quality.score >= 1 && g.quality.score <= 5;
const graderGrades = (run) => ['first', 'second'].map((s) => run.grades?.[s]).filter(gradeFilled);

/** The run-side values of a result.json, plus its token totals. */
export function runValues(result, tokens) {
  return {
    gates: result.gates?.length ? (result.gates.every((g) => g.rc === 0) ? 1 : 0) : null,
    costUsd: result.claude?.costUsd ?? null,
    turns: result.claude?.turns ?? null,
    wallMs: result.wallMs ?? null,
    ...(tokens ?? { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null }),
  };
}

/** A counted run's graded values: each the mean over the graders who graded it. Pass rate is passed
 *  boxes over all boxes (unverifiable is not a pass; the boxes are the same in every arm). */
function gradedValues(run) {
  const gs = graderGrades(run);
  if (!gs.length) return { passRate: null, quality: null };
  return { passRate: mean(gs.map((g) => g.boxes.filter((b) => b.verdict === 'pass').length / g.boxes.length)), quality: mean(gs.map((g) => g.quality.score)) };
}

/** Box-by-box verdict pairs of two grades. */
const boxPairs = (a, b) => a.boxes.flatMap((box, i) => (b.boxes[i] ? [[box.verdict, b.boxes[i].verdict]] : []));

/** Agreement on Done-when verdicts: the two graders over every double-graded packet, and the user
 *  against each grader over the user's sample. Quality is reported only when both kappas reach
 *  KAPPA_MIN and the user graded at least USER_MIN packets; `withheld` says why not. */
export function gradeAgreement(runs, { kappaMin = KAPPA_MIN, userMin = USER_MIN } = {}) {
  const ungraded = [];
  const gg = [];
  const ug = [];
  let doubled = 0;
  let userGraded = 0;
  for (const run of runs) {
    for (const slot of ['first', 'second', 'user']) {
      const grade = run.grades?.[slot];
      if (grade !== undefined && !gradeFilled(grade)) ungraded.push({ ticket: run.ticket, arm: run.arm, run: run.run, slot });
    }
    const [a, b, u] = ['first', 'second', 'user'].map((s) => (gradeFilled(run.grades?.[s]) ? run.grades[s] : null));
    if (a && b) {
      doubled++;
      gg.push(...boxPairs(a, b));
    }
    if (u) {
      userGraded++;
      for (const x of [a, b]) if (x) ug.push(...boxPairs(u, x));
    }
  }
  const graders = { packets: doubled, ...(kappa(gg) ?? { n: 0, agreement: null, kappa: null }) };
  const user = { packets: userGraded, ...(kappa(ug) ?? { n: 0, agreement: null, kappa: null }) };
  const withheld = [];
  const floor = kappaMin.toFixed(2);
  if (!doubled) withheld.push('no packet is graded by both graders');
  else if (graders.kappa < kappaMin) withheld.push(`graders agree at kappa ${graders.kappa.toFixed(2)}, under ${floor}`);
  if (userGraded < userMin) withheld.push(`the user graded ${userGraded} of the ${userMin} sample packets`);
  else if (user.kappa < kappaMin) withheld.push(`the user agrees with the graders at kappa ${user.kappa.toFixed(2)}, under ${floor}`);
  return { kappaMin, userMin, graders, user, qualityReported: withheld.length === 0, withheld, ungraded };
}

const outcome = (d, better) => (Math.abs(d) < TIE ? 'tied' : (d > 0) === (better === 'higher') ? 'won' : 'lost');
const byRun = (a, b) => a.ticket.localeCompare(b.ticket, 'en', { numeric: true }) || a.run - b.run;

/** Why `ticket` has no counted run of `arm`: it has none at all, or each one it has was left out. */
function missingReason(runs, ticket, arm) {
  const own = runs.filter((r) => r.ticket === ticket && r.arm === arm).sort((a, b) => a.run - b.run);
  if (!own.length) return `no ${arm} run`;
  return `no counted ${arm} run: ${own.map((r) => `r${r.run} ${r.status === 'no-result' ? 'has no result' : `excluded (${r.reason})`}`).join(', ')}`;
}

/** The comparison. `runs`: [{ticket, arm, run, status: counted|excluded|no-result, reason, held,
 *  heldReason, flags: {timedOut, budgetCapped}, values, grades: {first, second, user}, subagents:
 *  {spawned, costShare} | null, claudeLaunches: [command]}]. Excluded and resultless runs count in no
 *  metric; a held run has no grade, so it counts in the run-side metrics only; timed-out and
 *  budget-capped runs count in all (they are the arm's real outcome). A pair with solo is reported
 *  twice (#374): over every ticket, then over `spawnExpected` (ticket ids) only, where the director
 *  would spawn. A ticket a pair can't compare is named with why, per pair and per metric. */
export function compare(runs, { pairs, spawnExpected = [], iterations = 10000, seed = 1, kappaMin, userMin, joined = true } = {}) {
  const counted = runs.filter((r) => r.status === 'counted');
  const agreement = gradeAgreement(counted.filter((r) => !r.held), { kappaMin, userMin });
  if (!joined) agreement.withheld.unshift('no blind-key.json: the grades are not joined (run grade.mjs, then grade the packets)');
  agreement.qualityReported = agreement.qualityReported && joined;
  const metrics = METRICS.filter((m) => m.key !== 'quality' || agreement.qualityReported);
  const arms = [...new Set(runs.map((r) => r.arm))].sort();
  const tickets = [...new Set(runs.map((r) => r.ticket))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const valuesOf = (r) => ({ ...r.values, ...(r.held ? { passRate: null, quality: null } : gradedValues(r)) });
  const cellRuns = (ticket, arm) => counted.filter((r) => r.ticket === ticket && r.arm === arm).map(valuesOf);
  const table = tickets.map((ticket) => ({
    ticket,
    arms: Object.fromEntries(
      arms.map((arm) => {
        const vs = cellRuns(ticket, arm);
        const cell = (m) => {
          const s = metrics.includes(m) ? summarize(vs.map((v) => v[m.key])) : null;
          return s && m.key === 'gates' ? { ...s, green: present(vs.map((v) => v.gates)).filter((x) => x === 1).length } : s;
        };
        const subagents = counted
          .filter((r) => r.ticket === ticket && r.arm === arm && r.subagents)
          .sort((x, y) => x.run - y.run)
          .map((r) => ({ run: r.run, spawned: r.subagents.spawned, costShare: r.subagents.costShare }));
        return [arm, { runs: vs.length, ...Object.fromEntries(METRICS.map((m) => [m.key, cell(m)])), subagents }];
      }),
    ),
  }));
  const spawnSet = new Set(spawnExpected);
  const scopes = ([a, b]) => [
    { a, b, scope: 'all', tickets },
    ...(a === 'solo' || b === 'solo' ? [{ a, b, scope: 'spawn-expected', tickets: tickets.filter((t) => spawnSet.has(t)) }] : []),
  ];
  const paired = pairs.flatMap(scopes).map(({ a, b, scope, tickets: inScope }) => {
    const hasCounted = (ticket, arm) => counted.some((r) => r.ticket === ticket && r.arm === arm);
    const missing = inScope.flatMap((ticket) => [a, b].filter((arm) => !hasCounted(ticket, arm)).map((arm) => ({ ticket, arm, reason: missingReason(runs, ticket, arm) })));
    const out = { a, b, scope, tickets: inScope, missing, metrics: {} };
    if (!agreement.qualityReported) out.withheld = `quality is withheld: ${agreement.withheld.join('; ')}`;
    for (const m of metrics) {
      const perTicket = [];
      const skipped = [];
      for (const ticket of inScope) {
        const gone = missing.filter((x) => x.ticket === ticket);
        if (gone.length) {
          skipped.push({ ticket, reason: gone.map((x) => x.reason).join('; ') });
          continue;
        }
        const [xa, xb] = [a, b].map((arm) => present(cellRuns(ticket, arm).map((v) => v[m.key])));
        const lacking = [[a, xa], [b, xb]].filter(([, xs]) => !xs.length).map(([arm]) => arm);
        if (lacking.length) {
          skipped.push({ ticket, reason: `no ${m.label} value for ${lacking.join(' and ')}` });
          continue;
        }
        const r = bootstrapPairDiff(xa, xb, { iterations, seed });
        perTicket.push({ ticket, ...r, outcome: outcome(r.d, m.better) });
      }
      const ci = bootstrapMean(perTicket.map((t) => t.d), { iterations, seed });
      const count = (o) => perTicket.filter((t) => t.outcome === o).length;
      out.metrics[m.key] = { perTicket, tickets: perTicket.length, mean: ci?.mean ?? null, lo: ci?.lo ?? null, hi: ci?.hi ?? null, won: count('won'), tied: count('tied'), lost: count('lost'), missing: skipped };
    }
    return out;
  });
  const leftOut = Object.fromEntries(arms.map((arm) => [arm, []]));
  for (const r of [...runs].sort(byRun)) {
    const add = (kind, reason) => leftOut[r.arm].push({ ticket: r.ticket, run: r.run, kind, reason });
    if (r.status === 'no-result') add('no result', 'no readable result.json (the round crashed or is unfinished)');
    if (r.status === 'excluded') add('excluded', r.reason);
    if (r.status !== 'counted') continue;
    if (r.flags.timedOut) add('timed out', 'the runner killed claude at its timeout');
    if (r.flags.budgetCapped) add('budget-capped', `stopped at the spend cap ($${r.values.costUsd ?? '?'})`);
    if (r.held) add('held', r.heldReason);
    const launches = r.claudeLaunches ?? [];
    if (launches.length) add('nested claude', `Bash ran claude: ${launches[0]}${launches.length > 1 ? ` (+${launches.length - 1} more)` : ''}`);
  }
  return { arms, pairs: paired, agreement, tickets: table, leftOut, iterations, seed };
}

// ---- markdown --------------------------------------------------------------------------------

const fmtValue = (key, x) => {
  if (key === 'wallMs') return (x / 60000).toFixed(1);
  if (/Tokens$/.test(key)) return String(Math.round(x));
  if (key === 'turns') return Number.isInteger(x) ? String(x) : x.toFixed(1);
  return x.toFixed(2);
};
/** One arm's cell: the median with the range when the runs differ, or k/n green for gates. */
function fmtCell(key, s) {
  if (!s) return '–';
  if (key === 'gates') return `${s.green}/${s.n} green`;
  const v = fmtValue(key, s.median);
  return s.min === s.max ? v : `${v} (${fmtValue(key, s.min)}–${fmtValue(key, s.max)})`;
}
const fmtDiff = (key, d) => (key === 'turns' ? d.toFixed(1) : fmtValue(key, d));

const LEFT_NOTE = {
  'no result': 'dropped',
  excluded: 'dropped from every metric',
  'timed out': 'counts; no cost or turns when claude was killed',
  'budget-capped': 'counts',
  held: 'no grade; run-side metrics count',
  'nested claude': 'counts; a nested claude escapes the solo arm and the subagent metrics',
};

const pct = (x) => `${Math.round(x * 1000) / 10}%`;
/** One arm's subagent cell: each run's spawn count with its share of cost, or – when no run has the block. */
const fmtSubagents = (list) => (list.length ? list.map((x) => `r${x.run} ${x.spawned}${x.costShare === null ? '' : ` (${pct(x.costShare)})`}`).join(', ') : '–');

/** results.md from compare()'s output; `source` names the results dir. */
export function renderResults(res, { source }) {
  const shown = METRICS.filter((m) => m.key !== 'quality' || res.agreement.qualityReported);
  const L = [];
  L.push('# A/B results', '');
  L.push(`From ${source}. Arms: ${res.arms.join(', ')}. Each cell is one arm's median over its counted runs, with the range when the runs differ; gates are the runs with every gate green. Bootstrap: ${res.iterations} resamples, seed ${res.seed}, 95% percentile intervals.`, '');
  const a = res.agreement;
  L.push('## Grader agreement (Done-when verdicts)', '');
  const k = (x) => (x.kappa === null ? 'n/a' : `kappa ${x.kappa.toFixed(2)}, raw ${(x.agreement * 100).toFixed(0)}%, ${x.n} box pairs`);
  L.push(`- Two graders: ${a.graders.packets} packet(s) graded by both; ${k(a.graders)}.`);
  L.push(`- User sample (blind): ${a.user.packets} packet(s) graded, against both graders; ${k(a.user)}.`);
  L.push(`- Floor: kappa ${a.kappaMin.toFixed(2)} for both, and at least ${a.userMin} user-graded packets.`);
  if (a.ungraded.length) L.push(`- Not yet graded: ${a.ungraded.map((u) => `${u.ticket} ${u.arm} r${u.run} (${u.slot})`).join(', ')}.`);
  L.push('');
  L.push(a.qualityReported ? 'Quality scores are reported: agreement is at or over the floor.' : `Quality scores are withheld: ${a.withheld.join('; ')}.`, '');

  L.push('## Per ticket', '');
  L.push(`| ticket | runs | ${METRICS.map((m) => m.label).join(' | ')} | subagents (spawned, $ share) |`);
  L.push(`|---|---|${METRICS.map(() => '---').join('|')}|---|`);
  for (const t of res.tickets) {
    const cells = METRICS.map((m) => {
      if (!shown.includes(m)) return 'withheld';
      return res.arms.map((arm) => `${arm} ${fmtCell(m.key, t.arms[arm][m.key])}`).join('<br>');
    });
    const subagents = res.arms.map((arm) => `${arm} ${fmtSubagents(t.arms[arm].subagents)}`).join('<br>');
    L.push(`| ${t.ticket} | ${res.arms.map((arm) => `${arm} ${t.arms[arm].runs}`).join('<br>')} | ${cells.join(' | ')} | ${subagents} |`);
  }
  L.push('');

  for (const p of res.pairs) {
    L.push(`## ${p.a} − ${p.b}${p.scope === 'spawn-expected' ? `, spawn-expected tickets only (${p.tickets.join(', ') || 'none'})` : ''}`, '');
    L.push(`Per ticket: median(${p.a}) − median(${p.b}). Summary: the mean of those over tickets, with its interval from resampling tickets; won / tied / lost counts tickets from ${p.a}'s side (lower wins for cost, turns, time and tokens).`, '');
    if (p.withheld) L.push(`Quality is left out: ${p.withheld.replace(/^quality is withheld: /, '')}.`, '');
    if (p.missing.length) L.push(`Not compared: ${p.missing.map((x) => `${x.ticket} (${x.reason})`).join('; ')}.`, '');
    L.push('| metric | tickets | mean Δ [95% CI] | won / tied / lost | not compared |', '|---|---|---|---|---|');
    for (const m of shown) {
      const x = p.metrics[m.key];
      const ci = x.mean === null ? '–' : `${fmtDiff(m.key, x.mean)} [${fmtDiff(m.key, x.lo)}, ${fmtDiff(m.key, x.hi)}]`;
      L.push(`| ${m.label} | ${x.tickets} | ${ci} | ${x.won} / ${x.tied} / ${x.lost} | ${x.missing.map((y) => y.ticket).join(', ') || '–'} |`);
    }
    L.push('');
    L.push(`| ticket | ${shown.map((m) => m.label).join(' | ')} |`, `|---|${shown.map(() => '---').join('|')}|`);
    for (const id of p.tickets) {
      const cells = shown.map((m) => {
        const t = p.metrics[m.key].perTicket.find((x) => x.ticket === id);
        if (t) return `${fmtDiff(m.key, t.d)} [${fmtDiff(m.key, t.lo)}, ${fmtDiff(m.key, t.hi)}] ${t.outcome}`;
        return `– (${p.metrics[m.key].missing.find((x) => x.ticket === id).reason})`;
      });
      L.push(`| ${id} | ${cells.join(' | ')} |`);
    }
    L.push('');
  }

  L.push('## Runs left out or flagged, per arm', '');
  L.push('Dropping a run silently biases toward the arm that fails more, so each is named here.', '');
  for (const arm of res.arms) {
    const list = res.leftOut[arm];
    L.push(`### ${arm}: ${list.length}`, '');
    for (const x of list) L.push(`- ${x.ticket} r${x.run} ${x.kind} (${LEFT_NOTE[x.kind]}): ${x.reason}`);
    if (list.length) L.push('');
  }
  return `${L.join('\n').trimEnd()}\n`;
}
