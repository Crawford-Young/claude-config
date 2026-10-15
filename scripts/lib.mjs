// Shared helpers for claude-config workflow scripts.
// No dependencies outside Node builtins — must run on Windows and Linux alike.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Main-module guard that survives junctions/symlinks (#129): compares real paths, since
 * Node resolves import.meta.url through the link but argv[1] stays as typed.
 */
export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

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

// ---- session names (#175) -------------------------------------------------------
// The one source of the session-name format. A unit's windows carry it as their
// custom title (written by `claude -n` or /rename); spend, reflect, the worktree check
// and the statusline all read it back through parseSessionName.

const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*';
const ISSUE = '[1-9]\\d*';
const SLUG_RE = new RegExp(`^${SLUG}$`);
const ROLES = ['review', 'recon'];
const TYPED_RE = new RegExp(`^(?:(director|general)-(${SLUG})|(epic|ticket)-(${SLUG})-(${ISSUE})(?:-(${ROLES.join('|')}))?)$`);
const LEGACY_RE = new RegExp(`^(${SLUG})-(${ISSUE})$`);

/** Lowercase kebab slug of free text, cut to its first `maxWords` words. */
export function slugify(text, maxWords = Infinity) {
  return String(text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, maxWords).join('-');
}

/** Words in a general session's topic. */
export const TOPIC_WORDS = 4;

/** An issue number as sessionName takes it: leading zeros dropped (`0175` → '175'),
 *  null for 0 or anything that isn't a whole number. */
export function issueNumber(v) {
  const m = /^0*([1-9]\d*)$/.exec(typeof v === 'number' || typeof v === 'string' ? String(v) : '');
  return m ? m[1] : null;
}

/** The general session name for free text: slugified, first TOPIC_WORDS words. Throws on empty. */
export function generalSessionName(text) {
  return sessionName('general', slugify(text, TOPIC_WORDS));
}

function slugArg(what, v) {
  if (typeof v !== 'string' || !SLUG_RE.test(v)) throw new Error(`session name ${what} must be a lowercase kebab slug, got ${JSON.stringify(v)}`);
  return v;
}

/** A unit's session name: ('director', scope) | ('epic'|'ticket', repo, N[, role]) | ('general', topic).
 *  A role (review | recon) marks an in-session subagent of the unit; bare is the implementer.
 *  Throws on anything that would not parse back to the same type. */
const ARITY = new Map([['director', 1], ['general', 1], ['epic', 2], ['ticket', 2]]);
const ROLE_TYPES = new Set(['epic', 'ticket']);

export function sessionName(type, ...args) {
  const want = ARITY.get(type);
  if (!want) throw new Error(`unknown session type ${JSON.stringify(type)}: director | epic | ticket | general`);
  if (args.length > want + (ROLE_TYPES.has(type) ? 1 : 0)) throw new Error(`too many arguments for a ${type} session name`);
  if (want === 1) return `${type}-${slugArg(type === 'director' ? 'scope' : 'topic', args[0])}`;
  const repo = slugArg('repo', args[0]);
  const n = issueNumber(args[1]);
  if (!n) throw new Error(`session name issue must be a positive issue number, got ${JSON.stringify(args[1])}`);
  const role = args[2];
  if (role !== undefined && !ROLES.includes(role)) throw new Error(`session name role must be ${ROLES.join(' | ')}, got ${JSON.stringify(role)}`);
  return `${type}-${repo}-${n}${role ? `-${role}` : ''}`;
}

/** Parsed identity of a session name, case-folded. name is the canonical typed form
 *  (the join key, role dropped: every agent of a ticket joins to it) and raw the input as given.
 *  A role-suffixed name adds `role`; the bare form has none. A legacy `<slug>-<N>` is a ticket
 *  (legacy: true). Missing, empty or unparseable → { type: 'general', topic: null, name: null }. */
export function parseSessionName(input) {
  const raw = typeof input === 'string' ? input : '';
  const s = raw.trim().toLowerCase();
  const m = TYPED_RE.exec(s);
  if (m?.[1] === 'director') return { type: 'director', scope: m[2], name: s, raw };
  if (m?.[1] === 'general') return { type: 'general', topic: m[2], name: s, raw };
  if (m) {
    const name = `${m[3]}-${m[4]}-${m[5]}`;
    return { type: m[3], repo: m[4], issue: Number(m[5]), legacy: false, ...(m[6] && { role: m[6] }), name, raw };
  }
  const l = LEGACY_RE.exec(s);
  if (l) return { type: 'ticket', repo: l[1], issue: Number(l[2]), legacy: true, name: `ticket-${l[1]}-${l[2]}`, raw };
  return { type: 'general', topic: null, name: null, raw };
}

/** Whether a session name was chosen for its unit, given the registry's nameSource
 *  (undefined when unknown). A typed name is, whatever its source: what a `claude -n`
 *  launch records is unverified. A legacy-form name is only when user- or peer-set,
 *  since derived auto names (`code-42`) take the same shape. The failsafe never is. */
export function isChosenName(name, nameSource) {
  const p = parseSessionName(name);
  if (!p.name) return false;
  return !p.legacy || nameSource === 'user' || nameSource === 'peer';
}

/** Grouping key for a window's custom title: its typed name when it parses (a legacy
 *  and a typed window of one unit share it), the trimmed title when it doesn't, null
 *  when there is none. */
export function sessionKey(title) {
  const p = parseSessionName(title);
  return p.name ?? (p.raw.trim() || null);
}

/** Resolve a repo argument (relative or absolute) and verify it is a repo. */
export function resolveRepo(p) {
  const abs = resolve(p || '.');
  if (!isRepo(abs)) die(`not a git repository: ${abs}`);
  return abs;
}
