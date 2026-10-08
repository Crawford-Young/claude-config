// Shared plumbing for claude-config hooks (Node ports of the old .ps1 set).
//
// Contract (Claude Code hooks): JSON payload on stdin; exit 0 = proceed,
// exit 2 = block with the reason on stderr. Every hook is FAIL-OPEN by
// default: an internal error logs to ~/.claude/hook-errors.log and exits 0 so
// a broken hook never wedges work. A *guard* may opt into `failClosed` (see
// run(); bash-guard does) — a guard that crashed has checked nothing, and a
// silent allow there is invisible, where a block is not. H21 is the case in
// point: a BOM on stdin disarmed bash-guard and nothing said so.

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export const claudeDir = join(homedir(), '.claude');
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
          `${hookName} failed before it could check this action (${err?.message || err}) — this guard fails closed, so the action is blocked rather than silently allowed. Fix hooks/${hookName}.mjs (the Edit tool is not gated by it) or ask the user; the trace is in ~/.claude/hook-errors.log.`,
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
// Approval is the user's most recent AskUserQuestion answer — a record the
// model cannot forge. Shared so every gate reads it, and refusals, alike.

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

/** Advisory persistence only — a lost write costs a duplicate ask, nothing more. */
export function writeState(file, state) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state));
  } catch {
    // best-effort
  }
}

// "open" is left out on purpose: "Push + open PR" must not grant a browser.
const BROWSER_RE = /\b(browser|chrome|launch|playwright|headed)\b/i;

/** Does some answer value read as approving a visible browser? */
export function isBrowserApproving(answers) {
  return Object.values(answers).some((v) => BROWSER_RE.test(v) && !denies(v, BROWSER_RE));
}

export const browserGateStateFile = () => process.env.CLAUDE_BROWSER_GATE_STATE || join(claudeDir, 'browser-gate-sessions.json');

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
