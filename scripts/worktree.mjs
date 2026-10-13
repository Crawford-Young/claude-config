#!/usr/bin/env node
// worktree.mjs — create, pre-push lint, remove, and list feature worktrees.
//
//   node worktree.mjs new <repo> <slug> [--branch feat/<slug>] [--base main] [--install]
//   node worktree.mjs prepush <worktree-path> [--base main]
//   node worktree.mjs remove <worktree-path> [--port <n>] [--dry-run]
//   node worktree.mjs list [repo]
//
// `new` cuts the branch from origin/<default>, verifies the cut is clean, and
// copies env files per the repo's .worktreeinclude (default: .env, .env.local),
// and prints the unit's `claude -n` launch line (session-name.mjs).
// `remove` encodes the Windows-safe removal sequence (git remove → force →
// recursive delete → prune) so node_modules lock/long-path failures never need
// hand recovery. It first stops whatever listens on the worktree's serve port (a
// serve-type Justfile recipe's or package.json script's -p/--port/PORT=, or --port):
// stopping the `just serve` wrapper can leave the server holding the directory.
// `prepush` runs commitlint over origin/<base>..HEAD when the checkout has a commitlint
// config and exits non-zero on a failure. Chain it before the push
// (`prepush <wt> && git -C <wt> push ...`) so the push stays a visible, approval-gated
// command rather than one this script runs. Re-running `remove` on a half-removed
// worktree (registration gone, directory left behind) deletes it if empty, or lists
// what remains if not.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  DEFAULT_ENV_FILES,
  defaultBranch,
  die,
  generalSessionName,
  git,
  gitOrDie,
  log,
  isChosenName,
  isMain,
  issueNumber,
  listenerPidFromNetstat,
  parseArgs,
  parseSessionName,
  parseWorktreeInclude,
  readIfExists,
  resolveRepo,
  sessionName,
  slugify,
  workspaceRoot,
  worktreesDir,
} from './lib.mjs';
import { launchCommand } from './session-name.mjs';

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];

function cmdNew() {
  const repo = resolveRepo(args._[1]);
  const slug = args._[2];
  if (!slug) die('usage: worktree.mjs new <repo> <slug> [--branch <name>] [--install]');

  const repoName = basename(repo);
  const branch = args.branch || `feat/${slug}`;
  const unit = expectedUnit(repoName, slug, branch); // before any git side effect
  const base = args.base || defaultBranch(repo);
  const wtPath = join(worktreesDir(), `${repoName}-${slug}`);
  if (existsSync(wtPath)) die(`worktree path already exists: ${wtPath}`);
  mkdirSync(worktreesDir(), { recursive: true });

  gitOrDie(repo, ['fetch', 'origin', base]);
  gitOrDie(repo, ['worktree', 'add', wtPath, '-b', branch, `origin/${base}`]);

  // A branch cut from anything but origin/<base> drags foreign commits into the PR range.
  const ahead = gitOrDie(wtPath, ['log', '--oneline', `origin/${base}..HEAD`]);
  if (ahead) {
    log(`WARNING: new branch is not clean off origin/${base}:\n${ahead}`);
  }

  // Env files: .worktreeinclude wins; otherwise the default pair.
  const includeText = readIfExists(join(repo, '.worktreeinclude'));
  const wanted = includeText ? parseWorktreeInclude(includeText) : DEFAULT_ENV_FILES;
  const copied = [];
  for (const rel of wanted) {
    const src = join(repo, rel);
    if (existsSync(src)) {
      cpSync(src, join(wtPath, rel), { recursive: true });
      copied.push(rel);
    }
  }

  if (args.install) {
    const r = spawnSync('pnpm', ['install'], { cwd: wtPath, stdio: 'inherit', shell: true });
    if (r.status !== 0) log('WARNING: pnpm install failed — run it manually before gates.');
  }

  log(`worktree: ${wtPath}`);
  log(`branch:   ${branch} (from origin/${base})`);
  log(`env:      ${copied.length ? copied.join(', ') : 'none found to copy'}`);
  if (!includeText && copied.length === 0 && existsSync(join(repo, 'package.json'))) {
    log('note:     no .worktreeinclude and no env files found — verify none are needed.');
  }
  log('note:     dev servers in a worktree need their own port; never reuse another session\'s.');

  log(`launch:   ${launchCommand(unit.name)}`);
  warnOnSessionName(unit);
}

/** Directory of session-registry JSON files: ~/.claude/sessions, CLAUDE_SESSIONS_DIR overrides. */
function sessionsDir() {
  return process.env.CLAUDE_SESSIONS_DIR || join(homedir(), '.claude', 'sessions');
}

/** Leading issue number of a slug/branch-tail (`72-foo` -> '72', `007-foo` -> '7'), or
 *  null; `0-foo` has none, as sessionName takes only a positive number. */
function leadingIssueNumber(s) {
  const m = /^(\d+)-/.exec(s || '');
  return m ? issueNumber(m[1]) : null;
}

/** The worktree's unit: a ticket on the slug's leading issue number, else the branch's;
 *  with neither, a general session on the slug. → { name, repo, issue } (issue null for general). */
function expectedUnit(repoName, slug, branch) {
  const n = leadingIssueNumber(slug) || leadingIssueNumber((branch || '').replace(/^feat\//, ''));
  const repo = slugify(repoName);
  if (n && repo) return { name: sessionName('ticket', repo, n), repo, issue: Number(n) };
  return { name: generalSessionName(slugify(slug) || 'worktree'), repo, issue: null };
}

// Warn (never block) when the running session's name won't join this unit's spend
// and reflect: auto-generated, untyped (the parser's general failsafe), or another
// unit's. A ticket or epic on this repo and issue passes, typed or legacy, and so
// does an orchestrator cutting a child's worktree (a director, or an epic of this
// repo); with no issue to check against, any chosen name passes. The fix is the launch line for the
// next window, or a /rename for this one (agents can't run slash commands). Silent
// on non-Claude shells (no CLAUDE_PID / no registry file).
function warnOnSessionName(unit) {
  const pid = process.env.CLAUDE_PID;
  if (!pid) return;

  const text = readIfExists(join(sessionsDir(), `${pid}.json`));
  if (!text) return;

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return;
  }

  if (!data || typeof data !== 'object') return;
  const { name, nameSource } = data;
  const p = parseSessionName(name);
  const shown = name ? `session name '${name}'` : 'session has no name and';
  const userSet = nameSource === 'user' || nameSource === 'peer';
  let problem;
  if (!isChosenName(name, nameSource)) {
    if (!userSet) problem = `${shown} is auto-generated`;
    else problem = name ? `${shown} has no type` : 'session has no name';
  } else if (unit.issue !== null && !((p.type === 'ticket' || p.type === 'epic') && p.repo === unit.repo && p.issue === unit.issue)) {
    // a director or an epic of this repo is cutting a child's worktree: it keeps its own name
    if (p.type === 'director' || (p.type === 'epic' && p.repo === unit.repo)) return;
    problem = `${shown} names another unit`;
  } else return;
  log(`WARNING: ${problem} — spend and reflect join on the parsed session name. Launch the unit as:\n  ${launchCommand(unit.name)}\nor name this session now with:\n  /rename ${unit.name}`);
}

/** Parent repo named by a linked worktree's .git pointer file (<repo>/.git/worktrees/<name> → <repo>), or null. */
function pointerRepo(wtPath) {
  const gitFile = readIfExists(join(wtPath, '.git'));
  const m = gitFile && gitFile.match(/gitdir:\s*(.+)/);
  return m ? resolve(m[1].trim(), '..', '..', '..') : null;
}

const COMMITLINT_CONFIGS = [
  ...['js', 'cjs', 'mjs', 'ts', 'cts', 'mts'].map((e) => `commitlint.config.${e}`),
  '.commitlintrc',
  ...['json', 'yaml', 'yml', 'js', 'cjs', 'mjs', 'ts', 'cts', 'mts'].map((e) => `.commitlintrc.${e}`),
];

/** The commitlint config file in `dir` ('package.json' for its `commitlint` key), or null. */
export function commitlintConfig(dir) {
  const file = COMMITLINT_CONFIGS.find((n) => existsSync(join(dir, n)));
  if (file) return file;
  try {
    if (JSON.parse(readIfExists(join(dir, 'package.json')) || '{}')?.commitlint) return 'package.json';
  } catch {
    // unparseable package.json: no config there
  }
  return null;
}

/** Entry script of @commitlint/cli under `dir`'s node_modules, or null. Run with node, so no .cmd shim or shell. */
function commitlintCli(dir) {
  const pkgDir = join(dir, 'node_modules', '@commitlint', 'cli');
  try {
    const { bin } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    const entry = typeof bin === 'string' ? bin : bin?.commitlint;
    return entry ? join(pkgDir, entry) : null;
  } catch {
    return null;
  }
}

// CI was the first place a bad subject failed (dog-eat-dog#23: a reword, a force-push and
// an extra CI round), because the worktree's commit-msg hook never ran. This is the local
// gate: lint every commit the push would send.
function cmdPrepush() {
  if (!args._[1]) die('usage: worktree.mjs prepush <worktree-path> [--base main]');
  const wtPath = resolve(args._[1]);
  const repo = pointerRepo(wtPath) || (existsSync(join(wtPath, '.git')) ? wtPath : null);
  if (!repo) die(`${wtPath} is not a git checkout`);

  const config = commitlintConfig(wtPath);
  if (!config) return log(`commitlint: no config in ${wtPath} — skipped`);

  const base = args.base || defaultBranch(repo);
  const from = `origin/${base}`;
  gitOrDie(wtPath, ['fetch', 'origin', base]);
  const count = Number(gitOrDie(wtPath, ['rev-list', '--count', `${from}..HEAD`]));
  if (count === 0) return log(`commitlint: no commits over ${from}..HEAD`);

  // The worktree's own install wins; one without node_modules borrows the main checkout's
  // (its config then comes from the main checkout too: commitlint reads it from its cwd).
  const home = [wtPath, repo].find((d) => commitlintCli(d));
  if (!home) die(`commitlint config ${config} found but @commitlint/cli is not installed in ${wtPath} or ${repo} — run pnpm install, then re-run prepush`);
  const head = gitOrDie(wtPath, ['rev-parse', 'HEAD']);
  const r = spawnSync(process.execPath, [commitlintCli(home), '--from', from, '--to', head], { cwd: home, encoding: 'utf8' });
  if (r.error) die(`commitlint could not run: ${r.error.message}`);
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (r.status !== 0) die(`commitlint failed over ${from}..HEAD — reword the failing commits before pushing:\n${out}`);
  if (out) log(out);
  log(`commitlint: ${count} commit${count === 1 ? '' : 's'} clean over ${from}..HEAD (${config})`);
}

const SERVE_NAME = /serve|dev|start|preview/i;
const PORT_RE = /(?:^|\s)(?:-p|--port)(?:\s+|=)(\d{2,5})(?!\d)|\bPORT=(\d{2,5})(?!\d)/g;

/** Ports in `text`'s -p/--port/PORT= settings. */
function portsIn(text) {
  return [...text.matchAll(PORT_RE)].map((m) => Number(m[1] || m[2])).filter((p) => p > 0 && p < 65536);
}

/**
 * Serve ports a checkout declares: the -p/--port/PORT= values in its serve-type
 * (serve/dev/start/preview) Justfile recipes and package.json scripts. Other recipes are
 * ignored, so an `ssh -p 22` elsewhere is never read as a server.
 */
export function servePorts(dir) {
  const bodies = [];
  const just = readIfExists(join(dir, 'Justfile')) ?? readIfExists(join(dir, 'justfile')) ?? '';
  let recipe = null;
  for (const line of just.split(/\r?\n/)) {
    if (/^\s/.test(line)) {
      if (recipe && SERVE_NAME.test(recipe)) bodies.push(line);
      continue;
    }
    // a recipe header, `name args: deps`; `name := value` is a variable, not a recipe
    const m = /^@?([A-Za-z_][\w-]*)[^:#]*:(?!=)/.exec(line);
    recipe = m ? m[1] : line.trim() === '' ? recipe : null;
  }
  try {
    const { scripts } = JSON.parse(readIfExists(join(dir, 'package.json')) || '{}') || {};
    for (const [name, body] of Object.entries(scripts || {})) {
      if (SERVE_NAME.test(name) && typeof body === 'string') bodies.push(body);
    }
  } catch {
    // unparseable package.json: no scripts to read
  }
  return [...new Set(bodies.flatMap(portsIn))].sort((a, b) => a - b);
}

/** PIDs listening on a TCP port (netstat on Windows, lsof elsewhere; [] if neither answers). */
function listenerPids(port) {
  if (process.platform === 'win32') {
    const pid = listenerPidFromNetstat(spawnSync('netstat', ['-ano'], { encoding: 'utf8' }).stdout, port);
    return pid ? [pid] : [];
  }
  const r = spawnSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  return [...new Set((r.stdout || '').split(/\s+/).filter((p) => /^\d+$/.test(p)))];
}

/** Image name of a PID for the log line, or 'process'. */
function processName(pid) {
  const r = process.platform === 'win32'
    ? spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
    : spawnSync('ps', ['-p', pid, '-o', 'comm='], { encoding: 'utf8' });
  const out = (r.stdout || '').trim();
  return (process.platform === 'win32' ? /^"([^"]+)"/.exec(out)?.[1] : out) || 'process';
}

/** Kill a PID and its children. → true on success. */
function stopPid(pid) {
  const r = process.platform === 'win32'
    ? spawnSync('taskkill', ['/F', '/T', '/PID', pid], { encoding: 'utf8' })
    : spawnSync('kill', ['-9', pid], { encoding: 'utf8' });
  return r.status === 0;
}

/** Ports from --port (comma-separated), dying on a value that isn't one. */
function flagPorts() {
  if (args.port === undefined) return [];
  const ports = String(args.port).split(',').map(Number);
  if (args.port === true || ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) die('--port needs a port number (or a comma-separated list)');
  return ports;
}

// Stopping the `just serve` wrapper left `node …serve… -p 8060` alive and holding the
// worktree, so `git worktree remove` failed with "Permission denied" (dog-eat-dog#17).
// Stop the listener itself, whatever started it.
function stopServePorts(wtPath, dryRun) {
  const ports = [...new Set([...servePorts(wtPath), ...flagPorts()])];
  for (const port of ports) {
    for (const pid of listenerPids(port)) {
      const what = `${processName(pid)} (PID ${pid}) listening on port ${port}`;
      if (dryRun) log(`would stop ${what}`);
      else if (stopPid(pid)) log(`stopped ${what}`);
      else log(`WARNING: could not stop ${what}`);
    }
  }
}

function cmdRemove() {
  if (!args._[1]) die('usage: worktree.mjs remove <worktree-path> [--port <n>] [--dry-run]');
  const wtPath = resolve(args._[1]);
  if (!existsSync(wtPath)) die(`worktree path not found: ${wtPath}`);
  const dryRun = Boolean(args['dry-run']);

  const repo = pointerRepo(wtPath);
  if (!repo) {
    // No pointer: either a half-removed worktree (git dropped the registration but the
    // directory delete failed) or a mistyped path. Only an empty directory is safe to finish.
    let left;
    try {
      if (!statSync(wtPath).isDirectory()) die(`${wtPath} is not a directory`);
      left = readdirSync(wtPath);
    } catch (e) {
      die(`could not inspect ${wtPath}: ${e.message}`);
    }
    if (left.length === 0) {
      if (dryRun) return log(`would remove ${wtPath} (half-removed worktree: no .git pointer, empty directory)`);
      try {
        rmdirSync(wtPath); // only ever removes an empty directory
      } catch (e) {
        die(holderMessage(wtPath, e));
      }
      log(`removed ${wtPath} (half-removed worktree: no .git pointer, empty directory)`);
      return;
    }
    const shown = left.slice(0, 10).map((n) => `  ${n}`).join('\n');
    const more = left.length > 10 ? `\n  ...and ${left.length - 10} more` : '';
    die(`${wtPath} does not look like a linked worktree (.git pointer missing) and is not empty; remove it by hand if intended. Contents:\n${shown}${more}`);
  }
  stopServePorts(wtPath, dryRun);
  if (dryRun) return log(`would remove ${wtPath} (registered in ${repo})`);

  let r = git(repo, ['worktree', 'remove', wtPath]);
  if (r.code !== 0) r = git(repo, ['worktree', 'remove', '--force', wtPath]);
  if (r.code !== 0 || existsSync(wtPath)) {
    // Windows: node_modules file locks and >260-char paths defeat git's removal.
    // fs.rm with retries handles both (node uses \\?\ long paths internally).
    try {
      rmSync(wtPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (e) {
      die(holderMessage(wtPath, e));
    }
  }
  gitOrDie(repo, ['worktree', 'prune']);
  log(`removed ${wtPath} (pruned in ${repo})`);
}

/** Delete-failure message. The script can't see a session's tracked cwd, so it names the likely holder. */
function holderMessage(wtPath, e) {
  return `could not delete ${wtPath}: ${e.message}\nLikely holder: a Claude session or shell whose working directory is inside this worktree. Move it out first (a separate \`cd ~/code\` call), then re-run.`;
}

function cmdList() {
  const targets = [];
  if (args._[1]) {
    targets.push(resolveRepo(args._[1]));
  } else {
    const root = workspaceRoot();
    for (const domain of ['web', 'games', 'apps']) {
      const dir = join(root, domain);
      if (!existsSync(dir)) continue;
      for (const name of readdirSafe(dir)) {
        const p = join(dir, name);
        if (existsSync(join(p, '.git'))) targets.push(p);
      }
    }
    for (const name of ['claude-config', 'docs']) {
      const p = join(root, name);
      if (existsSync(join(p, '.git'))) targets.push(p);
    }
  }
  for (const repo of targets) {
    const r = git(repo, ['worktree', 'list']);
    const lines = r.out.split('\n').filter(Boolean);
    if (lines.length > 1 || args._[1]) {
      log(`# ${repo}`);
      for (const l of lines) log(`  ${l}`);
    }
  }
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

if (isMain(import.meta.url)) {
  if (cmd === 'new') cmdNew();
  else if (cmd === 'prepush') cmdPrepush();
  else if (cmd === 'remove') cmdRemove();
  else if (cmd === 'list') cmdList();
  else die('usage: worktree.mjs new <repo> <slug> | prepush <path> | remove <path> | list [repo]');
}
