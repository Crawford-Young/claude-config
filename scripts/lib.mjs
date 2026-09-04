// Shared helpers for claude-config workflow scripts.
// No dependencies outside Node builtins — must run on Windows and Linux alike.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Workspace root (~/code by default; CLAUDE_WORKSPACE_ROOT overrides for tests/remotes). */
export function workspaceRoot() {
  return process.env.CLAUDE_WORKSPACE_ROOT || join(homedir(), 'code');
}

/** Directory that holds all worktrees: <root>/.worktrees */
export function worktreesDir() {
  return join(workspaceRoot(), '.worktrees');
}

/** Run a git command in a repo. Returns { code, out, err }. Throws only on spawn failure. */
export function git(repo, args, opts = {}) {
  const r = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  if (r.error) throw r.error;
  return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

/** Run git; exit the script with the git error if it fails. */
export function gitOrDie(repo, args) {
  const r = git(repo, args);
  if (r.code !== 0) die(`git ${args.join(' ')} failed in ${repo}:\n${r.err || r.out}`);
  return r.out;
}

/** Current branch of a repo ('' when detached or not a repo). */
export function currentBranch(repo) {
  try {
    return git(repo, ['branch', '--show-current']).out;
  } catch {
    return '';
  }
}

/** Default branch of the repo's origin (falls back to 'main'). */
export function defaultBranch(repo) {
  const r = git(repo, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (r.code === 0 && r.out) return r.out.replace(/^origin\//, '');
  for (const b of ['main', 'master']) {
    if (git(repo, ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${b}`]).code === 0) return b;
  }
  return 'main';
}

/** True if the path is a git repo work tree root. */
export function isRepo(p) {
  return existsSync(join(p, '.git'));
}

/** Discover repos under the workspace: web/games/apps domain dirs plus claude-config/docs at root. */
export function discoverRepos(root = workspaceRoot()) {
  const out = [];
  for (const domain of ['web', 'games', 'apps']) {
    const dir = join(root, domain);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (existsSync(join(p, '.git'))) out.push(p);
    }
  }
  for (const name of ['claude-config', 'docs']) {
    const p = join(root, name);
    if (existsSync(join(p, '.git'))) out.push(p);
  }
  return out;
}

/** Read a file if it exists, else null. */
export function readIfExists(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/** Env-file names to copy into a new worktree when no .worktreeinclude exists. */
export const DEFAULT_ENV_FILES = ['.env', '.env.local'];

/** Parse a .worktreeinclude file: one filename/glob-less path per line, # comments. */
export function parseWorktreeInclude(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/** Recursively find checklists under any `checklists/active/` dir (depth-capped). */
export function findActiveChecklists(docsRoot) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = join(dir, e.name);
      if (e.name === 'active' && dir.endsWith('checklists')) {
        for (const f of readdirSync(p)) if (f.endsWith('.md')) found.push(join(p, f));
      } else if (!['node_modules', '.git', 'done', 'archive'].includes(e.name)) {
        walk(p, depth + 1);
      }
    }
  };
  walk(docsRoot, 0);
  return found;
}

/**
 * PID of the process LISTENING on `port`, from `netstat -ano` output.
 * Anchored to the local-address column on purpose: a substring test for
 * `:3000` also matches `:30001`, and the caller kills what this returns.
 */
export function listenerPidFromNetstat(stdout, port) {
  const local = new RegExp(`^\\s*\\S+\\s+\\S+:${port}\\s`);
  const line = (stdout || '').split(/\r?\n/).find((l) => local.test(l) && /LISTENING/i.test(l));
  if (!line) return null;
  const pid = line.trim().split(/\s+/).pop();
  return /^\d+$/.test(pid) ? pid : null;
}

export function log(msg) {
  try {
    process.stdout.write(`${msg}\n`);
  } catch {
    // EPIPE when the consumer (head, etc.) closed early — not an error
  }
}
process.stdout.on?.('error', (e) => {
  if (e && e.code === 'EPIPE') process.exit(0);
});

export function die(msg, code = 1) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(code);
}

/** UTC timestamp in the checklist done-stamp format. */
export function utcStamp(d = new Date()) {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Minimal argv parser: positional args plus --flag / --key value. */
export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      args._.push(...argv.slice(i + 1).map(String));
      break;
    }
    if (a.startsWith('--') || (a.startsWith('-') && a.length === 2)) {
      const key = a.startsWith('--') ? a.slice(2) : a.slice(1);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

/** Resolve a repo argument (relative or absolute) and verify it is a repo. */
export function resolveRepo(p) {
  const abs = resolve(p || '.');
  if (!isRepo(abs)) die(`not a git repository: ${abs}`);
  return abs;
}
