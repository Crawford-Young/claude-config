#!/usr/bin/env node
// bash-guard.mjs — consolidated PreToolUse guard for Bash/PowerShell commands.
// Port + extension of pretooluse-guard.ps1. Wire with matcher
// "Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit" (the file tools get rule 11 only).
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
//   8. git push / gh pr create / gh pr merge without the user's approval in
//      the transcript (CLAUDE.md: "No commit or push without explicit user
//      approval"). `git push --dry-run` and a remote branch delete are exempt.
//      Approval comes from the latest AskUserQuestion answer
//      (`toolUseResult.answers`) and the latest prompt the user typed in an
//      interactive session (#180: origin human, promptSource typed/queued/
//      suggestion_accepted — never a tool result, peer or teammate message,
//      task notification, hook or reminder injection, sidechain or claude -p
//      prompt; pasted blocks and reminders inside it are cut). A --bg
//      session's prompt or a process's first prompt, which a model can supply
//      as a launch argument, never approves but still refuses.
//      Newest first, the first that approves wins; an answer that doesn't
//      approve blocks, and so does a typed prompt that refuses; a neutral
//      typed prompt defers to the older. A typed approval is ship words only
//      ("lgtm push and pr", "ok, merge it"), with no question mark.
//      Rule 11 keeps the model from writing that transcript (#190).
//      Approval is single-use per verb, spent from a small state file keyed
//      by the approving record's uuid, so one approval covers push → pr
//      create → pr merge once each.
//      A command holding more than one gated verb is blocked outright (one
//      gated verb per Bash call), so a compound never spends one approval twice.
//      A remote branch delete (`push --delete`/`-d`, or every refspec `:branch`)
//      is exempt like --dry-run; a push that also pushes a ref stays gated.
//      A spend records its call's tool_use_id; if that call's transcript
//      tool_result is_error, the next gated call refunds the spend (#147).
//   9. Commands that open a visible browser — playwright --headed/--ui/--debug,
//      codegen, show-report, show-trace, open — need the user's browser consent
//      (_hooklib.mjs browserGateReason; shared with browser-gate.mjs, granted
//      once per session). Headless `playwright test` stays ungated.
//  10. A heredoc body holding a doubled backslash — the Bash tool's shell spawn
//      collapses it, silently corrupting the file or commit message; use Write
//      (#123, #137, #147).
//  11. A write into a session transcript (`~/.claude/projects/**/*.jsonl`,
//      auto-memory dirs exempt) or a gate state file (push-gate-approvals,
//      browser-gate-sessions, fable-clearance): rules 8 and 9 trust those, so
//      one appended line would forge approval (#190). Deleting or moving away
//      a state file counts too (it forgets single-use spends); deleting a
//      transcript doesn't (it can only take an approval away). Read off parsed
//      calls — redirects, tee, cp/mv/install/ln (a dir destination judged with
//      each source's name in it, a link's source too), dd of=, sed/perl -i,
//      truncate, curl/wget -o, rm, Copy-Item/Move-Item/New-Item/Tee-Object/
//      Rename-Item/Remove-Item — with the target resolved through cd, literal
//      vars and every home spelling ($HOME, $USERPROFILE, ${env:…}); a target
//      that can't resolve blocks only when it looks aimed (a substitution or
//      a var whose text names one, a for/read/foreach/`$_` var, a runner's
//      `{}`/`$1`) in a command naming one. Inline interpreter code (`node -e`,
//      `python -c`, `node - <<EOF`, PowerShell [IO.File]) blocks on a write
//      call whose literal path is one, or whose computed path sits in a call
//      naming one; a runner's payload (`find -exec`, `xargs`, `env`) is
//      judged as a call, and a find whose payload rm/mv's `{}` (through
//      wrappers, runners or a shell's -c script) removes like -delete: what
//      its -name/-iname/-path names in a plain conjunction, else its start
//      dirs whole, and with a recursive rm or an mv a matched dir's whole
//      tree (#214). Static, so best-effort: a script file is out of its
//      sight, whether it builds the path at runtime or holds it literally
//      (Write x.mjs, then `node x.mjs`). Known limits, accepted: a link or
//      junction to an ancestor dir (`ln -s ~/.claude /tmp/c`, New-Item
//      -ItemType Junction) and a write through it; archive extraction (tar
//      -C, unzip -d, Expand-Archive); Windows path forms the OS folds
//      (a trailing dot or space, `::$DATA`, `\\?\`); and inline code that
//      mentions a gate record stays blocked for a pathlib/stream write even to
//      a literal path. Wired on Write|Edit|MultiEdit|NotebookEdit too
//      (editToolReason), where it fails OPEN, so a broken guard never locks
//      out the Edit tool that fixes it.
//
// Scoping (matters as much as the rules): commit-message payloads and heredoc
// bodies not fed to an interpreter are stripped before any rule reads the
// line, and clauses split only on unquoted separators. Rules 1, 2, 4, 5 and 6
// read commands, not words: a git call is a clause whose command word is git, its
// subcommand the first non-option word, and its repo the payload cwd walked
// through every cd/Set-Location/pushd/popd clause before THAT call (`git -C` on
// top; pushd stacks, named ones included, are modelled) — so `cd a; git status;
// cd docs && git commit` commits in docs, and `echo "git commit" >> notes` is
// an echo. A cd target still holding a variable once $HOME/$PWD/~ and names a
// literal assignment earlier in the command set (`W=…; cd "$W"`) expand
// (`cd $d`, `Set-Location $_.FullName`) leaves the repo unknown until a cd
// to an absolute, `~`/$HOME or bare (home) target, a popd back to a known dir,
// or an absolute `git -C`: a commit there is blocked (#163). A quoted command handed to a
// shell (`bash -c`, `pwsh -Command`, `eval`) is parsed as the command it is,
// and so is every command substitution the shell would run — `…`, $(…), <(…),
// bare or inside double quotes or an unquoted-delimiter heredoc (#92);
// single-quoted text stays literal. A `{ … }` block body (PowerShell
// if/foreach/ForEach-Object, a bash group) is parsed in place too (#159), and
// so is an if/elseif/while condition, which PowerShell runs (#214).

// Fail-CLOSED (the exception to the fail-open house rule, see _hooklib.mjs):
// errors log to ~/.claude/hook-errors.log and block. A guard that crashed has
// checked nothing, and a silent allow is invisible — a loud block is not.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { isMain } from '../scripts/lib.mjs';
import {
  BILLED_MODEL,
  block,
  browserGateReason,
  consumeClearance,
  denies,
  isGateRecord,
  logBilled,
  logError,
  pushGateStateFile,
  readState,
  removesGateState,
  run,
  writeState,
} from './_hooklib.mjs';

export { pushGateStateFile };

const workspaceRoot = () => process.env.CLAUDE_WORKSPACE_ROOT || join(homedir(), 'code');

/** A dir the guard can't resolve: a cd target that still holds a variable or a
 *  command substitution (`cd $d`, `Set-Location $_.FullName`), a relative cd
 *  from one, `cd -`, or a rotated/lost pushd stack. Distinct from null, which
 *  means "no info, fail open": a commit in an unknown dir is blocked (#163). Not
 *  a string, so it can never reach spawnSync or path.resolve as a path. */
export const UNKNOWN_DIR = Object.freeze({ unknown: 'dir' });

// ---- pure rules (exported for tests) ----------------------------------------

/** Index of the backtick closing a `…` body that starts at i, or -1. */
function closeTick(s, i) {
  for (; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '`') return i;
  }
  return -1;
}

// closeGroup's answers, per opener character and per text: memo[opener] is
// the closer's index + 1, -1 for none, 0 not yet scanned. A few texts are live
// at once (a line, the bodies it recurses into), so the cache holds several
// and is dropped whole when full. `last` skips the Map on a repeat lookup: V8
// doesn't fully hash a long string, so a Map hit on one compares its content.
const groupMemo = { '(': { texts: new Map(), last: null }, '{': { texts: new Map(), last: null } };

/** Index of the `)` closing the `(` at s[at] (a $(…)/<(…)/>(…) body), or with
 *  `open`/`close` the `}` closing a block's `{`, or -1. Quoted text and nested
 *  backticks inside the body can't close it. An opener's answer depends only
 *  on the text after it, so every opener the scan passes is answered on the way
 *  and memoised: a nested opener already answered is jumped, one that never
 *  closes ends the scan (nor can any opener around it), and a line of N openers
 *  costs one scan, not N (#163). */
function closeGroup(s, at, open = '(', close = ')') {
  const cache = groupMemo[open];
  let memo = cache.last?.s === s ? cache.last.memo : cache.texts.get(s);
  if (!memo) {
    if (cache.texts.size >= 64) cache.texts.clear();
    memo = new Int32Array(s.length);
    cache.texts.set(s, memo);
  }
  cache.last = { s, memo };
  if (memo[at]) return memo[at] > 0 ? memo[at] - 1 : -1;
  const pending = [at];
  let quote = null;
  for (let i = at + 1; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '\\') i++;
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '`') {
      i = closeTick(s, i + 1);
      if (i === -1) break;
    } else if (ch === open) {
      const inner = memo[i];
      if (!inner) pending.push(i);
      else if (inner === -1) break;
      else i = inner - 1;
    } else if (ch === close) {
      memo[pending.pop()] = i + 1;
      if (!pending.length) return i;
    }
  }
  for (const k of pending) memo[k] = -1;
  return -1;
}

// A block's `{` stands where a command or keyword can end (`if ($x) {`,
// `} else{`, `| % {`), never inside a word (`@{u}`, `${x}`, `HEAD@{1}`); its `}`
// ends a word too. A spaceless body with a comma or `..` is a bash brace
// expansion (`{a,b}`, `{1..3}`), not a block. Both read a few characters, not
// the whole line, so a long command stays linear.
const BLOCK_BEFORE = /(?:^|[\s(){};|&%]|(?:^|[^\w-])(?:else|try|finally|do))$/i;
const BLOCK_AFTER = /^(?:$|[\s;|&)}<>]|(?:else|elseif|catch|finally|while|until)\b)/i;
// A clause holding a find -exec/-execdir/-ok/-okdir payload.
const FIND_EXEC = /(?:^|\s)-(?:exec|execdir|ok|okdir)\s/;

/** The block opening at i — a PowerShell script block (`if (…) { … }`,
 *  `ForEach-Object { … }`) or a bash brace group (`{ a; b; }`) — as { body,
 *  end }, or null. One that never closes is no block: the clause reads on. */
function blockAt(s, i) {
  if (s[i] !== '{' || !BLOCK_BEFORE.test(s.slice(Math.max(0, i - 8), i))) return null;
  const close = closeGroup(s, i, '{', '}');
  if (close === -1) return null;
  const body = s.slice(i + 1, close);
  if (/^\S*(?:,|\.\.)\S*$/.test(body) || !BLOCK_AFTER.test(s.slice(close + 1, close + 10))) return null;
  return { body, end: close + 1 };
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
    [open, close] = [2, closeGroup(s, i + 1)];
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
 *  (`2>&1`, `&>f`), and so does find's `-exec … \;` unless `tool` is
 *  PowerShell, where `\` is a word and the `;` still splits. With `pipes`, a
 *  pipeline (`a | b`, `a |& b`) is one piece — `pipelines()`. Unbalanced
 *  quotes fall back to the plain split — never swallow the rest of the line.
 *  When `seps` is an array it is filled, parallel to the result, with the
 *  separator before each clause ('' for the first); the unbalanced-quote
 *  fallback leaves it empty. A block body (`{ … }`, see blockAt) stays whole
 *  too; when `blocks` is an array, each block in a clause is cut out to a `{}`
 *  placeholder and the array is filled, parallel to the result, with that
 *  clause's blocks as { head, body } (`head` is the clause text since the
 *  previous block: `if ($x) `, ` else `). */
export function clauses(cmd, pipes = false, seps = null, blocks = null, tool = null) {
  const out = [];
  const before = [];
  const found = [];
  let own = [];
  let sep = '';
  let cur = '';
  let mark = 0; // where cur's text since its last block starts
  let quote = null;
  let block;
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
    } else if (ch === '{' && (block = blockAt(cmd, i))) {
      if (blocks) {
        own.push({ head: cur.slice(mark), body: block.body });
        cur += '{}';
        mark = cur.length;
      } else cur += cmd.slice(i, block.end);
      i = block.end - 1;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === '&' && cmd[i + 1] !== '&' && (/[<>]/.test(cmd[i - 1]) || cmd[i + 1] === '>')) {
      cur += ch;
    } else if (ch === '\\' && cmd[i + 1] === ';' && tool !== 'PowerShell' && FIND_EXEC.test(cur)) {
      // find's escaped `\;` ends its -exec payload, not the clause. Anywhere
      // else it splits: PowerShell reads `\` as a plain character.
      cur += ch + cmd[++i];
    } else if (ch === '|' && cmd[i - 1] === '>' && cmd[i - 2] !== '\\') {
      // `>|` is a clobbering redirect, not a pipe. After a `\` it splits as a
      // pipe either way, which errs safe: the spawn's `\\`-to-`\` collapse
      // makes the escape unknowable, and a split reads the command after it.
      cur += ch;
    } else if (pipes && ch === '|' && cmd[i + 1] !== '|') {
      cur += ch;
      if (cmd[i + 1] === '&') cur += cmd[++i];
    } else if (/[;&|\n]/.test(ch)) {
      let kind = ch;
      if ((ch === '&' || ch === '|') && cmd[i + 1] === ch) kind = ch + cmd[i++ + 1];
      // `a &` then a newline: the clause after the dropped empty one still follows a `&`.
      const afterAmp = sep === '&' && !cur.trim() && /^[;\n]$/.test(kind);
      out.push(cur);
      before.push(sep);
      found.push(own);
      sep = afterAmp ? '&' : kind;
      cur = '';
      mark = 0;
      own = [];
    } else cur += ch;
  }
  if (quote) return cmd.split(pipes ? /\|\||&&|(?<![<>|])&(?!>)|[;\n]/ : /\|\||&&|(?<![<>])&(?!>)|[;|\n]/).map((c) => c.trim()).filter(Boolean);
  out.push(cur);
  before.push(sep);
  found.push(own);
  const keep = out.map((c) => c.trim());
  if (seps) keep.forEach((c, k) => c && seps.push(before[k]));
  if (blocks) keep.forEach((c, k) => c && blocks.push(found[k]));
  return keep.filter(Boolean);
}

// How deep commands() follows blocks, groups, substitutions and shell strings
// into each other (#167). Each level re-reads its body and recurses, so a
// deeper line costs quadratic time and overflows the stack; real commands
// nest a few levels.
const MAX_NESTING = 100;
let nesting = 0;

/** A line nested past MAX_NESTING: the guard can't read it, so it blocks. */
export class NestingError extends Error {
  constructor() {
    super(`This command nests blocks, groups or substitutions more than ${MAX_NESTING} levels deep, deeper than the guard reads, so it is blocked unread (#167). Flatten the nesting.`);
  }
}

/** The pipelines of a compound command: clauses that keep `|` inside. */
const pipelines = (cmd, seps = null, tool = null) => clauses(cmd, true, seps, null, tool);

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

/** Does any heredoc body in `cmd` hold a doubled backslash? The Bash tool's
 *  shell spawn collapses `\\` to `\` inside a heredoc body, quoted delimiter or
 *  not, so the file or message written is silently wrong (#123, #137). Bodies are
 *  found as stripHeredocs finds them: a `<<WORD` line (not a `<<<` here-string)
 *  closed by a line of just WORD — text that only mentions `<<EOF` has no
 *  terminator line, so it is not a heredoc. */
export function heredocHasDoubledBackslash(cmd) {
  const lines = cmd.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/(?<!<)<<(?!<)(-?)\s*(["']?)([\w.-]+)\2/);
    if (!m) continue;
    const end = lines.findIndex((l, j) => j > i && (m[1] ? l.replace(/^\t+/, '') : l) === m[3]);
    if (end === -1) continue;
    if (lines.slice(i + 1, end).some((l) => l.includes('\\\\'))) return true;
    i = end;
  }
  return false;
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

/** The static rules (1-4, 10, 11) on one command. `tool` is the payload's
 *  tool_name: only off Bash are `sc`/`ac` PowerShell's content-cmdlet aliases
 *  (in Git Bash, `sc` is Windows' sc.exe); null (no tool, as in a replay)
 *  reads them as aliases. It is also the shell the command is parsed in (newScope). */
export function staticCheck(raw, cwd = null, tool = null) {
  if (!raw) return null;
  if (heredocHasDoubledBackslash(raw)) {
    return 'A heredoc body holding a doubled backslash arrives with it collapsed to one (the Bash tool\'s shell spawn eats it), so the file or message written is wrong. Write the file with the Write tool (or Edit) instead of a heredoc.';
  }
  const cmd = scrub(raw);

  // 1. git add -A/--all/. and git commit -a/--all, any flag order/combination —
  //    read off parsed git calls, so an `-A` on another command (grep -A 3,
  //    tar -A) or inside quoted text is not a hit. The bare-`.` check wants
  //    `.` (or `./`) as a whole argument: `.env`, `.github/…` and `./src/x.ts`
  //    are specific paths, not the whole tree.
  const calls = gitCalls(cmd, null, tool);
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
  const cmds = commands(cmd, null, false, false, newScope(null, tool));
  if (cmds.some((g) => isGate(g) && cmds.some((t) => t.pipe === g.pipe && t.seg > g.seg))) {
    return 'A pipe after a gate reports the pipe\'s exit code, not the gate\'s. Run gates unpiped (use `node $HOME/code/claude-config/scripts/qa.mjs` for compact output).';
  }

  // 4. PowerShell content cmdlets mangle UTF-8 (mojibake / BOM) — as a command,
  //    not as a word someone greps for; their sc/ac aliases only off Bash
  const content = tool === 'Bash' ? /^(?:Set-Content|Out-File|Add-Content)$/i : /^(?:Set-Content|Out-File|Add-Content|sc|ac)$/i;
  if (cmds.some(({ cmd: c }) => content.test(c))) {
    return 'PowerShell Set-Content/Out-File/Add-Content mojibake UTF-8 text. Use the Edit/Write tools for file mutations.';
  }

  // 11. a write into a transcript or a gate state file (#190)
  return forgeWrite(raw, cwd, tool);
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

// ---- 11. writes into a gate's records (#190) --------------------------------

/** Does `text` name a transcript or a gate state file? `.claude…projects`
 *  (any separators, `'.claude','projects'` too) unless the path goes on into
 *  an auto-memory dir, or a state file under `.claude`. */
function namesGateRecord(text) {
  for (const m of text.matchAll(/\.claude[\s'"`,+/\\]*projects(?![\w-])([^\s'"`;|&<>()]*)/gi)) {
    if (!/^[/\\][^/\\]+[/\\]memory(?:[/\\]|$)/i.test(m[1])) return true;
  }
  return namesGateState(text);
}
/** Does `text` name a gate state file (what a removal is judged by)? */
const namesGateState = (text) => /\.claude[\s'"`,+/\\]*(?:browser-gate-sessions|push-gate-approvals|fable-clearance)/i.test(text);
const INTERPRETER = /^(?:node|nodejs|deno|bun|python[\d.]*|py|perl|ruby|php)(?:\.exe)?$/i;
/** Flags that hand an interpreter its code inline: -e/--eval/-p (node, perl
 *  -ne/-pe/-pi -e), -c (python), -r (php). */
const EVAL_FLAG = /^(?:-[a-zA-Z]*e|--eval(?:=.*)?|-p|--print|-c|-r)$/;
/** Inline code's file writes (JS, Python, Ruby, .NET), by where the path is:
 *  the first argument, a write-mode open's first argument, or the second (a
 *  copy, rename or link destination). */
const CODE_PATH_FIRST = /\b(?:(?:writeFile|appendFile|truncate|writeTextFile)(?:Sync)?|createWriteStream|(?:Write|Append)All(?:Text|Lines|Bytes)|Bun\.write|File\.write)\s*\(/gi;
const CODE_OPEN = /\b(?:open|openSync|fopen)\s*\(/gi;
const CODE_PATH_SECOND = /\b(?:(?:copyFile|cp|rename|symlink|link)(?:Sync)?|shutil\.\w+|os\.(?:replace|rename)|IO\.File\]::(?:Copy|Move|Replace))\s*\(/gi;
/** Of those, the ones that take their first argument away (a move). */
const CODE_MOVE = /rename|replace|move/i;
/** Inline code's removals, path first (judged by removesGateState). */
const CODE_REMOVE = /\b(?:(?:unlink|rm|rmdir)(?:Sync)?|os\.(?:remove|unlink)|shutil\.rmtree|IO\.File\]::Delete)\s*\(/gi;
/** Writes whose path is no argument: a receiver (`Path(p).write_text`), a
 *  subprocess (any shell write), a .NET stream, a Perl `open(F, '>>…')`. */
const CODE_OPAQUE = /\.write_(?:text|bytes)\s*\(|\.open\s*\(\s*(?:mode\s*=\s*)?['"][rbt]*[wax+]|child_process|subprocess|\b(?:execSync|execFileSync|spawnSync|spawn|system|popen)\s*\(|StreamWriter|FileStream|\bopen\s*\(?\s*(?:my\s+)?[$\w]+\s*,\s*['"]\+?>/i;
/** PowerShell's .NET file calls, which run as the command itself. */
const DOTNET_FILE = /\[(?:System\.)?IO\.(?:File|StreamWriter|FileStream)\]|New-Object\s+(?:System\.)?IO\.(?:StreamWriter|FileStream)/i;
/** Commands that run another command from their args (`env cp …`,
 *  `find -exec sh -c '… >> {}'`, `xargs`); their payload is judged as a call
 *  of its own (runnerPayloads). */
const RUNNER = /^(?:find|xargs|env|timeout|nice|ionice|stdbuf|parallel|watch|script|unbuffer|busybox)$/i;
const COPY = /^(?:cp|mv|install|ln|rsync|scp|copy|move|cpi|mi|copy-item|move-item)$/i;
const MOVE = /^(?:mv|move|mi|move-item)$/i;
const REMOVE = /^(?:rm|unlink|del|erase|ri|rmdir|rd|remove-item|shred)$/i;
const RENAME = /^(?:rename-item|ren|rni)$/i;
/** PowerShell content cmdlets (and aliases): the first path is the file written. */
const CONTENT = /^(?:set-content|add-content|clear-content|out-file|sc|ac|clc)$/i;
/** PowerShell item cmdlets that take their source from the pipeline. */
const PS_ITEM = /^(?:copy-item|cpi|copy|move-item|mi|move|remove-item|ri|del|erase|rm|rename-item|rni|ren)$/i;
/** Pipeline steps that pass the items they get on unchanged. */
const PASS_THROUGH = /^(?:select-object|select|sort-object|sort|where-object|where|\?)$/i;
const DOWNLOAD = /^(?:curl|wget)(?:\.exe)?$/i;
const TEE = /^(?:tee|tee-object)$/i;
const IN_PLACE = /^(?:sed|perl)$/i;
const NEW_ITEM = /^(?:new-item|ni|truncate)$/i;
/** PowerShell params whose value is a path to write (`-Destination x`, `-Destination:x`). */
const PS_DEST = /^-dest\w*(?::(.*))?$/i;
const PS_PATH = /^-(?:path|literalpath|filepath)(?::(.*))?$/i;

/** The file targets of a clause's unquoted redirects (`>`, `>>`, `>|`, `&>`,
 *  `2>`, `>&file`), as words; an fd dup or close (`>&2`, `2>&1`, `>&-`) and
 *  a `>(…)` substitution are no file. */
function redirectTargets(text) {
  const out = [];
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    const sub = substitutionAt(text, i, false);
    if (sub) {
      i = sub.end - 1;
      continue;
    }
    // An escaped `\>` counts too: the Bash tool's spawn collapses `\\` to `\`,
    // so the backslashes before `>` can't be read off the text reliably.
    if (ch !== '>') continue;
    let j = i + 1;
    if (text[j] === '>' || text[j] === '|') j++;
    if (text[j] === '&') {
      if (/[\d-]/.test(text[j + 1] ?? '')) {
        i = j;
        continue;
      }
      j++;
    }
    while (text[j] === ' ' || text[j] === '\t') j++;
    let k = j;
    for (let q = null; k < text.length; k++) {
      if (q) {
        if (text[k] === q) q = null;
      } else if (text[k] === '"' || text[k] === "'") q = text[k];
      else if (/[\s;|&<>()]/.test(text[k])) break;
    }
    if (k > j) out.push(words(text.slice(j, k))[0] ?? '');
    i = k - 1;
  }
  return out;
}

/** A call's args up to its first redirect word — what follows is the redirect's. */
function ownArgs(w) {
  const end = w.findIndex((a, i) => i > 0 && /^[\d&]*[<>]/.test(a));
  return w.slice(1, end === -1 ? w.length : end);
}

/** A command word's name: its basename, less a `.exe`. */
const commandName = (word) => word.split(/[/\\]/).pop().replace(/\.exe$/i, '');

/** A payload's real command words: past the wrappers (`sudo`, `nohup`, an env
 *  assignment) and the runners (`env`, `nice`, `timeout`, `xargs`) the guard
 *  reads through elsewhere. */
function unwrapPayload(w) {
  while (w.length) {
    const run = commandName(w[0]);
    if (WRAPPER.test(w[0])) w = w.slice(1);
    else if (RUNNER.test(run) && !/^find$/i.test(run)) w = runnerPayloads(run, w.slice(1))[0] ?? [];
    else break;
  }
  return w;
}

/** How a payload takes away what find found, if it does: 'tree' when it
 *  mv's it or removes it recursively (`rm -rf {}`), so a matched dir goes
 *  with all under it; 'file' when it only rm's it; else null. A shell's -c
 *  script counts by the calls in it (`script`: the call, for its cwd), and
 *  there any argument that isn't a fixed path is what find handed it: one
 *  holding `$` (`"$1"`, `"$f"`, `$args[0]`) or `{}`, and a recursive rm's
 *  `.` or `*` after a cd to such a path. rmdir takes only an empty dir, so
 *  never a state file. */
function payloadRemoval(words, script = null) {
  const w = unwrapPayload(words);
  if (!w.length) return null;
  const run = commandName(w[0]);
  const shell = shellTool(run);
  if (shell) {
    const c = w.findIndex((a, i) => i > 0 && /^(?:-c|-Command)$/i.test(a));
    const removals = c === -1 || w[c + 1] === undefined ? [] : commands(w[c + 1], null, false, false, newScope(null, shell)).map((s) => payloadRemoval(s.words, s));
    return removals.includes('tree') ? 'tree' : removals.includes('file') ? 'file' : null;
  }
  if (!(REMOVE.test(run) || MOVE.test(run)) || /^rmdir$/i.test(run)) return null;
  const args = w.slice(1);
  // rm's -r/-R in any flag cluster; Remove-Item's -Recurse or a prefix of it.
  const recursive = args.some((a) => (/^rm$/i.test(run) ? /^-[a-zA-Z]*[rR]|^--recursive$/ : /^-r(?:e(?:c(?:u(?:r(?:se?)?)?)?)?)?$/i).test(a));
  const handed = script
    ? args.some((a) => /\$|\{\}/.test(a)) || (recursive && script.dir === UNKNOWN_DIR && args.some((a) => /^(?:\.|\*|\.[/\\]\*?)$/.test(a)))
    : args.some((a) => a.includes('{}'));
  if (!handed) return null;
  return MOVE.test(run) || recursive ? 'tree' : 'file';
}

/** How a find's -exec/-execdir/-ok/-okdir payloads that are handed `{}` take
 *  away what it finds (payloadRemoval). Either way, like -delete, the
 *  predicates name what goes (#214). */
function findExecRemoval(args) {
  const removals = runnerPayloads('find', args).flatMap((p) => (p.some((a) => a.includes('{}')) ? [payloadRemoval(p)] : []));
  return removals.includes('tree') ? 'tree' : removals.includes('file') ? 'file' : null;
}

// A find -path/-ipath pattern as the name it leaves the matched entry: `*`
// and `?` match `/` there, so after the last one any tail without a `/` is
// only a suffix (`*.json` names `*.json`, `*/.claude*` names `*`); a tail
// holding a `/`, or a pattern without either, ends in a literal last
// segment, which is the name (`*/debug/*.txt`: `*.txt`; `*/skills`: `skills`).
// A bracket class can match `/` too (`[/]`, `[!a]`), so a pattern holding a
// `[` names any entry, `*`, rather than have its classes parsed.
function findPathName(pattern) {
  if (pattern.includes('[')) return '*';
  const tail = pattern.slice(Math.max(pattern.lastIndexOf('*'), pattern.lastIndexOf('?')) + 1);
  return tail.length < pattern.length && !tail.includes('/') ? `*${tail}` : tail.slice(tail.lastIndexOf('/') + 1);
}

/** The paths a command call writes, as { word, dirTarget, tree, removes,
 *  deep }: its redirects, and the destination of tee, cp/mv/Copy-Item/
 *  Move-Item (a dir counts, and so does each source landing in it under its
 *  own name, as a `tree` that may hold a gate record: `cp -r bk/.claude ~/`;
 *  a contents copy, `bk/.` or rsync's `bk/`, lands as `*`), dd of=, sed/perl
 *  -i, truncate, New-Item, the content cmdlets (Set-/Add-/Clear-Content,
 *  Out-File, sc/ac/clc), curl/wget -o and Rename-Item; a link's source, which
 *  a write through the link reaches; and with `removes` what rm/Remove-Item/
 *  `find -delete` or `find -exec rm/mv {}` (`deep`: its -name/-iname/-path at
 *  any depth; `tree`: a matched dir with all under it) delete or mv takes
 *  away. `tool` is the shell running the call (newScope).
 *  A PowerShell item cmdlet with no source of its own takes `upstream`, the
 *  paths its pipeline feeds it (`Get-Item x | Remove-Item`). */
function writeTargets({ cmd, words: w, text, upstream = [], spill, tool }) {
  const out = [...redirectTargets(text), ...(spill === undefined ? [] : [spill])].map((word) => ({ word }));
  if (!w.length) return out;
  const args = ownArgs(w);
  const add = (word, o = {}) => word !== undefined && out.push({ word, ...o });
  const positional = args.filter((a, i) => !a.startsWith('-') && !PS_DEST.test(args[i - 1] ?? '') && !PS_PATH.test(args[i - 1] ?? ''));
  const flagValue = (re) => {
    const i = args.findIndex((a) => re.test(a));
    return i === -1 ? undefined : (args[i].match(re)[1] ?? args[i + 1]);
  };
  const fed = (own) => (own.length || !PS_ITEM.test(cmd) ? own : upstream);
  if (COPY.test(cmd)) {
    // -t takes the dir, alone or last in a cluster (`-rt`, `install -Dt`);
    // rsync's -t is --times.
    const t = /^(?:cp|mv|install|ln)$/i.test(cmd) ? args.findIndex((a) => /^-[a-zA-Z]*t$/.test(a) || a.startsWith('--target-directory')) : -1;
    let dest = flagValue(PS_DEST);
    let sources;
    if (t !== -1) {
      dest = args[t].split('=')[1] ?? args[t + 1];
      sources = positional.filter((a) => a !== dest);
    } else if (dest !== undefined) sources = [...positional, flagValue(PS_PATH)].filter(Boolean);
    else {
      // `Copy-Item -Path x dest`: the -Path value is a source, the last positional the dest.
      [dest, sources] = [positional.at(-1), [...positional.slice(0, -1), flagValue(PS_PATH)].filter(Boolean)];
    }
    add(dest, { dirTarget: true });
    const contents = (s) => /(?:^|[/\\])\.$/.test(s) || (/^rsync$/i.test(cmd) && /[/\\]$/.test(s));
    for (const s of dest === undefined ? [] : fed(sources)) {
      add(`${dest}/${contents(s) ? '*' : (s.split(/[/\\]/).filter(Boolean).pop() ?? '')}`, { dirTarget: true, tree: true });
      if (MOVE.test(cmd)) add(s, { removes: true });
      if (cmd === 'ln') add(s, { dirTarget: true });
    }
  } else if (REMOVE.test(cmd)) {
    for (const p of fed([...positional, flagValue(PS_PATH)].filter(Boolean))) add(p, { removes: true });
  } else if (/^find$/i.test(cmd) && (args.includes('-delete') || findExecRemoval(args))) {
    // find's own options come first: -H/-L/-P, -D <opts>, -O<n>, then `--`.
    let k = 0;
    while (/^(?:-[HLP]+|-O\d*|-D)$/.test(args[k] ?? '')) k += args[k] === '-D' ? 2 : 1;
    if (args[k] === '--') k++;
    // The expression starts at a word that reaches find as -x, ( or !: past
    // Bash's `\` (`\!`, `\(`) or PowerShell's backtick (`` `! ``), which
    // passes a `\!` on as a start path.
    const unescaped = (a) => (tool === 'PowerShell' ? a.replace(/`(.)/g, '$1') : a.replace(/\\(.)/g, '$1'));
    const start = args.findIndex((a, i) => i >= k && /^[-(!]/.test(unescaped(a)));
    const dirs = args.slice(k, start === -1 ? args.length : start);
    const expr = start === -1 ? [] : args.slice(start);
    // find's own words: an -exec/-ok payload, to its `;`/`+`, is the payload
    // rule's (its `$1`, its `\;`).
    const own = [];
    let inPayload = false;
    for (const a of expr) {
      if (inPayload) inPayload = !/^\\?[;+]$/.test(a);
      else if (/^-(?:exec|execdir|ok|okdir)$/.test(a)) inPayload = true;
      else own.push(a);
    }
    // The predicates name what goes only when every one must hold for it: in
    // a plain conjunction. An -o, `,`, !/-not, group or -prune can make one
    // name what stays instead, and so can an escape or an expansion that
    // hides one (`\-o`, `` `, ``, `$OP`); then the start dirs are judged whole.
    const plain = !expr.some((a) => /^(?:-o|-or|,|\\?!|-not|\\?[()]|-prune)$/.test(a)) && !own.some((a) => /[\\`$]/.test(a));
    const predicate = (re) => (plain ? expr.flatMap((a, i) => (re.test(a) && expr[i + 1] !== undefined ? [expr[i + 1]] : [])) : []);
    // A -path only narrows a -name; alone it is judged by the name it leaves.
    const named = predicate(/^-i?name$/);
    const names = named.length ? named : predicate(/^-i?path$/).map(findPathName);
    // A recursive rm or an mv of a matched dir takes everything under it.
    const tree = findExecRemoval(args) === 'tree';
    for (const dir of dirs.length ? dirs : ['.']) {
      if (!names.length) add(dir, { removes: true });
      for (const name of names) add(`${dir}/${name}`, { removes: true, deep: true, tree });
    }
  } else if (RENAME.test(cmd)) {
    const from = flagValue(PS_PATH) ?? positional[0] ?? upstream[0];
    const name = flagValue(/^-newname(?::(.*))?$/i) ?? positional[1];
    if (from !== undefined && name !== undefined) add(from.replace(/[^/\\]*[/\\]?$/, '') + name);
    add(from, { removes: true });
  } else if (CONTENT.test(cmd)) {
    add(flagValue(PS_PATH) ?? positional[0]);
  } else if (DOWNLOAD.test(cmd)) {
    const flag = /^curl/i.test(cmd) ? /^(?:-[a-zA-Z]*o|--output)$/ : /^(?:-[a-zA-Z]*[oO]|--output-document|--output-file)$/;
    for (const [i, a] of args.entries()) {
      if (flag.test(a)) add(args[i + 1]);
      else if (/^--output(?:-document|-file)?=/.test(a)) add(a.slice(a.indexOf('=') + 1));
    }
  } else if (TEE.test(cmd)) {
    for (const p of positional) add(p);
    add(flagValue(PS_PATH));
  } else if (cmd === 'dd') {
    for (const a of args) if (a.startsWith('of=')) add(a.slice(3));
  } else if (IN_PLACE.test(cmd) && args.some((a) => /^-[a-zA-Z]*i|^--in-place/.test(a))) {
    // The files, not the script: an -e/-f value, else sed's first positional.
    const script = new Set(args.flatMap((a, i) => (/^(?:-[a-zA-Z]*[ef]|--expression|--file)$/.test(a) ? [i + 1] : [])));
    const files = args.filter((a, i) => !a.startsWith('-') && !script.has(i));
    for (const p of script.size || !/^sed$/i.test(cmd) ? files : files.slice(1)) add(p);
  } else if (NEW_ITEM.test(cmd)) {
    for (const p of positional) add(p);
    add(flagValue(PS_PATH));
  }
  return out;
}

/** A `\>|` splits as a pipe (clauses), leaving `call` ending in `\>` and the
 *  redirect's real target as the next segment's command word. The Bash spawn
 *  collapses `\\` to `\`, so whether that `>` was escaped is unknowable: the
 *  word is judged as a target too. */
function spilledTarget(calls, call) {
  if (!/\\>\s*$/.test(call.text)) return undefined;
  return calls.find((c) => c.pipe === call.pipe && c.seg === call.seg + 1)?.words[0];
}

/** The paths a pipeline feeds `call` (a PowerShell item cmdlet reads them as
 *  its source): the arguments of the segment before it, looking through
 *  Select-/Sort-/Where-Object, which pass items on unchanged. */
function upstreamPaths(calls, call) {
  if (!PS_ITEM.test(call.cmd)) return [];
  let prev = call;
  do prev = calls.find((c) => c.pipe === call.pipe && c.seg === prev.seg - 1);
  while (prev && PASS_THROUGH.test(prev.cmd));
  return prev ? ownArgs(prev.words).filter((a) => !a.startsWith('-')) : [];
}

/** Is a write to `word` from `dir` a write into a gate's records (or, with
 *  `removes`, a removal of a gate state file)? 'forge' when it resolves to
 *  one; 'unknown' when it can't resolve and looks aimed, which blocks only in
 *  a command naming one; null otherwise. Aimed: a substitution whose own text
 *  names one, a var this command set to such a value (`f=$(ls …/projects/…)`,
 *  `$p = Join-Path …`), a var fed at runtime (a for/read/foreach var, `$_`, a
 *  runner's `{}` or `$1`), or a `*.jsonl`/glob name relative to a dir the
 *  guard lost after a cd that named one. So `S=$(mktemp -d); … > "$S/o"`
 *  and `cd "$S" && … > all.jsonl` stay open. A `{}` inside a path stands for
 *  any name, judged as a glob (`cp {} ~/.claude/` could land a state file). */
function targetVerdict({ word, dirTarget, tree, removes, deep }, dir, vars, cmd) {
  if (word === '{}') return 'unknown';
  const p = toDir(dir, word.replaceAll('{}', '*'), vars);
  if (typeof p === 'string') return (removes ? removesGateState(p, deep, tree) : isGateRecord(p, dirTarget, tree)) ? 'forge' : null;
  const names = removes ? namesGateState : namesGateRecord;
  const refs = varNames(word);
  if (refs.length || /\$[(@*]|`/.test(word)) {
    const fed = /\$[@*]/.test(word) || refs.some((n) => isFed(cmd, n));
    return names(word) || fed || refs.some((n) => assignedValues(cmd, n).some(names)) ? 'unknown' : null;
  }
  const last = word.split(/[/\\]/).pop();
  return /\.jsonl$|[*?[]/i.test(last) && cdNamesGateRecord(cmd) ? 'unknown' : null;
}

/** The var names `text` references (`$f`, `${f:?}`, `${fs[0]}`, `$env:X`). */
const varNames = (text) => [...text.matchAll(VAR_REF)].map(([, braced, bare]) => (braced ?? bare).replace(/^env:/i, ''));

/** Is `name` fed at runtime: a positional (`$1`), PowerShell's pipeline item
 *  (`$_`, `$PSItem`), or bound by the command — `for name in`, `read … name`,
 *  `mapfile`/`readarray … name`, `printf -v name`, PowerShell
 *  `foreach ($name in`? */
const isFed = (cmd, name) =>
  /^(?:\d|_|PSItem)$/i.test(name) ||
  new RegExp(
    String.raw`\bfor\s+${name}\s+in\b|\b(?:read|mapfile|readarray)\b[^;|&\n]*\s${name}(?!\w)|\bprintf\s+-v\s*${name}(?!\w)|\bforeach\s*\(\s*\$${name}\s+in\b`,
    'i',
  ).test(cmd);

/** Does a cd/pushd/Set-Location in the command name a gate record? */
const cdNamesGateRecord = (cmd) =>
  [...cmd.matchAll(/(?:^|[\s;&|(])(?:cd|chdir|pushd|sl|set-location|push-location)\s+([^;&|\n]*)/gi)].some(([, to]) => namesGateRecord(to));

/** The value texts a command assigns to `name` (default: any name): bash
 *  `NAME=…` (one word, a substitution whole) or PowerShell `$NAME = …` (the
 *  rest of the statement: `$t = (Get-ChildItem … | Sort-Object …)[-1]`). Read
 *  off the text: words() splits `f=$(ls …)` at its spaces, so such an
 *  assignment never reaches `vars`. */
function assignedValues(cmd, name = String.raw`\w+`) {
  const set = new RegExp(String.raw`(?:^|[\s;&|({])(?:(\$(?:env:)?${name}\s*=(?!=)\s*)|${name}=)`, 'gi');
  return [...cmd.matchAll(set)].map((m) => valueAt(cmd, m.index + m[0].length, m[1] !== undefined));
}

/** The text of a value starting at `i`, quotes and brackets kept whole: up to
 *  the next unquoted, unbracketed space or separator, or with `statement`
 *  (PowerShell) up to the next `;` or newline. */
function valueAt(s, i, statement) {
  let depth = 0;
  let j = i;
  for (let q = null; j < s.length; j++) {
    const ch = s[j];
    if (q) {
      if (ch === '\\' && q === '"') j++;
      else if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") q = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && (statement ? /[;\n]/ : /[\s;|&<>]/).test(ch)) break;
  }
  return s.slice(i, j);
}

/** A runner's payloads, as word lists: each `find -exec`/`-ok` command (to
 *  its `;`/`+`), or the command after the runner's own options (`xargs -n1
 *  cp …`, `timeout 5 cp …`, `env A=1 cp …`). xargs/parallel without -I append
 *  their input as a last word, here `{}`; an -I token reads as `{}`. */
function runnerPayloads(cmd, args) {
  if (/^find$/i.test(cmd)) {
    const out = [];
    for (let i = 0; i < args.length; i++) {
      if (!/^-(?:exec|execdir|ok|okdir)$/.test(args[i])) continue;
      const end = args.findIndex((a, j) => j > i && /^\\?[;+]$/.test(a));
      out.push(args.slice(i + 1, end === -1 ? args.length : end));
      if (end !== -1) i = end;
    }
    return out.filter((p) => p.length);
  }
  const fed = /^(?:xargs|parallel)$/i.test(cmd);
  let token = null;
  let k = 0;
  while (k < args.length && (args[k].startsWith('-') || isAssign(args[k]) || /^\d/.test(args[k]))) {
    const flag = args[k++];
    if (fed && /^-I$|^--replace$/.test(flag)) token = args[k++];
    else if (fed && /^-I./.test(flag)) token = flag.slice(2);
    else if (fed && flag === '-i') token = '{}';
    else if (fed && /^-[nLPdsEa]$/.test(flag)) k++;
  }
  const payload = args.slice(k);
  if (!payload.length) return [];
  if (!fed) return [payload];
  if (token === null) return [[...payload, '{}']];
  return [payload.map((a) => a.replaceAll(token, '{}'))];
}

/** Does the command set a var to a gate-record path? */
const setsGateRecordVar = (cmd) => assignedValues(cmd).some(namesGateRecord);

/** The argument texts of the call whose `(` is at `open`, split on top-level
 *  commas (quotes and nested brackets respected). */
function callArgs(text, open) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = open + 1, q = null; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '\\') cur += ch + (text[++i] ?? '');
      else {
        if (ch === q) q = null;
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') q = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) {
      if (depth === 0) break;
      depth--;
    } else if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

/** A code argument that is one plain string literal, as its text, else null.
 *  A shell-escaped quote (`\"x\"` inside a double-quoted `-e`) counts. */
function literal(arg) {
  const m = /^(['"`])([^'"`]*)\1$/.exec(arg.replace(/\\(["'`])/g, '$1'));
  return m && !(m[1] === '`' && m[2].includes('${')) ? m[2].replaceAll('\\\\', '\\') : null;
}

/** Inline code's verdict: 'forge' when a write call's literal path is a gate
 *  record (or a removal's or move's literal path a gate state file), 'opaque'
 *  when a write's path isn't a literal (or it runs a subprocess), else null.
 *  Literal paths resolve from `dir`. */
function codeVerdict(code, dir) {
  let opaque = CODE_OPAQUE.test(code);
  const judge = (arg, o = {}) => {
    if (arg === undefined) return null;
    // A bare name set only from literals (`const f='README.md'; …(f, s)`) is
    // judged by those literals.
    if (/^[A-Za-z_$][\w$]*$/.test(arg)) {
      const set = [...code.matchAll(new RegExp(String.raw`(?<![\w$.])${arg.replace(/\$/g, '\\$')}\s*=(?![=>])\s*([^,;\n]*)`, 'g'))].map((m) => m[1].trim());
      if (set.length && set.every((v) => literal(v) !== null)) return set.some((v) => judge(v, o) === 'forge') ? 'forge' : null;
    }
    const lit = literal(arg);
    const p = lit === null ? null : toDir(dir, lit);
    if (typeof p === 'string') return (o.removes ? removesGateState(p) : isGateRecord(p, o.dirTarget)) ? 'forge' : null;
    opaque ||= lit === null || /\.jsonl$/i.test(lit);
    return null;
  };
  const end = (m) => m.index + m[0].length - 1;
  for (const m of code.matchAll(CODE_PATH_FIRST)) if (judge(callArgs(code, end(m))[0]) === 'forge') return 'forge';
  for (const m of code.matchAll(CODE_OPEN)) {
    const [path, mode] = callArgs(code, end(m));
    const modeText = mode === undefined ? null : literal(mode.replace(/^mode\s*=\s*/, ''));
    if (modeText !== null && /[wax+]/.test(modeText) && judge(path) === 'forge') return 'forge';
  }
  for (const m of code.matchAll(CODE_PATH_SECOND)) {
    const [from, to] = callArgs(code, end(m));
    if (judge(to, { dirTarget: true }) === 'forge') return 'forge';
    if (CODE_MOVE.test(m[0]) && judge(from, { removes: true }) === 'forge') return 'forge';
  }
  for (const m of code.matchAll(CODE_REMOVE)) if (judge(callArgs(code, end(m))[0], { removes: true }) === 'forge') return 'forge';
  return opaque ? 'opaque' : null;
}

const FORGE_REASON =
  'This writes into a session transcript (~/.claude/projects/**/*.jsonl) or an approval gate\'s state file (push-gate-approvals, browser-gate-sessions, fable-clearance), or deletes one of those state files. The push and browser gates read user approval from those files, so the model never writes them (#190). Read them freely; write any copy elsewhere (the scratchpad). Inline code that mentions them and writes a path built at runtime (computed, a subprocess, a pathlib/stream write) can\'t be verified, even when the path is literal: do the write as a separate step, e.g. print the result and redirect it to a literal path outside ~/.claude.';

/** 11, for one parsed call (a runner's payload included). `ctx` is the whole
 *  command: its text, raw form and whether it names a gate record or state
 *  file; `fed` marks a runner's payload, whose input is whatever it named. */
function callForges(call, ctx, fed = false) {
  for (const t of writeTargets(call)) {
    const v = targetVerdict(t, call.dir, call.vars, ctx.cmd);
    if (v === 'forge' || (v === 'unknown' && (t.removes ? ctx.namedState : ctx.named))) return true;
  }
  if (call.aside) return false;
  const args = ownArgs(call.words);
  if (RUNNER.test(call.cmd)) {
    return runnerPayloads(call.cmd, args).some((w) => {
      const cmd = w[0].split(/[/\\]/).pop();
      const c = SHELL_C.test(cmd) ? w.findIndex((a, i) => i > 0 && /^(?:-c|-Command)$/i.test(a)) : -1;
      if (c !== -1) return commands(w.slice(c + 1).join(' '), call.dir, false, false, newScope(call.dir, shellTool(cmd))).some((s) => callForges(s, ctx, true));
      // No redirect text: the outer shell already took any redirect as the runner's.
      return callForges({ cmd, words: w, text: '', dir: call.dir, vars: call.vars, tool: call.tool }, ctx, true);
    });
  }
  // The inline code: an eval flag's argument, PowerShell's own .NET call, or
  // for code read from stdin (`node - <<EOF`, a bare `python`) the raw text,
  // since a heredoc body is scrubbed out of `cmd`.
  let code = null;
  if (DOTNET_FILE.test(call.text)) code = call.text;
  else if (INTERPRETER.test(call.cmd)) {
    const e = args.findIndex((a) => EVAL_FLAG.test(a));
    if (e !== -1) code = args[e + 1] ?? '';
    else if (/^deno/i.test(call.cmd) && args[0] === 'eval') code = args.slice(1).join(' ');
    else if (args.includes('-') || !args.some((a) => !a.startsWith('-'))) code = ctx.raw;
  }
  if (code === null) return false;
  const v = codeVerdict(code, call.dir);
  // A computed path is aimed when this call or its code names a gate record,
  // a var the command set does (`f=$(ls …/projects/…)`, then `"$f"`), or a
  // runner, a pipeline or a loop feeds it (`$_`, a foreach var) what the
  // command named.
  if (v !== 'opaque') return v === 'forge';
  return (ctx.named && (fed || varNames(code).some((n) => isFed(ctx.cmd, n)))) || namesGateRecord(call.text) || namesGateRecord(code) || setsGateRecordVar(ctx.cmd);
}

/** 11. Does a command write into a transcript or a gate state file, or delete
 *  a state file? Read off parsed calls: a redirect, tee, cp/mv, dd, sed -i,
 *  truncate, curl -o, rm or PowerShell Copy-Item/Move-Item/New-Item/
 *  Tee-Object/Rename-Item/Remove-Item whose target resolves to one (or can't
 *  resolve and looks aimed at one, in a command naming one); a runner's
 *  payload (`find -exec`, `xargs`, `env`), judged as a call; or inline
 *  interpreter code (`node -e`, `python -c`, `node - <<EOF`, PowerShell
 *  [IO.File]) whose write call names one as a literal path, or writes a
 *  computed path while the command names one. Static, so best-effort: a
 *  script file is out of its sight, its path literal or built at runtime. */
export function forgeWrite(raw, cwd = null, tool = null) {
  const cmd = scrub(raw);
  const ctx = { cmd, raw, named: namesGateRecord(cmd), namedState: namesGateState(cmd) };
  const calls = commands(cmd, cwd, false, false, newScope(cwd, tool));
  return calls.some((call) => callForges({ ...call, upstream: upstreamPaths(calls, call), spill: spilledTarget(calls, call) }, ctx)) ? FORGE_REASON : null;
}

/** 11, for the file tools: Write/Edit/MultiEdit/NotebookEdit into a
 *  transcript or a gate state file. The path expands like a shell target
 *  (`~`, a Git Bash `/c/…` drive) and a relative one resolves against `cwd`. */
export function editToolReason(tool, input, cwd) {
  if (!/^(?:Write|Edit|MultiEdit|NotebookEdit)$/.test(tool || '')) return null;
  const raw = input?.file_path ?? input?.notebook_path;
  if (typeof raw !== 'string' || !raw) return null;
  const p = toDir(cwd || process.cwd(), raw.replaceAll('\\', '/'));
  return typeof p === 'string' && isGateRecord(p) ? FORGE_REASON : null;
}

/** editToolReason as the hook runs it: failing OPEN, since a crashed check
 *  must never lock out the Edit tool that fixes it. `check` is swappable so a
 *  test can make it throw. */
export function fileToolReason(tool, input, cwd, check = editToolReason) {
  try {
    return check(tool, input, cwd);
  } catch (err) {
    logError('bash-guard', err);
    return null;
  }
}

/** Words that only wrap the real command (subshell/group openers, env
 *  assignments, shell keywords). */
const WRAPPER = /^(?:[({!]+|\w+\+?=.*|\$env:\w+=.*|sudo|command|builtin|time|exec|nohup|then|do|else|elif|if|while|until)$/i;
const LOCATION = /^(?:cd|chdir|sl|set-location|pushd|push-location|popd|pop-location)$/i;
const SET_LOCATION = /^(?:cd|chdir|sl|set-location)$/i;
const POP_LOCATION = /^(?:popd|pop-location)$/i;
const SHELL_C = /^(?:bash|sh|zsh|dash|pwsh|powershell|cmd|eval|iex|invoke-expression)(?:\.exe)?$/i;
const EVAL = /^(?:eval|iex|invoke-expression)$/i;
// An if/elseif condition that runs no command: a var, a literal, `-not` one, or
// two compared (`if ($x -eq 'b')`).
const TEST_OPERAND = String.raw`(?:\$[\w:]+|-?\d+|'[^']*'|"[^"$\x60]*")`;
const PLAIN_TEST = new RegExp(String.raw`^(?:if|elseif)\s*\(\s*(?:(?:!|-not)\s*)?${TEST_OPERAND}(?:\s+-[a-z]+\s+${TEST_OPERAND})?\s*\)$`, 'i');
// A PowerShell block head whose condition runs as a command (#214): the text in
// its parens. Its calls are read from the head, not off the clause's words.
const CONDITION_HEAD = /^(if|elseif|while)\s*\(([\s\S]*)\)$/i;
// A block head that is a print command with plain args: the block is one more arg.
const PRINTED = /^(?:echo|printf|write|write-output|write-host)(?:\s[^()$@;&|<>`]*)?$/i;
// A case arm's pattern word: `a)`, `(a)`, `a|b)`, `*)`, never fi)/done)/esac).
const CASE_PATTERN = /^\(?(?!(?:esac|fi|done)\)+$)[^()]+\)$/;
const GIT_OPT_WITH_ARG = /^(?:-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env)$/;
// Variables that still resolve: HOME and USERPROFILE, in every spelling ($X,
// ${X}, $env:X, ${env:X}), are the home dir, PWD the dir itself. A leading one becomes `~`/`.` so the
// path joins cleanly; elsewhere VAR_REF substitutes it.
const HOME_VAR = /^\$(?:\{(?:env:)?(?:HOME|USERPROFILE)\}|(?:env:)?(?:HOME|USERPROFILE)(?!\w))/i;
const PWD_VAR = /^\$(?:\{PWD\}|PWD(?!\w))/i;
// A braced ref may carry an index or an operator (`${fs[0]}`, `${f:?}`,
// `${f#*/}`): its name still counts, but its value doesn't (expandWord).
const VAR_REF = /\$\{((?:env:)?\w+)(?:\[[^\]]*\]|[:#%/^,@][^}]*)?\}|\$((?:env:)?\w+)/gi;

// Shell vars are a persistent chain, newest first: { key, value, up } or null.
// An assignment prepends a link, so a snapshot or a body's copy is the
// reference itself, never a copy (#163: copying a map per git call, body or
// substitution was quadratic). Keys: `sh:NAME` for bash (case-sensitive),
// `ps:name` for PowerShell (case-insensitive, like the shell).
const varOf = (vars, key) => {
  for (let v = vars; v; v = v.up) if (v.key === key) return v.value;
  return undefined;
};

/** `p` with its variables expanded: HOME/USERPROFILE/PWD, and the names a
 *  literal assignment earlier in the command set (`vars`). A string, null when
 *  it needs the dir and the dir is null (no info), or UNKNOWN_DIR when a
 *  variable or substitution is left, or a var is read through a PowerShell
 *  member or index (`$W.FullName`, `$W[0]`). */
function expandWord(p, dir, vars = null) {
  let miss = 0; // 1: a part is null, 2: a part is unknown
  const e = p.replace(HOME_VAR, '~').replace(VAR_REF, (m, braced, bare, at, s) => {
    const name = braced ?? bare;
    let v;
    if (/^(?:\.[A-Za-z]|\[)/.test(s.slice(at + m.length, at + m.length + 2))) v = UNKNOWN_DIR;
    else if (braced && m.length > braced.length + 3) v = UNKNOWN_DIR; // an index or operator
    else if (/^(?:env:)?(?:home|userprofile)$/i.test(name)) v = homedir();
    else if (/^pwd$/i.test(name)) v = dir;
    else if ((v = varOf(vars, `sh:${name}`)) === undefined) v = varOf(vars, `ps:${name.toLowerCase()}`);
    if (typeof v === 'string') return v;
    miss = Math.max(miss, v === null ? 1 : 2);
    return m;
  });
  if (miss === 2 || (!miss && /[$`]/.test(e))) return UNKNOWN_DIR;
  return miss ? null : expandHome(e);
}

/** The dir a cd to `p` from `dir` lands in: a path, null (a relative target
 *  with no cwd to resolve it against: no info, callers fail open) or
 *  UNKNOWN_DIR (a target still holding a variable or substitution once
 *  expandWord ran, a relative target from an unknown dir, or `cd -`, whose
 *  previous dir isn't tracked). On Windows a Git Bash `/c/…` (or bare `/c`)
 *  is the drive path `C:/…`, which git -C can open. */
const toDir = (dir, p, vars = null) => {
  if (p === '-') return UNKNOWN_DIR;
  let e = expandWord(p.replace(PWD_VAR, '.'), dir, vars);
  if (typeof e !== 'string') return e;
  if (process.platform === 'win32') e = e.replace(/^\/([a-zA-Z])(?:\/|$)/, (_, d) => `${d.toUpperCase()}:/`);
  if (isAbsolute(e)) return e;
  return typeof dir === 'string' ? resolve(dir, e) : dir;
};

const isAssign = (a) => /^[A-Za-z_]\w*\+?=/.test(a);
const DECLARE = /^(?:export|declare|typeset|local|readonly)$/;
const READS_VAR = /^(?:unset|read|mapfile|readarray)$/;

// A location switch takes no value: bash's cd/pushd flags, alone or combined
// (-L, -P, -e, -@, -PL, -e@; PowerShell's -L/-P prefixes leave the dir the
// next word either way), and PowerShell's -PassThru and common switches.
// Every other -Flag takes the next word, or its own `-Flag:value`.
const LOCATION_SWITCH = (a) => /^-(?:[LPe@]+|\w)$/.test(a) || /^-(?:pas\w*|verbose|vb|debug|db|whatif|wi|confirm|cf)$/i.test(a);

/** A cd/pushd/popd clause's arguments as { path, stack, n, rotate }: `path`
 *  the target (a bare word, or -Path/-LiteralPath's value), `stack` the
 *  lowercased -StackName (PowerShell names are case-insensitive), `n` bash's
 *  -n, `rotate` a +N/-N. Other value flags' values (-ErrorAction Stop) are
 *  skipped, never read as the dir. */
function locationArgs(args) {
  const o = { path: undefined, stack: undefined, n: false, rotate: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (/^[+-]\d+$/.test(a)) o.rotate = true;
    else if (a === '-n') o.n = true;
    else if (a === '--') {
      o.path ??= args[i + 1];
      break;
    } else if (a === '-' || !a.startsWith('-')) o.path ??= a;
    else if (!LOCATION_SWITCH(a)) {
      const colon = a.indexOf(':');
      const flag = (colon === -1 ? a : a.slice(0, colon)).toLowerCase();
      const value = colon === -1 ? args[++i] : a.slice(colon + 1);
      const prefix = (full, min) => flag.length >= min && full.startsWith(flag);
      if (prefix('-stackname', 3)) o.stack = (value ?? '').toLowerCase();
      else if (prefix('-path', 4) || prefix('-literalpath', 3) || flag === '-lp' || flag === '-pspath') o.path ??= value;
    }
  }
  return o;
}

/** Walk `scope` — { dir, stacks } — through one cd/Set-Location/pushd/popd
 *  clause. `stacks` maps a stack name ('' the default) to its dirs, top last.
 *  pushd pushes and cds; -n pushes without moving. A bare pushd swaps the dir
 *  with the top in bash but pushes and stays in PowerShell (its alias for
 *  Push-Location), so on a non-empty stack the dir and the top become unknown;
 *  on an empty one nothing moves (bash errors, PowerShell stays). A bare
 *  Push-Location pushes and stays. -StackName pushes or pops that named stack.
 *  A bare popd/Pop-Location pops the default stack; popd -n drops the top
 *  without moving. +N/-N rotates or drops an entry the model can't place, so
 *  the dir and every entry become unknown. Set-Location -StackName makes
 *  another stack the default, which this model gives up: the dir stays, and
 *  `stacks` turns null, so every later pop lands in UNKNOWN_DIR. */
function moveLocation(scope, cmd, args) {
  const o = locationArgs(args);
  const path = o.path?.replace(/\)+$/, '');
  if (SET_LOCATION.test(cmd)) {
    if (o.stack !== undefined) scope.stacks = null;
    else if (path !== undefined) scope.dir = toDir(scope.dir, path, scope.vars);
    else if (/^cd$/i.test(cmd)) scope.dir = homedir();
    return;
  }
  const pop = POP_LOCATION.test(cmd);
  if (!scope.stacks) {
    if (pop) scope.dir = UNKNOWN_DIR;
    else if (path !== undefined && !o.n) scope.dir = toDir(scope.dir, path, scope.vars);
    return;
  }
  const name = o.stack ?? '';
  if (!scope.stacks.has(name)) scope.stacks.set(name, []);
  const stack = scope.stacks.get(name);
  if (o.rotate || (o.n && path === undefined && !pop)) {
    if (pop) stack.pop();
    stack.fill(UNKNOWN_DIR);
    if (o.rotate) scope.dir = UNKNOWN_DIR;
  } else if (pop) {
    const top = stack.pop();
    if (top !== undefined && !o.n) scope.dir = top;
  } else if (path !== undefined) {
    const to = toDir(scope.dir, path, scope.vars);
    stack.push(o.n ? to : scope.dir);
    if (!o.n) scope.dir = to;
  } else if (/^pushd$/i.test(cmd)) {
    if (stack.length) [scope.dir, stack[stack.length - 1]] = [UNKNOWN_DIR, UNKNOWN_DIR];
  } else stack.push(scope.dir);
}

const isCommitCall = (e) => /^git(?:\.exe)?$/i.test(e.cmd) && e.words.includes('commit');

/** A copy of `scope` for a body that runs elsewhere or later (or a
 *  substitution's subshell): it reads the dir, stacks, vars and functions, but
 *  its cd, pushd/popd and assignments move the copy, never the clauses after
 *  it. */
const scopeCopy = ({ dir, stacks, vars, funcs, tool }) => ({ dir, stacks: stacks && new Map([...stacks].map(([k, v]) => [k, [...v]])), vars, funcs, tool });

// The function-body characters one walk may read to judge calls (#171). Past
// it a call fails closed: the dir is unknown after it.
const FUNCTION_BUDGET = 100_000;

/** A walk's starting scope. `tool` is the shell that runs the text: 'Bash',
 *  'PowerShell', or null when unknown (where the two disagree on whether a cd
 *  outlives a ( … ) group or a pipeline stage, it leaves the dir unknown).
 *  `funcs` holds the functions defined so far (`defs`, name → { body, own,
 *  walking }), a generation `gen` each new definition bumps, and the call
 *  effects memoized for it (`effects`, see callEffect). */
const newScope = (cwd, tool = null) => ({
  dir: cwd || null,
  stacks: new Map(),
  vars: null,
  funcs: { defs: new Map(), gen: 0, effects: new Map(), budget: FUNCTION_BUDGET },
  tool,
});

/** The shell a nested command string runs in (see newScope). */
const shellTool = (cmd) => (/^(?:bash|sh|zsh|dash)(?:\.exe)?$/i.test(cmd) ? 'Bash' : /^(?:pwsh|powershell)(?:\.exe)?$/i.test(cmd) ? 'PowerShell' : null);

/** Record a function definition; one with the body it already has changes nothing. */
const defineFunction = (funcs, name, body) => {
  if (funcs.defs.get(name)?.body === body) return;
  funcs.defs.set(name, { body, own: null, walking: false });
  funcs.gen++;
};

// A called function's body is walked from this dir: a cd anywhere moves off it.
const FUNCTION_START = '\0function-start';

/** A function's own effect, which depends on its body alone: whether the
 *  body moves the location (walked from FUNCTION_START with empty stacks, so
 *  any cd, or any pushd/popd, counts), the var keys it assigns, and every
 *  command word it calls, recorded rather than followed. Walked once per
 *  definition; a re-entrant walk (a call in its own substitution) adds
 *  nothing, and past the budget it counts as moving. */
function ownEffect(scope, fn) {
  if (fn.own) return fn.own;
  const none = { moves: false, keys: new Set(), calls: new Set() };
  if (fn.walking) return none;
  scope.funcs.budget -= fn.body.length;
  if (scope.funcs.budget < 0) return { ...none, moves: true };
  const probe = { ...scopeCopy(scope), dir: FUNCTION_START, stacks: new Map(), calls: new Set() };
  fn.walking = true;
  commands(fn.body, null, false, false, probe);
  fn.walking = false;
  const moves = probe.dir !== FUNCTION_START || !probe.stacks || probe.stacks.size > 0;
  fn.own = { moves, keys: assignedSince(probe.vars, scope.vars), calls: probe.calls };
  return fn.own;
}

/** What a call to `name` does to its caller: the union of the own effects of
 *  every defined function it reaches (so a cycle costs nothing), memoized
 *  per generation of the definitions. */
function callEffect(scope, name) {
  const { funcs } = scope;
  const memo = funcs.effects.get(name);
  if (memo?.gen === funcs.gen) return memo;
  const effect = { gen: funcs.gen, moves: false, keys: new Set() };
  const seen = new Set([name]);
  for (const todo = [name]; todo.length; ) {
    const own = ownEffect(scope, funcs.defs.get(todo.pop()));
    effect.moves ||= own.moves;
    for (const key of own.keys) effect.keys.add(key);
    for (const c of own.calls) {
      if (seen.has(c) || !funcs.defs.has(c)) continue;
      seen.add(c);
      todo.push(c);
    }
  }
  funcs.effects.set(name, effect);
  return effect;
}

/** The location (the dir and the non-empty pushd stacks) as a comparable key. */
const locationKey = ({ dir, stacks }) => JSON.stringify([dir, stacks && [...stacks].filter(([, v]) => v.length).sort()]);

/** A location the guard can't follow: the dir and every pushd stack entry
 *  become unknown. */
const loseLocation = (scope) => {
  scope.dir = UNKNOWN_DIR;
  scope.stacks = null;
};

/** The var keys assigned on `vars` since `before` (a link further up its chain). */
const assignedSince = (vars, before) => {
  const set = new Set();
  for (let v = vars; v !== before; v = v.up) set.add(v.key);
  return set;
};

const setVar = (scope, key, value) => {
  scope.vars = { key, value, up: scope.vars };
};

const PS_ASSIGN = /^\$(\w+)\s*([-+*/%]?)=(?!=)\s*(.*)$/s;
const PS_SCOPED_ASSIGN = /^\$(?:global|script|local|private):(\w+)\s*[-+*/%]?=(?!=)/i;
const PS_VARIABLE = /^(?:Set-Variable|sv|New-Variable|nv|Remove-Variable|rv|Clear-Variable|clv)$/i;
// `function f`, `function f()`, PowerShell `function f($a)`/`filter f`, bash `f()`.
const FUNCTION_HEAD = /^(?:function|filter)\s+([\w-]+)|^([\w-]+)\s*\(\s*\)$/i;

/** The var keys a command sets to a value the guard can't read: printf -v,
 *  let, getopts, and PowerShell's Set-/New-/Remove-/Clear-Variable (by -Name
 *  or first positional, a comma list too). */
function runtimeSets(cmd, args) {
  if (cmd === 'printf') {
    const i = args.findIndex((a) => a.startsWith('-v'));
    const name = i === -1 ? undefined : args[i].slice(2) || args[i + 1];
    return name ? [`sh:${name}`] : [];
  }
  if (cmd === 'let') return args.flatMap((a) => /^([A-Za-z_]\w*)(?:\[[^\]]*\])?\s*[-+*/%&|^<>]*=/.exec(a)?.slice(1, 2) ?? []).map((n) => `sh:${n}`);
  if (cmd === 'getopts') return args[1] ? [`sh:${args[1]}`] : [];
  if (!PS_VARIABLE.test(cmd)) return [];
  let name;
  for (let i = 0; i < args.length && name === undefined; i++) {
    const m = /^-(\w+)(?::(.*))?$/.exec(args[i]);
    if (!m) name = args[i];
    else if (/^n(?:a(?:me?)?)?$/i.test(m[1])) name = m[2] ?? args[i + 1];
    else if (m[2] === undefined && !/^(?:force|passthru|whatif|confirm|verbose|debug)$/i.test(m[1])) i++;
  }
  return (name ?? '').split(',').filter(Boolean).map((n) => `ps:${n.replace(/^\$/, '').toLowerCase()}`);
}

/** Record a bare assignment clause's names in `scope.vars` (see expandWord):
 *  bash `NAME=value` words, or PowerShell `clause` text `$NAME = '…'`/`"…"`.
 *  Only a `certain` one with a value built from parts that expand keeps it;
 *  anything else — a substitution, an unresolved var, an unquoted PowerShell
 *  right side (a command's output), a `+=`, or an assignment that may not run —
 *  makes the name unknown. */
function assignVars(scope, bashWords, clause, certain) {
  const set = (key, value) => setVar(scope, key, certain ? value : UNKNOWN_DIR);
  if (bashWords) {
    for (const a of bashWords) {
      const eq = a.indexOf('=');
      if (a[eq - 1] === '+') set(`sh:${a.slice(0, eq - 1)}`, UNKNOWN_DIR);
      else set(`sh:${a.slice(0, eq)}`, expandWord(a.slice(eq + 1), scope.dir, scope.vars));
    }
    return;
  }
  const m = PS_ASSIGN.exec(clause);
  const lit = !m[2] && /^'([^']*)'$|^"([^"`]*)"$/.exec(m[3].trim());
  set(`ps:${m[1].toLowerCase()}`, !lit ? UNKNOWN_DIR : lit[1] ?? expandWord(lit[2], scope.dir, scope.vars));
}

/** A pipeline's unquoted parens, outside quotes, substitutions and blocks, as
 *  { net, opened }: `net` how far it moves the subshell depth (`(` minus `)`),
 *  `opened` whether it holds a `(` at all (part of it runs in a subshell). */
function parens(p) {
  let net = 0;
  let opened = false;
  let span;
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '\\') i++;
    else if (ch === "'") {
      i = p.indexOf("'", i + 1);
      if (i === -1) break;
    } else if (ch === '"') {
      for (i++; i < p.length && p[i] !== '"'; i++) if (p[i] === '\\') i++;
    } else if ((span = substitutionAt(p, i, false) || blockAt(p, i))) i = span.end - 1;
    else if (ch === '(') [net, opened] = [net + 1, true];
    else if (ch === ')') net--;
  }
  return { net, opened };
}

/** Every command a line runs, as { cmd, words, dir, tool, pipe, seg, viaOr, loop }:
 *  `cmd` is the command word's basename, `dir` the payload cwd walked through
 *  the cd/pushd/popd clauses before it (see moveLocation; UNKNOWN_DIR once a
 *  target can't be resolved, see toDir), `tool` the shell running it (see
 *  newScope), `pipe` an identity shared by the
 *  commands of one pipeline and `seg` the command's place in it. `viaOr` marks
 *  the first commit of an `||` alternative to a commit (it runs only if the
 *  pipeline right before the `||` failed, and that pipeline's exit status is a
 *  commit's: run directly, last in its pipeline, not under `!`): a commit in
 *  the alternative's first pipeline, or in the leading `&&` pipelines of a
 *  body it enters (`|| { …; }`, `|| bash -c "…"`), or, when that
 *  pipeline opens a `( … )` group, in any of the group's pipelines (#160,
 *  #167: the whole group is the alternative, so its `;` keeps the carry) — not
 *  in `a || cd x && git commit`, which bash reads as `(a || cd x) && …`.
 *  `loop` marks one inside a for/while/until loop (it may run several times).
 *  `arms` (when set) lists the arms of the PowerShell if/elseif/else chains
 *  (one clause each) it sits in, as { chain, n }: only one arm of a chain runs.
 *  Location clauses are consumed; a quoted command handed to a shell is
 *  expanded in place (eval/iex share this shell's location and vars), and so is
 *  every substitution body (`…`, $(…), <(…)), which runs before the clause
 *  holding it. A block body (`{ … }`) is walked after its clause's own
 *  substitutions. One that runs in place (a group, a branch, a
 *  foreach/while/do/ForEach-Object body) shares the cwd walk, so a cd inside it
 *  moves the commands in it; one that runs elsewhere or later (a function, a
 *  job, a -Parallel or stored block) gets a copy of the cwd and stacks, which
 *  it can't move back. A body is a `loop` unless it runs once — a bare group,
 *  an if/elseif/else/try/catch/finally branch — since a PowerShell loop has no
 *  `done` to count. In bash a ( … ) group's close, or the end of a stage of a
 *  pipeline of several, restores the location before it (closeSubshells,
 *  #171); a backgrounded pipeline's cd moves only its job. The location is
 *  unknown after a body that moved it but may not run exactly once (an
 *  if/case/loop, or a block that isn't a bare group, try or finally), and
 *  after a call to a function that, with what it calls, moves it (callEffect). Other
 *  quoted text is an argument, never a
 *  command. A bare assignment (`W=…`, `export W=…`, `$W = '…'`) sets a var a
 *  later cd target or `git -C` expands (assignVars); one in a loop, a
 *  subshell, a pipeline, a background job, an if/case, an in-place body or
 *  after an `||` makes it unknown, as do unset/read/mapfile, a `for`/`select`
 *  var, the names runtimeSets reads, a scoped `$global:W =`, and a call to a
 *  function that assigns it. `orFirst`/`inLoop` carry the enclosing clause's
 *  state into a body; `scope` is the cwd, pushd stacks, vars and defined
 *  functions a block shares with its clause. Past MAX_NESTING it throws a
 *  NestingError, which the hook turns into a block. */
function commands(raw, cwd, orFirst = false, inLoop = false, scope = newScope(cwd)) {
  // The top-level text is level 0: up to MAX_NESTING bodies below it are read.
  // The count is back to 0 after every outermost call, thrown or not.
  if (nesting > MAX_NESTING) throw new NestingError();
  nesting++;
  try {
    return walkCommands(raw, cwd, orFirst, inLoop, scope);
  } finally {
    nesting--;
  }
}

/** One level of commands(): the walk itself. */
function walkCommands(raw, cwd, orFirst, inLoop, scope) {
  const out = [];
  let loops = 0; // loops opened in this text and not yet closed by `done`
  let ifs = 0; // bash if/case blocks opened in this text and not yet closed by fi/esac
  const caseDepths = []; // per open case block, the subshell depth inside it
  // The location when the outermost open if/case/loop began: a body that may
  // run zero or many times leaves the location unknown once it closes, if it
  // moved it.
  let region = null;
  const settle = () => {
    if (ifs + loops === 0) {
      if (region !== null && locationKey(scope) !== region) loseLocation(scope);
      region = null;
    } else region ??= locationKey(scope);
  };
  // The location before each open bash subshell (a ( … ) group, or a stage of
  // a pipeline of several), innermost last: its close restores it, since a
  // subshell's cd doesn't outlive it. PowerShell runs both in place; with no
  // tool, a close that changed the location leaves it unknown.
  const subshells = [];
  let closing = 0; // subshells the last clause closed
  const closeSubshells = () => {
    let outer;
    for (; closing > 0 && subshells.length; closing--) outer = subshells.pop();
    closing = 0;
    if (!outer) return;
    if (scope.tool === 'Bash') [scope.dir, scope.stacks] = [outer.dir, outer.stacks];
    else if (locationKey(scope) !== locationKey(outer)) loseLocation(scope);
  };
  // What `run` assigns in `scope` stands only when `certain`; otherwise each
  // name it assigned is unknown after it.
  const unlessCertain = (certain, run) => {
    const before = scope.vars;
    run();
    if (certain) return;
    const set = assignedSince(scope.vars, before);
    scope.vars = before;
    for (const key of set) setVar(scope, key, UNKNOWN_DIR);
  };
  let depth = 0; // the ( … ) subshell depth before this pipeline
  let orGroup = -1; // the depth just outside an `|| ( … )` group that still carries viaOr
  let orList = false; // an `||` since the last `;`/newline/`&`: what runs now may not
  const pipeSeps = [];
  let committed = false; // the pipeline before this one emitted a git commit
  for (const [pi, p] of pipelines(raw, pipeSeps, scope.tool).entries()) {
    // An `||` makes an alternative only to a commit that could have failed: the
    // pipeline right before it must hold one (`a; false || git commit` is no
    // fallback — its commit spends like any other).
    const orCommit = pipeSeps[pi] === '||' && committed;
    committed = false;
    // The whole group runs only as the alternative, so any separator inside
    // it keeps the carry; past its close the carry ends (below).
    if (orCommit && p.startsWith('(')) orGroup = depth;
    // A body entered as an alternative (`|| { …; }`, `|| bash -c "…"`) carries
    // it across its leading && pipelines, like an `|| ( … )` group.
    if (pi > 0 && pipeSeps[pi] !== '&&') orFirst = false;
    if (pipeSeps[pi] === '||') orList = true;
    else if (pipeSeps[pi] !== '&&') orList = false;
    const par = parens(p);
    // An assignment here may not set the var for what follows: in a subshell,
    // after an `||`, or backgrounded by the `&` after the pipeline.
    const unsure = depth > 0 || par.opened || orList || pipeSeps[pi + 1] === '&';
    // Only the alternative's first commit is sure to run before the rest of
    // it: viaOr clears once one is emitted. A substitution ahead of it
    // (`-m "$(cat …)"`, `FOO=$(date) git …`) leaves it set.
    let viaOr = orCommit || orFirst || orGroup !== -1;
    // A backgrounded pipeline (`cd x &`) runs as a job: its cd moves only the job.
    const job = pipeSeps[pi + 1] === '&' && scopeCopy(scope);
    const emit = (...cs) => {
      out.push(...cs);
      if (cs.some(isCommitCall)) [viaOr, orGroup, orFirst] = [false, -1, false];
    };
    const pipe = {};
    const blocks = [];
    const segs = clauses(p, false, null, blocks, scope.tool);
    for (const [seg, c] of segs.entries()) {
      settle();
      closeSubshells();
      const w = words(c);
      // A case arm's pattern (`a)`, `(a)`, `a|b)`) heads the command it runs, on
      // the `case … in` line or its own. On its own line it is told from a
      // group's `)` by depth: no subshell may have opened since the case began.
      let pattern = caseDepths.length && subshells.length === caseDepths[caseDepths.length - 1] && CASE_PATTERN.test(w[0] ?? '') ? w.shift() : null;
      // A bash loop keyword; a PowerShell for (…)/while (…) block has no `done`
      // to close it. A lone `(` after the keyword is PowerShell when a `{` body
      // follows it or the `(` runs on past this clause (`for ($i=0; …`); a bash
      // subshell condition (`while (true); do`) closes with no `{`.
      const psBlock = () => /^\((?!\()/.test(w[0] ?? '') && (/\)\s*\{/.test(c) || !c.includes(')'));
      const opensLoop = (kw) => /^(?:for|while|until)$/i.test(kw) && !psBlock();
      const wrappers = [];
      let negated = false; // a `!` wrapper inverts the clause's exit status
      let opens = 0; // ( … ) subshells opened at command position
      // A `(` after if/while/until opens a PowerShell condition, not a subshell.
      const countOpens = (lead) => {
        if (!(/^(?:if|while|until)$/i.test(wrappers[wrappers.length - 1] ?? '') && psBlock())) opens += lead.split('(').length - 1;
      };
      for (;;) {
        if (w.length && /^[({!]+./.test(w[0])) {
          const lead = w[0].match(/^[({!]+/)[0];
          negated ||= lead.includes('!');
          countOpens(lead);
          w[0] = w[0].slice(lead.length);
        }
        if (!w.length || !WRAPPER.test(w[0])) break;
        negated ||= /^[({!]+$/.test(w[0]) && w[0].includes('!');
        if (/^[({!]+$/.test(w[0])) countOpens(w[0]);
        const kw = w.shift();
        wrappers.push(kw);
        if (opensLoop(kw)) loops++; // a while/until condition repeats too
        if (/^if$/i.test(kw) && !psBlock()) ifs++;
      }
      const opensCase = w[0] === 'case' && w[2] === 'in';
      if (opensCase) {
        w.splice(0, 3);
        ifs++;
        if (CASE_PATTERN.test(w[0] ?? '')) pattern = w.shift();
      }
      settle();
      // A `|` in a pattern splits no pipeline stage.
      if (segs.length > 1 && !opens && pattern === null) opens = 1; // a bash stage is a subshell of its own
      if (scope.tool === 'PowerShell') opens = 0;
      for (let i = 0; i < opens; i++) subshells.push(scopeCopy(scope));
      if (opensCase) caseDepths.push(subshells.length);
      // A pattern's parens open or close no subshell.
      closing = opens - parens(c).net + (pattern === null ? 0 : parens(pattern).net);
      // A group's closing `)` sticks to its last word (`(git push)`), unless the
      // word opens a `(` of its own for it to close.
      if (w.length) {
        const last = w[w.length - 1];
        const extra = (last.match(/\)/g) || []).length - (last.match(/\(/g) || []).length;
        if (extra > 0) w[w.length - 1] = last.replace(/\)+$/, (m) => m.slice(extra));
        if (!w[w.length - 1]) w.pop();
      }
      // A clause opening with a condition block (`if (git push) { … }`) runs
      // that condition: the block loop below reads it, and every later
      // condition head of the clause (`} elseif (…) {`), as commands.
      const conditions = (blocks[seg] || []).filter(({ head }) => CONDITION_HEAD.test(head.trim()));
      if (conditions.length && conditions[0] === blocks[seg][0]) w.length = 0;
      const cmd = w.length ? w[0].split(/[/\\]/).pop() : '';
      const loop = inLoop || loops > 0;
      // eval/iex take the command as their words, iex maybe after -Command.
      const shellAt = !SHELL_C.test(cmd) ? -1 : EVAL.test(cmd) ? (/^-c/i.test(w[1] ?? '') ? 1 : 0) : w.findIndex((a, i) => i > 0 && /^(?:-c|-Command|\/c)$/i.test(a));
      const shellCmd = shellAt !== -1 && w[shellAt + 1] !== undefined ? w.slice(shellAt + 1).join(' ') : null;
      // A shell's own command string is parsed whole below; reading its
      // substitutions here too would count each gated verb twice.
      // A condition's own substitutions are read with it, below.
      const own = conditions.reduce((t, { head }) => t.replace(head.trim(), ''), c);
      if (shellCmd === null) for (const body of substitutions(own)) emit(...commands(body, null, viaOr, loop, scopeCopy(scope)));
      let chain = null; // the PowerShell if/elseif/else chain this clause's blocks are arms of
      for (const { head, body } of blocks[seg] || []) {
        const h = head.trim();
        // echo prints a `{ … }` it owns (bash: words, PowerShell: a script block)
        // unless bash would split it: a separator, redirect or substitution in it
        // runs. It owns one only when the clause is the echo: a later block's head
        // is just the text since the last `}` (`& { … } echo {`). One in a
        // condition, a call or a method argument (`if (echo x) {`, `echo (icm {`,
        // `.ForEach({`) is no echo arg.
        if (PRINTED.test(cmd) && PRINTED.test(h) && !/[;&|\n<>$`()]/.test(body)) continue;
        // Only one arm of a chain runs: each tags the calls in its body (see
        // exclusive). A condition the guard can't read (a command) may itself
        // commit, so it voids the chain's exemption.
        if (/^if\s*\(/i.test(h)) chain = { arms: 0, read: true };
        else if (!/^(?:elseif|else)\b/i.test(h)) chain = null;
        if (chain && /^(?:if|elseif)\b/i.test(h) && !PLAIN_TEST.test(h)) chain.read = false;
        const arm = chain && { chain, n: chain.arms++ };
        const inArm = (cs) => {
          if (arm) for (const call of cs) (call.arms ??= []).push(arm);
          return cs;
        };
        // The condition runs in place, in no arm: an elseif's runs whenever an
        // earlier arm's condition fails, a while's at least once and maybe more.
        const condition = CONDITION_HEAD.exec(h);
        if (condition) {
          const repeats = /^while$/i.test(condition[1]);
          const at = locationKey(scope);
          unlessCertain(false, () => emit(...commands(condition[2], null, viaOr, loop || repeats, scope)));
          if (locationKey(scope) !== at && !/^if$/i.test(condition[1])) loseLocation(scope);
        }
        const once = /^(?:[&.]\s*)?$|^(?:if|elseif|else|try|catch|finally|then)\b/i.test(h);
        // In place too: a PowerShell switch arm (`'a' { … }`, `default { … }`)
        // and the body after a condition split at its `;` (`for (…; …; $i++) {`).
        const inPlace = once || /^(?:foreach|for|while|do|until|switch)(?![\w-])|^(?:ForEach-Object|%|foreach|Where-Object|\?)$|^(?:'[^']*'|"[^"]*"|default|-?\d+|[^()]*\))$/i.test(h);
        if (!inPlace) {
          emit(...commands(body, null, viaOr, loop || !once, scopeCopy(scope)));
          // A function's call runs its body in the caller's shell (see below).
          const fn = FUNCTION_HEAD.exec(h);
          if (fn) defineFunction(scope.funcs, (fn[1] ?? fn[2]).toLowerCase(), body);
          continue;
        }
        // An in-place body moves the shared dir, but it may run zero or many
        // times: a name it assigns is unknown after it, and so is the location
        // it moved, unless it surely runs once (a bare group, try, finally).
        const at = locationKey(scope);
        unlessCertain(false, () => emit(...inArm(commands(body, null, viaOr, loop || !once, scope))));
        if (locationKey(scope) !== at && !/^(?:[&.]\s*)?$|^(?:try|finally)\b/i.test(h)) loseLocation(scope);
      }
      // A bare assignment sets a shell var for the clauses after it; a prefix one
      // (`W=x git -C $W …`) only the command's env, after $W already expanded.
      // export/declare/typeset/local/readonly NAME=… counts the same (with no
      // flag beside it); a bare NAME there only marks the var, so its value
      // stays — except `local NAME`, which empties it. Any other form, and
      // unset/read/mapfile, leaves the name unknown.
      const certain = !loop && !unsure && !ifs && segs.length === 1 && wrappers.every(isAssign);
      const declared = DECLARE.test(cmd) && w.slice(1);
      const flagged = declared && declared.some((a) => /^[-+]/.test(a));
      const sets = declared && declared.filter((a) => a.includes('=') || (cmd === 'local' && !/^[-+]/.test(a)));
      if (!w.length && wrappers.some(isAssign)) assignVars(scope, wrappers.filter(isAssign), c, certain);
      else if (sets && sets.length && !flagged && sets.every(isAssign)) assignVars(scope, sets, c, certain);
      else if (sets || READS_VAR.test(cmd)) {
        for (const a of sets || w.slice(1)) if (/^[A-Za-z_]\w*(?:\+?=|$)/.test(a)) setVar(scope, `sh:${a.match(/^\w+/)[0]}`, UNKNOWN_DIR);
      } else if (!wrappers.length && PS_SCOPED_ASSIGN.test(c)) setVar(scope, `ps:${c.match(PS_SCOPED_ASSIGN)[1].toLowerCase()}`, UNKNOWN_DIR);
      else if (!wrappers.length && PS_ASSIGN.test(c)) assignVars(scope, null, c, certain);
      else if (/^foreach$/i.test(cmd) && /\(\s*\$(\w+)\s+in\b/i.test(c)) setVar(scope, `ps:${c.match(/\(\s*\$(\w+)\s+in\b/i)[1].toLowerCase()}`, UNKNOWN_DIR);
      else if (w.length && /^(?:fi|esac)\)*$/.test(cmd)) {
        ifs = Math.max(0, ifs - 1);
        if (cmd.startsWith('esac')) caseDepths.pop();
      }
      for (const key of runtimeSets(cmd, w.slice(1))) setVar(scope, key, UNKNOWN_DIR);
      if (!w.length) continue;
      // A clause the branches below consume unemitted can still redirect
      // (`done > f`, `bash -c "…" >> f`): an `aside` entry carries it to rule
      // 11. No git/gh/gate rule matches its command word; rule 3 sees it as
      // the pipeline segment it is.
      if (c.includes('>') && (/^(?:for|done\)*)$/i.test(cmd) || LOCATION.test(cmd) || SHELL_C.test(cmd))) {
        out.push({ cmd, words: [...w], text: c, dir: scope.dir, vars: scope.vars, tool: scope.tool, pipe, seg, aside: true });
      }
      // bash `select W in …` loops like `for` (PowerShell's select is Select-Object).
      const select = cmd === 'select' && w[2] === 'in';
      if (/^for$/i.test(cmd) || select) {
        w.shift();
        if (/^[A-Za-z_]\w*$/.test(w[0] ?? '')) setVar(scope, `sh:${w[0]}`, UNKNOWN_DIR); // the loop var
        if (select || opensLoop(cmd)) loops++; // its word list runs once; the body after `do` repeats
        continue;
      }
      if (/^done\)*$/.test(cmd)) {
        loops = Math.max(0, loops - 1);
        continue;
      }
      if (LOCATION.test(cmd)) {
        moveLocation(scope, cmd, w.slice(1));
        continue;
      }
      if (SHELL_C.test(cmd)) {
        // eval/iex run in this shell: they share the location and vars.
        if (shellCmd !== null && EVAL.test(cmd)) unlessCertain(certain, () => emit(...commands(shellCmd, null, viaOr, loop, scope)));
        else if (shellCmd !== null) emit(...commands(shellCmd, scope.dir, viaOr, loop, newScope(scope.dir, shellTool(cmd))));
        continue;
      }
      // A function call runs its body here, as the definitions stand now (a
      // function it calls may be defined after it): if what it reaches moves
      // the location or assigns a name, that is unknown after the call
      // (callEffect). Inside an own-effect walk every command word is only
      // recorded, since the function it names may be defined later.
      const name = cmd.toLowerCase();
      if (scope.calls) scope.calls.add(name);
      else if (scope.funcs.defs.has(name)) {
        const effect = callEffect(scope, name);
        if (effect.moves) loseLocation(scope);
        for (const key of effect.keys) setVar(scope, key, UNKNOWN_DIR);
      }
      // `vars` as they stand here, for a git call's -C (gitCalls).
      const call = { cmd, words: w, text: c, dir: scope.dir, vars: scope.vars, tool: scope.tool, pipe, seg, viaOr, loop };
      // Only a commit that decides the pipeline's exit status — run directly (not
      // in a substitution or block body), in its last segment, not under `!` —
      // makes a following `||` its fallback.
      if (isCommitCall(call) && seg === segs.length - 1 && !negated) committed = true;
      emit(call);
    }
    if (job) {
      closeSubshells();
      [scope.dir, scope.stacks] = [job.dir, job.stacks];
    }
    // A `case` pattern's `a)` would take the depth below 0.
    depth = Math.max(0, depth + par.net);
    if (depth <= orGroup) orGroup = -1;
  }
  settle();
  closeSubshells();
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
 *  runs in: the command's dir, then any `-C` on the call (an absolute one
 *  resolves an unknown dir; a relative one keeps it unknown). A null repo means
 *  no info — callers fail open; UNKNOWN_DIR means a cd the guard couldn't
 *  follow — callRule blocks a commit there. `tool` is the shell (newScope). */
export function gitCalls(raw, cwd, tool = null) {
  const out = [];
  for (const { cmd, words: w, dir, vars, viaOr, loop, arms = [] } of commands(raw, cwd, false, false, newScope(cwd, tool))) {
    if (!/^git(?:\.exe)?$/i.test(cmd)) continue;
    let repo = dir;
    let i = 1;
    for (; i < w.length && w[i].startsWith('-'); i++) {
      if (w[i] === '-C' && w[i + 1] !== undefined) repo = toDir(repo, w[++i], vars);
      else if (GIT_OPT_WITH_ARG.test(w[i])) i++;
    }
    out.push({ sub: w[i] || null, args: w.slice(i + 1), repo, viaOr, loop, arms });
  }
  return out;
}

/** Every `gh` call's subcommand pair (`gh pr create` → sub 'pr', action
 *  'create') and its args, parsed by command word the same way as a git call
 *  — never by substring, so quoted text and commit messages never trigger it. */
export function ghCalls(raw, cwd, tool = null) {
  const out = [];
  for (const { cmd, words: w } of commands(raw, cwd, false, false, newScope(cwd, tool))) {
    if (!/^gh(?:\.exe)?$/i.test(cmd)) continue;
    // `-R x` / `--repo x` take a value, before the subcommand or after it.
    const nonFlag = w.slice(1).filter((a, i, all) => !a.startsWith('-') && !/^(?:-R|--repo)$/.test(all[i - 1]));
    out.push({ sub: nonFlag[0] || null, action: nonFlag[1] || null, args: w.slice(1) });
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
export function gatedVerbs(raw, cwd, tool = null) {
  const cmd = scrub(raw);
  const out = [];
  for (const { sub, args } of gitCalls(cmd, cwd, tool)) {
    if (sub === 'push' && !args.includes('--dry-run') && !isBranchDelete(args)) out.push('git push');
  }
  for (const { sub, action } of ghCalls(cmd, cwd, tool)) {
    if (sub === 'pr' && (action === 'create' || action === 'merge')) out.push(`gh pr ${action}`);
  }
  return out;
}

/** The first gated verb, or null — callers must check this FIRST and read
 *  nothing else when it's null, so a non-gated command costs zero extra I/O. */
export function gatedVerb(raw, cwd, tool = null) {
  return gatedVerbs(raw, cwd, tool)[0] || null;
}

const APPROVE_RE = /\b(commit|push|pr|pull request|merge|ship|land)\b/i;

/** Does some answer value read as approving (mentions the act) without also
 *  reading as a refusal? Only the record's own answers are considered — the
 *  caller already picked the single most recent record. */
export function isApproving(answers) {
  return Object.values(answers).some((v) => APPROVE_RE.test(v) && !denies(v, APPROVE_RE));
}

// Claude Code's own "user" prompt sources (its binary maps exactly these three
// to "user"): typed at the prompt, queued while busy, or a suggestion the user
// accepted. `sdk` (claude -p, Desktop), `system` (peer and teammate messages,
// task notifications, scheduled wakeups) and no source at all (tool results,
// hook feedback, reminders, command output, compact summaries) are not.
const USER_PROMPT_SOURCES = new Set(['typed', 'queued', 'suggestion_accepted']);

/** Is transcript record `o` a prompt entered at a session's prompt? */
export function isUserPrompt(o) {
  return (
    o?.type === 'user' &&
    !o.isMeta &&
    !o.isSidechain &&
    !o.isCompactSummary &&
    o.toolUseResult === undefined &&
    o.origin?.kind === 'human' &&
    USER_PROMPT_SOURCES.has(o.promptSource)
  );
}

/** Could user prompt `o` be a launch argument? A model can launch a session
 *  itself, and its argument records as typed + human: `claude --bg` stamps
 *  every record with `sessionKind`, and a positional prompt is its process's
 *  first (`turnPosition.promptIndex` 1; latestApproval also checks for an
 *  assistant turn before it, for records that predate turnPosition). Such a
 *  prompt can't approve, but it still refuses or holds an older approval —
 *  "stop" as the first prompt after --resume must count. */
function launchShaped(o) {
  return o.sessionKind !== undefined || o.turnPosition?.promptIndex === 1;
}

// Text inside a typed prompt that the user didn't write: pasted blocks and
// appended reminders (an unclosed one runs to the end).
const NOT_TYPED_RE = /<(pasted_content|system-reminder)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/g;

/** The text of user prompt record `o` with pasted blocks and reminders cut,
 *  or null when its content is unreadable. */
export function typedPromptText(o) {
  const c = o?.message?.content;
  const text =
    typeof c === 'string'
      ? c
      : Array.isArray(c)
        ? c.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
        : null;
  return text === null ? null : text.replace(NOT_TYPED_RE, ' ');
}

// A typed prompt is prose, not a picked option. Replaying real prompts, the
// answer wording alone approved task briefs and asides ("its when the pr is
// linked…", "keep commit."), and review probes got nouns, conditions and
// retractions through ("PR #183 failed CI", "push it once I review", "Push —
// actually no"). So a typed approval is ship words only, with a ship act.
const SHIP_ACT_RE = /^(?:push|pr|merge|ship|land)$/i;
const SHIP_WORDS = new Set(
  'push pr merge ship land pull request commit open create raise rebase it them this that the a an all both branch changes again too also and then now please go ahead lgtm sgtm ok okay yes yep yeah sure great good looks fine perfect nice cool alright approved thanks ty'.split(' '),
);
// Typed words that take back an older approval (on top of the answer check's `denies`).
const TYPED_REFUSE_RE = /\b(?:stop|cancel|abort|nope|nah|later|actually|hang on)\b/i;

/** Does typed prompt text approve? Printable ASCII only (a word the check
 *  can't read, "нет" or 🚫, or a full-width "？" must not slip past), every
 *  word a ship word, at least one a ship act, and no question mark: "lgtm
 *  push and pr", "ok, merge it", "land it". */
export function isPromptApproving(text) {
  const words = (text.match(/[\w'’]+/g) || []).map((w) => w.toLowerCase());
  return (
    /^[\t\n\r\x20-\x7e]*$/.test(text) &&
    !text.includes('?') &&
    words.length > 0 &&
    words.every((w) => SHIP_WORDS.has(w)) &&
    (words.some((w) => SHIP_ACT_RE.test(w)) || /\bpull request\b/i.test(text))
  );
}

/** Does any line before index `end` hold an assistant record? */
function assistantBefore(lines, end) {
  for (let i = 0; i < end; i++) {
    if (!lines[i].includes('"assistant"')) continue;
    try {
      if (JSON.parse(lines[i])?.type === 'assistant') return true;
    } catch {
      // torn line
    }
  }
  return false;
}

/** The approving user record's `{ uuid }`, or null. Candidates are the latest
 *  AskUserQuestion answer and the latest typed prompt, newest first: the first
 *  that approves wins. An answer that doesn't approve blocks, as before #180; a
 *  typed prompt that refuses or can't be read blocks; a neutral typed prompt
 *  ("also fix the typo") defers to the older candidate. An approving record
 *  without a uuid can't be spent, so it blocks. Throws on an unreadable file —
 *  the caller fails closed. */
export function latestApproval(transcriptPath) {
  const lines = readFileSync(transcriptPath, 'utf8').split('\n');
  const found = []; // newest first: { uuid, approves, blocks }
  let answerSeen = false;
  let promptSeen = false;
  for (let i = lines.length - 1; i >= 0 && !(answerSeen && promptSeen); i--) {
    const l = lines[i];
    if (!l || l[0] !== '{') continue;
    let o;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    const answers = o?.toolUseResult?.answers;
    if (!answerSeen && o?.type === 'user' && answers && typeof answers === 'object' && !Array.isArray(answers)) {
      answerSeen = true;
      found.push({ uuid: o.uuid, approves: isApproving(answers), blocks: true });
    } else if (!promptSeen && isUserPrompt(o)) {
      promptSeen = true;
      const text = typedPromptText(o);
      if (text === null) found.push({ approves: false, blocks: true });
      else
        found.push({
          uuid: o.uuid,
          approves: !launchShaped(o) && isPromptApproving(text) && assistantBefore(lines, i),
          blocks: denies(text, APPROVE_RE) || TYPED_REFUSE_RE.test(text),
        });
    }
  }
  for (const r of found) {
    if (r.approves) return typeof r.uuid === 'string' ? { uuid: r.uuid } : null;
    if (r.blocks) return null;
  }
  return null;
}

/** The state file's side table: `"<uuid>|<verb>"` -> the tool_use_id of the call
 *  that spent it, so a later gated call can refund a spend whose call errored. */
const IDS_KEY = '@ids';

/** Did the transcript record an errored tool_result for tool_use `id`? */
function toolResultErrored(transcriptPath, id) {
  try {
    for (const l of readFileSync(transcriptPath, 'utf8').split('\n')) {
      if (!l || l[0] !== '{' || !l.includes(id)) continue;
      const content = JSON.parse(l)?.message?.content;
      if (Array.isArray(content) && content.some((b) => b?.type === 'tool_result' && b.tool_use_id === id && b.is_error === true)) return true;
    }
  } catch {
    // Unreadable or torn line: no refund is the safe answer.
  }
  return false;
}

/** Has `verb` already been spent against approval `uuid`? Records it spent on
 *  first use, with the spending call's `toolUseId`. A prior spend whose call's
 *  tool_result errored is refunded first — the push never happened. Self-trims
 *  to the newest 200 approval uuids. */
function spend(uuid, verb, file, toolUseId, transcriptPath) {
  const state = readState(file);
  const ids = state[IDS_KEY] || {};
  const idKey = `${uuid}|${verb}`;
  let entry = state[uuid] || [];
  if (entry.includes(verb) && ids[idKey] && toolResultErrored(transcriptPath, ids[idKey])) {
    entry = entry.filter((v) => v !== verb);
    delete ids[idKey];
  }
  if (entry.includes(verb)) return true;
  state[uuid] = [...entry, verb];
  if (toolUseId) ids[idKey] = toolUseId;
  state[IDS_KEY] = ids;
  const keys = Object.keys(state).filter((k) => k !== IDS_KEY);
  if (keys.length > 200) {
    for (const k of keys.slice(0, keys.length - 200)) {
      delete state[k];
      for (const v of Object.keys(ids)) if (v.startsWith(`${k}|`)) delete ids[v];
    }
  }
  writeState(file, state);
  return false;
}

const askRemedy = (verb) =>
  `Ask the user with AskUserQuestion — give it an option that approves this ${verb} (answer wording like "push"/"PR"/"merge", without "hold"/"wait"/"no") — then retry. A prompt the user typed themselves approves the same way ("lgtm push and pr"); a message from an agent, another session, a hook or a tool never does. One approval covers each gated verb once, so get one for the whole ship (push, PR, merge); a second push of the same verb needs a new one.`;

/** 8. git push / gh pr create / gh pr merge need an approving answer in the
 *  transcript, spent once per verb. `transcriptPath` is read lazily — a
 *  non-gated command never touches disk here. */
export function pushGateReason(raw, cwd, transcriptPath, stateFile = pushGateStateFile(), toolUseId = undefined, tool = null) {
  const verbs = gatedVerbs(raw, cwd, tool);
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
    record = latestApproval(transcriptPath);
  } catch {
    return `${verb} needs explicit user approval, but the transcript could not be read. ${askRemedy(verb)}`;
  }

  if (!record) {
    return `${verb} needs explicit user approval; neither the user's latest typed prompt nor their latest AskUserQuestion answer approves it (a newer reply that doesn't approve overrides an older one that did). ${askRemedy(verb)}`;
  }

  if (spend(record.uuid, verb, stateFile, toolUseId, transcriptPath)) {
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
export function browserCommand(raw, cwd, tool = null) {
  for (const { cmd, words: w } of commands(scrub(raw), cwd, false, false, newScope(cwd, tool))) {
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

export function branchRules(raw, cwd, tool = null) {
  const rooted = new Map(); // unborn repo → the arms of each commit that spent its root-commit exemption
  for (const g of gitCalls(scrub(raw), cwd, tool)) {
    const reason = callRule(g, rooted);
    if (reason) return reason;
  }
  return null;
}

/** Do two calls' arm lists (see commands) put them in different arms of one
 *  if/elseif/else chain whose conditions run no command, so at most one of
 *  them runs and nothing between them commits? */
const exclusive = (a, b) => a.some((x) => b.some((y) => x.chain === y.chain && x.n !== y.n && x.chain.read));

function callRule({ sub, args, repo, viaOr, loop, arms = [] }, rooted = new Map()) {
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
  // A cd the guard couldn't follow: a commit's branch can't be checked, so it is
  // blocked (viaOr or not); a switch or restore keeps the fail-open (#163).
  if (repo === UNKNOWN_DIR) {
    if (!isCommit) return null;
    return `This git commit runs in a directory the guard can't resolve — a cd/Set-Location/pushd target holding a variable or a command substitution, \`cd -\`, a popd/Pop-Location with no known dir on the stack, or a relative git -C from one of those — so its branch can't be checked. cd to a literal path first, or run git -C <literal path> commit.`;
  }

  const branch = currentBranch(repo);
  if (branch === null) return null; // not a repo / git unavailable — fail open

  const name = basename(repo);
  const cfgMain = process.env.CLAUDE_CONFIG_REPO || join(workspaceRoot(), 'claude-config');

  // 6. claude-config main checkout never switches branches
  const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  const onCfgMain = same(resolve(repo), resolve(cfgMain)) && !/[/\\]\.worktrees[/\\]/.test(resolve(repo));
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
    // nor is denied the exemption. A commit in a loop body may be several commits, and a
    // hook can only block the whole command, so a loop commit gets no exemption at all.
    // A commit in another arm of an if/elseif/else chain than every commit that spent
    // it runs instead of them, so it gets the exemption as well (#167).
    if (!loop && isUnborn(repo)) {
      const key = repoKey(repo);
      const spent = rooted.get(key) ?? [];
      // A viaOr commit spends the exemption too: if it runs, the repo is born.
      if (viaOr || spent.every((s) => exclusive(s, arms))) {
        rooted.set(key, [...spent, arms]);
        return null;
      }
    }
    return `"${repo}" is on ${branch} — never commit to the default branch. Cut a branch in a worktree (scripts/worktree.mjs new) first.`;
  }

  return null;
}

// ---- main (only when executed as a hook, so tests can import the rules) -----

/** The hook's checks on one payload, in order; the first that blocks exits. */
function guard(payload) {
  const cmd = payload?.tool_input?.command || '';
  const cwd = payload?.cwd || payload?.tool_input?.cwd || process.cwd();
  const tool = payload?.tool_name;
  if (tool && tool !== 'Bash' && tool !== 'PowerShell') {
    const fileReason = fileToolReason(tool, payload?.tool_input, cwd);
    if (fileReason) block(fileReason);
    return;
  }
  const browser = browserCommand(cmd, cwd, tool);
  // Browser before push: a blocked command never spends a push approval.
  const reason =
    staticCheck(cmd, cwd, tool) ||
    branchRules(cmd, cwd, tool) ||
    (browser && browserGateReason(browser, payload?.session_id, payload?.transcript_path)) ||
    pushGateReason(cmd, cwd, payload?.transcript_path, undefined, payload?.tool_use_id, tool);
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
}

if (isMain(import.meta.url)) {
  run(
    'bash-guard',
    (payload) => {
      try {
        guard(payload);
      } catch (err) {
        // Too deep to read is a verdict of its own, not a guard crash.
        if (err instanceof NestingError) block(err.message);
        throw err;
      }
    },
    { failClosed: true },
  );
}
