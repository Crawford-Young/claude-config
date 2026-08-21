#!/usr/bin/env node
// qa.mjs — run a repo's quality gates with honest, compact output.
//
//   node qa.mjs [repo] [--gate <name>] [--list]
//
// Gates come from the repo itself: a justfile `check` recipe when present,
// otherwise the package.json scripts among lint / typecheck / test / e2e.
// Each gate runs FOREGROUND and unpiped; the full output goes to a log file
// and the console gets: an EXIT:<code> line per gate, failure lines on red,
// and all coverage metric lines on green. This replaces the old "pipe to
// tail eats the exit code" family of incidents at the source.

import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { die, log, parseArgs, readIfExists, resolveRepo } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const repo = resolveRepo(args._[0] || '.');
const logDir = join(homedir(), '.claude', 'qa-logs');
mkdirSync(logDir, { recursive: true });

const gates = discoverGates(repo);
if (args.list) {
  for (const g of gates) log(`${g.name}: ${g.cmd}`);
  process.exit(0);
}
const wanted = args.gate ? gates.filter((g) => g.name === args.gate) : gates;
if (wanted.length === 0) die(args.gate ? `no gate named "${args.gate}" (have: ${gates.map((g) => g.name).join(', ')})` : `no gates discovered in ${repo}`);

let failed = 0;
for (const g of wanted) {
  if (g.name === 'e2e') await warnIfPortBusy();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = join(logDir, `${basename(repo)}-${stamp}-${g.name}.log`);
  const r = spawnSync(g.cmd, { cwd: repo, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  writeFileSync(logFile, out);
  const code = r.status ?? -1;
  log(`EXIT:${code} ${g.name} (${g.cmd})`);
  if (code !== 0) {
    failed++;
    const fails = out.split(/\r?\n/).filter((l) => /(fail|error|✕|×|✗)/i.test(l)).slice(0, 40);
    for (const l of fails) log(`  ${l}`);
    log(`  FULL_LOG: ${logFile}`);
  } else {
    // All four coverage metrics, when the runner printed them — never quote fewer.
    const cov = out.split(/\r?\n/).filter((l) => /(Statements|Branches|Functions|Lines)\s*[:|]/.test(l)).slice(0, 8);
    for (const l of cov) log(`  ${l.trim()}`);
  }
}
process.exit(failed === 0 ? 0 : 1);

function discoverGates(repoPath) {
  const found = [];
  const justfile = readIfExists(join(repoPath, 'justfile')) || readIfExists(join(repoPath, 'Justfile'));
  if (justfile && /^check\s*:/m.test(justfile)) {
    found.push({ name: 'check', cmd: 'just check' });
    if (/^e2e\s*:/m.test(justfile) && !/^check\s*:.*e2e/m.test(justfile)) found.push({ name: 'e2e', cmd: 'just e2e' });
    return found;
  }
  const pkg = readIfExists(join(repoPath, 'package.json'));
  if (pkg) {
    const scripts = JSON.parse(pkg).scripts || {};
    for (const name of ['lint', 'typecheck', 'test', 'e2e']) {
      if (scripts[name]) found.push({ name, cmd: `pnpm ${name}` });
    }
    return found;
  }
  // Godot repos: GUT via justfile only; nothing else to guess safely.
  return found;
}

async function warnIfPortBusy() {
  for (const port of [3000, 3001]) {
    const busy = await new Promise((res) => {
      const sock = net.connect({ port, host: '127.0.0.1' });
      sock.once('connect', () => { sock.destroy(); res(true); });
      sock.once('error', () => res(false));
      sock.setTimeout(300, () => { sock.destroy(); res(false); });
    });
    if (busy) log(`WARNING: port ${port} has a listener — e2e reuseExistingServer may drive it. Verify the holder before trusting results.`);
  }
}
