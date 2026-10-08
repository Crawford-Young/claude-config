#!/usr/bin/env node
// guard-replay.mjs — diff guard verdicts between two checkouts over real transcripts (#106).
//   node scripts/guard-replay.mjs <old-checkout> <new-checkout> [--files N] [--days D] [--root <projects-dir>]
// Replays unique Bash/PowerShell commands through staticCheck, gatedVerbs and browserCommand,
// and unique AskUserQuestion answers through isApproving (plain and deletes) and isBrowserApproving,
// in both checkouts. Prints one line per changed verdict plus a summary. Exit 0 always: a report, not a gate.
// Transcripts: <CLAUDE_CONFIG_DIR or ~/.claude>/projects/*/*.jsonl and projects/*/<session>/subagents/*.jsonl, last --days (default 7) or newest --files.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_SHOWN = 120;

function num(v, o) {
  const n = Number(v);
  if (v === undefined || v === '' || !Number.isFinite(n) || n < 0) o.bad = true;
  return n;
}

function parseArgs(argv) {
  const o = { files: null, days: null, root: null, paths: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--files') o.files = num(argv[++i], o);
    else if (argv[i] === '--days') o.days = num(argv[++i], o);
    else if (argv[i] === '--root') o.root = argv[++i];
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

function transcripts(root, { files, days }) {
  const all = [];
  const add = (p) => {
    try {
      all.push({ p, mtime: statSync(p).mtimeMs });
    } catch {
      // vanished mid-scan
    }
  };
  for (const d of safeDir(root)) {
    for (const f of safeDir(join(root, d))) {
      if (f.endsWith('.jsonl')) add(join(root, d, f));
      else {
        const sub = join(root, d, f, 'subagents');
        for (const g of safeDir(sub)) if (g.endsWith('.jsonl')) add(join(sub, g));
      }
    }
  }
  all.sort((a, b) => b.mtime - a.mtime);
  if (days != null) return all.filter((f) => f.mtime >= Date.now() - days * 864e5).map((f) => f.p);
  return all.slice(0, files).map((f) => f.p);
}

function safeDir(p) {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}

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
      if (o?.type === 'user' && a && typeof a === 'object' && !Array.isArray(a)) answers.set(JSON.stringify(a), a);
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

const oneLine = (s, n = MAX_SHOWN) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}...` : t;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.paths.length !== 2 || args.bad) {
    console.log('usage: node scripts/guard-replay.mjs <old-checkout> <new-checkout> [--files N] [--days D] [--root <projects-dir>]');
    return;
  }
  const [a, b] = await Promise.all(args.paths.map(load));
  const files = transcripts(projectsRoot(args.root), args);
  const { commands, answers } = collect(files);
  let changed = 0;
  const cwd = process.cwd();
  const report = (name, o, n, text) => {
    if (o === n) return;
    changed++;
    console.log(`${name}: ${o} -> ${n} | ${oneLine(text)}`);
  };

  const cmdFns = [
    ['staticCheck', (m, c) => verdict(m.staticCheck, c)],
    ['gatedVerbs', (m, c) => verdict(m.gatedVerbs, c, cwd)],
    ['browserCommand', (m, c) => verdict(m.browserCommand, c, cwd)],
  ];
  for (const c of commands) for (const [name, f] of cmdFns) report(name, f(a, c), f(b, c), c);

  const ansFns = [
    ['isApproving', (m, x) => verdict(m.isApproving, x)],
    ['isApproving(deletes)', (m, x) => verdict(m.isApproving, x, { deletes: true })],
    ['isBrowserApproving', (m, x) => verdict(m.isBrowserApproving, x)],
  ];
  for (const x of answers) for (const [name, f] of ansFns) report(name, f(a, x), f(b, x), Object.values(x).join(' / '));

  console.log(`summary: ${changed} changed; ${commands.length} commands, ${answers.length} answers from ${files.length} files`);
}

main().catch((e) => console.log(`guard-replay failed: ${e?.message}`));
