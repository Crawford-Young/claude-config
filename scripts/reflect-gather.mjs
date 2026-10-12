#!/usr/bin/env node
// reflect-gather.mjs — a unit's reflect evidence in one pass (#67).
//
//   node reflect-gather.mjs <session-name> [--repo <path>]... [--since <date|rev>] [--root <projects dir>] [--idle-gap <min>]
//
// Prints one markdown payload: the transcript audit of every window renamed
// <session-name> (audit.mjs --session) with its cost and time (#97), then
// per-repo git log + diffstat since the unit's first window, then the repo's
// open `debt` issues that name a file those commits touched (#137).

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from './audit-lib.mjs';
import { die, git, isMain, log, parseArgs } from './lib.mjs';

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

/** The rendered debt lines for one repo: issues naming files its commits touched since `since`. */
export function debtSection(repo, since, run = spawnSync) {
  const names = git(repo, ['log', '--name-only', '--format=', `--since=${since}`]).out;
  const touched = [...new Set(names.split('\n').filter(Boolean))];
  const debt = fetchDebt(repo, run);
  return renderDebt(debt.error ? debt : { ...matchDebt(debt.issues, touched), truncated: debt.truncated });
}

const minutes = (ms) => `${Math.round(ms / 60e3)} min`;

if (isMain(import.meta.url)) main();

function main() {
  const args = parseArgs(process.argv.slice(2));
  const name = args._[0];
  if (!name) die('usage: reflect-gather.mjs <session-name> [--repo <path>]... [--since <date|rev>] [--root <projects dir>] [--idle-gap <min>]');

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
  const unit = report.names.find((g) => g.name === name);
  const time = report.time?.names.find((g) => g.name === name);
  if (unit) {
    log(`## Audit — ${unit.windows} window(s) named ${name}, ${report.files} transcripts${time ? ` · $${unit.usd.toFixed(2)} over ${minutes(time.activeMs)} active of ${minutes(time.wallMs)} wall` : ''}\n`);
    log(renderMarkdown(report));
  } else log(`## Audit — no priced requests in windows named ${name}, ${report.files} transcripts`);

  // A bare day (audit days are UTC) gets an explicit UTC midnight: git would
  // otherwise fill in the current time of day and drop that day's earlier commits.
  const day = args.since || unit?.first;
  if (!day) {
    log('\n(no --since given and no priced window to date the repo activity from)');
    return;
  }
  const since = /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T00:00:00Z` : day;
  log(`\n## Repo activity since ${day}`);
  for (const repo of repos) {
    const shortlog = git(repo, ['log', '--oneline', '--no-decorate', `--since=${since}`]);
    const stat = git(repo, ['diff', '--stat', `HEAD@{${since}}`, 'HEAD']);
    log(`\n### ${repo} (branch ${git(repo, ['branch', '--show-current']).out || 'detached'})`);
    log(shortlog.out || '(no commits in window)');
    if (stat.code === 0 && stat.out) log(stat.out.split('\n').slice(-1)[0].trim());
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
    log(debtSection(repo, since));
  }
}
