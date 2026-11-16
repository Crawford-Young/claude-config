// issue-body.mjs — bash-guard rule 13's logic (#388): an issue body is only
// ticked or added to. The line comparator, the shell reading of a
// `gh issue edit` call's body, the approval predicates for a rewrite, and the
// live-body reader. bash-guard.mjs owns the glue (parsing, transcript, spend).

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudeDir, denies } from './_hooklib.mjs';

/** Rule 13's spend state: apart from the push gate's file, whose entries can be bound objects. */
export const issueBodyStateFile = () => process.env.CLAUDE_ISSUE_BODY_STATE || join(claudeDir, 'issue-body-approvals.json');

// A task item (bulleted or ordered): its indent and bullet, its box, then its text.
const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](.*)$/;

/** The first non-blank line of `live` that `next` drops or rewords, as
 *  `{ line }`, or null. Each must be matched in order by an equal line of
 *  `next`, or a task item by itself ticked (`[x]`/`[X]`, so a ticked box may
 *  change case); added lines pass anywhere. CRLF and trailing whitespace are
 *  ignored. Un-ticking, re-indenting and reordering are rewording. */
export function bodyChange(live, next) {
  const lines = (s) => String(s).replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd());
  const have = lines(next);
  let j = 0;
  for (const line of lines(live).filter((l) => l.trim())) {
    const m = TASK.exec(line);
    const ok = (l) => l === line || (m !== null && (l === `${m[1]}[x]${m[3]}` || l === `${m[1]}[X]${m[3]}`));
    while (j < have.length && !ok(have[j])) j++;
    if (j === have.length) return { line };
    j++;
  }
  return null;
}

// A substitution or variable the shell expands: `…`, $(…), ${…}, $name, $1.
const EXPANDS = /`|\$[\w{(@*#?!$-]/;

/** The literal text a shell word (`raw`, quotes kept) passes, or null when the
 *  shell would expand part of it — the guard can't know that text. Single
 *  quotes are literal; in bash a double-quoted `\"`, `\\`, `\$` or `` \` ``
 *  unescapes. A bare word is read as written — a Windows path's backslashes
 *  stay (where bash strips them, gh reads a path that isn't there and fails).
 *  A bare `$` before a quote (`$'…'`) is unreadable. In PowerShell a `''`
 *  inside single quotes is one literal `'`. */
export function literal(raw, tool = null) {
  const bash = tool !== 'PowerShell';
  const re = bash ? /"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s"']+)/g : /"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([^\s"']+)/g;
  let out = '';
  for (const m of String(raw).matchAll(re)) {
    if (m[2] !== undefined) {
      out += bash ? m[2] : m[2].replace(/''/g, "'");
      continue;
    }
    const s = m[1] ?? m[3];
    // A bash double-quoted `\$` or `` \` `` is escaped: it expands nothing.
    const live = bash && m[1] !== undefined ? s.replace(/\\[\s\S]/g, '') : s;
    if (EXPANDS.test(live) || (m[3] !== undefined && s.endsWith('$'))) return null;
    out += bash && m[1] !== undefined ? s.replace(/\\([\\"$`\n])/g, '$1') : s;
  }
  return out;
}

// `gh issue edit`'s options that take a value (the rest are switches).
const VALUE = new Set(['-b', '--body', '-F', '--body-file', '-t', '--title', '-m', '--milestone', '-R', '--repo', '--add-assignee', '--remove-assignee', '--add-label', '--remove-label', '--add-project', '--remove-project', '--type', '--parent', '--add-blocked-by', '--remove-blocked-by', '--add-blocking', '--remove-blocking', '--add-sub-issue', '--remove-sub-issue']);
const SHORT_VALUE = /^(-[bFtmR])=?(.+)$/s;
// A redirect (`2>&1`, `>out`, `<<'EOF'`), and one whose target is the next word (`>`, `2>>`, `<<`).
const REDIRECT = /^(?:\d*|&)[<>]/;
const REDIRECT_ALONE = /^(?:\d*|&)(?:>>?|>\||<<?<?-?)$/;
const ISSUE_URL =/^https?:\/\/([^/\s]+)\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)\/?(?:[?#].*)?$/;

/** A target word as `{ number, repo }` (`N`, `#N`, or an issue URL, whose
 *  repo is `owner/repo` on github.com, else `host/owner/repo`), or null. */
function target(word) {
  const n = /^#?(\d+)$/.exec(word);
  if (n) return { number: n[1], repo: null };
  const u = ISSUE_URL.exec(word);
  if (!u) return null;
  return { number: u[4], repo: u[1].toLowerCase() === 'github.com' ? `${u[2]}/${u[3]}` : `${u[1]}/${u[2]}/${u[3]}` };
}

/** A gh call's body edit, read from its args (`args`, unquoted, after `gh`)
 *  and the same words with quotes kept (`raw`, null when they couldn't be
 *  lined up): null unless it is `gh issue edit` with -b/--body or
 *  -F/--body-file; else `{ targets, body }`. `targets` holds one
 *  `{ number, repo }` per issue named, null for a word the guard can't read
 *  as one (an empty list names none); `-R`/`--repo` beats a URL's repo.
 *  `body` is `{ text }`, `{ file }`, or `{ why }` when it can't be read.
 *  gh takes the last body flag; a body flag with no value word is an empty
 *  body (or an unread file), never no edit. An unquoted word starting `#` opens a shell
 *  comment: it and every word after it are no part of the call. */
export function bodyEdit(args, raw, tool = null) {
  const comment = raw === null ? -1 : raw.findIndex((r) => r.startsWith('#'));
  if (comment >= 0) {
    args = args.slice(0, comment);
    raw = raw.slice(0, comment);
  }
  const nonFlag = args.filter((a, i, all) => !a.startsWith('-') && !/^(?:-R|--repo)$/.test(all[i - 1]));
  if (nonFlag[0] !== 'issue' || nonFlag[1] !== 'edit') return null;
  const why = (what) => `its ${what} holds a shell substitution or variable, which the guard can't read`;
  let positional = 0;
  let body = null;
  let repo = null; // a string, or { why }
  const words = [];
  // Flag `flag`'s value: word `i`, past its first `prefix` characters (`--body=`).
  const value = (flag, i, prefix) => {
    const lit = raw === null ? null : literal(raw[i] ?? '', tool);
    const v = lit === null ? null : lit.slice(prefix);
    const unread = raw === null ? "the guard couldn't line up its words" : null;
    if (flag === '-b' || flag === '--body') body = v === null ? { why: unread ?? why('--body value') } : { text: v };
    else if (flag === '-F' || flag === '--body-file') {
      body = v === null ? { why: unread ?? why('--body-file path') } : v === '-' ? { why: "its new body comes from stdin (`--body-file -`), which the guard can't read" } : { file: v };
    } else if (flag === '-R' || flag === '--repo') repo = v === null ? { why: unread ?? why('--repo value') } : v;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      words.push(...args.slice(i + 1));
      break;
    }
    if (REDIRECT.test(a)) {
      if (REDIRECT_ALONE.test(a)) i++;
      continue;
    }
    const eq = a.indexOf('=');
    const short = SHORT_VALUE.exec(a);
    if (a.startsWith('--') && eq > 0 && VALUE.has(a.slice(0, eq))) value(a.slice(0, eq), i, eq + 1);
    else if (VALUE.has(a)) {
      if (i + 1 < args.length) value(a, ++i, 0);
      // No value word: the parse drops a trailing empty one (`--body ''`), so it reads as an empty body.
      else if (a === '-b' || a === '--body') body = { text: '' };
      else if (a === '-F' || a === '--body-file') body = { why: 'its --body-file names no file' };
    } else if (short && !a.startsWith('--')) value(short[1], i, a.length - short[2].length);
    else if (!a.startsWith('-') && positional++ >= 2) words.push(a);
  }
  if (!body) return null;
  if (repo?.why) return { targets: [null], body: repo };
  const targets = words.map((w) => {
    const t = target(w);
    return t && repo ? { ...t, repo } : t;
  });
  return { targets, body };
}

/** Rule 13's acts: what a rewrite approval says it allows. */
const ACTS = 'rewrite|reword|edit|update|change|replace|fix|correct';
export const BODY_ACT_RE = new RegExp(String.raw`\b(${ACTS})\b`, 'i');
const BODY_WORDS = new Set(
  'rewrite reword edit update change replace fix correct body spec issue done when it its the this that a an and ok okay yes yep yeah sure go ahead please lgtm approved fine now'.split(' '),
);

// The acts that approve a rewrite on their own; the others (a work direction
// as often as a rewrite: "fix #12") approve only beside BODY_NOUN.
const REWRITE_ACT = 'rewrite|reword';
const REWRITE_ACT_RE = new RegExp(String.raw`\b(?:${REWRITE_ACT})\b`, 'i');
const BODY_NOUN = /\b(?:body|spec|done-when)\b/i;
// Ends an answer's clause: `,` `;`, a `.` or `:` before a space or the end
// (a URL's are no break), or but/keep/not.
const CLAUSE_BREAK = String.raw`[,;]|[.:](?:\s|$)|\b(?:but|keep|not)\b`;

/** latestApproval's predicates for a rewrite of issue `n`. An answer approves
 *  when an act precedes its naming of the issue (`#N` or `issues/N`,
 *  word-bounded) within one clause ("Rewrite the body of #12", not "Rewrite
 *  #13, keep #12"), with no refusal. A typed prompt approves when it is
 *  printable ASCII with no `?`, names `#N`, has an act, and every other word
 *  is a body word or another `#M` ("rewrite #12", "ok, reword #12 and #13
 *  please"). Either way rewrite/reword is enough alone; another act needs the
 *  text to say body, spec or done-when ("fix the body of #12"). */
export function bodyApproval(n) {
  const near = (acts) => new RegExp(String.raw`\b(?:${acts})\b(?:(?!${CLAUSE_BREAK})[\s\S])*?(?:#|\bissues/)${n}\b`, 'i');
  const rewrites = near(REWRITE_ACT);
  const acts = near(ACTS);
  const strong = (text) => REWRITE_ACT_RE.test(text) || BODY_NOUN.test(text);
  return {
    answers: (answers) =>
      Object.values(answers).some((value) => {
        const v = String(value);
        return (rewrites.test(v) || (acts.test(v) && BODY_NOUN.test(v))) && !denies(v, BODY_ACT_RE);
      }),
    prompt: (text) => {
      const words = (text.match(/#?[\w'’]+/g) || []).map((w) => w.toLowerCase());
      return (
        /^[\t\n\r\x20-\x7e]*$/.test(text) &&
        !text.includes('?') &&
        words.includes(`#${n}`) &&
        words.every((w) => BODY_WORDS.has(w) || /^#\d+$/.test(w)) &&
        words.some((w) => BODY_ACT_RE.test(w)) &&
        strong(text)
      );
    },
    act: BODY_ACT_RE,
  };
}

/** The live body of issue `number` (in `repo`, else the repo gh resolves
 *  from `cwd`), or null when gh can't read it. `CLAUDE_ISSUE_BODY_STUB`
 *  names a file to read instead (hook-process probes; never the network). */
export function liveIssueBody({ number, repo, cwd }) {
  const stub = process.env.CLAUDE_ISSUE_BODY_STUB;
  if (stub) return readFileSync(stub, 'utf8');
  const r = spawnSync('gh', ['issue', 'view', String(number), ...(repo ? ['-R', repo] : []), '--json', 'body', '--jq', '.body'], {
    cwd: cwd || undefined,
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
  return r.status === 0 && !r.error ? r.stdout.replace(/\n$/, '') : null;
}
