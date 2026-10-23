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

/** True when the lockfile names Bun as the package manager (pnpm in a Bun repo fails, strate-18). */
export function isBunRepo(dir) {
  return ['bun.lock', 'bun.lockb'].some((f) => existsSync(join(dir, f)));
}

/** [bin, ...args] that installs dependencies in dir: bun in a Bun repo, else pnpm. */
export function installCommand(dir) {
  return [isBunRepo(dir) ? 'bun' : 'pnpm', 'install'];
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
// custom title (written by `claude -n` or /rename), and an in-session subagent its tree
// name (#272) as its Agent `name`; spend, reflect, the worktree check, the statusline
// and agent-name-guard all read it back through parseSessionName.

const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*';
const ISSUE = '[1-9]\\d*';
const SLUG_RE = new RegExp(`^${SLUG}$`);
const COUNT = '[2-9]|[1-9]\\d+'; // a round or dedupe number: 2 and up
const LAZY_SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*?';
const ROLES = ['review', 'recon'];
const WORKERS = ['impl', ...ROLES];
// A lazy repo slug, so `ticket-repo-5-2` reads as the harness's dedupe (-2) of ticket 5, not issue 2 of repo `repo-5`.
// Suffix order: role, then a -r<K> round, then the harness's -<K> dedupe (K >= 2 for both).
// A tree name (#272) spells its lineage, `_` between levels, since the Agent tool rejects dots:
// <dir>_<repo>[_e<N>][_t<N>][_<worker>[-r<K>]], dir → repo → epic → ticket → worker. Any
// lowercase <slug>_<slug> title therefore reads as a tree repo lead (a_b, probe_l1): accepted,
// since no typed or legacy name holds a `_`.
const TYPED_RE = new RegExp(
  `^(?:(?<unit>director|general)-(?<slug>${SLUG})` +
    `|(?<type>epic|ticket)-(?<repo>${LAZY_SLUG})-(?<issue>${ISSUE})(?:-(?<role>${ROLES.join('|')}))?(?:-r(?<round>${COUNT}))?(?:-(?<dedupe>${COUNT}))?` +
    `|(?<dir>${SLUG})_(?<treeRepo>${SLUG})(?:_e(?<epic>${ISSUE}))?(?:_t(?<ticket>${ISSUE}))?(?:_(?<worker>${WORKERS.join('|')})(?:-r(?<workerRound>${COUNT}))?)?)$`,
);
const LEGACY_RE = new RegExp(`^(${SLUG})-(${ISSUE})$`);
/** The Agent tool's limit on a name (tested 2026-10-16). */
const AGENT_NAME_MAX = 64;

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

/** A unit's session name: ('director', scope) | ('epic'|'ticket', repo, N[, role[, round]]) | ('general', topic),
 *  or an in-session subagent's tree name: ('tree', dir, repo[, { epic, ticket, worker, round }]).
 *  A role (review | recon) marks an in-session subagent of the unit; bare is the implementer.
 *  A round (2+) marks a fresh dispatch on a name already used in the session (`-r2`).
 *  Throws on anything that would not parse back to the same type. */
const ARITY = new Map([['director', 1], ['general', 1], ['epic', 2], ['ticket', 2]]);
const ROLE_TYPES = new Set(['epic', 'ticket']);
const TREE_OPTIONS = new Set(['epic', 'ticket', 'worker', 'round']);

function treeName(dir, repo, opts = {}, ...extra) {
  if (extra.length) throw new Error('too many arguments for a tree name');
  const unknown = Object.keys(opts).filter((k) => !TREE_OPTIONS.has(k));
  if (unknown.length) throw new Error(`unknown tree name option ${unknown.join(', ')}: ${[...TREE_OPTIONS].join(' | ')}`);
  const { epic, ticket, worker, round } = opts;
  let name = `${slugArg('scope', dir)}_${slugArg('repo', repo)}`;
  for (const [what, prefix, v] of [['epic', 'e', epic], ['ticket', 't', ticket]]) {
    if (v === undefined) continue;
    const n = issueNumber(v);
    if (!n) throw new Error(`tree name ${what} must be a positive issue number, got ${JSON.stringify(v)}`);
    name += `_${prefix}${n}`;
  }
  if (worker !== undefined && !WORKERS.includes(worker)) throw new Error(`tree name worker must be ${WORKERS.join(' | ')}, got ${JSON.stringify(worker)}`);
  if (round !== undefined && worker === undefined) throw new Error('a tree name round needs a worker (--worker impl | review | recon): it marks a worker re-dispatch');
  if (round !== undefined && !(Number.isInteger(round) && round >= 2)) throw new Error(`tree name round must be a whole number >= 2, got ${JSON.stringify(round)}`);
  if (worker) name += `_${worker}${round ? `-r${round}` : ''}`;
  if (name.length > AGENT_NAME_MAX) throw new Error(`tree name ${name} is over the Agent tool's ${AGENT_NAME_MAX} characters`);
  return name;
}

export function sessionName(type, ...args) {
  if (type === 'tree') return treeName(...args);
  const want = ARITY.get(type);
  if (!want) throw new Error(`unknown session type ${JSON.stringify(type)}: director | epic | ticket | general | tree`);
  if (args.length > want + (ROLE_TYPES.has(type) ? 2 : 0)) throw new Error(`too many arguments for a ${type} session name`);
  if (want === 1) return `${type}-${slugArg(type === 'director' ? 'scope' : 'topic', args[0])}`;
  const repo = slugArg('repo', args[0]);
  const n = issueNumber(args[1]);
  if (!n) throw new Error(`session name issue must be a positive issue number, got ${JSON.stringify(args[1])}`);
  const role = args[2];
  if (role !== undefined && !ROLES.includes(role)) throw new Error(`session name role must be ${ROLES.join(' | ')}, got ${JSON.stringify(role)}`);
  const round = args[3];
  if (round !== undefined && !(Number.isInteger(round) && round >= 2)) throw new Error(`session name round must be a whole number >= 2, got ${JSON.stringify(round)}`);
  return `${type}-${repo}-${n}${role ? `-${role}` : ''}${round ? `-r${round}` : ''}`;
}

/** Parsed identity of a session name, case-folded. name is the canonical typed form
 *  (the join key, role dropped: every agent of a ticket joins to it) and raw the input as given.
 *  A role-suffixed name adds `role`, a -r<K> round `round`, the harness's -<K> dedupe `dedupe`; the bare form has none. A legacy `<slug>-<N>` is a ticket
 *  (legacy: true). A tree name (tree: true) keys to its ticket, else its epic, else (type
 *  'repo') its own `<dir>_<repo>`, and adds its worker as `role`.
 *  Missing, empty or unparseable → { type: 'general', topic: null, name: null }. */
export function parseSessionName(input) {
  const raw = typeof input === 'string' ? input : '';
  const s = raw.trim().toLowerCase();
  const g = TYPED_RE.exec(s)?.groups;
  if (g?.unit === 'director') return { type: 'director', scope: g.slug, name: s, raw };
  if (g?.unit === 'general') return { type: 'general', topic: g.slug, name: s, raw };
  if (g?.type) {
    const name = `${g.type}-${g.repo}-${g.issue}`;
    return { type: g.type, repo: g.repo, issue: Number(g.issue), legacy: false, ...(g.role && { role: g.role }), ...(g.round && { round: Number(g.round) }), ...(g.dedupe && { dedupe: Number(g.dedupe) }), name, raw };
  }
  if (g?.dir) {
    const { dir, treeRepo: repo, epic, ticket, worker, workerRound } = g;
    const type = ticket ? 'ticket' : epic ? 'epic' : 'repo';
    const issue = ticket || epic;
    return { type, tree: true, repo, ...(issue && { issue: Number(issue) }), ...(worker && { role: worker }), ...(workerRound && { round: Number(workerRound) }), legacy: false, name: issue ? `${type}-${repo}-${issue}` : `${dir}_${repo}`, raw };
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
