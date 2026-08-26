#!/usr/bin/env node
// cleanup.mjs — end-of-wave sweep.
//
//   node cleanup.mjs [--kill-port <n>] [--remove-worktree <path>]
//
// Reports, in one pass: uncommitted changes in every workspace repo, linked
// worktrees still registered, and stale checklists in active/. Optionally
// kills a dev-server port holder and removes a finished worktree (via
// worktree.mjs's safe sequence). Read-only unless a flag asks otherwise.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { die, findActiveChecklists, git, listenerPidFromNetstat, log, parseArgs, workspaceRoot } from './lib.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));

const args = parseArgs(process.argv.slice(2));
const root = workspaceRoot();

if (args['kill-port']) killPort(Number(args['kill-port']));
if (args['remove-worktree']) {
  const r = spawnSync(process.execPath, [join(scriptsDir, 'worktree.mjs'), 'remove', args['remove-worktree']], { stdio: 'inherit' });
  if (r.status !== 0) process.exitCode = 1;
}

const repos = discoverRepos();
let dirtyCount = 0;
for (const repo of repos) {
  const status = git(repo, ['status', '--porcelain']);
  const branch = git(repo, ['branch', '--show-current']).out;
  const dirty = status.out.split('\n').filter(Boolean);
  const wts = git(repo, ['worktree', 'list']).out.split('\n').filter(Boolean);
  if (dirty.length === 0 && wts.length <= 1) continue;
  dirtyCount++;
  log(`# ${repo} (${branch || 'detached'})`);
  if (dirty.length) {
    log(`  uncommitted: ${dirty.length} file(s)`);
    for (const l of dirty.slice(0, 15)) log(`    ${l}`);
  }
  for (const w of wts.slice(1)) log(`  worktree: ${w}`);
}

const docs = join(root, 'docs');
if (existsSync(docs)) {
  const active = findActiveChecklists(docs);
  if (active.length) {
    log('# active checklists');
    for (const f of active) log(`  ${f}`);
  }
}
if (dirtyCount === 0) log('workspace clean: no uncommitted changes, no extra worktrees.');

function discoverRepos() {
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

function killPort(port) {
  if (!Number.isInteger(port)) die('--kill-port needs a port number');
  if (process.platform === 'win32') {
    const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
    const pid = listenerPidFromNetstat(r.stdout, port);
    if (!pid) return log(`port ${port}: no listener`);
    spawnSync('taskkill', ['/F', '/PID', pid], { stdio: 'inherit' });
  } else {
    const r = spawnSync('lsof', ['-ti', `:${port}`], { encoding: 'utf8' });
    const pids = (r.stdout || '').split('\n').filter(Boolean);
    if (pids.length === 0) return log(`port ${port}: no listener`);
    for (const pid of pids) spawnSync('kill', ['-9', pid], { stdio: 'inherit' });
  }
  log(`port ${port}: holder killed`);
}
