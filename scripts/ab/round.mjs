// round.mjs: builds one #271 round on disk and runs claude in it; run.mjs and canary.mjs share it.
//
// A round lives under <tmp>/ab/<round id>, which is the session's HOME:
//   code/.worktrees/claude-config-<N>  the ticket checkout: the parent and its history only, no branch, no remote
//   code/claude-config          current arm only: the harness checkout at the ticket's harness commit
//   code/{CLAUDE.md,<domain>/}  current arm only: that commit's workspace/ (the ancestor CLAUDE.md chain)
//   .claude/                    CLAUDE_CONFIG_DIR: settings for the arm, the account (no login: auth is the
//                               user's CLAUDE_CODE_OAUTH_TOKEN), an empty projects/ (no memory, and
//                               transcripts no other round can see); current adds skills/, agents/
//   AppData/{Roaming,Local}     APPDATA and LOCALAPPDATA, so Windows code finds the round as its home too
//   tmp/                        TEMP, TMP and TMPDIR, so the session's temp files stay in the round (Git
//                               Bash's /tmp still mounts the real %TEMP%; the contamination scan watches it)
//   .config/gh, .gitconfig      gh with no login; git with no credential helper and no transport

import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { log } from '../lib.mjs';
import { RUN_COMMAND, ancestorClaudeMds, barrierEnv, checkoutSteps, childEnv, gitconfigEntries, promptFrom, pruneClaudeJson, tokenHelp, transformSettings } from './ab-lib.mjs';

/** Run an argv; throw with its output on failure. → stdout */
export function must(argv, opts = {}) {
  const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
  if (r.status !== 0) throw new Error(`${argv.join(' ')} failed (rc ${r.status ?? r.error?.code}):\n${r.stderr || r.stdout}`);
  return r.stdout;
}

/** A fresh repo at `dest` holding `sha` and its history only: no branch, no remote, no tags, and none
 *  of the `absent` commits (a clone would bring main, and main holds the fix). */
export function fetchCheckout(source, sha, dest, absent = []) {
  for (const c of checkoutSteps(source, sha, dest)) must(c);
  const head = must(['git', '-C', dest, 'rev-parse', 'HEAD']).trim();
  if (head !== sha) throw new Error(`${dest} is at ${head}, not ${sha}`);
  const refs = must(['git', '-C', dest, 'for-each-ref']).trim();
  if (refs) throw new Error(`${dest} has refs beyond HEAD:\n${refs}`);
  for (const s of absent) {
    if (spawnSync('git', ['-C', dest, 'cat-file', '-e', `${s}^{commit}`]).status === 0) throw new Error(`${dest} holds ${s}: the fix would be readable`);
  }
}

/** Write a git config file of [key, value] entries. */
function writeGitconfig(file, entries) {
  writeFileSync(file, '');
  for (const [k, v] of entries) must(['git', 'config', '--file', file, '--add', k, v]);
}

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {});

/** The user's own Claude config dir and global .claude.json, the sources a round's config is built from. */
export function realClaudePaths(env = process.env) {
  const config = env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  return { config, globalJson: env.CLAUDE_CONFIG_DIR ? join(config, '.claude.json') : join(homedir(), '.claude.json') };
}

/** Build the round in plan.layout (which must not exist yet) and return the env for the gates
 *  (claude's adds the user's CLAUDE_CODE_OAUTH_TOKEN, which it alone gets) and the prompt. */
export function prepareRound(plan, { workspace }) {
  const { layout: l, ticket, arm } = plan;
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) throw new Error(tokenHelp(RUN_COMMAND));
  const real = realClaudePaths();
  for (const d of [l.root, l.appData, l.localAppData, l.tmp]) mkdirSync(d, { recursive: true });
  fetchCheckout(plan.source, ticket.parent, l.checkout, [ticket.merge]);
  if (arm === 'current') {
    fetchCheckout(plan.harnessSource, ticket.harness, l.harness, [ticket.merge]);
    cpSync(join(l.harness, 'workspace'), l.code, { recursive: true });
    for (const d of readdirSync(join(l.harness, 'skills'), { withFileTypes: true })) {
      if (d.isDirectory() && existsSync(join(l.harness, 'skills', d.name, 'SKILL.md'))) cpSync(join(l.harness, 'skills', d.name), join(l.config, 'skills', d.name), { recursive: true });
    }
    cpSync(join(l.harness, 'agents'), join(l.config, 'agents'), { recursive: true });
  }
  mkdirSync(join(l.config, 'projects'), { recursive: true });
  const settings = transformSettings(readJson(join(real.config, 'settings.json')), { arm, liveHarness: plan.harnessSource, harnessDir: l.harness, denyRoots: [workspace, real.config], exists: existsSync });
  writeFileSync(join(l.config, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
  writeFileSync(join(l.config, '.claude.json'), JSON.stringify(pruneClaudeJson(readJson(real.globalJson))));
  mkdirSync(l.gh, { recursive: true });
  const list = ['--system', '--global'].map((scope) => spawnSync('git', ['config', scope, '--list', '-z'], { encoding: 'utf8' }).stdout ?? '').join('');
  writeGitconfig(l.gitconfig, gitconfigEntries(list));

  const above = ancestorClaudeMds(l.checkout);
  if (arm === 'bare' && above.length) throw new Error(`a CLAUDE.md above the bare checkout would load: ${above.join(', ')}`);
  if (arm === 'current' && !above.includes(join(l.code, 'CLAUDE.md'))) throw new Error(`the current checkout has no harness CLAUDE.md above it (found: ${above.join(', ') || 'none'})`);

  return { env: childEnv(process.env, barrierEnv(l)), prompt: promptFrom(ticket.body) };
}

/** The round dir after the round: kept (`keep`) with a PowerShell line to remove it, else removed. */
export async function releaseRound(root, keep) {
  if (!existsSync(root)) return;
  if (keep) {
    log(`kept the round dir (--keep); remove it when done: Remove-Item -Recurse -Force "${root}"`);
    return;
  }
  try {
    // Async rm: Node 24's rmSync ignores maxRetries, and a just-exited child can still pin a file.
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    log(`removed the round dir ${root}`);
  } catch (e) {
    log(`WARNING: could not remove the round dir (${e.code ?? e.message}); remove it when done: Remove-Item -Recurse -Force "${root}"`);
  }
}

/** A predicate: does any of `trees` ([{repo, sha}]) hold the literal string anywhere (a substring of
 *  some line), at that commit? The scan asks it only of what the round served, never of what the
 *  session wrote: a tool result showing a round file that spells a real path reaches nothing, but a
 *  command that spells it is the reach. Cached. */
export function treeExplains(trees) {
  const seen = new Map();
  return (s) => {
    if (!seen.has(s)) seen.set(s, trees.some(({ repo, sha }) => spawnSync('git', ['-C', repo, 'grep', '-q', '-F', '-e', s, sha, '--']).status === 0));
    return seen.get(s);
  };
}

/** A predicate: is `line` verbatim a whole line of a file in any of `trees` ([{repo, sha}]) at that
 *  commit, LF or CRLF? git grep has no whole-line switch, so it lists the lines holding `line` (-F; -h
 *  prints a revision's lines bare) and one must equal it. The scan asks this of what an Edit, Write or
 *  MultiEdit wrote, a line at a time: keeping a line the checkout already holds reaches nothing. A
 *  substring never answers yes: the tree spells the live repo path inside longer lines (round 5,
 *  Major A). A line git can't take as an argument (a NUL, or too long to spawn) answers no. Cached. */
export function treeHasLine(trees) {
  const seen = new Map();
  const holds = ({ repo, sha }, line) => {
    const r = spawnSync('git', ['-C', repo, 'grep', '-F', '-h', '--no-color', '-e', line, sha, '--'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return r.status === 0 && r.stdout.split('\n').some((l) => l === line || l === `${line}\r`);
  };
  return (line) => {
    if (!seen.has(line)) seen.set(line, !line.includes('\0') && trees.some((t) => holds(t, line)));
    return seen.get(line);
  };
}

/** Kill a process and its children: the session's Bash tools outlive claude otherwise. */
function killTree(child) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

/** Run claude (`cmd` + args) with `input` on stdin; past `timeoutMs` the whole process tree is killed. */
export function runClaude(cmd, args, { cwd, env, input, timeoutMs }) {
  return new Promise((resolve) => {
    const c = spawn(cmd[0], [...cmd.slice(1), ...args], { cwd, env, detached: process.platform !== 'win32' });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    c.stdout.on('data', (d) => (stdout += d));
    c.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(c);
    }, timeoutMs);
    const done = (status, extra = '') => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr: `${stderr}${extra}`, timedOut });
    };
    c.on('close', (status) => done(status));
    c.on('error', (e) => done(-1, `\nspawn: ${e.message}`));
    c.stdin.end(input);
  });
}

/** What a redacted token reads as. */
export const TOKEN_PLACEHOLDER = '<CLAUDE_CODE_OAUTH_TOKEN>';

/** `text` with `secret` replaced by TOKEN_PLACEHOLDER; → [text, whether it held the secret]. */
export const redactText = (text, secret) => (secret && text.includes(secret) ? [text.split(secret).join(TOKEN_PLACEHOLDER), true] : [text, false]);

/** Replace `secret` with TOKEN_PLACEHOLDER in every file under `dir` (bytes kept as they are
 *  elsewhere); → how many files held it. A session that echoes its env puts its token in its output.
 *  A file it can't read or write doesn't stop the walk: the rest are redacted, then it throws naming
 *  each such file, which may still hold the secret. */
export function redactSecret(dir, secret) {
  if (!secret || !existsSync(dir)) return 0;
  let n = 0;
  const failed = [];
  for (const rel of readdirSync(dir, { recursive: true })) {
    const f = join(dir, String(rel));
    try {
      if (!statSync(f).isFile()) continue;
      const [text, hit] = redactText(readFileSync(f).toString('latin1'), secret);
      if (!hit) continue;
      writeFileSync(f, Buffer.from(text, 'latin1'));
      n++;
    } catch (e) {
      failed.push(`${f} (${e.code ?? e.message})`);
    }
  }
  if (failed.length) throw new Error(`could not redact the token from ${failed.length} file(s) under ${dir}, which may still hold it: ${failed.join(', ')}`);
  return n;
}

/** Every transcript line under a round's projects dir, for the contamination scan. */
export function transcriptText(dir) {
  if (!existsSync(dir)) return '';
  return readdirSync(dir, { recursive: true })
    .filter((f) => String(f).endsWith('.jsonl'))
    .map((f) => readFileSync(join(dir, String(f)), 'utf8'))
    .join('\n');
}
