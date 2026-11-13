#!/usr/bin/env node
// guard-replay.mjs — diff guard verdicts between two checkouts over real transcripts (#106).
//   node scripts/guard-replay.mjs <old-checkout> <new-checkout> [--branch] [--full] [--files N] [--days D] [--root <projects-dir>]
// Replays unique Bash/PowerShell commands (each under the tool that ran it) through staticCheck and gatedVerbs,
// and unique AskUserQuestion answers through isApproving and isBrowserApproving,
// in both checkouts. Prints one line per changed verdict plus a summary. Exit 0 always: a report, not a gate.
// --branch adds the stateful rules (#165): each command's gitCalls(scrub(c)) diffed by sub, args and repo,
// then branchRules allow/BLOCK verdicts with cwd = a temp unborn repo and a temp born repo.
// --full (#168) follows each changed line with the whole command, redacted and indented, and,
// where the line collapsed the new verdict (branchRules' BLOCK), its reason.
// branchRules runs read-only git (branch --show-current, rev-parse), so a command that cds into a
// real repo reads that repo; no command is ever executed. It finds only shapes the corpus holds: in
// #159 it reported 0 verdict changes while a false allow existed. It complements the fresh-context
// reviewer and does not replace it.
// Transcripts: <CLAUDE_CONFIG_DIR or ~/.claude>/projects/*/*.jsonl and projects/*/<session>/subagents/*.jsonl, last --days (default 7) or newest --files.
//
//   node scripts/guard-replay.mjs --by-rule [<checkout>] [--full] [--files N] [--days D] [--root <projects-dir>]
// --by-rule (#368) counts the live bash-guard blocks in the transcripts (every transcript by
// default) per rule, sorts each into true / false / undecided by the check in CHECK below, and
// replays <checkout>'s current rules (default: this repo) over every unique command. A markdown
// report on stdout; --full adds every block with its verdict.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseHookBlock, walkTranscripts } from './audit-lib.mjs';
import { isMain } from './lib.mjs';

const MAX_SHOWN = 120;

function num(v, o) {
  const n = Number(v);
  if (v === undefined || v === '' || !Number.isFinite(n) || n < 0) o.bad = true;
  return n;
}

function parseArgs(argv) {
  const o = { files: null, days: null, root: null, branch: false, full: false, byRule: false, paths: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--files') o.files = num(argv[++i], o);
    else if (argv[i] === '--days') o.days = num(argv[++i], o);
    else if (argv[i] === '--root') o.root = argv[++i];
    else if (argv[i] === '--branch') o.branch = true;
    else if (argv[i] === '--full') o.full = true;
    else if (argv[i] === '--by-rule') o.byRule = true;
    else o.paths.push(argv[i]);
  }
  // Default: the last 7 days, main + subagent transcripts. A newest-N count skews
  // toward many small subagent files (30 files held 930 commands; 7 days held 2118).
  // --by-rule reads every transcript: a rule's zero needs the widest window.
  if (!o.byRule && o.files == null && o.days == null) o.days = 7;
  return o;
}

function projectsRoot(override) {
  if (override) return override;
  const base = process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || process.env.USERPROFILE || homedir(), '.claude');
  return join(base, 'projects');
}

async function transcripts(root, { files, days }) {
  const all = [];
  try {
    for await (const { file } of walkTranscripts(root)) {
      try {
        all.push({ p: file, mtime: statSync(file).mtimeMs });
      } catch {
        // vanished mid-scan
      }
    }
  } catch {
    // projects root missing or unreadable: scan nothing
  }
  all.sort((a, b) => b.mtime - a.mtime);
  if (days != null) return all.filter((f) => f.mtime >= Date.now() - days * 864e5).map((f) => f.p);
  return all.slice(0, files ?? all.length).map((f) => f.p);
}

/** Order-independent identity for an answers object. */
const answerKey = (a) => JSON.stringify(Object.entries(a).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));

/** Shown commands and verdicts never carry secrets: NAME=value, $env:NAME = value, Bearer tokens,
 *  --with-token values and URL passwords print as ***. */
const SECRET_ASSIGN = /(?<![-\w])((?:\$env:)?(?:[A-Z0-9]+_)*(?:TOKEN|KEY|SECRET|PASSWORD|PASS|PAT)\s*=\s*)("[^"]*"|'[^']*'|\S+)/g;
const redact = (s) =>
  s
    .replace(SECRET_ASSIGN, '$1***')
    .replace(/(Authorization:\s*Bearer\s+)[^\s"']+/gi, '$1***')
    .replace(/(--with-token[\s=]+)[^\s"']+/g, '$1***')
    .replace(/(:\/\/[^\s/:@"']+:)[^\s/@"']+@/g, '$1***@');

/** Unique shell commands and unique AskUserQuestion answer objects across the files. */
/** The unique commands as { command, tool }: the hook judges a command by the
 *  tool that ran it (#171), so one run by both Bash and PowerShell counts twice. */
function collect(paths) {
  const commands = new Map();
  const answers = new Map();
  for (const p of paths) {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (!line || line[0] !== '{') continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      const content = o?.message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === 'tool_use' && (c.name === 'Bash' || c.name === 'PowerShell') && typeof c.input?.command === 'string') {
            commands.set(`${c.name}\n${c.input.command}`, { command: c.input.command, tool: c.name });
          }
        }
      }
      const a = o?.toolUseResult?.answers;
      if (o?.type === 'user' && a && typeof a === 'object' && !Array.isArray(a)) answers.set(answerKey(a), a);
    }
  }
  return { commands: [...commands.values()], answers: [...answers.values()] };
}

export async function load(checkout) {
  const dir = resolve(checkout, 'hooks');
  const guard = await import(pathToFileURL(join(dir, 'bash-guard.mjs')).href);
  const lib = await import(pathToFileURL(join(dir, '_hooklib.mjs')).href);
  return { ...lib, ...guard };
}

const verdict = (fn, ...args) => {
  try {
    if (typeof fn !== 'function') return 'missing';
    return JSON.stringify(fn(...args)) ?? 'undefined';
  } catch (e) {
    return `throws ${String(e?.message).slice(0, 60)}`;
  }
};

/** A temp repo on main: unborn, or born with one empty commit. The caller removes it. */
function tempRepo(born) {
  const dir = mkdtempSync(join(tmpdir(), born ? 'gr-born-' : 'gr-unborn-'));
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { timeout: 10000 });
  git('init', '-q', '-b', 'main');
  if (born) git('-c', 'user.name=guard-replay', '-c', 'user.email=guard-replay@localhost', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'init');
  return dir;
}

/** The gitCalls fields branchRules reads, with the temp repo's path shown as <repo>. An older
 *  checkout's viaOr and loop (rule 5's, cut by #368) are not compared. */
const callShape = (calls, repo) =>
  calls.map(({ sub, args, repo: r }) => ({
    sub,
    args,
    repo: typeof r === 'string' && r.startsWith(repo) ? `<repo>${r.slice(repo.length)}` : r,
  }));

/** A branchRules verdict as allow/BLOCK; missing and throws stay as they are. */
const allowBlock = (v) => (v === 'null' ? 'allow' : v.startsWith('"') ? 'BLOCK' : v);

const oneLine = (s, n = MAX_SHOWN) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}...` : t;
};

// ---- --by-rule (#368) ---------------------------------------------------------

/** bash-guard's rules: id, what it guards, and every wording its block reasons have used. */
const RULES = [
  ['1', "git add -A/./--all, git commit -a (sweeps other sessions' files)", /^git (?:add -A\/--all|add \.|commit -a\/--all) is banned/],
  ['2', 'staging or committing a real .env file', /^Refusing to stage\/commit a \.env/],
  ['3', 'a gate piped onward (the pipe masks its rc)', /^A pipe after a gate reports/],
  ['4', 'PowerShell Set-Content/Out-File/Add-Content (mojibake, BOM)', /^PowerShell Set-Content\/Out-File\/Add-Content/],
  ['5', 'git commit on main/master in a code repo, or in a dir it cannot resolve (cut, #368)', /is on (?:main|master) — never commit|^This git commit runs in a directory the guard can't resolve/],
  ['6', 'branch switch, file restore or commit on the claude-config main checkout', /^No file restores on the claude-config main checkout|^The claude-config main checkout is the live junction surface|^No commits in the claude-config main checkout/],
  ['7', 'a shell-launched claude on a usage-billed model', /^A shell-launched claude on /],
  ['8', 'git push / gh pr create / gh pr merge without approval', /needs explicit user approval|already spent that approval|^This command holds \d+ gated verbs|^This approval(?:'s PR)? /],
  ['9', 'a visible browser without consent (cut, #368)', /opens a visible browser and needs the user's consent/],
  ['10', 'a heredoc with a doubled backslash (removed, #293)', /^A heredoc body holding a doubled backslash/],
  ['11', 'a write into a transcript or gate state file (removed, #291)', /^This writes into a session transcript/],
  ['12', 'a node/bun/deno eval script the shell substitutes into', /^This node\/bun\/deno eval script/],
  ['nesting', 'a command nested past 100 levels (blocked unread)', /^This command nests blocks, groups or substitutions/],
  ['crash', 'the guard crashed (fails closed)', /^bash-guard failed before it could check/],
];

/** The rule a bash-guard block reason belongs to, or 'other'. */
export const ruleOf = (reason) => RULES.find(([, , re]) => re.test(String(reason).trim()))?.[0] ?? 'other';

/** Counted, never sorted. */
const UNSORTED = { 8: 'out of scope (#305)', 10: 'removed (#293)', 11: 'removed (#291)', other: 'not a known rule' };
/** Rules whose verdict needs no repo state, so a replay through the current rules is faithful. */
const STATIC_RULES = new Set(['1', '2', '3', '4', '12']);
/** How far after a block the check looks: tool calls, ending early at the next prompt. */
const FOLLOW_CALLS = 10;
/** A worktree (scripts/worktree.mjs or Claude Code's own), the temp dir or a session scratchpad: one
 *  owner's files. A `tmp/` or `temp/` segment inside a repo is none of them (#368). */
function owned(p) {
  const s = String(p).replace(/\\/g, '/');
  if (/\/\.?worktrees\/|\/scratchpad(?:\/|$)/i.test(s) || /^\/tmp(?:\/|$)/.test(s)) return true;
  if (/^(?:[a-z]:|\/[a-z])\/Users\/[^/]+\/AppData\/Local\/Temp(?:\/|$)/i.test(s)) return true;
  const temp = tmpdir().replace(/\\/g, '/').toLowerCase();
  return s.toLowerCase() === temp || s.toLowerCase().startsWith(`${temp}/`);
}
/** The docs repo commits to its default branch by design (rule 5's own exemption). */
const DOCS = /[\\/]code[\\/]docs(?:[\\/]|$)/i;
/** Whole-tree staging by a route rule 1 does not parse. */
const SWEEP = /\bxargs\b[^|;&\n]*\bgit\s+add\b|\bgit\s+add\s+(?:-[a-zA-Z]*u\b|--update\b)|\bgit\s+add\b[^;&|\n]*\$\(\s*git\s+(?:status|ls-files|diff)\b/;

/** The check, as the report states it. classify() implements it, in this order. */
const CHECK = [
  'Each live block is judged from the transcript it sits in: the block, then the next tool calls (at most 10, ending at the next user prompt). A *like call* is the next allowed shell call doing the same act: a git add/commit (rules 1, 2), the same gate (3), a git commit (5), a git checkout/switch/restore (6), else at least half the same words.',
  "1. **false, since fixed** — the checkout's rules no longer block that command: always replayed for the static rules (1–4, 12); rules 5 and 6 read the repo's branch, so they are replayed only while it is still the branch the block names (rule 6: the claude-config main checkout on main), and a rule-5 unresolved dir always. A checkout without rule 5 or 9 (cut by #368) blocks none of theirs.",
  "2. **false, no harm** — the harm the rule names was absent: rule 1/2 staged in a worktree, the temp dir or a scratchpad (no other session's files; a `tmp/` segment inside a repo path is none of these), or `git add -N`; rule 4 wrote ASCII-only text with Set-Content/Add-Content (Out-File always counts: UTF-16 or a BOM on Windows PowerShell 5.1, the only PowerShell here); rule 5's repo was a temp repo or under the docs repo.",
  '3. **true, asked** — an AskUserQuestion came before any like call, and it is the next call or names the blocked act (rule 3: a pipe, gate or rc; rule 6: a checkout, restore, switch or branch; and so on).',
  '4. **true, dropped** — no like call followed (rule 3: **undecided**, there is no rerun to read the rc from).',
  '5. **false, bypass** — the like call did the same thing by another route: rule 1 `xargs git add`, `git add -u`, `git add $(git status…)`; rule 5 a `git branch -m … main`.',
  "6. **false / true by the like call** — rule 3: a rerun meant to fail (its description or command says red, expect…fail, mutation or probe, or it feeds bash-guard.mjs a payload) is false; otherwise the rc echoed right after the gate decides (a qa.mjs run: its worst EXIT: line; no echo: Claude Code's exit code, only when the gate ran last): 0 is false (the pipe masked nothing), nonzero true; rule 5 with an unresolved dir: the like commit ran in a worktree or temp repo is false.",
  '7. **true, remedy** — the harm was live (rule 1/2 a shared checkout, rule 4 as above, rule 5 a code repo on main, rules 7/9/12/nesting/crash by construction) and the like call took the rule\'s way.',
  '8. **undecided** — anything else; listed below with its command.',
  'Rule 8 (out of scope, #305) and the removed rules 10 and 11 are counted, not sorted. *Replay* counts the unique commands the current rules block (7: needs clearance; 8 and 9: a gated call, which blocks only without approval or consent); rules 5 and 6 depend on the branch at the time, so they are not replayed.',
];

const fact = (live, why) => ({ live, why });
const verdictText = (f) => {
  try {
    return f() || '';
  } catch (e) {
    return String(e?.message ?? '');
  }
};
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const wordSet = (s) => new Set(norm(s).split(' '));
const jaccard = (a, b) => {
  const [x, y] = [wordSet(a), wordSet(b)];
  const both = [...x].filter((w) => y.has(w)).length;
  return both / (x.size + y.size - both);
};
const gitOf = (g, e) => {
  try {
    return g.gitCalls(g.scrub(e.cmd), e.cwd, e.tool);
  } catch {
    return [];
  }
};
const repoFact = (repos, why = "a worktree or temp repo: no other session's files to sweep") => {
  if (!repos.length || repos.some((r) => typeof r !== 'string')) return fact(null, 'its repo is unresolved');
  return repos.every(owned) ? fact(false, why) : fact(true, 'a shared checkout');
};
const sweeps = ({ sub, args }) =>
  (sub === 'add' && args.some((a) => a === '--all' || a === '.' || a === './' || /^-[a-zA-Z]*A[a-zA-Z]*$/.test(a))) ||
  (sub === 'commit' && args.some((a) => a === '--all' || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(a)));
const BY_CONSTRUCTION = {
  7: 'a usage-billed launch',
  9: 'a visible browser',
  12: 'the shell runs the substitution as a command',
  nesting: 'an unread command',
  crash: 'an unchecked command',
};

/** Was the harm the rule names live for this block? live: true, false, or null (not decidable yet). */
function harm(b, g) {
  if (b.rule === '1') {
    const calls = gitOf(g, b).filter(sweeps);
    if (calls.length && calls.every((c) => c.sub === 'add' && c.args.some((a) => a === '-N' || a === '--intent-to-add'))) return fact(false, 'git add -N stages no content');
    return repoFact(calls.map((c) => c.repo));
  }
  if (b.rule === '2') return repoFact(gitOf(g, b).filter((c) => c.sub === 'add' || c.sub === 'commit').map((c) => c.repo), 'a worktree or temp repo');
  if (b.rule === '4') {
    if (/\bOut-File\b/i.test(b.cmd)) return fact(true, 'Out-File writes UTF-16 or a BOM on Windows PowerShell 5.1');
    return /[^\x00-\x7f]/.test(b.cmd) ? fact(true, 'non-ASCII text through the ANSI codepage') : fact(false, 'ASCII-only text: nothing to mangle');
  }
  if (b.rule === '5') {
    const m = /^"(.+)" is on (?:main|master)/.exec(b.reason);
    if (!m) return fact(null, "the commit's dir was unresolved");
    if (owned(m[1])) return fact(false, 'a temp repo');
    if (DOCS.test(m[1])) return fact(false, 'the docs repo, which commits to its default branch by design');
    return fact(true, 'a code repo on its default branch');
  }
  if (b.rule in BY_CONSTRUCTION) return fact(true, BY_CONSTRUCTION[b.rule]);
  return fact(null, 'the check has no harm test for this rule');
}

/** Rule 3's gate, as the text a rerun of it holds: the first stage of the pipeline rule 3 blocks. */
function gateText(b, g) {
  for (const p of g.clauses(g.scrub(b.cmd), true)) {
    if (ruleOf(verdictText(() => g.staticCheck(p, null, b.tool))) === '3') return norm(g.clauses(p, false)[0].replace(/\s2>&1(?=\s|$)/g, ''));
  }
  return null;
}

/** Does allowed call `e` do the act block `b` was about? */
function like(b, e, g) {
  if (b.rule === '1' || b.rule === '2') return SWEEP.test(e.cmd) || gitOf(g, e).some((c) => c.sub === 'add' || c.sub === 'commit');
  if (b.rule === '3') {
    // every word of the gate, in any order (a rerun adds flags), or qa.mjs, which runs every gate
    const gate = gateText(b, g);
    const words = wordSet(e.cmd);
    return gate !== null && ([...wordSet(gate)].every((w) => words.has(w)) || /\bqa\.mjs\b/.test(e.cmd));
  }
  if (b.rule === '5') return gitOf(g, e).some((c) => c.sub === 'commit');
  if (b.rule === '6') return gitOf(g, e).some((c) => ['checkout', 'switch', 'restore'].includes(c.sub));
  return jaccard(b.cmd, e.cmd) >= 0.5;
}

function bypass(b, e, g) {
  if (b.rule === '1') return SWEEP.test(e.cmd);
  if (b.rule === '5') return gitOf(g, e).some((c) => c.sub === 'branch' && c.args.some((a) => /^-[mM]$/.test(a)) && /^(?:main|master)$/.test(c.args.at(-1)));
  return false;
}

/** A clause that reports the rc of the clause before it (`echo rc=$?`, PowerShell's
 *  `"rc=$LASTEXITCODE"`), capturing the label it prints the rc after. */
const RC_ECHO = /^(?:(?:echo|printf|write-output|write-host)\s+)?["']?([^"'$]*)\$(?:\?|\{PIPESTATUS\[0\]\}|LASTEXITCODE)/i;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A rerun's gate rc (#368): the marker the clause right after the gate's echoes, read off the
 *  result by its label; for a qa.mjs run with none, its worst EXIT: line (one per gate it ran);
 *  else Claude Code's "Exit code N", which is the last command's, so only when the gate ran last.
 *  Null if none of these shows. */
function rcOf(b, e, g) {
  const gate = gateText(b, g);
  const parts = g.clauses(g.scrub(e.cmd)).map((c) => c.replace(/^[({\s]+/, ''));
  let k = gate === null ? -1 : parts.findIndex((c) => [...wordSet(gate)].every((w) => wordSet(c).has(w)));
  const qa = k === -1 && (k = parts.findIndex((c) => /\bqa\.mjs\b/.test(c))) !== -1;
  if (k === -1) return null;
  const result = String(e.result);
  const label = RC_ECHO.exec(parts[k + 1] ?? '')?.[1].trim();
  if (label) {
    const m = new RegExp(`${/^\w/.test(label) ? '(?<!\\w)' : ''}${escapeRe(label)}\\s*(-?\\d+)`).exec(result);
    return m ? Number(m[1]) : null;
  }
  const marks = qa ? [...result.matchAll(/\bEXIT:(\d+)/g)].map((m) => Number(m[1])) : [];
  if (marks.length) return Math.max(...marks);
  const code = e.error && k === parts.length - 1 ? /^Exit code (\d+)/.exec(result.trim()) : null;
  return code ? Number(code[1]) : null;
}

/** A rerun meant to fail: a TDD red step (it says red, expect…fail, or runs tests against the
 *  base/main/pre-change copy) or a mutation run, by its description or command; or a guard probe
 *  (a payload fed to bash-guard.mjs, or a call that says probe). */
const MEANT_TO_FAIL = /\b(?:red|mutation|mutant|probe)\b|\bexpect(?:s|ed|ing)?\b[^.;\n]{0,24}\bfail|\bagainst (?:the )?(?:base|main|old|original|pre-[\w-]+)\b/i;
const meantToFail = (e) => MEANT_TO_FAIL.test(e.description ?? '') || MEANT_TO_FAIL.test(e.cmd) || /\bbash-guard\.mjs\b/.test(e.cmd);

/** The harm, decided by the like call where the block alone could not decide it (rules 3 and 5). */
function after(b, e, g, h) {
  if (b.rule === '3') {
    if (meantToFail(e)) return fact(false, 'the rerun was meant to fail (a TDD red step, a mutation run or a guard probe), so its rc hid nothing');
    const rc = rcOf(b, e, g);
    if (rc === null) return fact(null, 'the rerun shows no rc');
    return rc === 0 ? fact(false, 'the unpiped rerun passed, so the pipe masked nothing') : fact(true, `the unpiped rerun failed (rc ${rc}), which the pipe would have masked`);
  }
  if (b.rule === '5' && h.live === null) {
    const r = repoFact(gitOf(g, e).filter((c) => c.sub === 'commit').map((c) => c.repo), 'the unresolved dir was a worktree or temp repo');
    return r.live === false ? r : fact(null, 'the like commit ran in a shared checkout, on a branch the transcript does not show');
  }
  return h;
}

const branchOf = (dir) => {
  const r = spawnSync('git', ['-C', dir, 'branch', '--show-current'], { encoding: 'utf8', timeout: 4000 });
  return r.status === 0 ? r.stdout.trim() : null;
};

const rule5 = new WeakMap();
/** Does checkout `g` still have rule 5 (a commit on main, cut by #368)? Probed once, on a temp repo on main. */
function hasRule5(g) {
  if (!rule5.has(g)) {
    const dir = tempRepo(true);
    try {
      rule5.set(g, ruleOf(verdictText(() => g.branchRules('git commit -m x', dir, 'Bash'))) === '5');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return rule5.get(g);
}

/** Do the checkout's rules still block it? A static rule always replays; rules 5 and 6 read the
 *  repo's branch, so they replay only while it is the one the block names (rule 6: the
 *  claude-config main checkout on main); an unresolved dir is judged before any branch. A
 *  checkout without rule 5 or 9 (cut by #368) blocks none of theirs. */
function stillBlocked(b, g) {
  if (STATIC_RULES.has(b.rule)) return ruleOf(verdictText(() => g.staticCheck(b.cmd, null, b.tool))) === b.rule;
  if ((b.rule === '5' && !hasRule5(g)) || (b.rule === '9' && typeof g.browserCommand !== 'function')) return false;
  if (b.rule === '5' || b.rule === '6') {
    const m = /^"(.+)" is on (main|master)/.exec(b.reason);
    const cfg = process.env.CLAUDE_CONFIG_REPO || join(process.env.CLAUDE_WORKSPACE_ROOT || join(homedir(), 'code'), 'claude-config');
    const faithful = b.rule === '6' ? branchOf(cfg) === 'main' : m ? branchOf(m[1]) === m[2] : true;
    if (faithful) return ruleOf(verdictText(() => g.branchRules(b.cmd, b.cwd, b.tool))) === b.rule;
  }
  return true;
}

/** Words naming each rule's act: an AskUserQuestion that holds them asks about the block. */
const ACT = {
  1: /\b(?:git add|stag(?:e|es|ed|ing)|sweep\w*|commit\w*)\b/i,
  2: /\.env\b|\bsecrets?\b/i,
  3: /\b(?:pipe\w*|unpiped|gates?|rc|exit code)\b/i,
  4: /\b(?:Set-Content|Out-File|Add-Content|encoding|BOM)\b/i,
  5: /\bcommit\w*/i,
  6: /\b(?:checkout|restore\w*|switch\w*|branch\w*|discard\w*)\b/i,
  7: /\b(?:fable|mythos|billed|FABLE OK)\b/i,
  12: /\b(?:eval|node -e|template literal|substitut\w+)\b/i,
};

/** One live block's verdict by CHECK: { verdict: 'true' | 'false' | 'undecided' | null (unsorted), why }. */
export function classify(b, g) {
  const v = (verdict, why) => ({ verdict, why });
  if (b.rule in UNSORTED) return v(null, UNSORTED[b.rule]);
  if (!stillBlocked(b, g)) return v('false', 'since fixed: the current rules no longer block it');
  let h = harm(b, g);
  if (h.live === false) return v('false', `no harm: ${h.why}`);
  let next = null;
  for (const [i, e] of b.follow.entries()) {
    // Only an ask about the block: the next call, or one naming its act.
    if (e.kind === 'ask' && (i === 0 || ACT[b.rule]?.test(e.text ?? ''))) return v('true', 'asked the user');
    if (e.kind === 'shell' && !e.blocked && like(b, e, g)) {
      next = e;
      break;
    }
  }
  if (!next) return b.rule === '3' ? v('undecided', 'no unpiped rerun of the gate to read its rc from') : v('true', 'dropped: no like call followed');
  if (bypass(b, next, g)) return v('false', 'bypass: the like call did the same thing by another route');
  h = after(b, next, g, h);
  if (h.live === false) return v('false', `no harm: ${h.why}`);
  if (h.live) return v('true', `remedy: ${h.why}, and the like call took the rule's way`);
  return v('undecided', `rephrased; ${h.why}`);
}

const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : typeof x?.text === 'string' ? x.text : '')).join('\n') : '');
/** A user record a person (or a notification) wrote, not a tool result or an injected reminder. */
const isPrompt = (o) => {
  if (o.isMeta || o.isCompactSummary) return false;
  const c = o.message?.content;
  const text = typeof c === 'string' ? c : Array.isArray(c) && !c.some((x) => x?.type === 'tool_result') ? textOf(c) : '';
  return text.trim() !== '' && !/^\s*</.test(text);
};

/** An AskUserQuestion call's questions, headers and options as one text. */
const askText = (input) =>
  (Array.isArray(input?.questions) ? input.questions : [])
    .flatMap((q) => [q?.question, q?.header, ...(Array.isArray(q?.options) ? q.options.flatMap((o) => [o?.label, o?.description]) : [])])
    .filter((x) => typeof x === 'string')
    .join(' / ');

/** Every live bash-guard block, each with the calls after it, plus the window's totals. Only
 *  assistant and user records count (an api-request-blob copies old messages), each tool_use once. */
function scanBlocks(paths) {
  const seen = new Set();
  const commands = new Map();
  const blocks = [];
  let calls = 0, first = null, last = null;
  for (const p of paths) {
    const events = [];
    const shells = new Map();
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (!line || line[0] !== '{') continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (o?.type !== 'assistant' && o?.type !== 'user') continue;
      const ts = typeof o.timestamp === 'string' ? o.timestamp : null;
      if (ts && (!first || ts < first)) first = ts;
      if (ts && (!last || ts > last)) last = ts;
      if (o.type === 'user' && isPrompt(o)) events.push({ kind: 'prompt' });
      const content = o.message?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (o.type === 'assistant' && c?.type === 'tool_use' && !seen.has(c.id)) {
          seen.add(c.id);
          if ((c.name === 'Bash' || c.name === 'PowerShell') && typeof c.input?.command === 'string') {
            calls++;
            commands.set(`${c.name}\n${c.input.command}`, { command: c.input.command, tool: c.name });
            const description = typeof c.input.description === 'string' ? c.input.description : '';
            const e = { kind: 'shell', tool: c.name, cmd: c.input.command, description, cwd: o.cwd ?? null, t: ts, blocked: false, result: '', error: false };
            shells.set(c.id, e);
            events.push(e);
          } else if (c.name === 'AskUserQuestion') events.push({ kind: 'ask', text: askText(c.input) });
          else events.push({ kind: 'tool' });
        } else if (o.type === 'user' && c?.type === 'tool_result' && shells.has(c.tool_use_id)) {
          const e = shells.get(c.tool_use_id);
          shells.delete(c.tool_use_id);
          e.result = textOf(c.content);
          e.error = c.is_error === true;
          const blk = e.error ? parseHookBlock(e.result) : null;
          e.blocked = Boolean(blk);
          if (blk?.hook === 'bash-guard.mjs') e.reason = blk.reason;
        }
      }
    }
    events.forEach((e, i) => {
      if (e.reason === undefined) return;
      const follow = [];
      for (const n of events.slice(i + 1)) {
        if (n.kind === 'prompt' || follow.length >= FOLLOW_CALLS) break;
        follow.push(n);
      }
      blocks.push({ ...e, rule: ruleOf(e.reason), follow });
    });
  }
  return { blocks, calls, first, last, commands: [...commands.values()] };
}

/** Per rule, how many unique commands the current rules would block or gate. */
function replay(commands, g) {
  const counts = {};
  const cwd = process.cwd();
  for (const { command: c, tool } of commands) {
    const hits = new Set([ruleOf(verdictText(() => g.staticCheck(c, null, tool)))]);
    if (verdictText(() => g.billedLaunch(c))) hits.add('7');
    if (verdictText(() => g.gatedVerbs(c, cwd, tool).join(' '))) hits.add('8');
    if (typeof g.browserCommand === 'function' && verdictText(() => g.browserCommand(c, cwd, tool))) hits.add('9');
    hits.delete('other');
    for (const r of hits) counts[r] = (counts[r] || 0) + 1;
  }
  return counts;
}

const code = (s) => (s.includes('`') ? `\`\` ${s} \`\`` : `\`${s}\``);
const day = (ts) => (ts ? ts.slice(0, 10) : '?');

async function byRule(args) {
  const checkout = args.paths[0] ?? join(dirname(fileURLToPath(import.meta.url)), '..');
  const g = await load(checkout);
  const files = await transcripts(projectsRoot(args.root), args);
  const { blocks, calls, first, last, commands } = scanBlocks(files);
  const subs = files.filter((f) => /[\\/]subagents[\\/]/.test(f)).length;
  const days = first ? Math.round((Date.parse(day(last)) - Date.parse(day(first))) / 864e5) + 1 : 0;
  const judged = blocks.map((b) => ({ b, ...classify(b, g) }));
  const replayed = replay(commands, g);
  const out = [
    '# bash-guard blocks by rule (guard-replay --by-rule, #368)',
    '',
    `Window: ${day(first)} → ${day(last)} (${days} days); ${files.length} transcript files (${files.length - subs} main, ${subs} subagent); ${calls} Bash/PowerShell calls; ${blocks.length} live bash-guard blocks`,
    `Replay: ${commands.length} unique commands through ${resolve(checkout)}`,
    '',
    '| rule | guards | live blocks | true | false | undecided | replay |',
    '|---|---|---|---|---|---|---|',
  ];
  const ids = [...RULES.map(([id]) => id), ...(judged.some((j) => j.b.rule === 'other') ? ['other'] : [])];
  for (const id of ids) {
    const mine = judged.filter((j) => j.b.rule === id);
    const n = (v) => (id in UNSORTED ? '—' : mine.filter((j) => j.verdict === v).length);
    const what = RULES.find(([r]) => r === id)?.[1] ?? 'unrecognised reason';
    const rep = id === '5' || id === '6' ? '—' : replayed[id] ?? 0;
    out.push(`| ${id} | ${what} | ${mine.length} | ${n('true')} | ${n('false')} | ${n('undecided')} | ${rep} |`);
  }
  out.push('', '## The check', '', ...CHECK.map((l) => `${l}\n`));
  const line = (j, verdict) => `- rule ${j.b.rule} · ${day(j.b.t)} · ${verdict ? `${j.verdict ?? 'unsorted'}: ` : ''}${j.why} · ${code(oneLine(redact(j.b.cmd), 300))}`;
  const undecided = judged.filter((j) => j.verdict === 'undecided');
  out.push(`## Undecided (${undecided.length})`, '', ...undecided.map((j) => line(j, false)));
  if (args.full) out.push('', `## Every block (${judged.length})`, '', ...judged.map((j) => line(j, true)));
  console.log(out.join('\n'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.byRule && args.paths.length <= 1 && !args.bad) return byRule(args);
  if (args.paths.length !== 2 || args.bad) {
    console.log('usage: node scripts/guard-replay.mjs <old-checkout> <new-checkout> [--branch] [--full] [--files N] [--days D] [--root <projects-dir>]');
    console.log('       node scripts/guard-replay.mjs --by-rule [<checkout>] [--full] [--files N] [--days D] [--root <projects-dir>]');
    return;
  }
  const [a, b] = await Promise.all(args.paths.map(load));
  const files = await transcripts(projectsRoot(args.root), args);
  const { commands, answers } = collect(files);
  let changed = 0;
  const cwd = process.cwd();
  // raw: the new verdict before n collapsed it; --full prints it when it says more.
  const report = (name, o, n, text, raw = n) => {
    if (o === n) return;
    changed++;
    console.log(`${name}: ${redact(o)} -> ${redact(n)} | ${oneLine(redact(text))}`);
    if (!args.full) return;
    console.log(`  command:\n${redact(text).replace(/\r\n?/g, '\n').trimEnd().replace(/^/gm, '    ')}`);
    if (raw !== n) console.log(`  reason: ${redact(raw)}`);
  };

  const cmdFns = [
    ['staticCheck', (m, c, tool) => verdict(m.staticCheck, c, null, tool)],
    ['gatedVerbs', (m, c, tool) => verdict(m.gatedVerbs, c, cwd, tool)],
  ];
  for (const { command: c, tool } of commands) for (const [name, f] of cmdFns) report(name, f(a, c, tool), f(b, c, tool), c);

  const ansFns = [
    ['isApproving', (m, x) => verdict(m.isApproving, x)],
    ['isBrowserApproving', (m, x) => verdict(m.isBrowserApproving, x)],
  ];
  for (const x of answers) for (const [name, f] of ansFns) report(name, f(a, x), f(b, x), Object.values(x).join(' / '));

  let branch = '';
  if (args.branch) {
    const repos = { unborn: tempRepo(false), born: tempRepo(true) };
    try {
      const before = changed;
      // One JSON string per call, or the lone missing/throws verdict.
      const shapes = (m, c, tool) => {
        const v = verdict((x) => callShape(m.gitCalls(m.scrub(x), repos.unborn, tool), repos.unborn).map((g) => JSON.stringify(g)), c);
        return v.startsWith('[') ? JSON.parse(v) : [v];
      };
      for (const { command: c, tool } of commands) {
        const [o, n] = [shapes(a, c, tool), shapes(b, c, tool)];
        for (let i = 0; i < Math.max(o.length, n.length); i++) report(`gitCalls#${i}`, o[i] ?? 'none', n[i] ?? 'none', c);
      }
      const calls = changed - before;
      for (const [label, dir] of Object.entries(repos)) {
        for (const { command: c, tool } of commands) {
          const [o, n] = [verdict(a.branchRules, c, dir, tool), verdict(b.branchRules, c, dir, tool)];
          report(`branchRules[${label}]`, allowBlock(o), allowBlock(n), c, n);
        }
      }
      branch = `; --branch: ${calls} gitCalls, ${changed - before - calls} branchRules over ${commands.length * 2} probes (unborn + born)`;
    } finally {
      for (const dir of Object.values(repos)) rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log(`summary: ${changed} changed; ${commands.length} commands, ${answers.length} answers from ${files.length} files${branch}`);
}

if (isMain(import.meta.url)) main().catch((e) => console.log(`guard-replay failed: ${e?.message}`));
