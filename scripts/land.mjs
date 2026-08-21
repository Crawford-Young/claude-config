#!/usr/bin/env node
// land.mjs — the claude-config commit lane, mechanized.
//
// The main checkout of claude-config is the live junction/routing surface: it
// never leaves main and never commits. Every commit lands via an ephemeral
// worktree cut from origin/main, carrying ONLY a path-scoped diff of your
// files (concurrent sessions' live edits stay behind).
//
//   node land.mjs start <slug> -m "commit message" -- <path> [path...]
//   node land.mjs sync -- <path> [path...]     (after the PR merges)
//   node land.mjs finish <slug>                (remove the ephemeral worktree)
//
// start: fetch → worktree add chore/<slug> from origin/main → apply the main
//        checkout's diff for the named paths (untracked files copied) →
//        commit. Pushing and opening the PR stay with the user's approval.
// sync:  verify the live edits match origin/main for those paths, then
//        restore tracked copies and fast-forward the main checkout.

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  currentBranch,
  die,
  git,
  gitOrDie,
  log,
  parseArgs,
  workspaceRoot,
  worktreesDir,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const cfg = process.env.CLAUDE_CONFIG_REPO || join(workspaceRoot(), 'claude-config');

if (!existsSync(join(cfg, '.git'))) die(`claude-config repo not found at ${cfg} (set CLAUDE_CONFIG_REPO to override)`);

if (cmd === 'start') cmdStart();
else if (cmd === 'sync') cmdSync();
else if (cmd === 'finish') cmdFinish();
else die('usage: land.mjs start <slug> -m "msg" -- <paths...> | sync -- <paths...> | finish <slug>');

function paths() {
  const p = args._.slice(cmd === 'start' ? 2 : 1);
  if (p.length === 0) die('name the file paths after `--` — a path-scoped diff is the whole point');
  return p;
}

function cmdStart() {
  const slug = args._[1];
  const msg = args.m || args.message;
  if (!slug || !msg) die('usage: land.mjs start <slug> -m "commit message" -- <paths...>');
  const files = paths();

  const branch = currentBranch(cfg);
  if (branch !== 'main' && branch !== 'master') {
    die(`main checkout is on "${branch}" — the live-routing protocol requires it on main. Fix that first.`);
  }

  gitOrDie(cfg, ['fetch', 'origin']);
  const wt = join(worktreesDir(), `claude-config-${slug}`);
  if (existsSync(wt)) die(`worktree already exists: ${wt} (land.mjs finish ${slug} first?)`);
  mkdirSync(worktreesDir(), { recursive: true });
  gitOrDie(cfg, ['worktree', 'add', wt, '-b', `chore/${slug}`, 'origin/main']);

  // Apply the path-scoped diff of YOUR files only.
  const diff = git(cfg, ['diff', '--binary', 'HEAD', '--', ...files]);
  if (diff.code !== 0) die(`diff failed: ${diff.err}`);
  if (diff.out) {
    const apply = spawnSync('git', ['-C', wt, 'apply', '--index', '-'], { input: `${diff.out}\n`, encoding: 'utf8' });
    if (apply.status !== 0) die(`git apply failed in ${wt}:\n${apply.stderr}`);
  }
  // Untracked new files are invisible to diff — copy them explicitly.
  for (const f of files) {
    const tracked = git(cfg, ['ls-files', '--error-unmatch', f]).code === 0;
    const src = join(cfg, f);
    if (!tracked && existsSync(src)) {
      mkdirSync(dirname(join(wt, f)), { recursive: true });
      cpSync(src, join(wt, f), { recursive: true });
      gitOrDie(wt, ['add', f]);
    }
  }

  const staged = git(wt, ['diff', '--cached', '--stat']);
  if (!staged.out) die('nothing staged — are the named paths actually modified on the main checkout?');
  gitOrDie(wt, ['commit', '-m', msg]);
  log(`committed on chore/${slug} in ${wt}:`);
  log(staged.out);
  log('next: get user approval, then push (git push -u origin chore/' + slug + ') and open the PR (rebase-merge).');
}

function cmdSync() {
  const files = paths();
  gitOrDie(cfg, ['fetch', 'origin']);
  const drift = git(cfg, ['diff', 'origin/main', '--numstat', '--', ...files]);
  if (drift.out) {
    die(`live edits differ from origin/main for these paths — reconcile before syncing (never discard):\n${drift.out}`);
  }
  gitOrDie(cfg, ['restore', '--source=HEAD', '--worktree', '--', ...files]);
  const merge = git(cfg, ['merge', '--ff-only', 'origin/main']);
  if (merge.code !== 0) die(`merge --ff-only stopped:\n${merge.err || merge.out}\nIncoming commits touch a locally-modified path — reconcile by hand.`);
  log('main checkout synced to origin/main.');
}

function cmdFinish() {
  const slug = args._[1];
  if (!slug) die('usage: land.mjs finish <slug>');
  const wt = join(worktreesDir(), `claude-config-${slug}`);
  if (!existsSync(wt)) die(`no worktree at ${wt}`);
  let r = git(cfg, ['worktree', 'remove', wt]);
  if (r.code !== 0) r = git(cfg, ['worktree', 'remove', '--force', wt]);
  if (r.code !== 0) die(`worktree remove failed: ${r.err}\nRemove before deleting the remote branch — a checked-out branch can't be deleted.`);
  gitOrDie(cfg, ['worktree', 'prune']);
  log(`removed ${wt}`);
}
