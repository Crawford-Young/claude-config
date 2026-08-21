#!/usr/bin/env node
// worktree.mjs — create, remove, and list feature worktrees.
//
//   node worktree.mjs new <repo> <slug> [--branch feat/<slug>] [--base main] [--install]
//   node worktree.mjs remove <worktree-path> [--force]
//   node worktree.mjs list [repo]
//
// `new` cuts the branch from origin/<default>, verifies the cut is clean, and
// copies env files per the repo's .worktreeinclude (default: .env, .env.local).
// `remove` encodes the Windows-safe removal sequence (git remove → force →
// recursive delete → prune) so node_modules lock/long-path failures never need
// hand recovery.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  DEFAULT_ENV_FILES,
  defaultBranch,
  die,
  git,
  gitOrDie,
  log,
  parseArgs,
  parseWorktreeInclude,
  readIfExists,
  resolveRepo,
  workspaceRoot,
  worktreesDir,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];

if (cmd === 'new') cmdNew();
else if (cmd === 'remove') cmdRemove();
else if (cmd === 'list') cmdList();
else die('usage: worktree.mjs new <repo> <slug> | remove <path> | list [repo]');

function cmdNew() {
  const repo = resolveRepo(args._[1]);
  const slug = args._[2];
  if (!slug) die('usage: worktree.mjs new <repo> <slug> [--branch <name>] [--install]');

  const repoName = basename(repo);
  const branch = args.branch || `feat/${slug}`;
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
}

function cmdRemove() {
  const wtPath = resolve(args._[1] || '');
  if (!wtPath || !existsSync(wtPath)) die(`worktree path not found: ${wtPath}`);

  // The parent repo is named by the worktree's .git pointer file.
  const gitFile = readIfExists(join(wtPath, '.git'));
  const m = gitFile && gitFile.match(/gitdir:\s*(.+)/);
  if (!m) die(`${wtPath} does not look like a linked worktree (.git pointer missing)`);
  // <repo>/.git/worktrees/<name> → <repo>
  const repo = resolve(m[1].trim(), '..', '..', '..');

  let r = git(repo, ['worktree', 'remove', wtPath]);
  if (r.code !== 0) r = git(repo, ['worktree', 'remove', '--force', wtPath]);
  if (r.code !== 0 || existsSync(wtPath)) {
    // Windows: node_modules file locks and >260-char paths defeat git's removal.
    // fs.rm with retries handles both (node uses \\?\ long paths internally).
    try {
      rmSync(wtPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (e) {
      die(`could not delete ${wtPath}: ${e.message}\nClose any process holding files there and re-run.`);
    }
  }
  gitOrDie(repo, ['worktree', 'prune']);
  log(`removed ${wtPath} (pruned in ${repo})`);
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
