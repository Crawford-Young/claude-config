// Shared helpers for claude-config workflow scripts.
// No dependencies outside Node builtins — must run on Windows and Linux alike.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
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

// ---- agent names (#175, #272, #360) ---------------------------------------------
// The ONE place the agent-name grammar is documented; session-name.mjs builds it, and
// audit, reflect, the statusline, session-start and agent-name-guard read it back
// through parseAgentName. Strate (Rust) ports this block.
//
//   name   = [<role>_]<kind>_<target>        <= 64 chars when built, lowercase; no role: a charge key (form charge)
//   role   = slug                             a free label the spawner picks (manager, impl, review, researcher…)
//   kind   = repo | epic | issue | pr | topic
//   target = <repo>                           kind repo
//          | <repo>-<N>                       kind epic | issue | pr  (N = [1-9]\d*; the LAST -<digits> is N, so the repo slug is greedy)
//          | <slug>                           kind topic
//   slug   = [a-z0-9]+(-[a-z0-9]+)*
//   charge key = <kind>_<target>              the name minus its role
//
// The bound is the Agent `name` schema (CC 2.1.314): /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.
// Titles from `claude -n`, /rename and cloud sessions are free text. Parsing trims and
// case-folds, tries this grammar first, then the legacy forms, which map to the same charge:
//
//   legacy form                                                     form   role               charge
//   ticket-<r>-<N>[-review|-recon][-r<K>][-<K>]  (lazy <r>)          typed  the suffix, else null  issue r#N
//   epic-<r>-<N>…                                (same suffixes)     typed  the suffix, else null  epic r#N
//   director-<s>                                                    typed  director           topic s
//   general-<s>                                                     typed  null               topic s
//   <dir>_<repo>[_e<N>][_t<N>][_<impl|review|recon>[-r<K>]]         tree   the worker, else null  issue repo#tN, else epic repo#eN, else repo
//   <slug>-<N>                                                      bare   null               issue slug#N
//
// (K >= 2 in both round and dedupe suffixes.) A bare name is only chosen when the user or
// a peer set it, since derived auto titles (`code-42`) take the same shape. Forms: agent
// (role + charge), charge (a bare key, role null), then typed, tree and bare (legacy). One
// overlap follows from the order: a tree name whose repo is a kind word (`h_repo_t5`) reads
// as this grammar (role h, repo t5).
// Strate resolves an agent's charge from its git branch → PR → issue first, then its
// name, then its parent's charge; this harness reads the name alone.

const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*';
const NUM = '[1-9]\\d*';
const SLUG_RE = new RegExp(`^${SLUG}$`);
/** The charge kinds, in the grammar's order. */
export const CHARGE_KINDS = ['repo', 'epic', 'issue', 'pr', 'topic'];
const AGENT_RE = new RegExp(`^(?:(?<role>${SLUG})_)?(?<kind>${CHARGE_KINDS.join('|')})_(?<target>${SLUG})$`);
// <repo>-<N> with a greedy repo, so the last -<digits> is N; also the bare legacy form.
const NUMBERED_RE = new RegExp(`^(?<repo>${SLUG})-(?<number>${NUM})$`);
const COUNT = '[2-9]|[1-9]\\d+'; // a round or dedupe number: 2 and up
const LAZY_SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*?';
const ROLES = ['review', 'recon'];
const WORKERS = ['impl', ...ROLES];
// A lazy repo slug, so `ticket-repo-5-2` reads as the harness's dedupe (-2) of ticket 5, not issue 2 of repo `repo-5`.
const LEGACY_RE = new RegExp(
  `^(?:(?<unit>director|general)-(?<slug>${SLUG})` +
    `|(?<type>epic|ticket)-(?<repo>${LAZY_SLUG})-(?<issue>${NUM})(?:-(?<role>${ROLES.join('|')}))?(?:-r(?:${COUNT}))?(?:-(?:${COUNT}))?` +
    `|(?<dir>${SLUG})_(?<treeRepo>${SLUG})(?:_e(?<epic>${NUM}))?(?:_t(?<ticket>${NUM}))?(?:_(?<worker>${WORKERS.join('|')})(?:-r(?:${COUNT}))?)?)$`,
);
/** The Agent tool's limit on a name. */
const AGENT_NAME_MAX = 64;

/** Lowercase kebab slug of free text, cut to its first `maxWords` words. */
export function slugify(text, maxWords = Infinity) {
  return String(text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, maxWords).join('-');
}

/** Words in a topic target. */
export const TOPIC_WORDS = 4;

/** An issue number as agentName takes it: leading zeros dropped (`0175` → '175'),
 *  null for 0 or anything that isn't a whole number. */
export function issueNumber(v) {
  const m = /^0*([1-9]\d*)$/.exec(typeof v === 'number' || typeof v === 'string' ? String(v) : '');
  return m ? m[1] : null;
}

function slugArg(what, v) {
  if (typeof v !== 'string' || !SLUG_RE.test(v)) throw new Error(`agent name ${what} must be a lowercase kebab slug, got ${JSON.stringify(v)}`);
  return v;
}

/** An agent's name: agentName('impl', 'issue', 'strate', 16) → impl_issue_strate-16,
 *  ('lead', 'repo', 'strate'), ('researcher', 'topic', 'pricing'). Throws on a non-slug
 *  role/repo/topic, an unknown kind, a bad number, the wrong arity or a name over 64 chars. */
export function agentName(role, kind, ...target) {
  slugArg('role', role);
  if (!CHARGE_KINDS.includes(kind)) throw new Error(`agent name kind must be ${CHARGE_KINDS.join(' | ')}, got ${JSON.stringify(kind)}`);
  const numbered = kind !== 'repo' && kind !== 'topic';
  if (target.length !== (numbered ? 2 : 1)) throw new Error(`wrong number of arguments for ${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind} charge: it takes ${numbered ? '<repo> <N>' : `<${kind}>`}`);
  let t = slugArg(kind === 'topic' ? 'topic' : 'repo', target[0]);
  if (numbered) {
    const n = issueNumber(target[1]);
    if (!n) throw new Error(`agent name number must be a positive issue number, got ${JSON.stringify(target[1])}`);
    t += `-${n}`;
  }
  const name = `${role}_${kind}_${t}`;
  if (name.length > AGENT_NAME_MAX) throw new Error(`agent name ${name} is over the Agent tool's ${AGENT_NAME_MAX} characters`);
  return name;
}

/** A target's charge for its kind, or null when the target doesn't fit the kind. */
function targetCharge(kind, target) {
  if (kind === 'repo') return { kind, repo: target };
  if (kind === 'topic') return { kind, topic: target };
  const m = NUMBERED_RE.exec(target)?.groups;
  return m ? { kind, repo: m.repo, number: Number(m.number) } : null;
}

const keyOf = (c) => `${c.kind}_${c.topic ?? c.repo}${c.number ? `-${c.number}` : ''}`;

/** Parsed identity of an agent name, trimmed and case-folded:
 *  { role: string|null, charge: { kind, repo?, number?, topic? }, key, form, raw }, where key
 *  is `<kind>_<target>` (the join key every form of one charge shares), form is
 *  'agent' | 'charge' | 'typed' | 'tree' | 'bare' and raw the input as given.
 *  Null when the input is missing, empty or unparseable. */
export function parseAgentName(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  const out = (form, role, charge) => ({ role, charge, key: keyOf(charge), form, raw: input });
  const a = AGENT_RE.exec(s)?.groups;
  const agent = a && targetCharge(a.kind, a.target);
  if (agent) return a.role ? out('agent', a.role, agent) : out('charge', null, agent);
  const g = LEGACY_RE.exec(s)?.groups;
  if (g?.unit) return out('typed', g.unit === 'director' ? 'director' : null, { kind: 'topic', topic: g.slug });
  if (g?.type) return out('typed', g.role ?? null, { kind: g.type === 'ticket' ? 'issue' : 'epic', repo: g.repo, number: Number(g.issue) });
  if (g?.dir) {
    const { treeRepo: repo, epic, ticket, worker } = g;
    const charge = ticket ? { kind: 'issue', repo, number: Number(ticket) } : epic ? { kind: 'epic', repo, number: Number(epic) } : { kind: 'repo', repo };
    return out('tree', worker ?? null, charge);
  }
  const b = NUMBERED_RE.exec(s)?.groups;
  return b ? out('bare', null, { kind: 'issue', repo: b.repo, number: Number(b.number) }) : null;
}

/** Whether a name was chosen for its agent, given the registry's nameSource (undefined
 *  when unknown). A parsed non-bare name is, whatever its source: what a `claude -n`
 *  launch records is unverified. A bare name is only when user- or peer-set, since
 *  derived auto names (`code-42`) take the same shape. The failsafe never is. */
export function isChosenName(name, nameSource) {
  const p = parseAgentName(name);
  if (!p) return false;
  return p.form !== 'bare' || nameSource === 'user' || nameSource === 'peer';
}

/** Grouping key for a name or title: its charge key when it parses (every form of one
 *  charge shares it), the trimmed title when it doesn't, null when there is none. */
export function chargeKey(title) {
  return parseAgentName(title)?.key ?? ((typeof title === 'string' && title.trim()) || null);
}

/** The issue number a slug or branch leads with, after an optional feat/ fix/ chore/ refactor/
 *  prefix (`72-foo`, `feat/72-foo`, `chore/072-foo` -> '72'), or null; `release/2026-10` has none. */
export function branchIssue(s) {
  const m = /^(\d+)-/.exec(String(s ?? '').replace(/^(?:feat|fix|chore|refactor)\//, ''));
  return m ? issueNumber(m[1]) : null;
}

/** The charge key for a linked worktree rooted at `dir` whose branch leads with an issue
 *  number (`issue_<repo>-<N>`, repo from the main checkout's folder), else null. Role-less
 *  on purpose: the window's role is unknown, and a charge-form title stays out of
 *  agent-name-guard's company context. Reads the .git pointer and HEAD directly, so it
 *  spawns nothing: session-start runs it on every session start. */
export function worktreeChargeKey(dir) {
  const gitdir = /^gitdir:\s*(.+)$/m.exec(readIfExists(join(dir, '.git')) || '')?.[1]?.trim();
  if (!gitdir || !/[\\/]worktrees[\\/][^\\/]+$/.test(gitdir)) return null; // main checkout, submodule
  const abs = resolve(dir, gitdir);
  const n = branchIssue(/^ref: refs\/heads\/(.+)$/m.exec(readIfExists(join(abs, 'HEAD')) || '')?.[1]);
  const repo = slugify(basename(resolve(abs, '..', '..', '..')));
  return n && repo ? `issue_${repo}-${n}` : null;
}

/** Resolve a repo argument (relative or absolute) and verify it is a repo. */
export function resolveRepo(p) {
  const abs = resolve(p || '.');
  if (!isRepo(abs)) die(`not a git repository: ${abs}`);
  return abs;
}
