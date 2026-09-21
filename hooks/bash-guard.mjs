#!/usr/bin/env node
// bash-guard.mjs — consolidated PreToolUse guard for Bash/PowerShell commands.
// Port + extension of pretooluse-guard.ps1. Wire with matcher "Bash|PowerShell".
//
// Blocks (exit 2):
//   1. git add -A/--all/. and git commit -a/--all/-am, any flag order (sweeps
//      concurrent sessions' files)
//   2. git add/commit of real env files (.env, .env.local — secrets)
//   3. gate commands piped to tail/head (the pipe's exit code masks the gate's)
//   4. PowerShell Set-Content/Out-File/Add-Content (mojibake + BOM on UTF-8)
//   5. git commit on main/master in a code repo (worktree-always; docs repo exempt)
//   6. git checkout/switch off a branch, or a file restore (checkout -- <path>,
//      checkout ., restore), on the claude-config MAIN checkout — it is the live
//      junction surface and carries other sessions' uncommitted edits
//   7. a shell-launched `claude` on a usage-billed model (--model fable|mythos,
//      --model=…, or a *MODEL env var set anywhere in the command) without a
//      live FABLE OK marker — the same single-use clearance the Agent and
//      /model gates spend (_hooklib.mjs), logged to the same dispatch log
//
// Scoping (matters as much as the rules): commit-message payloads and heredoc
// bodies not fed to an interpreter are stripped before any rule reads the
// line, and clauses split only on unquoted separators. Rules 1, 2, 4, 5 and 6
// read commands, not words: a git call is a clause whose command word is git, its
// subcommand the first non-option word, and its repo the payload cwd walked
// through every cd/Set-Location/pushd clause before THAT call (`git -C` on
// top) — so `cd a; git status; cd docs && git commit` commits in docs, and
// `echo "git commit" >> notes` is an echo. A quoted command handed to a
// shell (`bash -c`, `pwsh -Command`, `eval`) is parsed as the command it is.

// Fail-CLOSED (the exception to the fail-open house rule, see _hooklib.mjs):
// errors log to ~/.claude/hook-errors.log and block. A guard that crashed has
// checked nothing, and a silent allow is invisible — a loud block is not.

import { spawnSync } from 'node:child_process';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { BILLED_MODEL, block, consumeClearance, logBilled, run } from './_hooklib.mjs';

const workspaceRoot = () => process.env.CLAUDE_WORKSPACE_ROOT || join(homedir(), 'code');

// ---- pure rules (exported for tests) ----------------------------------------

/** Split a compound command into its individual clauses on unquoted
 *  separators, so a flag in one clause can't be attributed to a command in
 *  another and quoted text stays with the command that owns it. Unbalanced
 *  quotes fall back to the plain split — never swallow the rest of the line. */
export function clauses(cmd) {
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && quote === '"' && i + 1 < cmd.length) cur += cmd[++i];
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (/[;&|\n]/.test(ch)) {
      if ((ch === '&' || ch === '|') && cmd[i + 1] === ch) i++;
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (quote) return cmd.split(/\|\||&&|[;&|\n]/).map((c) => c.trim()).filter(Boolean);
  out.push(cur);
  return out.map((c) => c.trim()).filter(Boolean);
}

/** A clause's words with quotes removed; adjacent pieces (a"b"c, @'…'@) are one
 *  word. Unbalanced quotes: plain whitespace split. */
function words(clause) {
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s"']+)|(["'])/g;
  const out = [];
  let prev = -1;
  let m;
  while ((m = re.exec(clause)) !== null) {
    if (m[4]) return clause.split(/\s+/).filter(Boolean);
    const w = m[1] ?? m[2] ?? m[3];
    if (m.index === prev && out.length) out[out.length - 1] += w;
    else out.push(w);
    prev = re.lastIndex;
  }
  return out;
}

/** Replace quoted `-m`/`--message` payloads with a placeholder. Commit-message
 *  prose is not a command: `git commit -m "handle .env loading"` stages nothing. */
export function stripMessages(cmd) {
  return cmd
    .replace(/(-m|--message)(=|\s+)"(?:[^"\\]|\\.)*"/g, '$1 "MSG"')
    .replace(/(-m|--message)(=|\s+)'(?:[^'\\]|\\.)*'/g, "$1 'MSG'");
}

/** Drop heredoc bodies: text written into a file is not a command, and a body
 *  that mentions `git commit` must not trip the branch rules. The opening line
 *  stays, so the command that consumes the heredoc is still checked. A body fed
 *  to an interpreter (`bash <<EOF`, `node - <<EOF`) can run commands and is kept. */
export function stripHeredocs(cmd) {
  const lines = cmd.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const m = line.match(/<<(-?)\s*(["']?)([\w.-]+)\2/);
    if (!m) continue;
    // The heredoc's consumer is the command word of the clause holding the `<<`
    // (so `cat > run.sh <<EOF` is cat, not sh).
    const consumer = (clauses(line.slice(0, m.index)).pop() || '').split(/\s+/)[0].split(/[/\\]/).pop();
    if (/^(bash|sh|zsh|dash|pwsh|powershell|cmd|node|python3?|deno|bun)(\.exe)?$/i.test(consumer)) continue;
    const end = lines.findIndex((l, j) => j > i && (m[1] ? l.replace(/^\t+/, '') : l) === m[3]);
    if (end === -1) continue; // unterminated — leave it for the rules to read
    out.push(lines[end]);
    i = end;
  }
  return out.join('\n');
}

/** Everything the rules should NOT read as command text. */
export function scrub(raw) {
  return stripMessages(stripHeredocs(raw));
}

/** Expand a leading `~` — Git Bash paths reach the hook unexpanded. */
function expandHome(p) {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2));
  return p;
}

export function staticCheck(raw) {
  if (!raw) return null;
  const cmd = scrub(raw);

  // 1. git add -A/--all/. and git commit -a/--all, any flag order/combination —
  //    read off parsed git calls, so an `-A` on another command (grep -A 3,
  //    tar -A) or inside quoted text is not a hit. The bare-`.` check wants
  //    `.` (or `./`) as a whole argument: `.env`, `.github/…` and `./src/x.ts`
  //    are specific paths, not the whole tree.
  const calls = gitCalls(cmd, null);
  for (const { sub, args } of calls) {
    if (sub === 'add' && args.some((a) => a === '--all' || /^-[a-zA-Z]*A[a-zA-Z]*$/.test(a))) {
      return 'git add -A/--all is banned: shared repos carry concurrent sessions\' in-flight files. Stage explicit paths.';
    }
    if (sub === 'add' && args.some((a) => a === '.' || a === './')) {
      return 'git add . is banned: shared repos carry concurrent sessions\' in-flight files. Stage explicit paths.';
    }
    if (sub === 'commit' && args.some((a) => a === '--all' || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(a))) {
      return 'git commit -a/--all is banned: shared repos carry concurrent sessions\' in-flight files. Stage explicit paths, then commit.';
    }
  }

  // 2. env files into git — an argument of a git add/commit call, not a mention
  const isEnv = (a) => /(?:^|[/\\=])\.env(?:\.[\w-]+)*$/.test(a) && !/\.env\.(?:example|sample|template)$/.test(a);
  if (calls.some(({ sub, args }) => (sub === 'add' || sub === 'commit') && args.some(isEnv))) {
    return 'Refusing to stage/commit a .env file (secrets). Only .env.example belongs in git.';
  }

  // 3. gate output piped to tail/head
  const gate = /\b(pnpm (test|lint|typecheck|e2e|vitest)|vitest\b|npx? tsc\b|tsc --noEmit|just check|npm test)\b/;
  if (gate.test(cmd) && /\|\s*(tail|head)\b/.test(cmd)) {
    return 'A pipe after a gate reports the pipe\'s exit code, not the gate\'s. Run gates unpiped (use scripts/qa.mjs for compact output).';
  }

  // 4. PowerShell content cmdlets mangle UTF-8 (mojibake / BOM) — as a command,
  //    not as a word someone greps for
  if (commands(cmd, null).some(({ cmd: c }) => /^(?:Set-Content|Out-File|Add-Content)$/i.test(c))) {
    return 'PowerShell Set-Content/Out-File/Add-Content mojibake UTF-8 text. Use the Edit/Write tools for file mutations.';
  }

  return null;
}

/** 7. The billed model a shell-launched `claude` would run on, or null. `claude`
 *  must be its own token (so `claude-config`, `~/.claude/`, `claude.ai` never
 *  match); the model can come from the flag or from an env var set in any
 *  clause (`$env:ANTHROPIC_MODEL = 'fable'; claude -p …` splits across two). */
export function billedLaunch(raw) {
  if (!raw) return null;
  const cmd = scrub(raw);
  if (!/(?:^|[\s"'&;|(/\\])claude(?:\.exe|\.cmd)?(?=[\s"')]|$)/i.test(cmd)) return null;
  const flag = cmd.match(/--model(?:=|\s+)["']?([^\s"';|&]+)/gi) || [];
  const env = cmd.match(/[A-Z_]*MODEL\s*=\s*["']?([^\s"';|&]+)/gi) || [];
  const hit = [...flag, ...env].find((m) => BILLED_MODEL.test(m.toLowerCase()));
  if (!hit) return null;
  return hit.toLowerCase().match(/[^\s"'=]*(?:fable|mythos)[^\s"']*/)[0];
}

/** Words that only wrap the real command (subshell/group openers, env
 *  assignments, shell keywords). */
const WRAPPER = /^(?:[({!]+|\w+=.*|\$env:\w+=.*|sudo|command|builtin|time|exec|nohup|then|do|else|elif|if|while|until)$/i;
const CD = /^(?:cd|chdir|pushd|set-location|push-location|sl)$/i;
const SHELL_C = /^(?:bash|sh|zsh|dash|pwsh|powershell|cmd|eval)(?:\.exe)?$/i;
const GIT_OPT_WITH_ARG = /^(?:-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env)$/;

const toDir = (dir, p) => {
  const e = expandHome(p);
  if (isAbsolute(e)) return e;
  return dir ? resolve(dir, e) : null;
};

/** Every command a line runs, as { cmd, words, dir }: `cmd` is the command
 *  word's basename, `dir` the payload cwd walked through the cd clauses before
 *  it. cd clauses are consumed; a quoted command handed to a shell is expanded
 *  in place. Quoted text elsewhere is an argument, never a command. */
function commands(raw, cwd) {
  const out = [];
  let dir = cwd || null;
  for (const c of clauses(raw)) {
    const w = words(c);
    while (w.length && WRAPPER.test(w[0])) w.shift();
    if (w.length && /^[({]/.test(w[0])) w[0] = w[0].replace(/^[({]+/, '');
    if (!w.length) continue;
    const cmd = w[0].split(/[/\\]/).pop();
    if (CD.test(cmd)) {
      const arg = w.slice(1).find((a) => !/^-/.test(a) || a === '-');
      if (arg === undefined) dir = /^cd$/i.test(cmd) ? homedir() : dir;
      else if (arg !== '-') dir = toDir(dir, arg.replace(/\)+$/, ''));
      continue;
    }
    if (SHELL_C.test(cmd)) {
      const at = /^eval/i.test(cmd) ? 0 : w.findIndex((a, i) => i > 0 && /^(?:-c|-Command|\/c)$/i.test(a));
      if (at !== -1 && w[at + 1] !== undefined) out.push(...commands(w.slice(at + 1).join(' '), dir));
      continue;
    }
    out.push({ cmd, words: w, dir });
  }
  return out;
}

/** Every git call in a command, each with its subcommand, args, and the repo it
 *  runs in: the command's dir, then any `-C` on the call. A null repo means
 *  unknown — callers fail open. */
export function gitCalls(raw, cwd) {
  const out = [];
  for (const { cmd, words: w, dir } of commands(raw, cwd)) {
    if (!/^git(?:\.exe)?$/i.test(cmd)) continue;
    let repo = dir;
    let i = 1;
    for (; i < w.length && w[i].startsWith('-'); i++) {
      if (w[i] === '-C' && w[i + 1] !== undefined) repo = toDir(repo, w[++i]);
      else if (GIT_OPT_WITH_ARG.test(w[i])) i++;
    }
    out.push({ sub: w[i] || null, args: w.slice(i + 1), repo });
  }
  return out;
}

// ---- stateful rules ---------------------------------------------------------

function currentBranch(repo) {
  const r = spawnSync('git', ['-C', repo, 'branch', '--show-current'], { encoding: 'utf8', timeout: 4000 });
  return r.status === 0 ? (r.stdout || '').trim() : null;
}

export function branchRules(raw, cwd) {
  for (const g of gitCalls(scrub(raw), cwd)) {
    const reason = callRule(g);
    if (reason) return reason;
  }
  return null;
}

function callRule({ sub, args, repo }) {
  const isCommit = sub === 'commit';
  // A file restore (`checkout -- <path>`, `checkout .`, `restore` that touches the
  // worktree) — `restore --staged` alone only unstages and is left alone.
  const has = (...f) => args.some((a) => f.includes(a));
  const isRestore =
    (sub === 'checkout' && has('--', '.')) ||
    (sub === 'restore' && !(has('--staged', '-S') && !has('--worktree', '-W')));
  const isSwitch = (sub === 'checkout' || sub === 'switch') && !isRestore;
  if (!isCommit && !isSwitch && !isRestore) return null;
  if (!repo) return null;

  const branch = currentBranch(repo);
  if (branch === null) return null; // not a repo / git unavailable — fail open

  const name = basename(repo);
  const cfgMain = process.env.CLAUDE_CONFIG_REPO || join(workspaceRoot(), 'claude-config');

  // 6. claude-config main checkout never switches branches
  const onCfgMain = resolve(repo) === resolve(cfgMain) && !/[/\\]\.worktrees[/\\]/.test(resolve(repo));
  if (isRestore && onCfgMain) {
    return `No file restores on the claude-config main checkout: it holds other sessions' uncommitted live edits, and a restore discards theirs along with yours. Undo your own change with the Edit tool; after a merge, scripts/land.mjs sync does the restore safely.`;
  }
  if (isSwitch && onCfgMain) {
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
  run(
    'bash-guard',
    (payload) => {
      const cmd = payload?.tool_input?.command || '';
      const cwd = payload?.cwd || payload?.tool_input?.cwd || process.cwd();
      const reason = staticCheck(cmd) || branchRules(cmd, cwd);
      if (reason) block(reason);
      // Last, so a command another rule blocks never spends the clearance.
      const billed = billedLaunch(cmd);
      if (billed) {
        const ok = consumeClearance();
        logBilled(`${ok ? 'ALLOW' : 'BLOCK'} shell model=${billed}`);
        if (!ok) {
          block(
            `A shell-launched claude on "${billed}" is usage-billed and needs per-run user clearance: ask the user to reply with "FABLE OK" (grants one billed act for 30 minutes), then re-run.`,
          );
        }
      }
    },
    { failClosed: true },
  );
}
