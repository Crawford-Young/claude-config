#!/usr/bin/env node
// reflect-gather.mjs — a unit's reflect evidence in one pass (#67).
//
//   node reflect-gather.mjs <name> [--issue <N>] [--repo <path>]... [--since <date|rev>] [--root <projects dir>] [--idle-gap <min>]
//
// Prints one markdown payload: the transcript audit of everything charged to <name>'s
// charge (audit.mjs --session, which joins every form of one charge, lib's chargeKey,
// #175, #360) with its cost and time (#97), then per-repo git log + diffstat
// of the commits since the unit's first window whose message names the unit's issue
// (an issue, epic or pr charge's repo and number: `(#N)` or `<repo>#N`, or a body line
// `Refs #N` / `Closes #N`), then the repo's
// open `debt` issues that name a file those commits touched (#137). A name with no
// issue takes the whole window, unless --issue <N> names the issue (one session that
// worked several): it overrides the name's number, and the `<prefix>#N` form then
// takes each repo's directory name.

import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from './audit-lib.mjs';
import { chargeKey, die, git, isMain, log, parseAgentName, parseArgs } from './lib.mjs';

/** What to print and exit with when the audit spawn failed — a spawn that never
 *  started has null stderr and status, so fall back to its error. */
export function auditFailure(r) {
  return { text: r.stderr || `${r.error?.message || 'audit.mjs failed'}\n`, code: r.status || 1 };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Split open debt issues into those whose title or body names a touched path
 *  (on a path boundary: `a.md` does not match `data.md`, but a directory prefix or
 *  blob URL before `scripts/a.md` still matches; a root-level `README.md` does not
 *  match `scripts/README.md`, so it takes no prefix) and a count of the rest. */
export function matchDebt(issues, touched) {
  const matched = [];
  for (const { number, title, body } of issues) {
    const text = `${title}\n${body ?? ''}`;
    const paths = touched.filter((p) => new RegExp(`(?<![\\w.${p.includes('/') ? '' : '/'}-])${escapeRe(p)}(?![\\w-])`).test(text));
    if (paths.length) matched.push({ number, title, paths });
  }
  return { matched, other: issues.length - matched.length };
}

const DEBT_LIMIT = 200;
const GH_TIMEOUT_MS = 15000;

/** Open `debt` issues of the repo at `cwd`. Returns { issues, truncated } or { error } — never throws. */
export function fetchDebt(cwd, run = spawnSync) {
  const r = run('gh', ['issue', 'list', '--label', 'debt', '--state', 'open', '--json', 'number,title,body', '--limit', String(DEBT_LIMIT)], { cwd, encoding: 'utf8', timeout: GH_TIMEOUT_MS });
  if (r.error || r.status !== 0) return { error: (r.error?.message || r.stderr || `gh exited ${r.status}`).trim() };
  try {
    const issues = JSON.parse(r.stdout);
    return { issues, truncated: issues.length >= DEBT_LIMIT };
  } catch (e) {
    return { error: `unreadable gh output: ${e.message}` };
  }
}

export function renderDebt({ matched, other, error, truncated }) {
  if (error) return `(debt lookup skipped: ${error})`;
  if (!matched.length && !other) return '(no open debt issues)';
  const lines = matched.length ? matched.map((m) => `- #${m.number} ${m.title} (${m.paths.join(', ')})`) : ['(none name touched files)'];
  if (other) lines.push(`${other} other open debt issue(s) not naming touched files`);
  if (truncated) lines.push(`(gh returned the ${DEBT_LIMIT}-issue limit; the list may be truncated and the counts undercount)`);
  return lines.join('\n');
}

/** A name with an issue, epic or pr charge → { prefix: its repo, issue }; null for any other charge. */
export function parseUnit(name) {
  const c = parseAgentName(name)?.charge;
  return c?.number ? { prefix: c.repo, issue: String(c.number) } : null;
}

/** Whether a commit message names the unit's issue, on a number boundary: `(#N)` or `<prefix>#N`
 *  anywhere, or a line led by a reference keyword (`Refs #N`, `Closes #16, #N`) — the body-trailer convention (#169). */
export function namesIssue(message, { prefix, issue }) {
  return new RegExp(`\\(#${issue}\\)|(?<![\\w-])${escapeRe(prefix)}#${issue}(?!\\d)|^(?:refs|close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\b.*?(?<![\\w-])#${issue}(?!\\d)`, 'im').test(message);
}

/** Commits of `repo` since `since`, split into those whose message names the unit's issue and a count of the rest. */
export function unitCommits(repo, since, unit) {
  const rows = git(repo, ['log', '--format=%h%x00%s%x00%b%x1e', '--no-decorate', `--since=${since}`]).out.split('\x1e').map((r) => r.trim()).filter(Boolean)
    .map((row) => { const [sha, subject, body] = row.split('\0'); return { sha, subject, body }; });
  const commits = rows.filter((c) => namesIssue(`${c.subject}\n${c.body}`, unit)).map(({ sha, subject }) => ({ sha, subject }));
  return { commits, other: rows.length - commits.length };
}

/** Files touched by, and a one-line diffstat of, exactly these commits. */
export function commitChanges(repo, commits) {
  if (!commits.length) return { files: [], summary: '' };
  const rows = git(repo, ['show', '--numstat', '--no-renames', '--format=', ...commits.map((c) => c.sha)]).out.split('\n').filter(Boolean).map((r) => r.split('\t'));
  const files = [...new Set(rows.map((r) => r[2]))];
  const sum = (i) => rows.reduce((n, r) => n + (Number(r[i]) || 0), 0);
  return { files, summary: `${files.length} file${files.length === 1 ? '' : 's'} changed, ${sum(0)} insertions(+), ${sum(1)} deletions(-)` };
}

/** The rendered debt lines for one repo: issues naming the files its unit commits touched. */
export function debtSection(repo, touched, run = spawnSync) {
  const debt = fetchDebt(repo, run);
  return renderDebt(debt.error ? debt : { ...matchDebt(debt.issues, touched), truncated: debt.truncated });
}

/** Files touched by every commit since `since` — the unattributed fallback for a name with no issue number. */
const whole = (repo, since) => [...new Set(git(repo, ['log', '--name-only', '--format=', `--since=${since}`]).out.split('\n').filter(Boolean))];

const minutes = (ms) => `${Math.round(ms / 60e3)} min`;

if (isMain(import.meta.url)) main();

function main() {
  const args = parseArgs(process.argv.slice(2));
  const name = args._[0];
  if (!name) die('usage: reflect-gather.mjs <name> [--issue <N>] [--repo <path>]... [--since <date|rev>] [--root <projects dir>] [--idle-gap <min>]');
  if (args.issue !== undefined && !/^\d+$/.test(args.issue)) die('--issue takes an issue number, e.g. --issue 147');

  const repos = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--repo' && process.argv[i + 1]) repos.push(resolve(process.argv[i + 1]));
  }

  const auditArgs = [join(dirname(fileURLToPath(import.meta.url)), 'audit.mjs'), '--session', name, '--json'];
  if (args.root) auditArgs.push('--root', args.root);
  if (args['idle-gap']) auditArgs.push('--idle-gap', args['idle-gap']);
  const audit = spawnSync(process.execPath, auditArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (audit.status !== 0) {
    const { text, code } = auditFailure(audit);
    process.stderr.write(text);
    process.exit(code);
  }
  const report = JSON.parse(audit.stdout);
  const key = chargeKey(name); // audit's charge rows are keyed the same way
  const unit = report.names.find((g) => g.name === key);
  const time = report.time?.names.find((g) => g.name === key);
  if (unit) {
    log(`## Audit — ${unit.windows} window(s) charged to ${key}, ${report.files} transcripts${time ? ` · $${unit.usd.toFixed(2)} over ${minutes(time.activeMs)} active of ${minutes(time.wallMs)} wall` : ''}\n`);
    log(renderMarkdown(report));
  } else log(`## Audit — no priced requests in windows charged to ${key}, ${report.files} transcripts`);

  // A bare day (audit days are UTC) gets an explicit UTC midnight: git would
  // otherwise fill in the current time of day and drop that day's earlier commits.
  const day = args.since || unit?.first;
  if (!day) {
    log('\n(no --since given and no priced window to date the repo activity from)');
    return;
  }
  const since = /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T00:00:00Z` : day;
  log(`\n## Repo activity since ${day}`);
  const parsed = parseUnit(name);
  const attributed = new Map();
  for (const repo of repos) {
    log(`\n### ${repo} (branch ${git(repo, ['branch', '--show-current']).out || 'detached'})`);
    const unitId = args.issue ? { prefix: basename(repo), issue: args.issue } : parsed;
    if (unitId) {
      const { commits, other } = unitCommits(repo, since, unitId);
      const changes = commitChanges(repo, commits);
      attributed.set(repo, { files: changes.files, issue: unitId.issue, none: !commits.length });
      if (commits.length) {
        log(commits.map((c) => `${c.sha} ${c.subject}`).join('\n'));
        log(changes.summary);
        if (other) log(`(${other} other commit(s) in the window, not naming #${unitId.issue})`);
      } else log(`no commits naming #${unitId.issue} since ${day} (${other} other commit(s) in the window)`);
    } else {
      const shortlog = git(repo, ['log', '--oneline', '--no-decorate', `--since=${since}`]);
      const stat = git(repo, ['diff', '--stat', `HEAD@{${since}}`, 'HEAD']);
      log(shortlog.out || '(no commits in window)');
      if (stat.code === 0 && stat.out) log(stat.out.split('\n').slice(-1)[0].trim());
    }
    const dirty = git(repo, ['status', '--porcelain']).out;
    if (dirty) log(`uncommitted: ${dirty.split('\n').filter(Boolean).length} file(s)`);
  }
  if (repos.length === 0) {
    log('(no --repo given)');
    return;
  }

  log('\n## Open debt in touched code');
  for (const repo of repos) {
    log(`\n### ${repo}`);
    const a = attributed.get(repo);
    if (a?.none) log(`(no commits naming #${a.issue}, so no debt matched)`);
    else log(debtSection(repo, a ? a.files : whole(repo, since), spawnSync));
  }
}
