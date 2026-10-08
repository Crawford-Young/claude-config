#!/usr/bin/env node
// cleanup.mjs — end-of-wave sweep.
//
//   node cleanup.mjs [--kill-port <n>] [--remove-worktree <path>]
//
// Reports, in one pass: uncommitted changes in every workspace repo and
// linked worktrees still registered. Optionally kills a dev-server port
// holder and removes a finished worktree (via worktree.mjs's safe
// sequence). Read-only unless a flag asks otherwise.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { die, discoverRepos, git, listenerPidFromNetstat, log, parseArgs } from './lib.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));

const args = parseArgs(process.argv.slice(2));

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

if (dirtyCount === 0) log('workspace clean: no uncommitted changes, no extra worktrees.');

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
