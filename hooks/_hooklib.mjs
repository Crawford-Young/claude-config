// Shared plumbing for claude-config hooks (Node ports of the old .ps1 set).
//
// Contract (Claude Code hooks): JSON payload on stdin; exit 0 = proceed,
// exit 2 = block with the reason on stderr. Every hook is FAIL-OPEN by
// default: an internal error logs to ~/.claude/hook-errors.log and exits 0 so
// a broken hook never wedges work. A *guard* may opt into `failClosed` (see
// run(); bash-guard does) — a guard that crashed has checked nothing, and a
// silent allow there is invisible, where a block is not. H21 is the case in
// point: a BOM on stdin disarmed bash-guard and nothing said so.

import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export const claudeDir = join(homedir(), '.claude');
export const errorLog = join(claudeDir, 'hook-errors.log');

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
