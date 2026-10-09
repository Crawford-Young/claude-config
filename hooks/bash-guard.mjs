#!/usr/bin/env node
// bash-guard.mjs — consolidated PreToolUse guard for Bash/PowerShell commands.
// Port + extension of pretooluse-guard.ps1. Wire with matcher "Bash|PowerShell".
//
// Blocks (exit 2):
//   1. git add -A/--all/. and git commit -a/--all/-am, any flag order (sweeps
//      concurrent sessions' files)
//   2. git add/commit of real env files (.env, .env.local — secrets)
//   3. gate commands (by command word: pnpm test, node --test, just check,
//      cargo test/clippy…) piped onward — the pipe's exit code masks the gate's
//   4. PowerShell Set-Content/Out-File/Add-Content (mojibake + BOM on UTF-8)
//   5. git commit on main/master in a code repo (worktree-always; docs repo exempt)
//   6. git checkout/switch off a branch, or a file restore (checkout -- <path>,
//      checkout ., restore), on the claude-config MAIN checkout — it is the live
//      junction surface and carries other sessions' uncommitted edits
//   7. a shell-launched `claude` on a usage-billed model (--model fable|mythos,
//      --model=…, or a *MODEL env var set anywhere in the command) without a
//      live FABLE OK marker — the same single-use clearance the Agent and
//      /model gates spend (_hooklib.mjs), logged to the same dispatch log
//   8. git push / gh pr create / gh pr merge without an approving answer in
//      the transcript (CLAUDE.md: "No commit or push without explicit user
//      approval"). `git push --dry-run` and a remote branch delete are exempt. Approval is read from the
//      most recent user record carrying `toolUseResult.answers` — an
//      AskUserQuestion answer the model cannot forge — and is single-use per
//      verb, spent from a small state file keyed by that record's uuid, so
//      one approving answer covers push → pr create → pr merge once each.
//      A command holding more than one gated verb is blocked outright (one
//      gated verb per Bash call), so a compound never spends one approval twice.
//      A remote branch delete (`push --delete`/`-d`, or every refspec `:branch`)
//      is exempt like --dry-run; a push that also pushes a ref stays gated.
//   9. Commands that open a visible browser — playwright --headed/--ui/--debug,
//      codegen, show-report, show-trace, open — need the user's browser consent
//      (_hooklib.mjs browserGateReason; shared with browser-gate.mjs, granted
//      once per session). Headless `playwright test` stays ungated.
//
// Scoping (matters as much as the rules): commit-message payloads and heredoc
// bodies not fed to an interpreter are stripped before any rule reads the
// line, and clauses split only on unquoted separators. Rules 1, 2, 4, 5 and 6
// read commands, not words: a git call is a clause whose command word is git, its
// subcommand the first non-option word, and its repo the payload cwd walked
// through every cd/Set-Location/pushd clause before THAT call (`git -C` on
// top) — so `cd a; git status; cd docs && git commit` commits in docs, and
// `echo "git commit" >> notes` is an echo. A quoted command handed to a
// shell (`bash -c`, `pwsh -Command`, `eval`) is parsed as the command it is,
// and so is every command substitution the shell would run — `…`, $(…), <(…),
// bare or inside double quotes or an unquoted-delimiter heredoc (#92);
// single-quoted text stays literal.

// Fail-CLOSED (the exception to the fail-open house rule, see _hooklib.mjs):
// errors log to ~/.claude/hook-errors.log and block. A guard that crashed has
// checked nothing, and a silent allow is invisible — a loud block is not.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  BILLED_MODEL,
  block,
  browserGateReason,
  claudeDir,
  consumeClearance,
  denies,
  latestAnswer,
  logBilled,
  readState,
  run,
  writeState,
} from './_hooklib.mjs';

const workspaceRoot = () => process.env.CLAUDE_WORKSPACE_ROOT || join(homedir(), 'code');

// ---- pure rules (exported for tests) ----------------------------------------

/** Index of the backtick closing a `…` body that starts at i, or -1. */
function closeTick(s, i) {
  for (; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '`') return i;
  }
  return -1;
}

/** Index of the `)` closing a $(…)/<(…)/>(…) body that starts at i, or -1.
 *  Quoted text and nested backticks inside the body can't close it. */
function closeParen(s, i) {
  let depth = 1;
  let quote = null;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '\\') i++;
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '`') {
      i = closeTick(s, i + 1);
      if (i === -1) return -1;
    } else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  return -1;
}

/** The substitution opening at i — `…`, $(…), and outside double quotes
 *  <(…)/>(…) — as { body, end } (end = index just past it), or null. One that
 *  never closes runs to the end of the string: a guard reads too much, never
 *  too little. */
function substitutionAt(s, i, inDouble) {
  let open = 0;
  let close = -1;
  if (s[i] === '`') [open, close] = [1, closeTick(s, i + 1)];
  else if (s[i + 1] === '(' && (s[i] === '$' || (!inDouble && (s[i] === '<' || s[i] === '>')))) {
    [open, close] = [2, closeParen(s, i + 2)];
  } else return null;
  return close === -1 ? { body: s.slice(i + open), end: s.length } : { body: s.slice(i + open, close), end: close + 1 };
}

/** The bodies of the command substitutions a shell would run in `s`: `…`,
 *  $(…), <(…) and >(…), unquoted or inside double quotes. Single-quoted text
 *  is literal (`'$(x)'` runs nothing), as is an escaped backtick. `\$(` still
 *  counts: PowerShell, which this hook also guards, runs `"C:\x\$(…)"`. With
 *  `quotesLiteral` (an unquoted heredoc body) quote characters are plain text.
 *  Nested substitutions stay in their body for the caller's recursion. */
export function substitutions(s, quotesLiteral = false) {
  const out = [];
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && (s[i + 1] === '`' || (inDouble && s[i + 1] === '"'))) i++;
    else if (!quotesLiteral && !inDouble && ch === "'") {
      const e = s.indexOf("'", i + 1);
      if (e === -1) break;
      i = e;
    } else if (!quotesLiteral && ch === '"') inDouble = !inDouble;
    else {
      const sub = substitutionAt(s, i, inDouble);
      if (!sub) continue;
      out.push(sub.body);
      i = sub.end - 1;
    }
  }
  return out;
}

/** Split a compound command into its individual clauses on unquoted
 *  separators, so a flag in one clause can't be attributed to a command in
 *  another and quoted text stays with the command that owns it. A substitution
 *  body stays whole (`echo $(a; b)` is one clause), and so does a redirection
 *  (`2>&1`, `&>f`). With `pipes`, a pipeline (`a | b`, `a |& b`) is one piece
 *  — `pipelines()`. Unbalanced quotes fall back to the plain split — never
 *  swallow the rest of the line. When `seps` is an array it is filled, parallel to
 *  the result, with the separator before each clause ('' for the first); the
 *  unbalanced-quote fallback leaves it empty. */
export function clauses(cmd, pipes = false, seps = null) {
  const out = [];
  const before = [];
  let sep = '';
  let cur = '';
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    const sub = quote === "'" ? null : substitutionAt(cmd, i, quote === '"');
    if (ch === '\\' && cmd[i + 1] === '`') {
      cur += ch + cmd[++i];
    } else if (sub) {
      cur += cmd.slice(i, sub.end);
      i = sub.end - 1;
    } else if (quote) {
      cur += ch;
      if (ch === '\\' && quote === '"' && i + 1 < cmd.length) cur += cmd[++i];
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === '&' && cmd[i + 1] !== '&' && (/[<>]/.test(cmd[i - 1]) || cmd[i + 1] === '>')) {
      cur += ch;
    } else if (pipes && ch === '|' && cmd[i + 1] !== '|') {
      cur += ch;
      if (cmd[i + 1] === '&') cur += cmd[++i];
    } else if (/[;&|\n]/.test(ch)) {
      let kind = ch;
      if ((ch === '&' || ch === '|') && cmd[i + 1] === ch) kind = ch + cmd[i++ + 1];
      out.push(cur);
      before.push(sep);
      sep = kind;
      cur = '';
    } else cur += ch;
  }
  if (quote) return cmd.split(pipes ? /\|\||&&|(?<![<>|])&(?!>)|[;\n]/ : /\|\||&&|(?<![<>])&(?!>)|[;|\n]/).map((c) => c.trim()).filter(Boolean);
  out.push(cur);
  before.push(sep);
  const keep = out.map((c) => c.trim());
  if (seps) keep.forEach((c, k) => c && seps.push(before[k]));
  return keep.filter(Boolean);
}

/** The pipelines of a compound command: clauses that keep `|` inside. */
const pipelines = (cmd, seps = null) => clauses(cmd, true, seps);

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

/** Re-wrap substitution bodies as `$(…)` text, so a scrubbed payload keeps
 *  what the shell would still run in it. */
const keepSubs = (bodies) => bodies.map((b) => `$(${b})`).join(' ');

/** Replace quoted `-m`/`--message` payloads with a placeholder. Commit-message
 *  prose is not a command: `git commit -m "handle .env loading"` stages nothing.
 *  A double-quoted payload's substitutions do run, so they are kept. */
export function stripMessages(cmd) {
  return cmd
    .replace(/(-m|--message)(=|\s+)("(?:[^"\\]|\\.)*")/g, (_, flag, __, q) => `${flag} "MSG${keepSubs(substitutions(q))}"`)
    .replace(/(-m|--message)(=|\s+)'(?:[^'\\]|\\.)*'/g, "$1 'MSG'");
}

/** Drop heredoc bodies: text written into a file is not a command, and a body
 *  that mentions `git commit` must not trip the branch rules. The opening line
 *  stays, so the command that consumes the heredoc is still checked. A body fed
 *  to a shell (`bash <<EOF`) runs as commands and is kept. A body fed to another
 *  interpreter (`node - <<'EOF'`) is that language's code, not shell: its JS
 *  template literals or markdown backticks are not substitutions. An unquoted
 *  delimiter (`<<EOF`, not `<<'EOF'`) makes the shell expand the body's
 *  substitutions before any consumer sees it, so those are kept as a line of
 *  their own. */
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
    if (/^(bash|sh|zsh|dash|pwsh|powershell|cmd)(\.exe)?$/i.test(consumer)) continue;
    const end = lines.findIndex((l, j) => j > i && (m[1] ? l.replace(/^\t+/, '') : l) === m[3]);
    if (end === -1) continue; // unterminated — leave it for the rules to read
    const subs = m[2] ? [] : substitutions(lines.slice(i + 1, end).join('\n'), true);
    if (subs.length) out.push(keepSubs(subs));
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

  // 3. gate output piped onward — a gate command, by command word, with any
  //    command after it in the same pipeline (tail, head, grep, tee… all mask it)
  const cmds = commands(cmd, null);
  if (cmds.some((g) => isGate(g) && cmds.some((t) => t.pipe === g.pipe && t.seg > g.seg))) {
    return 'A pipe after a gate reports the pipe\'s exit code, not the gate\'s. Run gates unpiped (use scripts/qa.mjs for compact output).';
  }

  // 4. PowerShell content cmdlets mangle UTF-8 (mojibake / BOM) — as a command,
  //    not as a word someone greps for
  if (cmds.some(({ cmd: c }) => /^(?:Set-Content|Out-File|Add-Content)$/i.test(c))) {
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

/** Every command a line runs, as { cmd, words, dir, pipe, seg }: `cmd` is the
 *  command word's basename, `dir` the payload cwd walked through the cd clauses
 *  before it, `pipe` an identity shared by the commands of one pipeline and
 *  `seg` the command's place in it. cd clauses are consumed; a quoted command
 *  handed to a shell is expanded in place, and so is every substitution body
 *  (`…`, $(…), <(…)), which runs before the clause holding it. Other quoted
 *  text is an argument, never a command. */
function commands(raw, cwd) {
  const out = [];
  let dir = cwd || null;
  const pipeSeps = [];
  for (const [pi, p] of pipelines(raw, pipeSeps).entries()) {
    const viaOr = pipeSeps[pi] === '||';
    const pipe = {};
    for (const [seg, c] of clauses(p).entries()) {
      const w = words(c);
      while (w.length && WRAPPER.test(w[0])) w.shift();
      if (w.length && /^[({]/.test(w[0])) w[0] = w[0].replace(/^[({]+/, '');
      const cmd = w.length ? w[0].split(/[/\\]/).pop() : '';
      const shellAt = !SHELL_C.test(cmd) ? -1 : /^eval/i.test(cmd) ? 0 : w.findIndex((a, i) => i > 0 && /^(?:-c|-Command|\/c)$/i.test(a));
      const shellCmd = shellAt !== -1 && w[shellAt + 1] !== undefined ? w.slice(shellAt + 1).join(' ') : null;
      // A shell's own command string is parsed whole below; reading its
      // substitutions here too would count each gated verb twice.
      if (shellCmd === null) for (const body of substitutions(c)) out.push(...commands(body, dir));
      if (!w.length) continue;
      if (CD.test(cmd)) {
        const arg = w.slice(1).find((a) => !/^-/.test(a) || a === '-');
        if (arg === undefined) dir = /^cd$/i.test(cmd) ? homedir() : dir;
        else if (arg !== '-') dir = toDir(dir, arg.replace(/\)+$/, ''));
        continue;
      }
      if (SHELL_C.test(cmd)) {
        if (shellCmd !== null) out.push(...commands(shellCmd, dir));
        continue;
      }
      out.push({ cmd, words: w, dir, pipe, seg, viaOr });
    }
  }
  return out;
}

const PKG_RUNNER = /^(?:pnpm|npm|yarn|bun|npx|pnpx|bunx)(?:\.cmd|\.exe)?$/i;
const PKG_FLAG_WITH_ARG = /^(?:--filter|-F|-C|--dir|--prefix|--workspace|-w)$/;
const PKG_GATE = /^(?:test|lint|typecheck|e2e|vitest|tsc)$/;
const JUST_GATE = /^(?:check|test|lint|typecheck|e2e|clippy)$/;
const firstArg = (args) => args.find((a) => !a.startsWith('-') && !a.startsWith('+'));

/** 3. Is this command a QA gate whose exit code matters? Read by command word
 *  and subcommand, so `npm view vitest` or `grep tsc` is not a gate (#98). */
function isGate({ cmd, words: w }) {
  const c = cmd.replace(/\.(?:cmd|exe)$/i, '').toLowerCase();
  const args = w.slice(1);
  if (PKG_RUNNER.test(cmd)) {
    // Skip flags (and their values) and the run/exec verbs to the script or bin.
    let i = 0;
    for (; i < args.length; i++) {
      if (PKG_FLAG_WITH_ARG.test(args[i])) i++;
      else if (!args[i].startsWith('-') && !/^(?:run|exec|dlx|x)$/.test(args[i])) break;
    }
    const bin = args[i];
    if (bin === 'playwright' || bin === '@playwright/test') return firstArg(args.slice(i + 1)) === 'test';
    return PKG_GATE.test(bin || '');
  }
  if (c === 'vitest' || c === 'tsc') return true;
  if (c === 'playwright') return firstArg(args) === 'test';
  if (c === 'node') return args.includes('--test');
  if (c === 'just') return JUST_GATE.test(firstArg(args) || '');
  if (c === 'cargo') {
    const sub = firstArg(args);
    return sub === 'test' || sub === 'clippy' || sub === 'nextest' || (sub === 'fmt' && args.includes('--check'));
  }
  return false;
}

/** Every git call in a command, each with its subcommand, args, and the repo it
 *  runs in: the command's dir, then any `-C` on the call. A null repo means
 *  unknown — callers fail open. */
export function gitCalls(raw, cwd) {
  const out = [];
  for (const { cmd, words: w, dir, viaOr } of commands(raw, cwd)) {
    if (!/^git(?:\.exe)?$/i.test(cmd)) continue;
    let repo = dir;
    let i = 1;
    for (; i < w.length && w[i].startsWith('-'); i++) {
      if (w[i] === '-C' && w[i + 1] !== undefined) repo = toDir(repo, w[++i]);
      else if (GIT_OPT_WITH_ARG.test(w[i])) i++;
    }
    out.push({ sub: w[i] || null, args: w.slice(i + 1), repo, viaOr });
  }
  return out;
}

/** Every `gh` call's subcommand pair (`gh pr create` → sub 'pr', action
 *  'create'), parsed by command word the same way as a git call — never by
 *  substring, so quoted text and commit messages never trigger it. */
function ghCalls(raw, cwd) {
  const out = [];
  for (const { cmd, words: w } of commands(raw, cwd)) {
    if (!/^gh(?:\.exe)?$/i.test(cmd)) continue;
    // `-R x` / `--repo x` take a value, before the subcommand or after it.
    const nonFlag = w.slice(1).filter((a, i, all) => !a.startsWith('-') && !/^(?:-R|--repo)$/.test(all[i - 1]));
    out.push({ sub: nonFlag[0] || null, action: nonFlag[1] || null });
  }
  return out;
}

const PUSH_VALUE_FLAGS = new Set(['-o', '--push-option', '--receive-pack', '--exec', '--repo']);
const PUSH_REF_RIDERS = new Set(['--tags', '--follow-tags', '--all', '--branches', '--mirror', '--prune']);

/** A push whose args delete remote branches only — `--delete`/`-d`, or every
 *  refspec of the form `:branch` (after the remote). A ref-writing rider
 *  (`--tags`, `--all`, ...) makes it a real push; a flag's value (`-o -d`) is
 *  not the delete flag. */
function isBranchDelete(args) {
  const own = args.filter((a, i) => !PUSH_VALUE_FLAGS.has(args[i - 1]));
  if (own.some((a) => PUSH_REF_RIDERS.has(a))) return false;
  if (own.some((a) => a === '--delete' || a === '-d')) return true;
  const refspecs = own.filter((a) => !a.startsWith('-')).slice(1);
  return refspecs.length > 0 && refspecs.every((r) => /^:[^:]/.test(r));
}

/** 8. Every verb a command would spend a push/PR approval on, in order —
 *  empty when nothing here is gated. `git push --dry-run` and remote branch
 *  deletes are exempt. */
export function gatedVerbs(raw, cwd) {
  const cmd = scrub(raw);
  const out = [];
  for (const { sub, args } of gitCalls(cmd, cwd)) {
    if (sub === 'push' && !args.includes('--dry-run') && !isBranchDelete(args)) out.push('git push');
  }
  for (const { sub, action } of ghCalls(cmd, cwd)) {
    if (sub === 'pr' && (action === 'create' || action === 'merge')) out.push(`gh pr ${action}`);
  }
  return out;
}

/** The first gated verb, or null — callers must check this FIRST and read
 *  nothing else when it's null, so a non-gated command costs zero extra I/O. */
export function gatedVerb(raw, cwd) {
  return gatedVerbs(raw, cwd)[0] || null;
}

const APPROVE_RE = /\b(commit|push|pr|pull request|merge|ship|land)\b/i;

/** Does some answer value read as approving (mentions the act) without also
 *  reading as a refusal? Only the record's own answers are considered — the
 *  caller already picked the single most recent record. */
export function isApproving(answers) {
  return Object.values(answers).some((v) => APPROVE_RE.test(v) && !denies(v, APPROVE_RE));
}

export const pushGateStateFile = () => process.env.CLAUDE_PUSH_GATE_STATE || join(claudeDir, 'push-gate-approvals.json');

/** Has `verb` already been spent against approval `uuid`? Records it spent on
 *  first use. Self-trims to the newest 200 approval uuids. */
function spend(uuid, verb, file) {
  const state = readState(file);
  const entry = state[uuid] || [];
  if (entry.includes(verb)) return true;
  state[uuid] = [...entry, verb];
  const keys = Object.keys(state);
  if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete state[k];
  writeState(file, state);
  return false;
}

const askRemedy = (verb) =>
  `Ask the user with AskUserQuestion — give it an option that approves this ${verb} (answer wording like "push"/"PR"/"merge", without "hold"/"wait"/"no") — then retry.`;

/** 8. git push / gh pr create / gh pr merge need an approving answer in the
 *  transcript, spent once per verb. `transcriptPath` is read lazily — a
 *  non-gated command never touches disk here. */
export function pushGateReason(raw, cwd, transcriptPath, stateFile = pushGateStateFile()) {
  const verbs = gatedVerbs(raw, cwd);
  if (!verbs.length) return null;
  if (verbs.length > 1) {
    return `This command holds ${verbs.length} gated verbs (${verbs.join(', ')}) — run each gated verb in its own Bash call, so each one is checked against the user's approval on its own. Nothing was spent.`;
  }
  const [verb] = verbs;

  if (!transcriptPath || !existsSync(transcriptPath)) {
    return `${verb} needs explicit user approval (CLAUDE.md: "No commit or push without explicit user approval"), but there is no transcript to read it from. ${askRemedy(verb)}`;
  }

  let record;
  try {
    record = latestAnswer(transcriptPath);
  } catch {
    return `${verb} needs explicit user approval, but the transcript could not be read. ${askRemedy(verb)}`;
  }

  if (!record) {
    return `${verb} needs explicit user approval and no AskUserQuestion answer was found in the transcript. ${askRemedy(verb)}`;
  }

  if (!isApproving(record.answers)) {
    return `${verb} needs explicit user approval; the most recent AskUserQuestion answer does not approve it. ${askRemedy(verb)}`;
  }

  if (spend(record.uuid, verb, stateFile)) {
    return `${verb} already spent that approval — one push/PR per approving answer. ${askRemedy(verb)}`;
  }

  return null;
}

const PW_LAUNCHER = /^(?:npx|pnpx|bunx|pnpm|yarn|npm|bun)(?:\.cmd|\.exe)?$/i;
const PW_VISIBLE_SUB = /^(?:codegen|show-report|show-trace|open)$/;
const PW_VISIBLE_FLAG = /^--(?:headed|ui|debug)(?:=.*)?$/;

/** 9. A description of the visible-browser launch a command makes, or null.
 *  Parsed by command word: `playwright` itself, or behind a package runner
 *  (`npx`, `pnpm exec`, `yarn dlx` …). `--headed` on any other command (a
 *  package script forwarding it) counts too. Headless `playwright test` is a
 *  QA gate and stays ungated. */
export function browserCommand(raw, cwd) {
  for (const { cmd, words: w } of commands(scrub(raw), cwd)) {
    let p = -1;
    if (/^playwright(?:\.cmd|\.exe)?$/i.test(cmd)) p = 0;
    else if (PW_LAUNCHER.test(cmd)) {
      const i = w.findIndex((a, j) => j > 0 && !/^(?:-.*|exec|dlx|x|run)$/.test(a));
      if (i !== -1 && /^(?:@playwright\/test|playwright)$/.test(w[i])) p = i;
    }
    const args = w.slice(p === -1 ? 1 : p + 1);
    if (p === -1) {
      if (args.includes('--headed')) return `${cmd} --headed`;
      continue;
    }
    const sub = args.find((a) => !a.startsWith('-'));
    if (sub && PW_VISIBLE_SUB.test(sub)) return `playwright ${sub}`;
    const flag = args.find((a) => PW_VISIBLE_FLAG.test(a));
    if (flag) return `playwright ${flag}`;
  }
  return null;
}

// ---- stateful rules ---------------------------------------------------------

function currentBranch(repo) {
  const r = spawnSync('git', ['-C', repo, 'branch', '--show-current'], { encoding: 'utf8', timeout: 4000 });
  return r.status === 0 ? (r.stdout || '').trim() : null;
}

/** True only for a repo with no commits at all: HEAD does not resolve AND no
 *  local branch or remote-tracking ref exists. Any other rev-parse failure stays "not unborn". */
function isUnborn(repo) {
  const opts = { encoding: 'utf8', timeout: 4000 };
  const head = spawnSync('git', ['-C', repo, 'rev-parse', '--verify', '-q', 'HEAD'], opts);
  if (head.status === null || head.status === 0) return false;
  const refs = spawnSync('git', ['-C', repo, 'for-each-ref', '--count=1', 'refs/heads', 'refs/remotes'], opts);
  return refs.status === 0 && (refs.stdout || '').trim() === '';
}

function repoKey(repo) {
  const r = spawnSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 4000 });
  const top = resolve(r.status === 0 && (r.stdout || '').trim() ? r.stdout.trim() : repo);
  return process.platform === 'win32' ? top.toLowerCase() : top;
}

export function branchRules(raw, cwd) {
  const rooted = new Set(); // unborn repos whose one root-commit exemption this command already spent
  for (const g of gitCalls(scrub(raw), cwd)) {
    const reason = callRule(g, rooted);
    if (reason) return reason;
  }
  return null;
}

function callRule({ sub, args, repo, viaOr }, rooted = new Set()) {
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
    // Root commit: no origin/main yet, so no worktree to cut. Only the first commit of a
    // chain gets it; after it the repo is born, so a later one gets the normal verdict.
    // Keyed by toplevel so cd/-C into a subdir or a case variant can't claim a second.
    // A commit after `||` only runs if the first failed (still unborn): it neither spends
    // nor is denied the exemption.
    if (isUnborn(repo)) {
      const key = repoKey(repo);
      if (viaOr) return null;
      if (!rooted.has(key)) {
        rooted.add(key);
        return null;
      }
    }
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
      const browser = browserCommand(cmd, cwd);
      // Browser before push: a blocked command never spends a push approval.
      const reason =
        staticCheck(cmd) ||
        branchRules(cmd, cwd) ||
        (browser && browserGateReason(browser, payload?.session_id, payload?.transcript_path)) ||
        pushGateReason(cmd, cwd, payload?.transcript_path);
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
