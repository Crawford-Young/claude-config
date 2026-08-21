#!/usr/bin/env node
// reflect-gather.mjs — collect a wave's reflect inputs in one pass.
//
//   node reflect-gather.mjs <project-docs-dir> [--repo <path>]... [--since <date|rev>]
//
// Prints a single markdown payload: the wave checklist (active, or the newest
// in done/), the open issue log, and per-repo git log + diffstat since the
// wave started. The reflect skill reads this one payload instead of paying
// for a directory crawl every time.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { die, git, log, parseArgs } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const projectDir = resolve(args._[0] || '');
if (!projectDir || !existsSync(projectDir)) die('usage: reflect-gather.mjs <project-docs-dir> [--repo <path>]... [--since <date|rev>]');

const repos = [];
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--repo' && process.argv[i + 1]) repos.push(resolve(process.argv[i + 1]));
}

// Checklist: newest file in active/, else newest in done/.
const checklist = newestIn(join(projectDir, 'checklists', 'active')) || newestIn(join(projectDir, 'checklists', 'done'));
log('## Checklist');
if (checklist) {
  log(`<!-- ${checklist} -->`);
  log(readFileSync(checklist, 'utf8').trim());
} else {
  log('(none found)');
}

// Issue logs still open (not in done/).
const issuesDir = join(projectDir, 'issues');
log('\n## Open issue logs');
let anyIssues = false;
if (existsSync(issuesDir)) {
  for (const f of readdirSync(issuesDir)) {
    const p = join(issuesDir, f);
    if (f.endsWith('.md') && statSync(p).isFile()) {
      anyIssues = true;
      log(`<!-- ${p} -->`);
      log(readFileSync(p, 'utf8').trim());
      log('');
    }
  }
}
if (!anyIssues) log('(none)');

// Wave start: --since, else the checklist file's git add date, else 7 days.
const since = args.since || checklistBirth(checklist) || '7 days ago';
log(`\n## Repo activity since ${since}`);
for (const repo of repos) {
  const shortlog = git(repo, ['log', '--oneline', '--no-decorate', `--since=${since}`]);
  const stat = git(repo, ['diff', '--stat', `HEAD@{${since}}`, 'HEAD']);
  log(`\n### ${repo} (branch ${git(repo, ['branch', '--show-current']).out || 'detached'})`);
  log(shortlog.out || '(no commits in window)');
  if (stat.code === 0 && stat.out) {
    const lines = stat.out.split('\n');
    log(lines.slice(-1)[0].trim());
  }
  const dirty = git(repo, ['status', '--porcelain']).out;
  if (dirty) log(`uncommitted: ${dirty.split('\n').filter(Boolean).length} file(s)`);
}
if (repos.length === 0) log('(no --repo given)');

function newestIn(dir) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] || null;
}

function checklistBirth(p) {
  if (!p) return null;
  const repoRoot = git(p, ['rev-parse', '--show-toplevel']);
  if (repoRoot.code !== 0) return null;
  const r = git(repoRoot.out, ['log', '--diff-filter=A', '--format=%aI', '-1', '--follow', '--', p]);
  return r.code === 0 && r.out ? r.out : null;
}
