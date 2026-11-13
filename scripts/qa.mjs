#!/usr/bin/env node
// qa.mjs — run a repo's quality gates with honest, compact output.
//
//   node qa.mjs [repo] [--gate <name>] [--list]
//
// Gates come from the repo itself: a justfile `check` recipe when present,
// otherwise the package.json scripts among lint / typecheck / test / e2e,
// otherwise marker files (scripts/test/*.test.mjs, verify-frontmatter.mjs, harness-map.mjs).
// Each gate runs FOREGROUND and unpiped; the full output goes to a log file
// and the console gets: an EXIT:<code> line per gate, failure lines on red,
// and all coverage metric lines on green. This replaces the old "pipe to
// tail eats the exit code" family of incidents at the source.
//
// Gate runs hold a machine-wide suite lock (#384), so parallel worktrees queue instead
// of racing each other's load: see acquireSuiteLock below. --list takes no lock.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { die, isBunRepo, isMain, log, parseArgs, readIfExists, resolveRepo } from './lib.mjs';

async function main() {
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

  const lock = await acquireSuiteLock({ dir: lockDir(), repo });
  releaseOnSignals(lock);
  const h = lock.holder;
  const waitLine = `qa-lock: waited ${(lock.waitedMs / 1000).toFixed(1)} s${h ? ` for pid ${h.pid}, repo ${h.repo}, session ${h.session}` : ''}\n`;

  let failed = 0;
  for (const g of wanted) {
    if (g.name === 'e2e') await warnIfPortBusy();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = join(logDir, `${basename(repo)}-${stamp}-${g.name}.log`);
    const r = spawnSync(g.cmd, { cwd: repo, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    writeFileSync(logFile, waitLine + out);
    const code = r.status ?? -1;
    log(`EXIT:${code} ${g.name} (${g.cmd})`);
    const verdict = gateVerdict(g, code, out);
    if (!verdict.ok) {
      failed++;
      if (verdict.reason) log(`  ${verdict.reason}`);
      const fails = out.split(/\r?\n/).filter((l) => /(fail|error|✕|×|✗)/i.test(l)).slice(0, 40);
      for (const l of fails) log(`  ${l}`);
      log(`  FULL_LOG: ${logFile}`);
    } else {
      // All four coverage metrics, when the runner printed them — never quote fewer.
      const cov = out.split(/\r?\n/).filter((l) => /(Statements|Branches|Functions|Lines)\s*[:|]/.test(l)).slice(0, 8);
      for (const l of cov) log(`  ${l.trim()}`);
    }
  }
  await lock.release();
  process.exit(failed === 0 ? 0 : 1);
}

// ---- suite lock (#384) ---------------------------------------------------------------
// One gate run per machine: a mkdir lock whose owner.json records the holder's pid, its
// OS start time, repo and session name. A waiter polls; a holder whose pid is dead, or
// alive with another start time (the pid was reused), is taken over under a short
// `<dir>.takeover` mutex, so two waiters never both break one stale lock. A crash-left
// lock heals itself that way, since its pid dies with the run.

const TAKEOVER_STALE_MS = 30_000; // a taker crashed mid-takeover: its mutex stops blocking
const OWNERLESS_GRACE_MS = 10_000; // a lock dir whose holder died before writing owner.json
const RECHECK_START_MS = 30_000; // a waiter re-reads a live holder's start time this often

/** The machine-wide lock dir; CLAUDE_QA_LOCK_DIR gives a test run a private one. */
export function lockDir() {
  return process.env.CLAUDE_QA_LOCK_DIR || join(homedir(), '.claude', 'qa-lock');
}

/** The OS start time of `pid` as an opaque string, or null when it is gone or unreadable. */
export function procStart(pid) {
  if (process.platform === 'linux') {
    const stat = readIfExists(`/proc/${pid}/stat`);
    return stat ? stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null : null; // field 22, starttime
  }
  const [cmd, argv] =
    process.platform === 'win32'
      ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${Number(pid)} -ErrorAction Stop).StartTime.ToFileTimeUtc()`]]
      : ['ps', ['-o', 'lstart=', '-p', String(Number(pid))]];
  const r = spawnSync(cmd, argv, { encoding: 'utf8', windowsHide: true });
  const out = (r.stdout ?? '').trim();
  return r.status === 0 && out ? out : null;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // exists, owned by someone else
  }
}

/** 'dead' | 'reused' | 'alive' for a lock record. An unreadable start time cannot prove reuse. */
export function holderState(rec) {
  if (!Number.isInteger(rec?.pid) || !pidAlive(rec.pid)) return 'dead';
  if (!rec.start) return 'alive';
  const now = procStart(rec.pid);
  if (now === null) return pidAlive(rec.pid) ? 'alive' : 'dead';
  return now === rec.start ? 'alive' : 'reused';
}

/** The session's name from the CLI registry (CLAUDE_PID's entry), else '-'. */
function sessionName() {
  const dir = process.env.CLAUDE_SESSIONS_DIR || join(homedir(), '.claude', 'sessions');
  try {
    const name = JSON.parse(readIfExists(join(dir, `${process.env.CLAUDE_PID}.json`)) || 'null')?.name;
    return typeof name === 'string' && name.trim() ? name.trim() : '-';
  } catch {
    return '-';
  }
}

/** The lock's current state: { rec, id, ageMs } with id naming this exact lock dir and owner, or null when free. */
function readLock(dir) {
  let st;
  try {
    st = statSync(dir);
  } catch {
    return null;
  }
  const raw = readIfExists(join(dir, 'owner.json'));
  let rec = null;
  try {
    rec = raw && JSON.parse(raw);
  } catch {
    // half-written: renameSync makes this unreachable short of a foreign writer
  }
  return { rec, id: `${st.ino}:${st.birthtimeMs}:${raw}`, ageMs: Date.now() - st.mtimeMs };
}

const removeDir = (d) => rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

/** Break the stale lock `seen` unless someone changed it first; true when it was broken. */
async function takeOver(dir, seen) {
  const mutex = `${dir}.takeover`;
  try {
    mkdirSync(mutex);
  } catch {
    let age = 0;
    try {
      age = Date.now() - statSync(mutex).mtimeMs;
    } catch {
      // the other taker just finished
    }
    if (age > TAKEOVER_STALE_MS) await removeDir(mutex);
    return false; // another waiter is taking over; poll again
  }
  try {
    if (readLock(dir)?.id !== seen.id) return false;
    await removeDir(dir);
    return true;
  } finally {
    await removeDir(mutex);
  }
}

/**
 * Wait for and hold the suite lock at `dir`. Logs the holder once per distinct holder it
 * waits on, and each takeover. → { waitedMs, holder (the first one waited on, or null), release() }.
 */
export async function acquireSuiteLock({ dir, repo, session = sessionName(), log: say = log, pollMs = 500 }) {
  const t0 = Date.now();
  const start = procStart(process.pid);
  const mine = JSON.stringify({ pid: process.pid, start, repo, session, since: t0 });
  mkdirSync(join(dir, '..'), { recursive: true });
  let holder = null;
  let announced = null;
  let checked = { id: null, at: 0 };
  for (;;) {
    try {
      mkdirSync(dir);
      const tmp = join(dir, 'owner.json.tmp');
      writeFileSync(tmp, mine);
      renameSync(tmp, join(dir, 'owner.json'));
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const seen = readLock(dir);
    if (seen) {
      let state = 'alive';
      if (!seen.rec) state = seen.ageMs > OWNERLESS_GRACE_MS ? 'dead' : 'alive';
      else if (checked.id !== seen.id || Date.now() - checked.at > RECHECK_START_MS) {
        state = holderState(seen.rec);
        checked = { id: seen.id, at: Date.now() };
      } else if (!pidAlive(seen.rec.pid)) state = 'dead';
      if (state !== 'alive') {
        if (await takeOver(dir, seen)) say(`qa-lock: took over from pid ${seen.rec?.pid ?? '?'} (${state === 'dead' ? 'dead' : 'pid reused'}), repo ${seen.rec?.repo ?? '?'}`);
        continue;
      }
      if (seen.rec && announced !== seen.id) {
        announced = seen.id;
        holder ??= seen.rec;
        say(`qa-lock: waiting on pid ${seen.rec.pid}, repo ${seen.rec.repo}, session ${seen.rec.session} (held since ${new Date(seen.rec.since).toISOString()})`);
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  let released = false;
  const ours = () => readIfExists(join(dir, 'owner.json')) === mine;
  return {
    waitedMs: Date.now() - t0,
    holder,
    async release() {
      if (released) return;
      released = true;
      if (ours()) await removeDir(dir);
    },
    releaseSync() {
      if (released) return;
      released = true;
      try {
        if (ours()) rmSync(dir, { recursive: true, force: true });
      } catch {
        // a pinned dir (Node 24 rmSync skips retries): our pid dies with us, so the next waiter takes over
      }
    },
  };
}

/** Release `lock` on SIGINT (exit 130), SIGTERM (exit 143) and, as a last resort, on exit. */
export function releaseOnSignals(lock, proc = process) {
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    proc.on(signal, async () => {
      await lock.release();
      proc.exit(code);
    });
  }
  proc.on('exit', () => lock.releaseSync());
}

export function discoverGates(repoPath) {
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
    // The lockfile names the runner: pnpm in a Bun repo fails every gate (strate-18).
    const bun = isBunRepo(repoPath);
    for (const name of ['lint', 'typecheck', 'test', 'e2e']) {
      if (scripts[name]) found.push({ name, cmd: bun ? `bun run ${name}` : `pnpm ${name}` });
    }
    return found;
  }
  // Marker files: repos with no justfile/package.json (claude-config's own CI steps).
  const testDir = join(repoPath, 'scripts', 'test');
  if (existsSync(testDir) && readdirSync(testDir).some((f) => f.endsWith('.test.mjs'))) {
    found.push({ name: 'test', cmd: 'node --test "scripts/test/*.test.mjs"' });
  }
  if (existsSync(join(repoPath, 'scripts', 'verify-frontmatter.mjs'))) found.push({ name: 'frontmatter', cmd: 'node scripts/verify-frontmatter.mjs' });
  if (existsSync(join(repoPath, 'scripts', 'harness-map.mjs'))) found.push({ name: 'harness-map', cmd: 'node scripts/harness-map.mjs check' });
  // Godot repos: GUT via justfile only; nothing else to guess safely.
  return found;
}

/** Verdict for one gate run. A node --test gate that ran no tests (unmatched glob exits 0 with `tests 0`) fails, as in CI. */
export function gateVerdict(gate, code, out) {
  if (code !== 0) return { ok: false };
  if (gate.cmd.startsWith('node --test ')) {
    // Same pattern as ci.yml: spec reporter prints `ℹ tests N`, TAP prints `# tests N`.
    if (!/^(?:ℹ|#) tests [1-9]/m.test(out)) return { ok: false, reason: 'no "tests N" line with N>=1 in output — nothing ran' };
  }
  return { ok: true };
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

// Last, so main sees every module-level const initialized.
if (isMain(import.meta.url)) await main();
