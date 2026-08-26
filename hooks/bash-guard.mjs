#!/usr/bin/env node
// bash-guard.mjs — consolidated PreToolUse guard for Bash/PowerShell commands.
// Port + extension of pretooluse-guard.ps1. Wire with matcher "Bash|PowerShell".
//
// Blocks (exit 2):
//   1. git add -A / --all in any flag order (sweeps concurrent sessions' files)
//   2. git add/commit of real env files (.env, .env.local — secrets)
//   3. gate commands piped to tail/head (the pipe's exit code masks the gate's)
//   4. PowerShell Set-Content/Out-File/Add-Content (mojibake + BOM on UTF-8)
//   5. git commit on main/master in a code repo (worktree-always; docs repo exempt)
//   6. git checkout/switch off a branch on the claude-config MAIN checkout
//      (it is the live junction surface — commits land via land.mjs worktrees)
//
// Scoping (matters as much as the rules): commit-message payloads are stripped
// before any rule reads the line, flag rules are scanned per clause, and the
// repo a git command targets is the payload cwd walked through any leading
// `cd` — the workspace root is not a repo, so `cd <repo> && git commit` is the
// shape branch rules must see.
//
// Fail-open: errors log to ~/.claude/hook-errors.log and allow.

import { spawnSync } from 'node:child_process';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { block, run } from './_hooklib.mjs';

const workspaceRoot = () => process.env.CLAUDE_WORKSPACE_ROOT || join(homedir(), 'code');

// ---- pure rules (exported for tests) ----------------------------------------

/** Split a compound command into its individual clauses, so a flag in one
 *  clause can't be attributed to a command in another. */
export function clauses(cmd) {
  return cmd
    .split(/\|\||&&|[;&|\n]/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/** Replace quoted `-m`/`--message` payloads with a placeholder. Commit-message
 *  prose is not a command: `git commit -m "handle .env loading"` stages nothing. */
export function stripMessages(cmd) {
  return cmd
    .replace(/(-m|--message)(=|\s+)"(?:[^"\\]|\\.)*"/g, '$1 "MSG"')
    .replace(/(-m|--message)(=|\s+)'(?:[^'\\]|\\.)*'/g, "$1 'MSG'");
}

/** Expand a leading `~` — Git Bash paths reach the hook unexpanded. */
function expandHome(p) {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2));
  return p;
}

/** The directory git actually runs in. A compound `cd <path> && git …` moves the
 *  shell first, and the payload's cwd is the session cwd, not the shell's — the
 *  dominant shape here, since the workspace root is not itself a repo. */
export function effectiveCwd(cmd, cwd) {
  const gitAt = cmd.search(/\bgit\b/);
  const head = gitAt === -1 ? cmd : cmd.slice(0, gitAt);
  let dir = cwd || null;
  const re = /(?:^|[;&|]\s*)cd\s+("([^"]+)"|'([^']+)'|([^\s;&|]+))/g;
  let m;
  while ((m = re.exec(head)) !== null) {
    const p = expandHome(m[2] || m[3] || m[4]);
    if (isAbsolute(p)) dir = p;
    else if (dir) dir = resolve(dir, p);
  }
  return dir;
}

export function staticCheck(raw) {
  if (!raw) return null;
  const cmd = stripMessages(raw);

  // 1. git add -A/--all, any flag order/combination — scanned per clause, so an
  //    unrelated `-A` (grep -A 3, tar -A) elsewhere in the line is not a hit.
  for (const c of clauses(cmd)) {
    if (!/\bgit\b[^\n]*\badd\b/.test(c)) continue;
    if (/(\s--all\b|\s-[a-zA-Z]*A[a-zA-Z]*\b)/.test(c)) {
      return 'git add -A/--all is banned: shared repos carry concurrent sessions\' in-flight files. Stage explicit paths.';
    }
  }

  // 2. env files into git
  if (/\bgit\b[^\n;|&]*\b(add|commit)\b/.test(cmd)) {
    const envHit = cmd.match(/(^|[\s"'=/\\])(\.env(\.[\w-]+)*)/g);
    if (envHit && envHit.some((h) => !/\.env\.(example|sample|template)/.test(h))) {
      return 'Refusing to stage/commit a .env file (secrets). Only .env.example belongs in git.';
    }
  }

  // 3. gate output piped to tail/head
  const gate = /\b(pnpm (test|lint|typecheck|e2e|vitest)|vitest\b|npx? tsc\b|tsc --noEmit|just check|npm test)\b/;
  if (gate.test(cmd) && /\|\s*(tail|head)\b/.test(cmd)) {
    return 'A pipe after a gate reports the pipe\'s exit code, not the gate\'s. Run gates unpiped (use scripts/qa.mjs for compact output).';
  }

  // 4. PowerShell content cmdlets mangle UTF-8 (mojibake / BOM)
  if (/\b(Set-Content|Out-File|Add-Content)\b/i.test(cmd)) {
    return 'PowerShell Set-Content/Out-File/Add-Content mojibake UTF-8 text. Use the Edit/Write tools for file mutations.';
  }

  return null;
}

/** Extract the repo a git command targets: `git -C <path>` wins, else the
 *  effective cwd (payload cwd walked through any leading `cd`). */
export function gitTargetRepo(cmd, cwd) {
  const base = effectiveCwd(cmd, cwd);
  const m = cmd.match(/\bgit\s+(?:[^-\s][^\s]*\s+)?-C\s+("([^"]+)"|'([^']+)'|(\S+))/);
  const p = m ? expandHome(m[2] || m[3] || m[4]) : null;
  if (p) return isAbsolute(p) ? p : resolve(base || '.', p);
  return base || null;
}

// ---- stateful rules ---------------------------------------------------------

function currentBranch(repo) {
  const r = spawnSync('git', ['-C', repo, 'branch', '--show-current'], { encoding: 'utf8', timeout: 4000 });
  return r.status === 0 ? (r.stdout || '').trim() : null;
}

export function branchRules(raw, cwd) {
  const cmd = stripMessages(raw);
  const isCommit = /\bgit\b[^\n;|&]*\bcommit\b/.test(cmd);
  const isSwitch = /\bgit\b[^\n;|&]*\b(checkout|switch)\b/.test(cmd) && !/\s--\s/.test(cmd) && !/\bcheckout\b[^\n;|&]*\s--\s/.test(cmd);
  if (!isCommit && !isSwitch) return null;

  const repo = gitTargetRepo(cmd, cwd);
  if (!repo) return null;
  const branch = currentBranch(repo);
  if (branch === null) return null; // not a repo / git unavailable — fail open

  const name = basename(repo);
  const cfgMain = process.env.CLAUDE_CONFIG_REPO || join(workspaceRoot(), 'claude-config');

  // 6. claude-config main checkout never switches branches
  if (isSwitch && resolve(repo) === resolve(cfgMain) && !/[/\\]\.worktrees[/\\]/.test(resolve(repo))) {
    if (/\bgit\b[^\n;|&]*\bcheckout\b[^\n;|&]*\.(?:\s|$)/.test(cmd)) return null; // `git checkout .` = file restore
    return `The claude-config main checkout is the live junction surface — it never leaves main. Use scripts/land.mjs (ephemeral worktree) to commit, or work in a worktree.`;
  }

  // 5. no commits on main/master in code repos (docs repo keeps its direct lane)
  if (isCommit && (branch === 'main' || branch === 'master')) {
    if (name === 'docs') return null;
    if (/[/\\]\.worktrees[/\\]/.test(resolve(repo))) return null;
    return `"${repo}" is on ${branch} — never commit to the default branch. Cut a branch in a worktree (scripts/worktree.mjs new) first.`;
  }

  return null;
}

// ---- main (only when executed as a hook, so tests can import the rules) -----

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run('bash-guard', (payload) => {
    const cmd = payload?.tool_input?.command || '';
    const cwd = payload?.cwd || payload?.tool_input?.cwd || process.cwd();
    const reason = staticCheck(cmd) || branchRules(cmd, cwd);
    if (reason) block(reason);
  });
}
