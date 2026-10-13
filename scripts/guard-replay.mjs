#!/usr/bin/env node
// guard-replay.mjs — diff guard verdicts between two checkouts over real transcripts (#106).
//   node scripts/guard-replay.mjs <old-checkout> <new-checkout> [--branch] [--full] [--files N] [--days D] [--root <projects-dir>]
// Replays unique Bash/PowerShell commands through staticCheck, gatedVerbs and browserCommand,
// and unique AskUserQuestion answers through isApproving and isBrowserApproving,
// in both checkouts. Prints one line per changed verdict plus a summary. Exit 0 always: a report, not a gate.
// --branch adds the stateful rules (#165): each command's gitCalls(scrub(c)) diffed structurally,
// then branchRules allow/BLOCK verdicts with cwd = a temp unborn repo and a temp born repo.
// --full (#168) follows each changed line with the whole command, redacted and indented, and,
// where the line collapsed the new verdict (branchRules' BLOCK), its reason.
// branchRules runs read-only git (branch --show-current, rev-parse), so a command that cds into a
// real repo reads that repo; no command is ever executed. It finds only shapes the corpus holds: in
// #159 it reported 0 verdict changes while a false allow existed. It complements the fresh-context
// reviewer and does not replace it.
// Transcripts: <CLAUDE_CONFIG_DIR or ~/.claude>/projects/*/*.jsonl and projects/*/<session>/subagents/*.jsonl, last --days (default 7) or newest --files.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { walkTranscripts } from './audit-lib.mjs';

const MAX_SHOWN = 120;

function num(v, o) {
  const n = Number(v);
  if (v === undefined || v === '' || !Number.isFinite(n) || n < 0) o.bad = true;
  return n;
}

function parseArgs(argv) {
  const o = { files: null, days: null, root: null, branch: false, full: false, paths: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--files') o.files = num(argv[++i], o);
    else if (argv[i] === '--days') o.days = num(argv[++i], o);
    else if (argv[i] === '--root') o.root = argv[++i];
    else if (argv[i] === '--branch') o.branch = true;
    else if (argv[i] === '--full') o.full = true;
    else o.paths.push(argv[i]);
  }
  // Default: the last 7 days, main + subagent transcripts. A newest-N count skews
  // toward many small subagent files (30 files held 930 commands; 7 days held 2118).
  if (o.files == null && o.days == null) o.days = 7;
  return o;
}

function projectsRoot(override) {
  if (override) return override;
  const base = process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || process.env.USERPROFILE || homedir(), '.claude');
  return join(base, 'projects');
}

async function transcripts(root, { files, days }) {
  const all = [];
  try {
    for await (const { file } of walkTranscripts(root)) {
      try {
        all.push({ p: file, mtime: statSync(file).mtimeMs });
      } catch {
        // vanished mid-scan
      }
    }
  } catch {
    // projects root missing or unreadable: scan nothing
  }
  all.sort((a, b) => b.mtime - a.mtime);
  if (days != null) return all.filter((f) => f.mtime >= Date.now() - days * 864e5).map((f) => f.p);
  return all.slice(0, files).map((f) => f.p);
}

/** Order-independent identity for an answers object. */
const answerKey = (a) => JSON.stringify(Object.entries(a).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));

/** Shown commands and verdicts never carry secrets: NAME=value, $env:NAME = value, Bearer tokens,
 *  --with-token values and URL passwords print as ***. */
const SECRET_ASSIGN = /(?<![-\w])((?:\$env:)?(?:[A-Z0-9]+_)*(?:TOKEN|KEY|SECRET|PASSWORD|PASS|PAT)\s*=\s*)("[^"]*"|'[^']*'|\S+)/g;
const redact = (s) =>
  s
    .replace(SECRET_ASSIGN, '$1***')
    .replace(/(Authorization:\s*Bearer\s+)[^\s"']+/gi, '$1***')
    .replace(/(--with-token[\s=]+)[^\s"']+/g, '$1***')
    .replace(/(:\/\/[^\s/:@"']+:)[^\s/@"']+@/g, '$1***@');

/** Unique shell commands and unique AskUserQuestion answer objects across the files. */
function collect(paths) {
  const commands = new Set();
  const answers = new Map();
  for (const p of paths) {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (!line || line[0] !== '{') continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      const content = o?.message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === 'tool_use' && (c.name === 'Bash' || c.name === 'PowerShell') && typeof c.input?.command === 'string') {
            commands.add(c.input.command);
          }
        }
      }
      const a = o?.toolUseResult?.answers;
      if (o?.type === 'user' && a && typeof a === 'object' && !Array.isArray(a)) answers.set(answerKey(a), a);
    }
  }
  return { commands: [...commands], answers: [...answers.values()] };
}

async function load(checkout) {
  const dir = resolve(checkout, 'hooks');
  const guard = await import(pathToFileURL(join(dir, 'bash-guard.mjs')).href);
  const lib = await import(pathToFileURL(join(dir, '_hooklib.mjs')).href);
  return { ...lib, ...guard };
}

const verdict = (fn, ...args) => {
  try {
    if (typeof fn !== 'function') return 'missing';
    return JSON.stringify(fn(...args)) ?? 'undefined';
  } catch (e) {
    return `throws ${String(e?.message).slice(0, 60)}`;
  }
};

/** A temp repo on main: unborn, or born with one empty commit. The caller removes it. */
function tempRepo(born) {
  const dir = mkdtempSync(join(tmpdir(), born ? 'gr-born-' : 'gr-unborn-'));
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { timeout: 10000 });
  git('init', '-q', '-b', 'main');
  if (born) git('-c', 'user.name=guard-replay', '-c', 'user.email=guard-replay@localhost', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'init');
  return dir;
}

/** The gitCalls fields branchRules reads, with the temp repo's path shown as <repo>. */
const callShape = (calls, repo) =>
  calls.map(({ sub, args, repo: r, viaOr, loop }) => ({
    sub,
    args,
    repo: typeof r === 'string' && r.startsWith(repo) ? `<repo>${r.slice(repo.length)}` : r,
    viaOr,
    loop,
  }));

/** A branchRules verdict as allow/BLOCK; missing and throws stay as they are. */
const allowBlock = (v) => (v === 'null' ? 'allow' : v.startsWith('"') ? 'BLOCK' : v);

const oneLine = (s, n = MAX_SHOWN) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}...` : t;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.paths.length !== 2 || args.bad) {
    console.log('usage: node scripts/guard-replay.mjs <old-checkout> <new-checkout> [--branch] [--full] [--files N] [--days D] [--root <projects-dir>]');
    return;
  }
  const [a, b] = await Promise.all(args.paths.map(load));
  const files = await transcripts(projectsRoot(args.root), args);
  const { commands, answers } = collect(files);
  let changed = 0;
  const cwd = process.cwd();
  // raw: the new verdict before n collapsed it; --full prints it when it says more.
  const report = (name, o, n, text, raw = n) => {
    if (o === n) return;
    changed++;
    console.log(`${name}: ${redact(o)} -> ${redact(n)} | ${oneLine(redact(text))}`);
    if (!args.full) return;
    console.log(`  command:\n${redact(text).replace(/\r\n?/g, '\n').trimEnd().replace(/^/gm, '    ')}`);
    if (raw !== n) console.log(`  reason: ${redact(raw)}`);
  };

  const cmdFns = [
    ['staticCheck', (m, c) => verdict(m.staticCheck, c)],
    ['gatedVerbs', (m, c) => verdict(m.gatedVerbs, c, cwd)],
    ['browserCommand', (m, c) => verdict(m.browserCommand, c, cwd)],
  ];
  for (const c of commands) for (const [name, f] of cmdFns) report(name, f(a, c), f(b, c), c);

  const ansFns = [
    ['isApproving', (m, x) => verdict(m.isApproving, x)],
    ['isBrowserApproving', (m, x) => verdict(m.isBrowserApproving, x)],
  ];
  for (const x of answers) for (const [name, f] of ansFns) report(name, f(a, x), f(b, x), Object.values(x).join(' / '));

  let branch = '';
  if (args.branch) {
    const repos = { unborn: tempRepo(false), born: tempRepo(true) };
    try {
      const before = changed;
      // One JSON string per call, or the lone missing/throws verdict.
      const shapes = (m, c) => {
        const v = verdict((x) => callShape(m.gitCalls(m.scrub(x), repos.unborn), repos.unborn).map((g) => JSON.stringify(g)), c);
        return v.startsWith('[') ? JSON.parse(v) : [v];
      };
      for (const c of commands) {
        const [o, n] = [shapes(a, c), shapes(b, c)];
        for (let i = 0; i < Math.max(o.length, n.length); i++) report(`gitCalls#${i}`, o[i] ?? 'none', n[i] ?? 'none', c);
      }
      const calls = changed - before;
      for (const [label, dir] of Object.entries(repos)) {
        for (const c of commands) {
          const [o, n] = [verdict(a.branchRules, c, dir), verdict(b.branchRules, c, dir)];
          report(`branchRules[${label}]`, allowBlock(o), allowBlock(n), c, n);
        }
      }
      branch = `; --branch: ${calls} gitCalls, ${changed - before - calls} branchRules over ${commands.length * 2} probes (unborn + born)`;
    } finally {
      for (const dir of Object.values(repos)) rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log(`summary: ${changed} changed; ${commands.length} commands, ${answers.length} answers from ${files.length} files${branch}`);
}

main().catch((e) => console.log(`guard-replay failed: ${e?.message}`));
