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
//      A spend records its call's tool_use_id; if that call's transcript
//      tool_result is_error, the next gated call refunds the spend (#147).
//   9. Commands that open a visible browser — playwright --headed/--ui/--debug,
//      codegen, show-report, show-trace, open — need the user's browser consent
//      (_hooklib.mjs browserGateReason; shared with browser-gate.mjs, granted
//      once per session). Headless `playwright test` stays ungated.
//  10. A heredoc body holding a doubled backslash — the Bash tool's shell spawn
//      collapses it, silently corrupting the file or commit message; use Write
//      (#123, #137, #147).
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
// single-quoted text stays literal. A `{ … }` block body (PowerShell
// if/foreach/ForEach-Object, a bash group) is parsed in place too (#159).

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

/** Index of the `)` closing a $(…)/<(…)/>(…) body that starts at i (or the
 *  `}` closing a block body, with `open`/`close`), or -1. Quoted text and
 *  nested backticks inside the body can't close it. `rest[k]`, when given,
 *  counts the closers at k or later: a depth past it can never close, so the
 *  scan stops there instead of running on to the end for every opener. */
function closeGroup(s, i, open = '(', close = ')', rest = null) {
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
    } else if (ch === open) {
      if (++depth > (rest ? rest[i] : Infinity)) return -1;
    } else if (ch === close && --depth === 0) return i;
  }
  return -1;
}

// A block's `{` stands where a command or keyword can end (`if ($x) {`,
// `} else{`, `| % {`), never inside a word (`@{u}`, `${x}`, `HEAD@{1}`); its `}`
// ends a word too. A spaceless body with a comma or `..` is a bash brace
// expansion (`{a,b}`, `{1..3}`), not a block. Both read a few characters, not
// the whole line, so a long command stays linear.
const BLOCK_BEFORE = /(?:^|[\s(){};|&%]|(?:^|[^\w-])(?:else|try|finally|do))$/i;
const BLOCK_AFTER = /^(?:$|[\s;|&)}<>]|(?:else|elseif|catch|finally|while|until)\b)/i;
let lastText = null;
let closers = null; // closers[k]: the `}`s in lastText at k or later

function bracesFrom(s) {
  if (s === lastText) return closers;
  closers = new Int32Array(s.length + 1);
  for (let k = s.length - 1; k >= 0; k--) closers[k] = closers[k + 1] + (s[k] === '}');
  lastText = s;
  return closers;
}

/** The block opening at i — a PowerShell script block (`if (…) { … }`,
 *  `ForEach-Object { … }`) or a bash brace group (`{ a; b; }`) — as { body,
 *  end }, or null. One that never closes is no block: the clause reads on. */
function blockAt(s, i) {
  if (s[i] !== '{' || !BLOCK_BEFORE.test(s.slice(Math.max(0, i - 8), i))) return null;
  const rest = bracesFrom(s);
  if (!rest[i]) return null;
  const close = closeGroup(s, i + 1, '{', '}', rest);
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
    [open, close] = [2, closeGroup(s, i + 2)];
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
 *  unbalanced-quote fallback leaves it empty. A block body (`{ … }`, see
 *  blockAt) stays whole too; when `blocks` is an array, each block in a clause
 *  is cut out to a `{}` placeholder and the array is filled, parallel to the
 *  result, with that clause's blocks as { head, body } (`head` is the clause
 *  text since the previous block: `if ($x) `, ` else `). */
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
    } else if (pipes && ch === '|' && cmd[i + 1] !== '|') {
      cur += ch;
      if (cmd[i + 1] === '&') cur += cmd[++i];
    } else if (/[;&|\n]/.test(ch)) {
      let kind = ch;
      if ((ch === '&' || ch === '|') && cmd[i + 1] === ch) kind = ch + cmd[i++ + 1];
      out.push(cur);
      before.push(sep);
      found.push(own);
      sep = kind;
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

export function staticCheck(raw) {
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
    return 'A pipe after a gate reports the pipe\'s exit code, not the gate\'s. Run gates unpiped (use `node $HOME/code/claude-config/scripts/qa.mjs` for compact output).';
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
const POPD = /^(?:popd|pop-location)$/i;
const SHELL_C = /^(?:bash|sh|zsh|dash|pwsh|powershell|cmd|eval)(?:\.exe)?$/i;
const GIT_OPT_WITH_ARG = /^(?:-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env)$/;

const toDir = (dir, p) => {
  const e = expandHome(p);
  if (isAbsolute(e)) return e;
  return dir ? resolve(dir, e) : null;
};

/** Every command a line runs, as { cmd, words, dir, pipe, seg, viaOr, loop }:
 *  `cmd` is the command word's basename, `dir` the payload cwd walked through
 *  the cd clauses before it, `pipe` an identity shared by the commands of one
 *  pipeline and `seg` the command's place in it. `viaOr` marks the first
 *  command of an `||` alternative (it runs only if what came before failed),
 *  `loop` one inside a for/while/until loop (it may run several times). cd
 *  clauses are consumed; a quoted command handed to a shell is expanded in
 *  place, and so is every substitution body (`…`, $(…), <(…)), which runs
 *  before the clause holding it. A block body (`{ … }`) is walked after its
 *  clause's own substitutions. One that runs in place (a group, a branch, a
 *  foreach/while/do/ForEach-Object body) shares the cwd walk, so a cd inside it
 *  moves the commands after it; one that runs elsewhere or later (a function,
 *  a job, a -Parallel or stored block) reads the cwd but can't move it. A body
 *  is a `loop` unless it runs once — a bare group, an if/elseif/else/try/catch/
 *  finally branch — since a PowerShell loop has no `done` to count. Other
 *  quoted text is an argument, never a command. `orFirst`/`inLoop` carry the
 *  enclosing clause's state into a body; `scope` is the cwd and pushd stack a
 *  block shares with its clause. */
function commands(raw, cwd, orFirst = false, inLoop = false, scope = { dir: cwd || null, stack: [] }) {
  const out = [];
  let loops = 0; // loops opened in this text and not yet closed by `done`
  const pipeSeps = [];
  for (const [pi, p] of pipelines(raw, pipeSeps).entries()) {
    // Only the alternative's first commit is sure to run before the rest of
    // it: viaOr clears once one is emitted. A substitution ahead of it
    // (`-m "$(cat …)"`, `FOO=$(date) git …`) leaves it set.
    let viaOr = pipeSeps[pi] === '||' || (pi === 0 && orFirst);
    const emit = (...cs) => {
      out.push(...cs);
      if (cs.some((e) => /^git(?:\.exe)?$/i.test(e.cmd) && e.words.includes('commit'))) viaOr = false;
    };
    const pipe = {};
    const blocks = [];
    for (const [seg, c] of clauses(p, false, null, blocks).entries()) {
      const w = words(c);
      // A bash loop keyword; a PowerShell for (…)/while (…) block has no `done`
      // to close it. A lone `(` after the keyword is PowerShell when a `{` body
      // follows it or the `(` runs on past this clause (`for ($i=0; …`); a bash
      // subshell condition (`while (true); do`) closes with no `{`.
      const psBlock = () => /^\((?!\()/.test(w[0] ?? '') && (/\)\s*\{/.test(c) || !c.includes(')'));
      const opensLoop = (kw) => /^(?:for|while|until)$/i.test(kw) && !psBlock();
      for (;;) {
        if (w.length && /^[({!]+./.test(w[0])) w[0] = w[0].replace(/^[({!]+/, '');
        if (!w.length || !WRAPPER.test(w[0])) break;
        if (opensLoop(w.shift())) loops++; // a while/until condition repeats too
      }
      // A group's closing `)` sticks to its last word (`(git push)`), unless the
      // word opens a `(` of its own for it to close.
      if (w.length) {
        const last = w[w.length - 1];
        const extra = (last.match(/\)/g) || []).length - (last.match(/\(/g) || []).length;
        if (extra > 0) w[w.length - 1] = last.replace(/\)+$/, (m) => m.slice(extra));
        if (!w[w.length - 1]) w.pop();
      }
      const cmd = w.length ? w[0].split(/[/\\]/).pop() : '';
      const loop = inLoop || loops > 0;
      const shellAt = !SHELL_C.test(cmd) ? -1 : /^eval/i.test(cmd) ? 0 : w.findIndex((a, i) => i > 0 && /^(?:-c|-Command|\/c)$/i.test(a));
      const shellCmd = shellAt !== -1 && w[shellAt + 1] !== undefined ? w.slice(shellAt + 1).join(' ') : null;
      // A shell's own command string is parsed whole below; reading its
      // substitutions here too would count each gated verb twice.
      if (shellCmd === null) for (const body of substitutions(c)) emit(...commands(body, scope.dir, viaOr, loop));
      for (const { head, body } of blocks[seg] || []) {
        const h = head.trim();
        const once = /^(?:[&.]\s*)?$|^(?:if|elseif|else|try|catch|finally|then)\b/i.test(h);
        const inPlace = once || /^(?:foreach|for|while|do|until|switch)(?![\w-])|^(?:ForEach-Object|%|foreach|Where-Object|\?)$/i.test(h);
        emit(...commands(body, null, viaOr, loop || !once, inPlace ? scope : { dir: scope.dir, stack: [...scope.stack] }));
      }
      if (!w.length) continue;
      if (/^for$/i.test(cmd)) {
        w.shift();
        if (opensLoop(cmd)) loops++; // its word list runs once; the body after `do` repeats
        continue;
      }
      if (/^done\)*$/.test(cmd)) {
        loops = Math.max(0, loops - 1);
        continue;
      }
      if (POPD.test(cmd)) {
        // `popd -n`/`+N` and `-StackName` leave the cwd: only a bare pop moves it.
        const bare = w.slice(1).every((a) => /^-PassThru$/i.test(a));
        if (bare && scope.stack.length) scope.dir = scope.stack.pop();
        continue;
      }
      if (CD.test(cmd)) {
        if (/^(?:pushd|push-location)$/i.test(cmd)) scope.stack.push(scope.dir);
        const arg = w.slice(1).find((a) => !/^-/.test(a) || a === '-');
        if (arg === undefined) scope.dir = /^cd$/i.test(cmd) ? homedir() : scope.dir;
        else if (arg !== '-') scope.dir = toDir(scope.dir, arg.replace(/\)+$/, ''));
        continue;
      }
      if (SHELL_C.test(cmd)) {
        if (shellCmd !== null) emit(...commands(shellCmd, scope.dir, viaOr, loop));
        continue;
      }
      emit({ cmd, words: w, dir: scope.dir, pipe, seg, viaOr, loop });
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
  for (const { cmd, words: w, dir, viaOr, loop } of commands(raw, cwd)) {
    if (!/^git(?:\.exe)?$/i.test(cmd)) continue;
    let repo = dir;
    let i = 1;
    for (; i < w.length && w[i].startsWith('-'); i++) {
      if (w[i] === '-C' && w[i + 1] !== undefined) repo = toDir(repo, w[++i]);
      else if (GIT_OPT_WITH_ARG.test(w[i])) i++;
    }
    out.push({ sub: w[i] || null, args: w.slice(i + 1), repo, viaOr, loop });
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
  `Ask the user with AskUserQuestion — give it an option that approves this ${verb} (answer wording like "push"/"PR"/"merge", without "hold"/"wait"/"no") — then retry. One answer approves each gated verb once, so ask once for the whole ship (push, PR, merge); a second push of the same verb needs its own answer.`;

/** 8. git push / gh pr create / gh pr merge need an approving answer in the
 *  transcript, spent once per verb. `transcriptPath` is read lazily — a
 *  non-gated command never touches disk here. */
export function pushGateReason(raw, cwd, transcriptPath, stateFile = pushGateStateFile(), toolUseId = undefined) {
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

function callRule({ sub, args, repo, viaOr, loop }, rooted = new Set()) {
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
    // nor is denied the exemption. A commit in a loop body may be several commits, and a
    // hook can only block the whole command, so a loop commit gets no exemption at all.
    if (!loop && isUnborn(repo)) {
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

if (isMain(import.meta.url)) {
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
        pushGateReason(cmd, cwd, payload?.transcript_path, undefined, payload?.tool_use_id);
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
