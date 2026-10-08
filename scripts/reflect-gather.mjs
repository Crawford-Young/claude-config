#!/usr/bin/env node
// reflect-gather.mjs — a unit's reflect evidence in one pass (#67).
//
//   node reflect-gather.mjs <session-name> [--repo <path>]... [--since <date|rev>] [--root <projects dir>]
//
// Prints one markdown payload: the transcript audit of every window renamed
// <session-name> (audit.mjs --session), then per-repo git log + diffstat since
// the unit's first window.

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderMarkdown } from './audit-lib.mjs';
import { die, git, log, parseArgs } from './lib.mjs';

/** What to print and exit with when the audit spawn failed — a spawn that never
 *  started has null stderr and status, so fall back to its error. */
export function auditFailure(r) {
  return { text: r.stderr || `${r.error?.message || 'audit.mjs failed'}\n`, code: r.status || 1 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

function main() {
  const args = parseArgs(process.argv.slice(2));
  const name = args._[0];
  if (!name) die('usage: reflect-gather.mjs <session-name> [--repo <path>]... [--since <date|rev>] [--root <projects dir>]');

  const repos = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--repo' && process.argv[i + 1]) repos.push(resolve(process.argv[i + 1]));
  }

  const auditArgs = [join(dirname(fileURLToPath(import.meta.url)), 'audit.mjs'), '--session', name, '--json'];
  if (args.root) auditArgs.push('--root', args.root);
  const audit = spawnSync(process.execPath, auditArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (audit.status !== 0) {
    const { text, code } = auditFailure(audit);
    process.stderr.write(text);
    process.exit(code);
  }
  const report = JSON.parse(audit.stdout);
  const unit = report.names.find((g) => g.name === name);
  if (unit) {
    log(`## Audit — ${unit.windows} window(s) named ${name}, ${report.files} transcripts\n`);
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
  if (repos.length === 0) log('(no --repo given)');
}
