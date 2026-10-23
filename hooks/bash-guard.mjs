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
//   8. git push / gh pr create / gh pr merge without the user's approval in
//      the transcript (CLAUDE.md: "Push, PR create, PR merge need explicit user
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
//      State lives in a small file keyed by the approving record's uuid.
//      When an approval's first gated call is a lone canonical command
//      (canonicalShip: `[cd <abs path> &&] git push <remote> <branch>`,
//      `gh pr create …` or `gh pr merge …`, nothing else but a redirect and
//      a tail/head), it binds to the `host/owner/repo#branch` that call
//      ships, read live, and covers that branch's later pushes, one PR create
//      and one merge, which uses it up (#305). Every later gated call under a
//      bound approval must be a lone canonical command too. Any other first
//      call spends one-shot as before: each verb once.
//      A command holding more than one gated verb is blocked outright (one
//      gated verb per Bash call), so a compound never spends one approval twice.
//      A remote branch delete (`push --delete`/`-d`, or every refspec `:branch`)
//      is exempt like --dry-run; a push that also pushes a ref stays gated.
//      A spend records its call's tool_use_id; if that call's transcript
//      tool_result is_error, the next gated call refunds the spend (#147). A
//      bound approval refunds an errored create or merge, and is released
//      when every call under it errored.
//   9. Commands that open a visible browser — playwright --headed/--ui/--debug,
//      codegen, show-report, show-trace, open — need the user's browser consent
//      (_hooklib.mjs browserGateReason; shared with browser-gate.mjs, granted
//      once per session). Headless `playwright test` stays ungated.
//  10. A heredoc body holding a doubled backslash — the Bash tool's shell spawn
//      collapses it, silently corrupting the file or commit message; use Write
//      (#123, #137, #147).
//  11. (removed, #291: a write into a transcript or a gate state file could
//      forge an approval, but a model that would do that can edit this hook
//      too, and no real session ever wrote one)
//  12. A node/bun inline script (-e/--eval/-p/--print) or a deno eval script
//      holding a substitution its shell runs before the runtime starts: in
//      bash an unescaped backtick or `$(` outside single quotes, in PowerShell
//      a `$(` (a backtick is its escape char and runs nothing). A JS template
//      literal in a double-quoted `node -e` ran `cd ~/.claude` and `rm -f`
//      during #249 (#258). Single quotes or a script file keep it literal.
//      Read off parsed calls.
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
// shell (`bash -c`, `sh -c`, `powershell -Command`, `eval`) is parsed as the command it is,
// and so is every command substitution the shell would run — `…`, $(…), <(…),
// bare or inside double quotes or an unquoted-delimiter heredoc (#92);
// single-quoted text stays literal. A `{ … }` block body (PowerShell
// if/foreach/ForEach-Object, a bash group) is parsed in place too (#159), and
// so is an if/elseif/while condition, which PowerShell runs (#214). Every rule
// matches a command by its name (commandName: the basename less a `.exe`, in
// any case, so `C:/…/git.exe` and `GIT` are git), read through the prefixes
// env, timeout, nohup and time and their options (`env -u X`, `timeout -s KILL 5`)
// to the call they run (#239). A POSIX shell's command line is found past -c,
// alone or in a flag cluster (`bash -lc`), PowerShell's past -Command or -c,
// eval/iex's as their words (shellLine), and a call inside a group or shell
// line belongs to the pipeline stage it runs in (inStage). These are the
// shapes real sessions use: #291 cut the readers for every other prefix,
// runner (xargs, find -exec, parallel) and shell (cmd, zsh, busybox), which
// only guard development ever ran.

// Fail-CLOSED (the exception to the fail-open house rule, see _hooklib.mjs):
// errors log to ~/.claude/hook-errors.log and block. A guard that crashed has
// checked nothing, and a silent allow is invisible — a loud block is not.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { isMain } from '../scripts/lib.mjs';
import {
  BILLED_MODEL,
  block,
  browserGateReason,
  consumeClearance,
  denies,
  logBilled,
  pushGateStateFile,
  readState,
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
 *  (`2>&1`, `&>f`). With `pipes`, a
 *  pipeline (`a | b`, `a |& b`) is one piece — `pipelines()`. Unbalanced
 *  quotes fall back to the plain split — never swallow the rest of the line.
 *  When `seps` is an array it is filled, parallel to the result, with the
 *  separator before each clause ('' for the first); the unbalanced-quote
 *  fallback leaves it empty. A block body (`{ … }`, see blockAt) stays whole
 *  too; when `blocks` is an array, each block in a clause is cut out to a `{}`
 *  placeholder and the array is filled, parallel to the result, with that
 *  clause's blocks as { head, body } (`head` is the clause text since the
 *  previous block: `if ($x) `, ` else `). */
export function clauses(cmd, pipes = false, seps = null, blocks = null) {
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

/** A command the guard can't read: the hook blocks it unread, with this
 *  reason, rather than judge a guess. */
export class UnreadableError extends Error {}

/** A line nested past MAX_NESTING. */
export class NestingError extends UnreadableError {
  constructor() {
    super(`This command nests blocks, groups or substitutions more than ${MAX_NESTING} levels deep, deeper than the guard reads, so it is blocked unread (#167). Flatten the nesting.`);
  }
}

/** The pipelines of a compound command: clauses that keep `|` inside. */
const pipelines = (cmd, seps = null) => clauses(cmd, true, seps);

/** A clause's words with quotes removed; adjacent pieces (a"b"c, @'…'@) are one
 *  word. Unbalanced quotes: plain whitespace split. With `raw`, the same words
 *  keep their quotes (rule 12 reads which text a quote holds). */
function words(clause, raw = false) {
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s"']+)|(["'])/g;
  const out = [];
  let prev = -1;
  let m;
  while ((m = re.exec(clause)) !== null) {
    if (m[4]) return clause.split(/\s+/).filter(Boolean);
    const w = raw ? m[0] : (m[1] ?? m[2] ?? m[3]);
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
    // The heredoc's consumer is the command of the clause holding the `<<`
    // (so `cat > run.sh <<EOF` is cat, not sh; `timeout 60 bash <<EOF` is bash).
    const consumer = commandName(unwrapCommand(words(clauses(line.slice(0, m.index)).pop() || ''))[0] ?? '');
    if (shellTool(consumer) || /^cmd$/i.test(consumer)) continue;
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

/** Is a gate command among `cmds` piped onward? Rule 3's test. A later stage
 *  counts through its own chain too, so a call inside `| bash -c "…"` or
 *  `| eval …` masks the gate like a bare `| tail`. */
function gatePiped(cmds) {
  const masked = (g) => stagesOf(g).some((s) => cmds.some((t) => stagesOf(t).some((u) => u.pipe === s.pipe && u.seg > s.seg)));
  return cmds.some((g) => isGate(g) && masked(g));
}

/** Rule 3's runnable rewrite (#295): the one `gate [2>&1] | filter…` pipeline
 *  becomes `gate > LOG 2>&1; echo rc=$?; filter < LOG` (`tail -n N LOG` for a
 *  lone tail/head -N), the rest of the command kept as written; or null when it
 *  cannot be built faithfully. Declined: a PowerShell command; `||`, `&`,
 *  `<<`, groups, substitutions or backticks anywhere; more or fewer than one
 *  piped segment (split at `&&`, `;`, newline); a redirect on any gate-pipeline
 *  stage but the gate's `2>&1`; a first stage that is not itself the gate; a
 *  rewrite that rule 3 would still block. The log sits in `${TMPDIR:-/tmp}`
 *  (the payload does not expose the session scratchpad), `$$`-suffixed so
 *  concurrent calls do not share it. */
function gateRewrite(raw, tool) {
  if (tool && tool !== 'Bash') return null;
  const segs = [{ raw: '', stages: [{ text: '', bad: false, at: -1 }] }];
  const seg = () => segs[segs.length - 1];
  const stage = () => seg().stages[seg().stages.length - 1];
  const add = (ch) => { seg().raw += ch; stage().text += ch; };
  let quote = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1] ?? '';
    if (quote) {
      if (ch === '\\' && quote === '"') { add(ch + next); i++; continue; }
      if (ch === quote) quote = null;
      add(ch);
    } else if (ch === '\\') { add(ch + next); i++; }
    else if (ch === '"' || ch === "'") { quote = ch; add(ch); }
    else if (ch === '(' || ch === ')' || ch === '`' || (ch === '$' && next === '(')) return null;
    else if (ch === '#' && (i === 0 || /\s/.test(raw[i - 1]))) return null; // a comment would swallow `< LOG`
    else if (ch === '|') {
      if (next === '|') return null;
      seg().raw += ch;
      if (next === '&') { seg().raw += '&'; i++; if (seg().stages.length === 1) seg().err = true; }
      seg().stages.push({ text: '', bad: false, at: -1 });
    } else if (ch === '&' && next === '&') segs.push({ raw: '', stages: [{ text: '', bad: false, at: -1 }], sep: '&&' }), i++;
    else if (ch === ';' || ch === '\n') segs.push({ raw: '', stages: [{ text: '', bad: false, at: -1 }], sep: ch });
    else if (ch === '\r') add(ch);
    else if (ch === '2' && raw.startsWith('2>&1', i) && /(?:^|\s)$/.test(stage().text) && /^(?:\s|$|\|)/.test(raw.slice(i + 4))) {
      stage().at = stage().text.length;
      add('2>&1');
      i += 3;
    } else if (ch === '&' || ch === '<' || ch === '>') {
      if (ch === '<' && next === '<') return null;
      if (ch === '&' && next !== '>' && raw[i - 1] !== '>') return null;
      stage().bad = true;
      add(ch);
    } else add(ch);
  }
  if (quote) return null;
  const piped = segs.filter((s) => s.stages.length > 1);
  if (piped.length !== 1) return null;
  const g = piped[0];
  const [first, ...rest] = g.stages;
  if (first.bad) return null;
  const head = first.at >= 0 ? first.text.slice(0, first.at) + first.text.slice(first.at + 4) : first.text;
  if (rest.some((s) => s.bad || !s.text.trim()) || !head.trim()) return null;
  const lead = g.raw.match(/^\s*/)[0];
  const gateCmd = head.trim();
  if (gateCmd.startsWith('!')) return null; // `!` inverts the rc echoed
  if (rest.some((s) => /^tail\s/.test(s.text.trim()) && /(?:\s|^)(?:-[^-\s]*[fF]|--follow)/.test(s.text.trim()))) return null; // would hang
  const probe = commands(gateCmd, null, false, false, newScope(null, tool));
  if (probe.length !== 1 || !isGate(probe[0])) return null;
  const log = '"${TMPDIR:-/tmp}/gate-$$.log"';
  const filters = rest.map((s) => s.text.trim());
  const lone = filters.length === 1 && filters[0].match(/^(tail|head)\s+(?:-n\s*(\d+)|-(\d+))$/);
  const filter = lone
    ? `${lone[1]} -n ${lone[2] ?? lone[3]} ${log}`
    : `${filters[0]} < ${log}${filters.slice(1).map((s) => ` | ${s}`).join('')}`;
  const tail = g.raw.match(/\s*$/)[0];
  const redirect = first.at >= 0 || g.err ? `> ${log} 2>&1` : `> ${log}`;
  const body = `${gateCmd} ${redirect}; echo rc=$?; ${filter}`;
  // after a list separator, group it: `a && g | t && b` must not run b once `a` failed
  const swapped = `${lead}${g === segs[0] ? body : `{ ${body}; }`}${tail}`;
  const out = segs.map((s) => (s.sep ?? '') + (s === g ? swapped : s.raw)).join('');
  return gatePiped(commands(scrub(out), null, false, false, newScope(null, tool))) ? null : out;
}

/** The static rules (1-4, 10, 12) on one command. `tool` is the payload's
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
  //    command after it in the same pipeline (tail, head, grep, tee… all mask
  //    it), or after the group or shell line it runs in (inStage)
  const cmds = commands(cmd, null, false, false, newScope(null, tool));
  if (gatePiped(cmds)) {
    const base = 'A pipe after a gate reports the pipe\'s exit code, not the gate\'s. Run gates unpiped: redirect to a file, echo the rc, then filter the file.';
    const rewrite = gateRewrite(raw, tool);
    return rewrite ? `${base} Same command, unpiped (rc kept):\n${rewrite}` : base;
  }

  // 4. PowerShell content cmdlets mangle UTF-8 (mojibake / BOM) — as a command,
  //    not as a word someone greps for; their sc/ac aliases only off Bash
  const content = tool === 'Bash' ? /^(?:Set-Content|Out-File|Add-Content)$/i : /^(?:Set-Content|Out-File|Add-Content|sc|ac)$/i;
  if (cmds.some(({ cmd: c }) => content.test(c))) {
    return 'PowerShell Set-Content/Out-File/Add-Content mojibake UTF-8 text. Use the Edit/Write tools for file mutations.';
  }

  // 12. a node eval script the caller's shell substitutes into (#258)
  //     (11, writes into a gate's records, went with #291.)
  return evalSubstitution(cmds);
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

/** A command word's name, as every rule matches it: its basename, less a
 *  `.exe` (`C:/…/git.exe` is git). Windows finds a command whatever its
 *  case, in Git Bash as in PowerShell (`GIT`, `Git.EXE`), so the rules match
 *  names case-insensitively; shell keywords and builtins keep their case. */
const commandName = (word) => word.split(/[/\\]/).pop().replace(/\.exe$/i, '');

/** Commands that run the rest of their words as a command (`timeout 60 git
 *  push`, `env -u X git push`, `nohup git push`, `time (…)`), by name: the short options
 *  that take a value (`value`; in a cluster the first one takes the rest of
 *  it, or the next word), every long option (`long`), marked `=` when it
 *  takes a value and `!` when nothing runs after it, and how many words come
 *  before the command (`args`: timeout's duration). Any other option takes
 *  no value. The prefixes real sessions use (#239; #291 cut the rest). */
const PREFIX = new Map(
  Object.entries({
    nohup: { long: 'help! version!' },
    time: { value: 'fo', long: 'append format= help! output= portability quiet verbose version!' },
    env: {
      value: 'aCPSu',
      long: 'argv0= block-signal chdir= debug default-signal help! ignore-environment ignore-signal list-signal-handling null split-string= unset= version!',
    },
    timeout: { value: 'ks', long: 'foreground help! kill-after= preserve-status signal= verbose version!', args: 1 },
  }),
);

/** The words of the call a prefix command (PREFIX) runs, or null when `w`
 *  doesn't start with one or its options run nothing (`timeout --help`). */
function prefixRead(w) {
  const spec = PREFIX.get(commandName(w[0] ?? '').toLowerCase());
  if (!spec) return null;
  let k = 1;
  for (; k < w.length && w[k].startsWith('-'); k++) {
    const a = w[k];
    if (a === '--') {
      k++;
      break;
    }
    if (a.startsWith('--')) {
      const [name, attached] = a.slice(2).split(/=(.*)/s);
      const o = spec.long.split(' ').find((x) => x.replace(/[=!]$/, '') === name);
      if (o?.endsWith('!')) return null;
      if (o?.endsWith('=') && attached === undefined) k++;
    } else {
      const j = [...a.slice(1)].findIndex((ch) => spec.value?.includes(ch));
      if (j !== -1 && j === a.length - 2) k++;
    }
  }
  return w.slice(k + (spec.args ?? 0));
}

/** A call's real command words: past the wrappers (an env assignment, a
 *  subshell opener) and the prefix commands (`timeout 5`). */
function unwrapCommand(w) {
  for (let run; w.length; w = run) {
    if (WRAPPER.test(w[0])) run = w.slice(1);
    else if (!(run = prefixRead(w))) break;
  }
  return w;
}

/** Mark `cs`, emitted from a body or shell line run as pipeline stage
 *  `stage` ({ pipe, seg }), as inside it: each call's chain of enclosing
 *  stages (`outer`) ends there, so rule 3 sees the pipeline around a group
 *  or a shell's -c line. */
function inStage(cs, stage) {
  for (const c of cs) {
    let s = c;
    while (s.outer) s = s.outer;
    if (s !== stage) s.outer = stage;
  }
  return cs;
}

/** A call and the stages enclosing it, innermost first (inStage). */
const stagesOf = (call) => {
  const out = [];
  for (let s = call; s; s = s.outer) out.push(s);
  return out;
};

// ---- 12. an eval script the caller's shell substitutes into (#258) ---------

/** Runtimes whose inline script rule 12 reads. */
const EVAL_RUNTIME = /^(?:node|nodejs|bun|deno)$/i;
/** node's and bun's options that hand over the script: as the next word, or attached. */
const NODE_EVAL = /^(?:-[ep]|-pe|-ep|--eval|--print)$/;
const NODE_EVAL_ATTACHED = /^--(?:eval|print)=/;
/** Options that take the next word as their value, so it is no script file. */
const NODE_VALUE = /^(?:-r|--require|--import|--loader|--experimental-loader|-C|--conditions|--input-type|--env-file|--title)$/;
const DENO_VALUE = /^(?:-c|--config|--ext|--import-map|--location|--seed|--cert|--lock)$/;

const EVAL_SUBSTITUTION_REASON =
  "This node/bun/deno eval script holds a backtick or `$(` the shell substitutes before the runtime starts: a JS template literal runs as a shell command (#258). Single-quote the script (`node -e '…'`), passing any shell value as an argument (`node -e '…process.argv[1]…' \"$(…)\"`), or Write it to a file with the Write tool and run that.";

/** Where a node/bun/deno call's inline script is among its words `w`, or -1:
 *  the word after -e/--eval/-p/--print (`-pe` too), the flag word itself
 *  when the script is attached (`--eval=…`), or deno eval's first operand.
 *  node's and bun's options end at their first operand, a script file (or
 *  bun's subcommand), whose arguments are its own. */
function evalScriptAt(w) {
  const deno = /^deno$/i.test(commandName(w[0]));
  if (deno && w[1] !== 'eval') return -1;
  for (let k = deno ? 2 : 1; k < w.length; k++) {
    const a = w[k];
    if (a === '--') return deno && k + 1 < w.length ? k + 1 : -1;
    if (!a.startsWith('-')) return deno ? k : -1;
    if (deno) {
      if (DENO_VALUE.test(a)) k++;
    } else if (NODE_EVAL_ATTACHED.test(a)) return k;
    else if (NODE_EVAL.test(a)) return k + 1 < w.length ? k + 1 : -1;
    else if (NODE_VALUE.test(a)) k++;
  }
  return -1;
}

/** Does `word` (a word as the shell reads it, quotes kept) run a command
 *  substitution in `shell` before its command starts? bash runs a backtick or
 *  `$(` outside single quotes that no backslash escapes; PowerShell runs a
 *  `$(` subexpression outside single quotes that no backtick escapes (its
 *  escape char: a backtick runs nothing there, and a backslash escapes
 *  nothing). No shell (a replay) reads it both ways. */
function runsSubstitution(word, shell) {
  if (!shell) return runsSubstitution(word, 'Bash') || runsSubstitution(word, 'PowerShell');
  const ps = shell === 'PowerShell';
  let quote = null;
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
    } else if (ch === (ps ? '`' : '\\')) i++;
    else if (ch === "'" && !quote) quote = ch;
    else if (ch === '"') quote = quote ? null : ch;
    else if (ch === '`' || (ch === '$' && word[i + 1] === '(')) return true;
  }
  return false;
}

/** 12. A node/bun/deno call whose inline script holds a substitution its
 *  shell runs first (`node -e "x = `rm -f y`"`, `node -p "$(x)"`) — the
 *  #249 probe incident: a JS template literal ran as shell commands. Read off
 *  parsed calls, so through wrappers, prefixes, groups and a shell's -c line;
 *  the script is found among the call's clause words with their quotes
 *  (the call's words are the clause's last ones). */
function evalSubstitution(calls) {
  for (const call of calls) {
    if (!EVAL_RUNTIME.test(call.cmd)) continue;
    const j = evalScriptAt(call.words);
    if (j === -1) continue;
    const plain = words(call.text);
    const raws = words(call.text, true);
    // A group's closing `)` may stand as a last word of its own, cut off the call's.
    const at = [0, 1].map((cut) => plain.length - cut - call.words.length).find((i) => i >= 0 && plain[i].replace(/^[({!]+/, '') === call.words[0]);
    if (at !== undefined && runsSubstitution(raws[at + j], call.tool)) return EVAL_SUBSTITUTION_REASON;
  }
  return null;
}

/** Words that only wrap the real command (subshell/group openers, env
 *  assignments, shell keywords); a prefix command is PREFIX's. */
const WRAPPER = /^(?:[({!]+|\w+\+?=.*|\$env:\w+=.*|then|do|else|elif|if|while|until)$/i;
const LOCATION = /^(?:cd|chdir|sl|set-location|pushd|push-location|popd|pop-location)$/i;
const SET_LOCATION = /^(?:cd|chdir|sl|set-location)$/i;
const POP_LOCATION = /^(?:popd|pop-location)$/i;
const POSIX_SHELL = /^(?:bash|sh)$/i;
const EVAL = /^(?:eval|iex|invoke-expression)$/i;

/** The words of the command line a shell call runs, or null (#92): eval/iex's
 *  words, iex maybe after -Command; a POSIX shell's after a -c flag, alone or
 *  in a cluster (`bash -lc`), the first word the line and the rest its $0 and
 *  args; PowerShell's after -Command or -c. The shapes real sessions use
 *  (#291 cut the readers for every other shell and spelling). */
function shellLine(cmd, w) {
  if (EVAL.test(cmd)) {
    const line = w.slice(/^-c/i.test(w[1] ?? '') ? 2 : 1);
    return line.length ? line : null;
  }
  const tool = shellTool(cmd);
  const flag = tool === 'Bash' ? /^-[a-zA-Z]*c[a-zA-Z]*$/ : tool === 'PowerShell' ? /^-c(?:ommand)?$/i : null;
  const at = flag ? w.findIndex((a, j) => j > 0 && flag.test(a)) : -1;
  return at === -1 || at + 1 === w.length ? null : w.slice(at + 1);
}

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

const isCommitCall = (e) => /^git$/i.test(e.cmd) && e.words.includes('commit');

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
const shellTool = (cmd) => (POSIX_SHELL.test(cmd) ? 'Bash' : /^(?:pwsh|powershell)$/i.test(cmd) ? 'PowerShell' : null);

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
  for (const [pi, p] of pipelines(raw, pipeSeps).entries()) {
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
    const segs = clauses(p, false, null, blocks);
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
        if (!w.length) break;
        // A prefix command (`timeout 5`, `env -u X`) runs the call after it.
        const run = !WRAPPER.test(w[0]) && prefixRead(w);
        if (run) {
          wrappers.push(w[0]);
          w.splice(0, w.length, ...run);
          continue;
        }
        if (!WRAPPER.test(w[0])) break;
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
      const cmd = w.length ? commandName(w[0]) : '';
      const loop = inLoop || loops > 0;
      const shellRun = shellLine(cmd, w); // the line this call runs as a shell
      // What runs as this pipeline stage: a body or shell line here is inside it (inStage).
      const stage = { pipe, seg };
      // A shell's own command string is parsed whole below; reading its
      // substitutions here too would count each gated verb twice.
      // A condition's own substitutions are read with it, below.
      const own = conditions.reduce((t, { head }) => t.replace(head.trim(), ''), c);
      if (!shellRun) for (const body of substitutions(own)) emit(...commands(body, null, viaOr, loop, scopeCopy(scope)));
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
          unlessCertain(false, () => emit(...inStage(commands(condition[2], null, viaOr, loop || repeats, scope), stage)));
          if (locationKey(scope) !== at && !/^if$/i.test(condition[1])) loseLocation(scope);
        }
        const once = /^(?:[&.]\s*)?$|^(?:if|elseif|else|try|catch|finally|then)\b/i.test(h);
        // In place too: a PowerShell switch arm (`'a' { … }`, `default { … }`)
        // and the body after a condition split at its `;` (`for (…; …; $i++) {`).
        const inPlace = once || /^(?:foreach|for|while|do|until|switch)(?![\w-])|^(?:ForEach-Object|%|foreach|Where-Object|\?)$|^(?:'[^']*'|"[^"]*"|default|-?\d+|[^()]*\))$/i.test(h);
        if (!inPlace) {
          emit(...inStage(commands(body, null, viaOr, loop || !once, scopeCopy(scope)), stage));
          // A function's call runs its body in the caller's shell (see below).
          const fn = FUNCTION_HEAD.exec(h);
          if (fn) defineFunction(scope.funcs, (fn[1] ?? fn[2]).toLowerCase(), body);
          continue;
        }
        // An in-place body moves the shared dir, but it may run zero or many
        // times: a name it assigns is unknown after it, and so is the location
        // it moved, unless it surely runs once (a bare group, try, finally).
        const at = locationKey(scope);
        unlessCertain(false, () => emit(...inStage(inArm(commands(body, null, viaOr, loop || !once, scope)), stage)));
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
      // eval/iex run in this shell: they share the location and vars.
      if (EVAL.test(cmd)) {
        if (shellRun) unlessCertain(certain, () => emit(...inStage(commands(shellRun.join(' '), null, viaOr, loop, scope), stage)));
        continue;
      }
      if (shellTool(cmd)) {
        if (shellRun) emit(...inStage(commands(shellRun.join(' '), scope.dir, viaOr, loop, newScope(scope.dir, shellTool(cmd))), stage));
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

const PKG_RUNNER = /^(?:pnpm|npm|yarn|bun|npx|pnpx|bunx)(?:\.cmd)?$/i;
const PKG_FLAG_WITH_ARG = /^(?:--filter|-F|-C|--dir|--prefix|--workspace|-w)$/;
const PKG_GATE = /^(?:test|lint|typecheck|e2e|vitest|tsc)$/;
const JUST_GATE = /^(?:check|test|lint|typecheck|e2e|clippy)$/;
const firstArg = (args) => args.find((a) => !a.startsWith('-') && !a.startsWith('+'));

/** 3. Is this command a QA gate whose exit code matters? Read by command word
 *  and subcommand, so `npm view vitest` or `grep tsc` is not a gate (#98). */
function isGate({ cmd, words: w }) {
  const c = cmd.replace(/\.cmd$/i, '').toLowerCase();
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
    if (!/^git$/i.test(cmd)) continue;
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
    if (!/^gh$/i.test(cmd)) continue;
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

// ---- 8. the canonical ship command (#305) -----------------------------------
// An approval binds to a branch only through a command the guard can read
// whole: one push, PR create or merge, optionally after a cd to a literal
// path and before a redirect and a tail/head. Any earlier step in the same
// command could change what ships after the guard read it, so this grammar has
// room for none. It has its own small tokenizer on the raw text: none of the
// big parser's allowances apply.

// A plain unquoted word character (`~` leads a path; `\` is one in PowerShell only).
const SHIP_CHAR = /[A-Za-z0-9_./:@%+=-]/;
// Ends an unquoted word.
const SHIP_STOP = /[ \t;&|<>(){}\n\r]/;
// The one shell expansion allowed (bash): a quoted heredoc fed to cat, as
// Claude Code writes a PR body: "$(cat <<'EOF' … EOF\n)".
const HEREDOC_SUB = /^\$\(cat <<(['"])([\w.-]+)\1\n/;
// Marks a heredoc body in a word: data, never a name, path or ref.
const OPAQUE = '\0';
const PUSH_FLAG = /^(?:-u|--set-upstream|-q|--quiet|-v|--verbose|-f|--force|--force-with-lease(?:=.*)?|--force-if-includes|--progress|--no-progress|--porcelain)$/s;
const REMOTE_NAME = /^[A-Za-z0-9][\w.-]*$/;
// A branch name the guard can read: no `..`, `//`, leading `-`/`+`/`@`, or trailing `/` or `.`.
const BRANCH = /^(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9_][\w./-]*(?<![./])$/;
const PR_URL = /^https:\/\/[\w.-]+\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;
const GH_REPO_ARG = /^(?:[\w.-]+\/)?[\w.-]+\/[\w.-]+$/;
const CREATE_VALUE = new Set(['-t', '--title', '-b', '--body', '-F', '--body-file', '-B', '--base', '-H', '--head', '-R', '--repo', '-l', '--label', '-a', '--assignee', '-r', '--reviewer', '-m', '--milestone', '-p', '--project', '-T', '--template']);
const CREATE_BOOL = new Set(['-d', '--draft', '-f', '--fill', '--fill-first', '--fill-verbose', '--no-maintainer-edit']);
const MERGE_VALUE = new Set(['-R', '--repo', '-t', '--subject', '-b', '--body', '-F', '--body-file', '--match-head-commit', '-A', '--author-email']);
const MERGE_BOOL = new Set(['-r', '--rebase', '-s', '--squash', '-m', '--merge', '-d', '--delete-branch', '--delete-branch=true', '--delete-branch=false', '--auto', '--disable-auto', '--admin']);
// The long name a short gh flag the guard reads stands for.
const GH_LONG = { '-R': '--repo', '-H': '--head', '-F': '--body-file' };
const TRUE_CFG = /^(?:true|yes|on|1)$/i;

/** The command as tokens — `{ word, tilde }`, `{ op }` (`&&`, `;`, `|`) or
 *  `{ redirect }` — or `{ why }` at the first thing outside the grammar.
 *  `tilde` marks a word led by an unquoted `~` (home). `ps`: PowerShell's
 *  quoting rules. */
function shipTokens(raw, ps) {
  const text = raw.replace(/\s+$/, '');
  if (ps && /[\u2018-\u201f]/.test(text)) return { why: 'it holds a Unicode quote, which PowerShell reads as a quote' };
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if (text.startsWith('&&', i) || c === ';' || (c === '|' && text[i + 1] !== '|')) {
      const op = c === '&' ? '&&' : c;
      tokens.push({ op });
      i += op.length;
      continue;
    }
    const redirect = /^(?:2>&1|2?>\/dev\/null)(?=[ \t]|$)/.exec(text.slice(i));
    if (redirect) {
      tokens.push({ redirect: redirect[0] });
      i += redirect[0].length;
      continue;
    }
    if (SHIP_STOP.test(c)) return { why: `it holds ${c === '\n' || c === '\r' ? 'a newline' : `"${c}"`} outside quotes` };
    const start = i;
    let word = '';
    while (i < text.length && !SHIP_STOP.test(text[i])) {
      const ch = text[i];
      if (ch === "'") {
        // bash: literal to the next quote; PowerShell: '' is a quote inside.
        let j = i + 1;
        for (;;) {
          const k = text.indexOf("'", j);
          if (k < 0) return { why: 'it has an unclosed quote' };
          word += text.slice(j, k);
          if (ps && text[k + 1] === "'") {
            word += "'";
            j = k + 2;
            continue;
          }
          i = k + 1;
          break;
        }
      } else if (ch === '"') {
        const sub = !ps && HEREDOC_SUB.exec(text.slice(i + 1));
        if (sub) {
          // Closed at the first line that is the delimiter, followed by `)"`.
          const delim = sub[2];
          let pos = i + 1 + sub[0].length;
          for (;;) {
            const nl = text.indexOf('\n', pos);
            const end = nl < 0 ? text.length : nl;
            const line = text.slice(pos, end);
            if (line === delim) {
              if (!text.startsWith(')"', end + 1)) return { why: 'its heredoc body is followed by more than `)"`' };
              i = end + 3;
              break;
            }
            if (line.startsWith(`${delim})"`)) {
              i = pos + delim.length + 2;
              break;
            }
            if (nl < 0) return { why: 'its heredoc is never closed' };
            pos = nl + 1;
          }
          word += OPAQUE;
          continue;
        }
        // No expansion inside: bash escapes \" \\ and a line continuation,
        // PowerShell doubles a quote ("").
        let j = i + 1;
        for (;;) {
          const q = text[j];
          if (q === undefined) return { why: 'it has an unclosed quote' };
          if (q === '$' || q === '`') return { why: `it holds ${q} inside double quotes` };
          if (q === '"' && !(ps && text[j + 1] === '"')) break;
          if (q === '"' || (!ps && q === '\\' && /["\\\n]/.test(text[j + 1] ?? ''))) {
            if (text[j + 1] !== '\n') word += text[j + 1];
            j += 2;
          } else {
            word += q;
            j++;
          }
        }
        i = j + 1;
      } else if (SHIP_CHAR.test(ch) || (ps && ch === '\\') || (ch === '~' && i === start && /^(?:[/ \t;&|]|$)/.test(text[i + 1] ?? ''))) {
        if (ps && ch === '@' && i === start) return { why: 'it holds a PowerShell splat (@)' };
        word += ch;
        i++;
      } else {
        return { why: `it holds "${ch}" outside quotes` };
      }
    }
    if (ps && word === '--%') return { why: "it holds PowerShell's --% stop-parsing token" };
    // PowerShell 5.1 drops an empty argument to a native command and re-splits
    // one holding a quote, or a backslash with a space: git or gh would read
    // other args than these.
    if (ps && (word === '' || word.includes('"') || (/\s/.test(word) && word.includes('\\')))) {
      return { why: 'it holds an empty or quote-bearing argument, which PowerShell 5.1 passes to git or gh re-split' };
    }
    tokens.push({ word, tilde: text[start] === '~' });
  }
  return { tokens };
}

/** The existing dir a cd (`cd`: absolute only) or `git -C` word names from
 *  `base`, or null. On Windows an absolute path must carry its drive (Git
 *  Bash's `/c/…` is `C:/…`): a bare `/x` means different dirs to Git Bash, to
 *  PowerShell and to this process. PowerShell passes a `-C ~` to git as is. */
function shipDir(base, { word, tilde }, ps, cd) {
  if (word.includes(OPAQUE) || (tilde && ps && !cd)) return null;
  const drive = (s) => (process.platform === 'win32' ? s.replace(/^\/([a-zA-Z])(?:\/|$)/, (_, d) => `${d.toUpperCase()}:/`) : s);
  // Bash's ~ is $HOME; this process's is homedir() (USERPROFILE on Windows).
  if (tilde && !ps && process.env.HOME && resolve(drive(process.env.HOME)).toLowerCase() !== resolve(homedir()).toLowerCase()) return null;
  let p = tilde ? expandHome(word) : word;
  if (process.platform === 'win32') {
    if (!ps) p = drive(p);
    if (/^[a-zA-Z]:(?![\\/])/.test(p) || (isAbsolute(p) && !/^[a-zA-Z]:[\\/]/.test(p))) return null;
  }
  if (cd && !isAbsolute(p)) return null;
  const dir = resolve(base ?? '', p);
  try {
    return statSync(dir).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}

/** A remote URL, a gh `-R` value or a PR URL as one comparable `host/owner/repo`
 *  string: scheme, credentials, port, `.git` and a `/pull/N` tail dropped,
 *  lowercased; a bare `owner/repo` is on github.com. */
function repoSlug(ref) {
  let s = String(ref).trim().replace(/^[a-z][\w+.-]*:\/\//i, '').replace(/^[^@/]+@/, '');
  s = s.replace(/^([^/:]+):(?!\d+\/)/, '$1/').replace(/^([^/]+):\d+\//, '$1/');
  s = s.replace(/\/pull\/\d+.*$/, '').replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
  return s.split('/').length === 2 ? `github.com/${s}` : s;
}

/** A repo's remote, branch, push and url config in one read, as git sees it:
 *  key → every value, in order (git's single-valued keys take the last).
 *  Section and variable names come lowercased; subsections keep their case.
 *  Empty when no key matches (git's exit 1, nothing printed); null when the
 *  read failed (timeout, spawn error, any other exit) — callers fail closed. */
export function gitConfig(repo) {
  const r = spawnSync('git', ['-C', repo, 'config', '--get-regexp', '^(remote|branch|push|url)\\.'], { encoding: 'utf8', timeout: 4000 });
  const noMatch = r.status === 1 && !r.stdout && !(r.stderr || '').trim();
  if (r.error || (r.status !== 0 && !noMatch)) return null;
  const cfg = new Map();
  for (const line of (r.stdout || '').split('\n')) {
    const sp = line.indexOf(' ');
    const key = sp > 0 ? line.slice(0, sp) : line.trim();
    if (key) cfg.set(key, [...(cfg.get(key) || []), sp > 0 ? line.slice(sp + 1).trim() : 'true']);
  }
  return cfg;
}

/** The value git uses for a single-valued key: the last one set. */
const last = (cfg, key) => cfg.get(key)?.at(-1);

/** The branch checked out in `dir`, or null (no dir, not a repo, detached HEAD). */
const liveBranch = (dir) => (dir ? currentBranch(dir) || null : null);

/** The `host/owner/repo` gh would act on from `repo`: a remote `gh repo
 *  set-default` resolved, else upstream, github, origin, then the first. */
function ghRemoteSlug(repo) {
  const cfg = gitConfig(repo);
  if (!cfg) return null;
  const names = [...cfg.keys()].map((k) => /^remote\.(.+)\.url$/.exec(k)?.[1]).filter(Boolean);
  const name = names.find((n) => cfg.has(`remote.${n}.gh-resolved`)) || ['upstream', 'github', 'origin'].find((n) => names.includes(n)) || names[0];
  return name ? repoSlug(last(cfg, `remote.${name}.url`)) : null;
}

/** Why push config could send `git push <remote> <branch>` somewhere other
 *  than `url` and that branch, or null. */
function pushConfigRisk(cfg, remoteName, url, branch) {
  const r = `remote.${remoteName}`;
  // A remote from a legacy .git/remotes or .git/branches file, which this read can't see.
  if (!cfg.has(`${r}.url`)) return `${r}.url is not in its config (a legacy remotes/branches file?)`;
  if (cfg.has(`${r}.push`)) return `${r}.push maps its refspecs`;
  // upstream/tracking send an explicit `<remote> <branch>` to the branch's
  // upstream; simple (git's default) and the rest keep its name.
  const mode = last(cfg, 'push.default');
  const merges = cfg.get(`branch.${branch}.merge`) || [];
  if (/^(?:upstream|tracking)$/i.test(mode ?? '') && merges.some((m) => m !== `refs/heads/${branch}`)) return `push.default=${mode} sends it to its upstream ${merges.join(', ')}`;
  if (TRUE_CFG.test(last(cfg, `${r}.mirror`) ?? '')) return `${r}.mirror is set`;
  if ((cfg.get(`${r}.pushurl`) || []).length > 1 || (!cfg.has(`${r}.pushurl`) && (cfg.get(`${r}.url`) || []).length > 1)) return `${r} pushes to more than one URL`;
  for (const [k, vs] of cfg) {
    if (/^url\..+\.(?:push)?insteadof$/.test(k) && vs.some((v) => url.startsWith(v))) return `${k} rewrites its URL`;
  }
  if (TRUE_CFG.test(last(cfg, 'push.followtags') ?? '')) return 'push.followTags pushes tags along';
  const subs = last(cfg, 'push.recursesubmodules');
  if (subs !== undefined && !/^(?:no|check|false)$/i.test(subs)) return `push.recurseSubmodules=${subs} pushes submodules along`;
  return null;
}

/** A default PR head lookup: `gh pr view <ref> --json headRefName`, run from
 *  the call's dir. Null on any failure — the caller fails closed. */
function ghPrHead(ref, repoFlag, dir) {
  const args = ['pr', 'view', ref, '--json', 'headRefName', '--jq', '.headRefName', ...(repoFlag ? ['-R', repoFlag] : [])];
  const r = spawnSync('gh', args, { cwd: dir ?? undefined, encoding: 'utf8', timeout: 10000, windowsHide: true });
  const head = r.status === 0 ? (r.stdout || '').trim() : '';
  return head || null;
}

/** `git [-C <path>] push [flags] <remote> <branch>`'s target from `base`. */
function pushShip(words, base, ps) {
  let repo = base;
  let i = 1;
  if (words[1]?.word === '-C' && words[2]) {
    repo = shipDir(base, words[2], ps, false);
    if (!repo) return { why: `git -C ${words[2].word} is not a dir that exists` };
    i = 3;
  }
  if (words[i]?.word !== 'push') return { why: 'its git call is not a plain `git [-C <path>] push`' };
  const pos = [];
  for (const { word: a } of words.slice(i + 1)) {
    if (!a.startsWith('-')) pos.push(a);
    else if (!PUSH_FLAG.test(a)) return { why: `push flag ${a} is not one the guard reads` };
  }
  if (pos.length !== 2) return { why: 'a push must name exactly `<remote> <branch>`' };
  const [remote, ref] = pos;
  if (!REMOTE_NAME.test(remote)) return { why: `"${remote}" is not a plain remote name` };
  if (!repo || currentBranch(repo) === null) return { why: 'its dir is not a git checkout' };
  const branch = ref === 'HEAD' ? liveBranch(repo) : ref.replace(/^refs\/heads\//, '');
  if (!branch) return { why: 'HEAD is detached there' };
  if (!BRANCH.test(branch) || branch.startsWith('refs/')) return { why: `"${ref}" is not a branch name the guard can read` };
  const r = spawnSync('git', ['-C', repo, 'remote', 'get-url', '--push', '--all', remote], { encoding: 'utf8', timeout: 4000 });
  const urls = r.status === 0 ? (r.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean) : [];
  if (urls.length !== 1) return { why: urls.length ? `remote "${remote}" pushes to more than one URL` : `"${remote}" is not a remote git can resolve there` };
  const cfg = gitConfig(repo);
  if (!cfg) return { why: 'its git config could not be read' };
  const configured = last(cfg, `remote.${remote}.pushurl`) || last(cfg, `remote.${remote}.url`) || urls[0];
  const risk = pushConfigRisk(cfg, remote, configured, branch) || pushConfigRisk(cfg, remote, urls[0], branch);
  if (risk) return { why: risk };
  return { verb: 'git push', target: `${repoSlug(urls[0])}#${branch}`, use: {} };
}

/** gh pr args read against its value and boolean flags: `{ flags, pos }`
 *  (flag → its values, short names the guard reads under their long ones),
 *  or `{ why }` for an unknown flag. */
function ghArgs(args, value, bool) {
  const flags = new Map();
  const pos = [];
  const add = (k, v) => flags.set(GH_LONG[k] ?? k, [...(flags.get(GH_LONG[k] ?? k) || []), v]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('-')) pos.push(a);
    else if (bool.has(a)) add(a, true);
    else {
      const eq = a.startsWith('--') ? a.indexOf('=') : -1;
      const name = eq > 0 ? a.slice(0, eq) : a;
      const v = eq > 0 ? a.slice(eq + 1) : args[++i];
      if (!value.has(name)) return { why: `gh flag ${a} is not one the guard reads` };
      if (v === undefined) return { why: `gh flag ${a} has no value` };
      add(name, v);
    }
  }
  if ((flags.get('--repo') || []).length > 1 || (flags.get('--head') || []).length > 1) return { why: 'it names --repo or --head twice' };
  return { flags, pos };
}

/** The repo a gh pr call acts on: -R, else a PR URL, else `dir`'s gh remote. */
function ghRepo(flags, dir, url) {
  const flag = flags.get('--repo')?.[0];
  if (flag !== undefined && (flag.includes(OPAQUE) || !GH_REPO_ARG.test(flag))) return { why: `-R ${flag} is not OWNER/REPO` };
  const fromFlag = flag && repoSlug(flag);
  const fromUrl = url && repoSlug(url);
  if (fromFlag && fromUrl && fromFlag !== fromUrl) return { why: 'its -R and PR URL name different repos' };
  const slug = fromFlag || fromUrl || (dir && currentBranch(dir) !== null ? ghRemoteSlug(dir) : null);
  return slug ? { slug, owner: slug.split('/')[1] } : { why: 'the guard can read no repo for it (no -R, and its dir is not a checkout with a remote)' };
}

/** `gh pr create [flags]`'s target from `dir`. */
function createShip(args, dir) {
  const p = ghArgs(args, CREATE_VALUE, CREATE_BOOL);
  if (p.why) return p;
  if (p.pos.length) return { why: 'gh pr create takes no positional args' };
  if ((p.flags.get('--body-file') || []).includes('-')) return { why: '--body-file - reads stdin' };
  const repo = ghRepo(p.flags, dir, null);
  if (repo.why) return repo;
  const head = p.flags.get('--head')?.[0];
  const [, owner, named] = head === undefined ? [] : /^(?:([^:]*):)?(.*)$/s.exec(head);
  if (owner !== undefined && owner.toLowerCase() !== repo.owner) return { why: `its head ${head} is in another owner's fork` };
  const branch = head === undefined ? liveBranch(dir) : named;
  if (!branch || !BRANCH.test(branch)) return { why: head === undefined ? 'no branch is checked out in its dir' : `--head ${head} is not a branch name the guard can read` };
  return { verb: 'gh pr create', target: `${repo.slug}#${branch}`, use: { create: true } };
}

/** `gh pr merge [<N>|#N|<branch>|<PR URL>] [flags]`'s target from `dir`. */
function mergeShip(args, dir, prHead) {
  const p = ghArgs(args, MERGE_VALUE, MERGE_BOOL);
  if (p.why) return p;
  if (p.pos.length > 1) return { why: 'gh pr merge takes one PR argument' };
  const auto = p.flags.has('--auto');
  const off = p.flags.has('--disable-auto');
  if (auto && off) return { why: 'it holds both --auto and --disable-auto' };
  const [arg] = p.pos;
  const isUrl = arg !== undefined && PR_URL.test(arg);
  const repo = ghRepo(p.flags, dir, isUrl ? arg : null);
  if (repo.why) return repo;
  let branch;
  if (arg === undefined) branch = p.flags.has('--repo') ? null : liveBranch(dir);
  else if (/^#?\d+$/.test(arg) || isUrl) branch = prHead(arg.replace(/^#/, ''), p.flags.get('--repo')?.[0] ?? null, dir);
  else branch = arg;
  if (!branch || !BRANCH.test(branch)) {
    return { why: arg === undefined ? 'it names no PR (with -R, or outside a checkout on a branch)' : /^#?\d+$/.test(arg) || isUrl ? `gh could not look up PR ${arg}'s head branch` : `"${arg}" is not a PR the guard can read` };
  }
  return { verb: 'gh pr merge', target: `${repo.slug}#${branch}`, use: auto ? { auto: true } : off ? {} : { merge: true } };
}

/** 8. A canonical ship command's `{ verb, target: 'host/owner/repo#branch', use }`
 *  (use: this call's create / auto / merge), read live from the checkout,
 *  remotes and config; or `{ why }` when `raw` is anything else:
 *  `[cd <abs path> SEP] CALL [2>&1 | >/dev/null | 2>/dev/null]* [| tail|head -N]`,
 *  SEP `&&` in bash, `;` or `&&` in PowerShell, CALL a push, PR create or
 *  merge in the shapes hooks/README.md rule 8 lists.
 *  `deps.prHead(ref, repoFlag, dir)` looks up a PR's head branch (gh by default). */
export function canonicalShip(raw, cwd, tool = null, deps = {}) {
  const ps = tool === 'PowerShell';
  const lexed = shipTokens(String(raw ?? ''), ps);
  if (lexed.why) return lexed;
  const t = lexed.tokens;
  let base = typeof cwd === 'string' ? cwd : null;
  let k = 0;
  if (t[0]?.word === 'cd') {
    // Bash's `;` would run the call in the old dir if the cd failed; PowerShell
    // 5.1 has no `&&`.
    if (!t[1]?.word || !(t[2]?.op === '&&' || (ps && t[2]?.op === ';'))) return { why: 'a cd before the call must be `cd <absolute path> &&`' };
    // Set-Location reads [ ] * ? as wildcards, quoted or not, and its failure
    // doesn't stop the call.
    if (ps && /[[\]*?]/.test(t[1].word)) return { why: `PowerShell's cd reads the wildcard chars in ${t[1].word}` };
    base = shipDir(null, t[1], ps, true);
    if (!base) return { why: `cd ${t[1].word} is not an absolute path to a dir that exists` };
    k = 3;
  }
  const words = [];
  while (t[k]?.word !== undefined) words.push(t[k++]);
  while (t[k]?.redirect) k++;
  if (t[k]?.op === '|') {
    const [cmd, a, b] = [t[k + 1]?.word, t[k + 2]?.word, t[k + 3]?.word];
    if (!/^(?:tail|head)$/.test(cmd ?? '')) return { why: 'its pipe goes to something other than tail or head' };
    if (/^-\d+$/.test(a ?? '')) k += 3;
    else if (a === '-n' && /^\d+$/.test(b ?? '')) k += 4;
    else return { why: 'its tail/head takes something other than -N or -n N' };
  }
  if (k < t.length) return { why: `it carries another step (${t[k].op ? `\`${t[k].op}\`` : 'a redirect or word out of place'})` };
  const w = words.map((x) => x.word);
  const env = Object.keys(process.env);
  const gitEnv = env.find((e) => /^GIT_(?:DIR|WORK_TREE|COMMON_DIR|NAMESPACE|CONFIG.*)$/i.test(e));
  if (gitEnv) return { why: `the hook's env sets ${gitEnv}` };
  if (w[0] === 'git') return pushShip(words, base, ps);
  if (w[0] === 'gh' && w[1] === 'pr' && (w[2] === 'create' || w[2] === 'merge')) {
    const ghEnv = env.find((e) => /^GH_(?:REPO|HOST)$/i.test(e));
    if (ghEnv) return { why: `the hook's env sets ${ghEnv}` };
    return w[2] === 'create' ? createShip(w.slice(3), base) : mergeShip(w.slice(3), base, deps.prHead ?? ghPrHead);
  }
  return { why: 'its call is not `git push`, `gh pr create` or `gh pr merge`' };
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

/** The tool_use ids among `ids` whose transcript tool_result errored, in one
 *  read. An unreadable transcript or a torn line counts as no error: no refund
 *  is the safe answer. */
function erroredCalls(transcriptPath, ids) {
  const want = new Set(ids);
  const out = new Set();
  let text = '';
  try {
    text = readFileSync(transcriptPath, 'utf8');
  } catch {
    return out;
  }
  for (const l of text.split('\n')) {
    if (!l || l[0] !== '{' || !l.includes('"tool_result"')) continue;
    try {
      const content = JSON.parse(l)?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const b of content) if (b?.type === 'tool_result' && b.is_error === true && want.has(b.tool_use_id)) out.add(b.tool_use_id);
    } catch {
      // torn line
    }
  }
  return out;
}

/** Keeps the newest 200 approval uuids, and their side-table ids. */
function trimState(state) {
  const ids = state[IDS_KEY] || {};
  const keys = Object.keys(state).filter((k) => k !== IDS_KEY);
  for (const k of keys.slice(0, Math.max(0, keys.length - 200))) {
    delete state[k];
    for (const v of Object.keys(ids)) if (v.startsWith(`${k}|`)) delete ids[v];
  }
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
  if (entry.includes(verb) && ids[idKey] && erroredCalls(transcriptPath, [ids[idKey]]).has(ids[idKey])) {
    entry = entry.filter((v) => v !== verb);
    delete ids[idKey];
  }
  if (entry.includes(verb)) return true;
  state[uuid] = [...entry, verb];
  if (toolUseId) ids[idKey] = toolUseId;
  state[IDS_KEY] = ids;
  trimState(state);
  writeState(file, state);
  return false;
}

// The tool_use ids a binding remembers; past this it can no longer be released.
const MAX_BOUND_CALLS = 50;

/** A state entry binding an approval to a branch (#305); an array is a
 *  one-shot approval's spent verbs. */
const isBound = (e) => e !== null && typeof e === 'object' && !Array.isArray(e) && typeof e.target === 'string';

/** Checks a canonical call (`{ target, use }`) against the binding `entry`
 *  (null: none yet, so this call binds). Returns null when it may run,
 *  `{ other }` naming the bound target, `{ merged }` once a merge under it
 *  used the approval up, or `{ again }` for a second create or merge. A
 *  create or merge whose call errored is refunded first (#147). A call
 *  without a tool_use_id makes its binding permanent. */
function bind(state, uuid, entry, { target, use }, file, toolUseId, transcriptPath) {
  const spent = entry ? ['merge', 'auto', 'create'].filter((k) => typeof entry[k] === 'string') : [];
  if (spent.length) {
    const errored = erroredCalls(transcriptPath, spent.map((k) => entry[k]));
    for (const k of spent) if (errored.has(entry[k])) delete entry[k];
  }
  if (entry?.merge) return { merged: entry.target };
  if (entry && entry.target !== target) return { other: entry.target, target };
  if (use.create && entry?.create) return { again: 'gh pr create', target };
  if ((use.merge || use.auto) && entry?.auto) return { again: 'gh pr merge', target };
  const next = entry ?? { target, calls: [] };
  next.calls = toolUseId && Array.isArray(next.calls) && next.calls.length < MAX_BOUND_CALLS ? [...next.calls, toolUseId] : null;
  // A merge uses the approval up; an auto-merge uses up only the merge verb,
  // so CI-fix pushes still follow it; a create runs once.
  for (const k of ['create', 'auto', 'merge']) if (use[k]) next[k] = toolUseId || true;
  delete state[uuid]; // re-inserted last: the newest binding survives the trim
  state[uuid] = next;
  trimState(state);
  writeState(file, state);
  return null;
}

/** 8. Approval `uuid`'s verdict on this gated call: binds it when this is its
 *  first gated call and `readShip()` (canonicalShip, read only when needed)
 *  finds a lone canonical command, checks a bound approval's later calls,
 *  and spends one-shot (main's per-verb `spend`) otherwise. A binding whose
 *  every call errored is released first, so this call counts as a first. */
function shipGate(uuid, verb, readShip, file, toolUseId, transcriptPath) {
  const state = readState(file);
  let entry = state[uuid];
  if (isBound(entry)) {
    const calls = Array.isArray(entry.calls) ? entry.calls : [];
    if (calls.length && erroredCalls(transcriptPath, calls).size === calls.length) {
      delete state[uuid];
      writeState(file, state);
      entry = undefined;
    }
  }
  if (entry === undefined || isBound(entry)) {
    const ship = readShip();
    if (!ship.why) return bind(state, uuid, entry ?? null, ship, file, toolUseId, transcriptPath);
    if (entry) return { lone: entry.target, why: ship.why };
  }
  return spend(uuid, verb, file, toolUseId, transcriptPath) ? { spent: true } : null;
}

const askRemedy = (verb) =>
  `Ask the user with AskUserQuestion — give it an option that approves this ${verb} (answer wording like "push"/"PR"/"merge", without "hold"/"wait"/"no") — then retry. A prompt the user typed themselves approves the same way ("lgtm push and pr"); a message from an agent, another session, a hook or a tool never does. One approval covers each gated verb once — but a lone canonical command (\`git push <remote> <branch>\`, \`gh pr create …\`, \`gh pr merge …\`, no other steps) as an approval's first gated call binds it to that branch for the whole ship (pushes, PR create, CI-fix pushes, merge) until the merge.`;

/** 8. git push / gh pr create / gh pr merge need an approving answer in the
 *  transcript: bound to one branch's ship when its first gated call is a lone
 *  canonical command, else spent once per verb. `transcriptPath` is read
 *  lazily — a non-gated command never touches disk here. `deps.prHead`
 *  replaces gh's PR head lookup (tests). */
export function pushGateReason(raw, cwd, transcriptPath, stateFile = pushGateStateFile(), toolUseId = undefined, tool = null, deps = {}) {
  const verbs = gatedVerbs(raw, cwd, tool);
  if (!verbs.length) return null;
  if (verbs.length > 1) {
    return `This command holds ${verbs.length} gated verbs (${verbs.join(', ')}) — run each gated verb in its own Bash call, so each one is checked against the user's approval on its own. Nothing was spent.`;
  }
  const [verb] = verbs;

  if (!transcriptPath || !existsSync(transcriptPath)) {
    return `${verb} needs explicit user approval (CLAUDE.md: "Push, PR create, PR merge need explicit user approval (hook-gated); commits need none."), but there is no transcript to read it from. ${askRemedy(verb)}`;
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

  // Both readings must agree on the verb, or the call is not canonical.
  const readShip = () => {
    const ship = canonicalShip(raw, cwd, tool, deps);
    return ship.why || ship.verb === verb ? ship : { why: `the guard reads it as ${verb}, not ${ship.verb}` };
  };
  const held = shipGate(record.uuid, verb, readShip, stateFile, toolUseId, transcriptPath);
  if (held?.spent) return `${verb} already spent that approval — one push/PR per approving answer. ${askRemedy(verb)}`;
  if (held?.lone) {
    return `This approval covers ${held.lone}. After its first call, a push, PR create or merge under it must be a lone command — \`[cd <abs path> && ] git push [-u] <remote> <branch>\`, \`gh pr create … [--head <branch>]\`, \`gh pr merge <N|branch> …\`, optionally ending \`2>&1 | tail -N\` — with no other steps (${held.why}). Run other steps in their own Bash call. Nothing was spent.`;
  }
  if (held?.merged) return `This approval's PR (${held.merged}) was merged, which used the approval up — ${verb} needs a new answer. ${askRemedy(verb)}`;
  if (held?.again) return `This approval already ran ${held.again} for ${held.target}; a second ${held.again} needs a new answer. ${askRemedy(verb)}`;
  if (held?.other) {
    return `This approval covers ${held.other} (the branch its first push/PR/merge shipped); ${verb} ships ${held.target}. A push, PR or merge of another branch needs its own answer. ${askRemedy(verb)}`;
  }
  return null;
}

const PW_LAUNCHER = /^(?:npx|pnpx|bunx|pnpm|yarn|npm|bun)(?:\.cmd)?$/i;
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
    if (/^playwright(?:\.cmd)?$/i.test(cmd)) p = 0;
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
        // Unreadable is a verdict of its own, not a guard crash.
        if (err instanceof UnreadableError) block(err.message);
        throw err;
      }
    },
    { failClosed: true },
  );
}
