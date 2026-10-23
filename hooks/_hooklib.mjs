// Shared plumbing for claude-config hooks (Node ports of the old .ps1 set).
//
// Contract (Claude Code hooks): JSON payload on stdin; exit 0 = proceed,
// exit 2 = block with the reason on stderr. Every hook is FAIL-OPEN by
// default: an internal error logs to ~/.claude/hook-errors.log and exits 0 so
// a broken hook never wedges work. A *guard* may opt into `failClosed` (see
// run(); bash-guard does) — a guard that crashed has checked nothing, and a
// silent allow there is invisible, where a block is not. H21 is the case in
// point: a BOM on stdin disarmed bash-guard and nothing said so.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, dirname, resolve } from 'node:path';

export const claudeDir = join(homedir(), '.claude');

const WRAPPERS = new Set(['sudo', 'time', 'env']); // env's VAR=value args fall to the assignment strip
const READERS = new Set(['cat', 'head', 'tail', 'less', 'more', 'bat', 'nl', 'sed', 'awk', 'type', 'gc', 'get-content']);

/** Skills read through the shell (#103, #117): the names in `skills/<name>/SKILL.md`
 *  (and `INDEX` for `skills/INDEX.md`) that a reader verb (cat, head, sed,
 *  Get-Content, ...) names in its own command segment (split on ; && || | and
 *  newlines, leading VAR=value skipped). grep/echo/wc/cp/node naming the file
 *  read nothing for the model. Either slash direction, any path prefix.
 *  Deduped, in order. */
export function shellSkillReads(command) {
  const names = [];
  for (const seg of String(command ?? '').split(/[;&|\r\n]+/)) {
    const toks = seg.trim().replace(/^[({\s]+/, '').replace(/^\$\w+\s*=\s*/, '').replace(/^[({\s]+/, '').split(/\s+/);
    while (/^\w+=/.test(toks[0] ?? '') || WRAPPERS.has((toks[0] ?? '').toLowerCase())) toks.shift();
    const verb = (toks[0] ?? '').replace(/^.*[\\/]/, '').toLowerCase().replace(/\.exe$/, '');
    if (!READERS.has(verb)) continue;
    for (const m of seg.matchAll(/skills[\\/]+(?:([\w.-]+)[\\/]+SKILL\.md|(INDEX)\.md)(?![\w.-])/gi)) names.push(m[1] ?? m[2]);
  }
  return [...new Set(names)];
}
export const errorLog = join(claudeDir, 'hook-errors.log');

// ---- billed-model clearance (shared by every gate on a usage-billed act) ----
// agent-model-guard (Agent dispatch), pre-model-switch (/model) and bash-guard
// (shell-launched `claude`) must agree on what "billed" means and spend the same
// single-use marker — one "FABLE OK" authorises one billed act, whichever gate
// it passes through. Naming a family before it is reachable is free; adding it
// late costs one unclearanced billed run on the day it ships (H55).
export const BILLED_MODEL = /fable|mythos/;
export const clearanceFile = join(claudeDir, 'fable-clearance.json');
export const dispatchLog = join(claudeDir, 'fable-dispatch.log');
const CLEARANCE_MS = 30 * 60 * 1000;

/** Spend the user's clearance marker. True when it existed and was granted
 *  within the window; the marker is deleted either way (single use). */
export function consumeClearance() {
  try {
    if (!existsSync(clearanceFile)) return false;
    const marker = JSON.parse(readFileSync(clearanceFile, 'utf8'));
    unlinkSync(clearanceFile);
    return Date.now() - Date.parse(marker.granted) < CLEARANCE_MS;
  } catch {
    return false;
  }
}

/** One audit line per billed-act decision. Best-effort — never throws. */
export function logBilled(line) {
  try {
    appendTrimmed(dispatchLog, `${new Date().toISOString()} ${line}`);
  } catch {
    // audit trail is best-effort — logging never throws into a gate
  }
}

export function readPayload() {
  // A UTF-8 BOM is legal on the wire and fatal to JSON.parse — strip it before
  // parsing, or the guard fails open on a payload that is otherwise valid.
  const raw = readFileSync(0, 'utf8').replace(/^\uFEFF/, '');
  return raw.trim() ? JSON.parse(raw) : {};
}

export function logError(hook, err) {
  try {
    appendTrimmed(errorLog, `${new Date().toISOString()} ${hook}: ${err && err.stack ? err.stack : err}`);
  } catch {
    // nowhere left to report — logging never throws into the caller
  }
}

export function block(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

export function allow() {
  process.exit(0);
}

/** Run a hook body. Supports async bodies; anything that didn't explicitly block
 *  proceeds. Fail-open by default. `failClosed: true` (guards only) turns an
 *  internal error into a block, so a guard that never ran says so out loud
 *  instead of waving the action through. */
export function run(hookName, fn, { failClosed = false } = {}) {
  Promise.resolve()
    .then(() => fn(readPayload()))
    .catch((err) => {
      logError(hookName, err);
      if (failClosed) {
        block(
          `${hookName} failed before it could check this action (${err?.message || err}) — this guard fails closed, so the action is blocked rather than silently allowed. Fix hooks/${hookName}.mjs with the Edit tool (a guard wired on the file tools fails open for them, so the fix stays reachable) or ask the user; the trace is in ~/.claude/hook-errors.log.`,
        );
      }
    })
    .finally(() => process.exit(0));
}

/** Append a line to a log file, creating dirs; self-trim to keep the tail. */
export function appendTrimmed(file, line, { maxBytes = 512 * 1024, keepLines = 200 } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${line}\n`);
  try {
    if (statSync(file).size > maxBytes) {
      const lines = readFileSync(file, 'utf8').split('\n');
      writeFileSync(file, lines.slice(-keepLines).join('\n'));
    }
  } catch {
    // trim is best-effort
  }
}

// ---- user-approval gates (bash-guard push/PR, browser-gate) -----------------
// Approval is the user's most recent AskUserQuestion answer (or typed prompt),
// read from the session transcript. Claude Code writes that file, but so could
// the model — one appended line would read as approval — so bash-guard refuses
// any write it can see into a transcript or a gate's state file (#190,
// isGateRecord). Shared so every gate reads approvals, and refusals, alike.

export const browserGateStateFile = () => process.env.CLAUDE_BROWSER_GATE_STATE || join(claudeDir, 'browser-gate-sessions.json');
export const pushGateStateFile = () => process.env.CLAUDE_PUSH_GATE_STATE || join(claudeDir, 'push-gate-approvals.json');

/** A path as one comparable string: forward slashes, absolute, lowercased —
 *  case-folded everywhere, since a Windows path matches in any case and a
 *  Linux false match under ~/.claude costs only a refused write. */
const normPath = (p) => resolve(String(p).replaceAll('\\', '/')).replaceAll('\\', '/').toLowerCase();
const under = (p, root) => p === root || p.startsWith(`${root}/`);

const gateStates = () =>
  [clearanceFile, browserGateStateFile(), pushGateStateFile(), join(claudeDir, 'browser-gate-sessions.json'), join(claudeDir, 'push-gate-approvals.json')].map(normPath);

/** One glob path segment (`*.md`, `push-*`, `a[bc]`) as an anchored RegExp.
 *  A `[` with no closing `]` is a literal (`draft[1.txt`), and a class the
 *  engine rejects (`[z-a]`) matches anything, so a refusal errs toward the
 *  gate and a typo'd name never crashes a fail-closed guard. */
function segmentRe(glob) {
  let src = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    const close = ch === '[' ? glob.indexOf(']', i + 2) : -1;
    if (ch === '*') src += '[^/]*';
    else if (ch === '?') src += '[^/]';
    else if (close !== -1) {
      src += `[${glob.slice(i + 1, close).replace(/^!/, '^').replaceAll('\\', '\\\\')}]`;
      i = close;
    } else src += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  try {
    return new RegExp(`^${src}$`);
  } catch {
    return /^/;
  }
}

/** The glob in `n` (normalised) split as { dir, name }: `dir` the part before
 *  the segment holding the first wildcard, `name` the rest; null for no glob. */
function globParts(n) {
  const glob = n.search(/[*?[]/);
  if (glob === -1) return null;
  const dir = n.slice(0, n.lastIndexOf('/', glob)) || '/';
  return { dir, name: n.slice(dir.length + 1) };
}

/** Could a last-segment glob `re` in `dir` name `f` or a dir on its way down
 *  (`~/*` names `~/.claude`, `~/.claude/*.json` a state file)? */
const globReaches = (re, dir, f) => under(f, dir) && f !== dir && re.test(f.slice(dir.length + 1).split('/')[0]);

/** Is `p` (absolute) a file the approval gates trust — a session transcript
 *  (`*.jsonl` anywhere under a projects dir, subagent ones included) or a gate
 *  state file (push spends, browser grants, the billed-model clearance)? A
 *  `dirTarget` (a cp/mv destination) counts anywhere under a projects dir; a
 *  `tree` (a dir a copy lands as: `cp -r bk/.claude ~/`) counts when it holds
 *  one. A glob counts when it could reach one: a last-segment glob is matched
 *  against the names on the way (`~/.claude/*.md` can't reach a state file,
 *  `~/*.md` can't reach `.claude`), and inside a projects dir it counts
 *  unless its name ends in a literal extension other than `.jsonl`. The
 *  auto-memory dirs (`projects/<slug>/memory/`) stay writable. #190. */
export function isGateRecord(p, dirTarget = false, tree = false) {
  const env = process.env;
  const roots = [join(claudeDir, 'projects'), env.CLAUDE_CONFIG_DIR && join(env.CLAUDE_CONFIG_DIR, 'projects'), env.CLAUDE_PROJECTS_DIR]
    .filter(Boolean)
    .map(normPath);
  const states = gateStates();
  const n = normPath(p);
  const inMemory = (q, root) => q.slice(root.length).split('/').includes('memory');
  const g = globParts(n);
  if (g && g.name.includes('/')) {
    return [...states, ...roots].some((f) => under(f, g.dir)) || roots.some((r) => under(g.dir, r) && !inMemory(g.dir, r));
  }
  if (g) {
    const re = segmentRe(g.name);
    if ([...states, ...roots].some((f) => globReaches(re, g.dir, f))) return true;
    const root = roots.find((r) => under(g.dir, r));
    return !!root && !inMemory(g.dir, root) && (dirTarget || tree || !/\.(?!jsonl$)[^.*?[\]/]+$/.test(g.name));
  }
  if (states.includes(n)) return true;
  if (tree && [...states, ...roots].some((f) => under(f, n))) return true;
  const root = roots.find((r) => under(n, r));
  if (!root || inMemory(n, root)) return false;
  return dirTarget || n.endsWith('.jsonl');
}

/** Does removing (or moving away) `p` (absolute) take a gate state file with
 *  it — the file, a dir holding one, or a glob that could match one? With
 *  `deep`, `p`'s last segment is a name matched at any depth below its dir
 *  (`find DIR -name X -delete`); with `tree` too, a matched dir goes with
 *  everything under it, so the name may match any dir on a state file's way
 *  down (`find DIR -name X -exec rm -rf {} +`, #214). Deleting
 *  push-gate-approvals.json forgets every spend and binding, so it counts as a
 *  write. A transcript doesn't: deleting one can only take an approval away
 *  (the gates fail closed on a missing transcript), never forge one. #190. */
export function removesGateState(p, deep = false, tree = false) {
  const states = gateStates();
  const n = normPath(p);
  const g = deep ? { dir: n.slice(0, n.lastIndexOf('/')) || '/', name: n.slice(n.lastIndexOf('/') + 1) } : globParts(n);
  if (!g) return states.some((f) => under(f, n));
  if (g.name.includes('/')) return states.some((f) => under(f, g.dir));
  const re = segmentRe(g.name);
  if (!deep) return states.some((f) => globReaches(re, g.dir, f));
  // The names whose match takes f: its own, and with `tree` each dir's from
  // the start dir down (find tests the start dir too).
  const onTheWay = (f) => (tree ? f.slice(g.dir.lastIndexOf('/') + 1).split('/') : [f.slice(f.lastIndexOf('/') + 1)]);
  return states.some((f) => under(f, g.dir) && onTheWay(f).some((s) => re.test(s)));
}

/** Walk a transcript JSONL file backward for the most recent user record
 *  carrying an AskUserQuestion answer (`toolUseResult.answers`: question text
 *  -> answer text, alongside the record's own `uuid`/`timestamp`). Returns
 *  null when the transcript holds none. Throws on a missing/unreadable file —
 *  callers fail closed. */
export function latestAnswer(transcriptPath) {
  const lines = readFileSync(transcriptPath, 'utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!l || l[0] !== '{') continue;
    let o;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    const answers = o?.toolUseResult?.answers;
    if (o?.type === 'user' && answers && typeof answers === 'object' && !Array.isArray(answers)) {
      return { uuid: o.uuid, timestamp: o.timestamp, answers };
    }
  }
  return null;
}

const HOLD_RE = /\b(hold|review first|not yet|wait)\b/i;
const NEGATOR_RE = /^(?:no|not|never|don['’]?t)$/i;

/** Does answer text refuse the act `actRe` names? A hold word refuses anywhere.
 *  A negator (no/not/never/don't) refuses only the act it negates — one named
 *  within the next four words — or the whole answer when it opens with "no",
 *  so "push and pr but dont know if…" approves (#96) while "don't push" and
 *  "No — found a problem" refuse. */
export function denies(text, actRe) {
  if (HOLD_RE.test(text) || /^\W*no\b/i.test(text)) return true;
  const w = text.match(/[\w'’]+/g) || [];
  return w.some((x, i) => NEGATOR_RE.test(x) && actRe.test(w.slice(i + 1, i + 5).join(' ')));
}

/** A small JSON state file; absent or corrupt reads as empty. */
export function readState(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/** Advisory persistence only — a lost write costs a duplicate ask, nothing more.
 *  Writes a temp file then renames it, so a reader never sees half a file. Where the
 *  rename is refused (win32 EPERM/EBUSY/EACCES when the target is open) it falls
 *  back to a direct write. `io` is a test seam for the fs calls. */
export function writeState(file, state, io = {}) {
  const write = io.writeFileSync ?? writeFileSync;
  const rename = io.renameSync ?? renameSync;
  const data = JSON.stringify(state);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    try {
      write(tmp, data);
      rename(tmp, file);
    } catch (err) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(err?.code)) throw err;
      write(file, data); // old behavior: non-atomic, but it lands
    } finally {
      try {
        unlinkSync(tmp);
      } catch {
        // already renamed or never written
      }
    }
  } catch {
    // best-effort
  }
}

export const WEEK_MS = 7 * 24 * 3600 * 1000;

/** Remove files in `dir` last modified more than `ms` before `now`, for state dirs that
 *  nothing else empties (#77, #217). Throws when `dir` can't be listed; a file another
 *  session raced away is skipped. */
export function pruneOlderThan(dir, ms, now) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    try {
      if (now - statSync(p).mtimeMs > ms) rmSync(p, { force: true });
    } catch {
      /* raced with another session */
    }
  }
}

// ---- claim: one parallel hook process at a time (#139) ----------------------
// A lease, not a breakable lock, so there is no stale break to race: a hook makes
// `<base>.lock.<epoch>` (epoch = now / CLAIM_LEASE_MS) with 'wx', then backs off if a
// claim exists in an adjacent epoch or its own epoch rolled over meanwhile. Two
// claimants in one epoch collide on 'wx'; in adjacent epochs each creates before it
// checks, so at least one sees the other (both may back off: a skipped note, retried on
// the next call). A crash-left claim blocks only its own and the adjacent epochs
// (≤ 2 leases) and is swept after that. Holds while fn finishes inside one lease: a
// claimant stalled for more than a lease, or the wall clock stepping back, can still let
// a second hook in, and the worst outcome is a note announced twice.
export const CLAIM_LEASE_MS = 5_000;
export const claimFile = (base, epoch) => `${base}.lock.${epoch}`;

/** Run `fn` under the claim on `base` → fn's result, or null when another hook holds it
 *  or it cannot be made — the caller skips its note, never blocks. `now` and `io` (the
 *  sweep's unlinkSync) are test seams. */
export function withClaim(base, fn, now = Date.now, io = {}) {
  const epoch = Math.floor(now() / CLAIM_LEASE_MS);
  const own = claimFile(base, epoch);
  try {
    mkdirSync(dirname(base), { recursive: true });
    writeFileSync(own, String(process.pid), { flag: 'wx' });
  } catch {
    return null; // held this epoch, or no lock can be made here
  }
  try {
    if (existsSync(claimFile(base, epoch - 1)) || existsSync(claimFile(base, epoch + 1))) return null;
    if (Math.floor(now() / CLAIM_LEASE_MS) !== epoch) return null;
    sweepClaims(base, epoch, io.unlinkSync ?? unlinkSync);
    return fn();
  } finally {
    try {
      unlinkSync(own);
    } catch {
      // already gone
    }
  }
}

/** Remove crash-left claims older than the adjacent epoch; they no longer block anyone. */
function sweepClaims(base, epoch, unlink) {
  const prefix = `${basename(base)}.lock.`;
  let names;
  try {
    names = readdirSync(dirname(base));
  } catch {
    return; // best-effort: a leftover claim stops blocking after two leases anyway
  }
  for (const f of names) {
    if (!f.startsWith(prefix)) continue;
    const e = Number(f.slice(prefix.length));
    if (!Number.isInteger(e) || e >= epoch - 1) continue;
    try {
      unlink(join(dirname(base), f));
    } catch {
      // EPERM/EBUSY on one file: the rest still get swept
    }
  }
}

// "open" is left out on purpose: "Push + open PR" must not grant a browser.
const BROWSER_RE = /\b(browser|chrome|launch|playwright|headed)\b/i;

/** Does some answer value read as approving a visible browser? */
export function isBrowserApproving(answers) {
  return Object.values(answers).some((v) => BROWSER_RE.test(v) && !denies(v, BROWSER_RE));
}

const browserRemedy =
  'Ask the user with AskUserQuestion — give it an option that approves opening the browser (answer wording like "launch"/"browser"/"Chrome", without "hold"/"wait"/"no") — then retry. One approval covers the rest of the session.';

/** A visible browser (Chrome MCP, headed Playwright) needs the user's consent
 *  once per session: an approving answer records `sessionId` in the state
 *  file, and every later browser call in that session passes without reading
 *  the transcript. Returns the block reason, or null to allow. Fails closed. */
export function browserGateReason(what, sessionId, transcriptPath, stateFile = browserGateStateFile()) {
  const state = readState(stateFile);
  if (sessionId && state[sessionId]) return null;
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return `${what} opens a visible browser and needs the user's consent, but there is no transcript to read it from. ${browserRemedy}`;
  }
  let record;
  try {
    record = latestAnswer(transcriptPath);
  } catch {
    return `${what} opens a visible browser and needs the user's consent, but the transcript could not be read. ${browserRemedy}`;
  }
  if (!record || !isBrowserApproving(record.answers)) {
    return `${what} opens a visible browser and needs the user's consent; the most recent AskUserQuestion answer does not give it. ${browserRemedy}`;
  }
  if (sessionId) {
    state[sessionId] = new Date().toISOString();
    const keys = Object.keys(state);
    if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete state[k];
    writeState(stateFile, state);
  }
  return null;
}
