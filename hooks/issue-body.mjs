// issue-body.mjs — bash-guard rule 13's logic (#388): an issue body is only
// ticked or added to. The line comparator, the shell reading of a
// `gh issue edit` call's body, the approval predicates for a rewrite, and the
// live-body and repo readers. bash-guard.mjs owns the glue (parsing,
// transcript, spend).

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
 *  ignored. Un-ticking, re-indenting and reordering are rewording. A line
 *  hidden in an HTML comment (see hidden) matches no live line outside one:
 *  wrapping a box in `<!-- … -->` loses it (#419). */
export function bodyChange(live, next) {
  const lines = (s) => hidden(String(s).replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd()));
  const have = lines(next);
  let j = 0;
  for (const { text: line, hid } of lines(live).filter((l) => l.text.trim())) {
    const m = TASK.exec(line);
    const ok = ({ text: l, hid: h }) => (hid || !h) && (l === line || (m !== null && (l === `${m[1]}[x]${m[3]}` || l === `${m[1]}[X]${m[3]}`)));
    while (j < have.length && !ok(have[j])) j++;
    if (j === have.length) return { line };
    j++;
  }
  return null;
}

/** Each line as `{ text, hid }`: `hid` when it starts inside an HTML comment,
 *  or opens one first thing (`<!--` past its indent). A comment runs to the
 *  first `-->` after its `<!--`, across lines; one that starts its line and is
 *  never closed runs to the end, but a mid-line `<!--` with no `-->` after it
 *  is plain text. A `<!--` inside an inline code span or a fenced code block opens nothing. */
function hidden(lines) {
  let open = false;
  let fence = null;
  // A `-->` after offset `at` of line `n`, or on a later line.
  const closes = (n, at) => lines[n].indexOf('-->', at) >= 0 || lines.slice(n + 1).some((l) => l.includes('-->'));
  return lines.map((text, n) => {
    if (!open) {
      const f = /^\s*(`{3,}|~{3,})/.exec(text);
      if (fence) {
        if (f && f[1][0] === fence[0] && f[1].length >= fence.length && /^\s*[`~]+\s*$/.test(text)) fence = null;
        return { text, hid: false };
      }
      if (f) {
        fence = f[1];
        return { text, hid: false };
      }
    }
    const hid = open || text.trimStart().startsWith('<!--');
    const first = open ? -1 : text.length - text.trimStart().length;
    for (let at = 0; ; ) {
      if (open) {
        const i = text.indexOf('-->', at);
        if (i < 0) break;
        at = i + 3;
        open = false;
        continue;
      }
      const m = /<!--|`+/g;
      m.lastIndex = at;
      const f = m.exec(text);
      if (!f) break;
      if (f[0] === '<!--') {
        at = f.index + 4;
        open = first === f.index || closes(n, at);
      } else {
        const close = text.indexOf(f[0], f.index + f[0].length);
        at = close < 0 ? f.index + f[0].length : close + f[0].length;
      }
    }
    return { text, hid };
  });
}

// A substitution or variable the shell expands: `…`, $(…), ${…}, $name, $1.
const EXPANDS = /`|\$[\w{(@*#?!$-]/;

/** The literal text a shell word (`raw`, quotes kept) passes, or null when the
 *  shell would expand part of it — the guard can't know that text. Single
 *  quotes are literal; in bash a double-quoted `\"`, `\\`, `\$` or `` \` ``
 *  unescapes and a backslash-newline is dropped, both characters (#419). A bare word is read as written — a Windows path's backslashes
 *  stay (where bash strips them, gh reads a path that isn't there and fails).
 *  A bare `$` before a quote (`$'…'`) is unreadable. In PowerShell a `''`
 *  inside single quotes is one literal `'`. */
export function literal(raw, tool = null) {
  const bash = tool !== 'PowerShell';
  const re = bash ? /"((?:[^"\\]|\\[\s\S])*)"|'([^']*)'|([^\s"']+)/g : /"((?:[^"\\]|\\[\s\S])*)"|'((?:[^']|'')*)'|([^\s"']+)/g;
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
    out += bash && m[1] !== undefined ? s.replace(/\\([\\"$`\n])/g, (_, ch) => (ch === '\n' ? '' : ch)) : s;
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

/** A target word as `{ number, repo, host }` (`N`, `#N`, or an issue URL,
 *  whose repo is `owner/repo` on github.com, else `host/owner/repo`), or
 *  null. `host` is the host the target names, null for a bare number. */
function target(word) {
  const n = /^#?(\d+)$/.exec(word);
  if (n) return { number: n[1], repo: null, host: null };
  const u = ISSUE_URL.exec(word);
  if (!u) return null;
  const host = u[1].toLowerCase();
  return { number: u[4], repo: host === 'github.com' ? `${u[2]}/${u[3]}` : `${u[1]}/${u[2]}/${u[3]}`, host };
}

/** The host a `-R` value names: `host` of `host/owner/repo`, else null (gh's default host, which GH_HOST sets). */
const repoHost = (repo) => (repo.split('/').length === 3 ? repo.split('/')[0].toLowerCase() : null);

/** A gh call's body edit, read from its args (`args`, unquoted, after `gh`)
 *  and the same words with quotes kept (`raw`, null when they couldn't be
 *  lined up): null unless it is `gh issue edit` with -b/--body or
 *  -F/--body-file; else `{ targets, body }`. `targets` holds one
 *  `{ number, repo, host }` per issue named (see target), null for a word the
 *  guard can't read as one (an empty list names none); `-R`/`--repo` beats a
 *  URL's repo and host.
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
    return t && repo ? { ...t, repo, host: repoHost(repo) } : t;
  });
  return { targets, body };
}

// `gh api`'s options that take a value, its field flags (key=value) among them.
const API_VALUE = new Set(['-X', '--method', '-f', '--raw-field', '-F', '--field', '-H', '--header', '--input', '-q', '--jq', '-t', '--template', '--hostname', '-p', '--preview', '--cache']);
const API_FIELD = new Set(['-f', '--raw-field', '-F', '--field']);
const API_SHORT = /^(-[XfFHqtp])(.+)$/s;
// A REST endpoint naming one issue, no further segment: owner, repo and number
// may each be literal, a `{owner}`/`{repo}` placeholder or a `$var`.
const ISSUE_ENDPOINT = /^(?:https?:\/\/[^/\s]+(?:\/api\/v3)?)?\/?repos\/[^/\s]+\/[^/\s]+\/issues\/([^/?#\s]+)\/?(?:[?#].*)?$/s;
// A field key that is, or may be, `body`.
const BODY_KEY = /^body$|[$`]/;

/** A `gh api` call that may write an issue body, read from its args (`args`,
 *  unquoted, after `gh`) and `raw` (as bodyEdit): null unless it is one.
 *  `{ n }` for a REST write of issue `n` (its number word as written): a body
 *  field (`-f`/`-F`/`--field`/`--raw-field` `body=…`) or `--input`, with a
 *  method other than GET. `{ queries, keys }` for a graphql call: each query
 *  field's value as `{ text }`, `{ file }` (`query=@file`) or `{ why }` when
 *  it can't be read, and the call's other field keys. */
export function apiCall(args, raw, tool = null) {
  const at = args.findIndex((a) => !a.startsWith('-'));
  if (args[at] !== 'api') return null;
  let endpoint = null;
  let method = null;
  let input = false;
  const fields = []; // { key, i, prefix }: field word `i`, its key=value past `prefix` characters
  for (let i = at + 1; i < args.length; i++) {
    const a = args[i];
    if (REDIRECT.test(a)) {
      if (REDIRECT_ALONE.test(a)) i++;
      continue;
    }
    const eq = a.indexOf('=');
    const short = API_SHORT.exec(a);
    let flag;
    let prefix = 0;
    if (a.startsWith('--') && eq > 0 && API_VALUE.has(a.slice(0, eq))) [flag, prefix] = [a.slice(0, eq), eq + 1];
    else if (API_VALUE.has(a)) [flag, i] = [a, i + 1];
    else if (short && !a.startsWith('--')) [flag, prefix] = [short[1], 2];
    else {
      if (!a.startsWith('-') && endpoint === null) endpoint = a;
      continue;
    }
    if (flag === '--input') input = true;
    if (i >= args.length) continue;
    const v = args[i].slice(prefix);
    if (flag === '-X' || flag === '--method') method = v;
    else if (API_FIELD.has(flag)) fields.push({ key: v.split('=')[0], i, prefix });
  }
  const rest = ISSUE_ENDPOINT.exec(endpoint ?? '');
  if (rest) return (input || fields.some((f) => BODY_KEY.test(f.key))) && !/^get$/i.test(method ?? '') ? { n: rest[1] } : null;
  if (!/^(?:https?:\/\/[^/\s]+(?:\/api)?)?\/?graphql$/.test(endpoint ?? '')) return null;
  const queries = fields
    .filter((f) => f.key === 'query')
    .map(({ i, prefix }) => {
      if (raw === null) return { why: "the guard couldn't line up its words" };
      const lit = literal(raw[i] ?? '', tool);
      if (lit === null) return { why: "its query holds a shell substitution or variable, which the guard can't read" };
      const text = lit.slice(prefix + 'query='.length);
      if (text === '@-') return { why: "its query comes from stdin (`query=@-`), which the guard can't read" };
      return text.startsWith('@') ? { file: text.slice(1) } : { text };
    });
  if (input) queries.push({ why: "its request comes from --input, which the guard doesn't read" });
  return { queries, keys: fields.filter((f) => f.key !== 'query').map((f) => f.key) };
}

/** A graphql query that writes an issue body: an `updateIssue` mutation with
 *  `body` in the query or in a field key (`-F input[body]=…`). */
export const gqlBodyWrite = (query, keys = []) => /\bupdateIssue\b/.test(query) && (/\bbody\b/.test(query) || keys.some((k) => /\bbody\b/.test(k)));

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

// A repo as an approval names it: `owner/repo`, or `host/owner/repo`.
const REPO_REF = String.raw`[\w.-]+(?:\/[\w.-]+){1,2}`;
// `owner/repo#N` in a typed prompt, read as `#N` for its word check.
const REPO_HASH = new RegExp(String.raw`(?<![\w./-])${REPO_REF}(#\d+)`, 'g');

/** A repo, compared: lowercase, and github.com's own host dropped (`github.com/o/r` is `o/r`). */
export const repoKey = (repo) => repo.toLowerCase().replace(/^github\.com\//, '');

/** latestApproval's predicates for a rewrite of issue `n`. Each returns false,
 *  or the repos it approves #N in: one per naming, `repoKey` of the repo
 *  named beside the number (`owner/repo#N`, a URL `…/owner/repo/issues/N`),
 *  or null for a bare `#N`/`issues/N` (the approving record's dir's repo).
 *  An answer approves a naming that an act precedes within one clause
 *  ("Rewrite the body of #12", not "Rewrite #13, keep #12"), with no refusal.
 *  A typed prompt approves when it is printable ASCII with no `?`, names
 *  `#N` (or `owner/repo#N`), has an act, and every other word is a body word
 *  or another `#M` ("rewrite #12", "ok, reword other/repo#12 and #13
 *  please"). Either way rewrite/reword is enough alone; another act needs the
 *  text to say body, spec or done-when ("fix the body of #12"). */
export function bodyApproval(n) {
  const naming = new RegExp(String.raw`(?:https?:\/\/|(?<![\w./-]))(${REPO_REF})(?:#|\/issues\/)${n}\b|(?:#|\bissues\/)${n}\b`, 'gi');
  const actBefore = (acts) => new RegExp(String.raw`\b(?:${acts})\b(?:(?!${CLAUSE_BREAK})[\s\S])*$`, 'i');
  const rewrites = actBefore(REWRITE_ACT);
  const acts = actBefore(ACTS);
  // The repos `text` names #N in, each naming kept only when `before` reads its preceding text.
  const named = (text, before = null) =>
    [...text.matchAll(naming)].filter((m) => !before || before.test(text.slice(0, m.index))).map((m) => (m[1] ? repoKey(m[1]) : null));
  const strong = (text) => REWRITE_ACT_RE.test(text) || BODY_NOUN.test(text);
  const some = (repos) => (repos.length ? repos : false);
  return {
    answers: (answers) =>
      some(
        Object.values(answers).flatMap((value) => {
          const v = String(value);
          return denies(v, BODY_ACT_RE) ? [] : named(v, BODY_NOUN.test(v) ? acts : rewrites);
        }),
      ),
    prompt: (text) => {
      const words = (text.replace(REPO_HASH, '$1').match(/#?[\w'’]+/g) || []).map((w) => w.toLowerCase());
      return (
        /^[\t\n\r\x20-\x7e]*$/.test(text) &&
        !text.includes('?') &&
        words.includes(`#${n}`) &&
        words.every((w) => BODY_WORDS.has(w) || /^#\d+$/.test(w)) &&
        words.some((w) => BODY_ACT_RE.test(w)) &&
        strong(text) &&
        some(named(text))
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

/** The repo gh resolves in `cwd` — `owner/repo`, or `host/owner/repo` off
 *  github.com — or null when gh can't tell. `CLAUDE_ISSUE_BODY_REPO_STUB`
 *  is a literal repo to answer instead (hook-process probes; never gh). */
export function issueRepoOf(cwd) {
  const stub = process.env.CLAUDE_ISSUE_BODY_REPO_STUB;
  if (stub) return stub;
  const r = spawnSync('gh', ['repo', 'view', '--json', 'url', '--jq', '.url'], { cwd: cwd || undefined, encoding: 'utf8', timeout: 10000, windowsHide: true });
  const u = r.status === 0 && !r.error ? /^https?:\/\/([^/\s]+)\/([^/\s]+)\/([^/\s]+?)\/?$/.exec(r.stdout.trim()) : null;
  return u ? repoKey(`${u[1]}/${u[2]}/${u[3]}`) : null;
}
