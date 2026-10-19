#!/usr/bin/env node
// run.mjs: the #271 A/B runner, bare Claude Code vs the harness at the ticket's parent, on replayed
// claude-config tickets.
//
//   node scripts/ab/run.mjs --dry-run [--only <ticket>] [--arm bare|current] [--run <n>] [--out <dir>] [--manifest <file>]
//   node scripts/ab/run.mjs --only <ticket> --arm <bare|current> --run <n> [--keep] [--out <dir>] [--manifest <file>] [--timeout-min 120]
//
// Auth: a live run refuses to start without CLAUDE_CODE_OAUTH_TOKEN, and never copies your login.
// Create a token once with `claude setup-token`, then run each cleared round from your own PowerShell
// with the token set there only:
//   $env:CLAUDE_CODE_OAUTH_TOKEN = Read-Host; node scripts/ab/run.mjs --only <ticket> --arm <a> --run <n>
// Not as a persistent user env var: every Claude Code session would run on that token.
//
// A round is one (ticket, arm, run), built by round.mjs under <tmp>/ab/<round id>: the ticket repo at
// its parent with no route to the fix, a home and temp (HOME, USERPROFILE, HOMEDRIVE+HOMEPATH, APPDATA,
// LOCALAPPDATA, TEMP, TMP, TMPDIR), Claude config, gh and git of its own, and for the current arm the
// harness checked out at the ticket's harness commit. The issue body goes to `claude -p` on stdin; bare
// adds --safe-mode, nothing else differs. Then the session's diff (committed, staged, unstaged,
// untracked, against the tree it started from), the repo's own gates, claude's cost, turns and wall
// time, the round's transcripts, and a scan of transcripts, the diff's added lines and gate logs for
// reaches into the real workspace, config or temp go to <out>/runs/<ticket>/<arm>-r<n>/. However the
// round ends, a failed capture included, the token is redacted from the results and the round's
// transcripts and the round dir is removed (--keep retains it). A live run takes exactly one round, so
// each is cleared on its own; --dry-run prints the commands, paths and estimate and touches nothing.

import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { die, git, isMain, log, parseArgs, readIfExists, workspaceRoot } from '../lib.mjs';
import { DEFAULT_OUT, RUN_COMMAND, addedLines, claudeCommand, gateVerdict, loadManifest, parseClaudeJson, planRound, readResult, scanContamination, scanRoots, selectRounds, tokenHelp, tokenHow, transcriptParts } from './ab-lib.mjs';
import { TOKEN_PLACEHOLDER, must, prepareRound, realClaudePaths, redactSecret, redactText, releaseRound, runClaude, transcriptText, treeExplains, treeHasLine } from './round.mjs';

const AB_DIR = dirname(fileURLToPath(import.meta.url));

/** Display form of an argv: an arg with a space or shell metacharacter is double-quoted. */
const show = (argv) => argv.map((a) => (/[\s"'*$&|<>;()]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ');

/** Cost and turns of every finished run under `out`, for the estimate; an unreadable result is skipped. */
function measuredRuns(out) {
  const runs = join(out, 'runs');
  if (!existsSync(runs)) return [];
  const found = [];
  for (const ticketId of readdirSync(runs)) {
    for (const name of readdirSync(join(runs, ticketId))) {
      const r = readResult(join(runs, ticketId, name, 'result.json'));
      if (r?.claude) found.push({ ticketId, costUsd: r.claude.costUsd, turns: r.claude.turns });
    }
  }
  return found;
}

function printPlan(p, cmd) {
  const e = p.estimate;
  const l = p.layout;
  log(`== ${p.ticket.id} ${p.arm} r${p.run}: est. $${e.usd}, ~${e.turns} turns (${e.basis}); hard cap --max-budget-usd ${e.budgetUsd}`);
  log(`  round:    ${l.root} (HOME, USERPROFILE, HOMEDRIVE+HOMEPATH, APPDATA, LOCALAPPDATA, TEMP, TMP and TMPDIR; CLAUDE_CONFIG_DIR ${l.config}, empty projects/ so no memory)`);
  log('  auth:     CLAUDE_CODE_OAUTH_TOKEN from your env, to claude only (not the gates); no login is copied');
  log(`  checkout: ${l.checkout}`);
  log(`  results:  ${p.resultsDir}`);
  for (const c of p.fetch) log(`  $ ${show(c)}`);
  log('    (the fix commit must be absent)');
  if (p.arm === 'current') log(`  harness: claude-config at ${p.ticket.harness} -> ${l.harness}; skills, agents and hooks from it, its workspace/ as the ancestor CLAUDE.md chain`);
  else log('  harness: none (--safe-mode, no CLAUDE.md above the checkout, no hooks in settings)');
  log('  barrier: no remote, no gh login, no git credential helper or network transport (file stays, for the repo\'s tests); deny rules on the real workspace and config');
  log(`  $ ${show([...cmd, ...p.claude.args])} < ${join(p.resultsDir, 'prompt.md')}    (in the checkout)`);
  log('  $ git add -A into a scratch index, then git diff --cached --binary <baseline tree>    (diff.patch; the baseline is written before claude)');
  for (const g of p.gates) log(`  $ ${g.cmd}    (gate ${g.name}${g.requireMatch ? `, needs /${g.requireMatch}/` : ''}${g.failIf ? `, fails on /${g.failIf}/` : ''})`);
  log('  writes: the results dir; the round dir is removed after capture (--keep retains it)');
}

if (isMain(import.meta.url)) await main();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dry = Boolean(args['dry-run']);
  if (!dry && !(typeof args.only === 'string' && typeof args.arm === 'string' && typeof args.run === 'string')) {
    die('a live run takes exactly one round: --only <ticket> --arm <bare|current> --run <n> (or --dry-run to preview any selection)');
  }
  if (!dry && !process.env.CLAUDE_CODE_OAUTH_TOKEN) die(tokenHelp(RUN_COMMAND));
  const manifest = loadManifest(args.manifest || join(AB_DIR, 'manifest.json'));
  const out = args.out || DEFAULT_OUT;
  const measured = measuredRuns(out);
  let rounds;
  try {
    rounds = selectRounds(manifest, { only: args.only, arm: args.arm, run: args.run });
  } catch (e) {
    die(e.message);
  }
  const workspace = workspaceRoot();
  const where = { tmp: tmpdir(), workspace, out, roundId: dry ? '<round-id>' : randomBytes(4).toString('hex') };
  const plans = rounds.map((r) => planRound(manifest, r.ticket, r.arm, r.run, where, measured));
  const cmd = claudeCommand();
  for (const p of plans) printPlan(p, cmd);
  if (dry) {
    const usd = plans.reduce((s, p) => s + p.estimate.usd, 0);
    const turns = plans.reduce((s, p) => s + p.estimate.turns, 0);
    log(`total: ${plans.length} round(s), est. $${Math.round(usd * 100) / 100}, ~${turns} turns (dry run: nothing ran)`);
    if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) log(`CLAUDE_CODE_OAUTH_TOKEN is not set: a live round will refuse to start. ${tokenHow(RUN_COMMAND)}`);
    return;
  }
  try {
    await runRound(plans[0], cmd, { workspace, keep: Boolean(args.keep), timeoutMs: Number(args['timeout-min'] ?? 120) * 60_000 });
  } catch (e) {
    die(e.message);
  }
}

/** One round. Once its dir is claimed, whatever path the round takes (a capture that throws
 *  included), the token is redacted from the results dir and the round's transcripts, and then the
 *  round dir is removed, or under --keep named for removal. A redaction that throws doesn't stop the
 *  other or the release; the round then fails with every error. */
async function runRound(p, cmd, { workspace, keep, timeoutMs }) {
  const l = p.layout;
  if (existsSync(join(p.resultsDir, 'result.json'))) throw new Error(`${p.resultsDir} already holds a result; move it aside to re-run this round`);
  if (existsSync(l.root)) throw new Error(`${l.root} exists; a round starts fresh`);
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  mkdirSync(p.resultsDir, { recursive: true });
  const errors = [];
  const attempt = async (step) => {
    try {
      await step();
    } catch (e) {
      errors.push(e.message);
    }
  };
  await attempt(() => playRound(p, cmd, { workspace, timeoutMs, token }));
  await attempt(() => redactSecret(p.resultsDir, token));
  await attempt(() => redactSecret(join(l.config, 'projects'), token));
  await releaseRound(l.root, keep);
  if (errors.length) throw new Error([...new Set(errors)].join('\n'));
}

/** Build the round, run the session, capture it and write result.json. */
async function playRound(p, cmd, { workspace, timeoutMs, token }) {
  const l = p.layout;
  const { env, prompt } = prepareRound(p, { workspace });
  writeFileSync(join(p.resultsDir, 'prompt.md'), prompt);

  // The tree the session starts from: the parent, plus whatever a fresh checkout re-cleans (line
  // endings under the copied git config). The diff is taken against it, so it holds the session's work only.
  const baseIndex = join(p.resultsDir, 'baseline.index');
  const benv = { ...process.env, GIT_INDEX_FILE: baseIndex };
  must(['git', '-C', l.checkout, 'add', '-A'], { env: benv });
  const baseline = {
    tree: must(['git', '-C', l.checkout, 'write-tree'], { env: benv }).trim(),
    changedFromParent: must(['git', '-C', l.checkout, 'diff', '--cached', '--name-only', p.ticket.parent], { env: benv }).split('\n').filter(Boolean).length,
  };
  rmSync(baseIndex, { force: true });

  log(`running claude (${p.ticket.id} ${p.arm} r${p.run}) in ${l.checkout}; this takes a while`);
  const started = new Date();
  const c = await runClaude(cmd, p.claude.args, { cwd: l.checkout, env: { ...env, CLAUDE_CODE_OAUTH_TOKEN: token }, input: prompt, timeoutMs });
  const wallMs = Date.now() - started.getTime();
  const { claude, diffStat, gates, contamination, contaminationExplained } = capture(p, { env, workspace, c, baseline });
  // The token is redacted from every file in the results dir and the round's transcripts (runRound
  // does it again whatever happens), and from result.json before it is written.
  let tokenRedactions = redactSecret(p.resultsDir, token) + redactSecret(join(l.config, 'projects'), token);
  const result = {
    ticket: p.ticket.id,
    arm: p.arm,
    run: p.run,
    roundId: l.root.split(/[\\/]/).pop(),
    roundRoot: l.root,
    checkout: l.checkout,
    parent: p.ticket.parent,
    harness: p.arm === 'current' ? p.ticket.harness : null,
    command: [...cmd, ...p.claude.args],
    startedAt: started.toISOString(),
    wallMs,
    claude,
    baseline,
    diffStat,
    gates,
    contamination,
    contaminationExplained,
    estimate: p.estimate,
  };
  // The final message rides in result.json (claude.result): redact it before it is written, and count it.
  const [json, inResult] = redactText(JSON.stringify(result), token);
  if (inResult) tokenRedactions++;
  writeFileSync(join(p.resultsDir, 'result.json'), `${JSON.stringify({ ...JSON.parse(json), tokenRedactions }, null, 2)}\n`);
  log(`done ${p.ticket.id} ${p.arm} r${p.run}: $${claude.costUsd ?? '?'} (est. $${p.estimate.usd}), ${claude.turns ?? '?'} turns, ${Math.round(wallMs / 60_000)} min, ${diffStat.files} file(s) +${diffStat.insertions}/-${diffStat.deletions}, gates ${gates.map((g) => `${g.name}:${g.rc}`).join(' ')}`);
  if (contamination.length) log(`WARNING: the run reached the real ${contamination.map((x) => `${x.label} (${x.count}x in ${x.source})`).join(', ')}; grade.mjs excludes it. See ${join(p.resultsDir, 'result.json')}`);
  if (contaminationExplained.length) log(`note: ${contaminationExplained.reduce((n, x) => n + x.count, 0)} real-path mention(s) in what the round served are explained, not flagged (the round's own files spell them, or bare /tmp)`);
  if (tokenRedactions) log(`WARNING: the session wrote its OAuth token into ${tokenRedactions} file(s); each copy is redacted as ${TOKEN_PLACEHOLDER}`);
  if (!claude.ok) log(`WARNING: claude's output was not a result (exit ${c.status}${c.timedOut ? ', timed out' : ''}); see ${join(p.resultsDir, 'claude.stderr.log')}`);
  log(`results: ${p.resultsDir}`);
}

/** After the session: its output, its diff, the gates, its transcripts and the contamination scan, written to the results dir. */
function capture(p, { env, workspace, c, baseline }) {
  const l = p.layout;
  writeFileSync(join(p.resultsDir, 'claude.json'), c.stdout);
  writeFileSync(join(p.resultsDir, 'claude.stderr.log'), c.stderr);
  const claude = { ...parseClaudeJson(c.stdout), exit: c.status, timedOut: c.timedOut };

  // The diff against the baseline through a scratch index: commits, staged, unstaged and untracked
  // (not ignored) files alike, and the checkout's own index stays as the session left it.
  const index = join(p.resultsDir, 'scratch.index');
  const genv = { ...process.env, GIT_INDEX_FILE: index };
  must(['git', '-C', l.checkout, 'add', '-A'], { env: genv });
  writeFileSync(join(p.resultsDir, 'diff.patch'), must(['git', '-C', l.checkout, 'diff', '--cached', '--binary', baseline.tree], { env: genv }));
  const numstat = must(['git', '-C', l.checkout, 'diff', '--cached', '--numstat', baseline.tree], { env: genv });
  rmSync(index, { force: true });
  const diffStat = { files: 0, insertions: 0, deletions: 0 };
  for (const line of numstat.split('\n').filter(Boolean)) {
    const [a, d] = line.split('\t');
    diffStat.files++;
    diffStat.insertions += Number(a) || 0;
    diffStat.deletions += Number(d) || 0;
  }
  writeFileSync(join(p.resultsDir, 'commits.txt'), git(l.checkout, ['log', '--format=%H %s', `${p.ticket.parent}..HEAD`]).out);

  const gates = [];
  for (const g of p.gates) {
    const r = spawnSync(g.cmd, { cwd: l.checkout, shell: true, encoding: 'utf8', env, maxBuffer: 256 * 1024 * 1024 });
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    writeFileSync(join(p.resultsDir, `gate-${g.name}.log`), output);
    const exit = r.status ?? -1;
    const v = gateVerdict(g, exit, output);
    gates.push({ name: g.name, cmd: g.cmd, exit, rc: v.rc, reason: v.reason, output });
    log(`EXIT:${exit} ${g.name} (${g.cmd})${v.reason ? ` -> rc ${v.rc}: ${v.reason}` : ''}`);
  }

  const projects = join(l.config, 'projects');
  if (existsSync(projects)) cpSync(projects, join(p.resultsDir, 'transcripts'), { recursive: true });
  // Model-written code runs in the gates too, so their logs and the diff's added lines are scanned with
  // the transcripts. The round is masked (it sits under the real temp, which Git Bash also spells /tmp).
  // What the session wrote (its tool inputs, its diff) always flags, but for a line an Edit, Write or
  // MultiEdit wrote that the checkout holds verbatim at the parent (user, 2026-10-19). In what the round
  // served, a path the round's own tree spells, at the parent or the harness commit, is explained.
  const { inputs, edits, served } = transcriptParts(transcriptText(projects));
  const sources = { transcripts: served, 'tool inputs': inputs, 'edit content': edits, 'diff.patch': addedLines(readIfExists(join(p.resultsDir, 'diff.patch')) ?? '') };
  for (const g of gates) sources[`gate-${g.name}.log`] = g.output;
  const checkout = { repo: l.checkout, sha: p.ticket.parent };
  const trees = [checkout, ...(p.arm === 'current' ? [{ repo: l.harness, sha: p.ticket.harness }] : [])];
  const real = realClaudePaths();
  const scan = scanContamination(sources, scanRoots({ workspace, config: real.config, globalJson: real.globalJson, temp: tmpdir() }), {
    mask: [l.root],
    explains: treeExplains(trees),
    lineExplains: treeHasLine([checkout]),
    tmp: tmpdir(),
    written: ['tool inputs', 'diff.patch'],
    byLine: ['edit content'],
  });
  return { claude, diffStat, gates: gates.map(({ output, ...g }) => g), contamination: scan.flagged, contaminationExplained: scan.explained };
}
