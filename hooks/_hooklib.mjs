// Shared plumbing for claude-config hooks (Node ports of the old .ps1 set).
//
// Contract (Claude Code hooks): JSON payload on stdin; exit 0 = proceed,
// exit 2 = block with the reason on stderr. Every hook is FAIL-OPEN: an
// internal error logs to ~/.claude/hook-errors.log and exits 0 so a broken
// hook never wedges work.

import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export const claudeDir = join(homedir(), '.claude');
export const errorLog = join(claudeDir, 'hook-errors.log');

export function readPayload() {
  const raw = readFileSync(0, 'utf8');
  return raw.trim() ? JSON.parse(raw) : {};
}

export function logError(hook, err) {
  try {
    mkdirSync(claudeDir, { recursive: true });
    appendFileSync(errorLog, `${new Date().toISOString()} ${hook}: ${err && err.stack ? err.stack : err}\n`);
  } catch {
    // nowhere left to report
  }
}

export function block(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

export function allow() {
  process.exit(0);
}

/** Run a hook body fail-open. Supports async bodies; anything that didn't explicitly block proceeds. */
export function run(hookName, fn) {
  Promise.resolve()
    .then(() => fn(readPayload()))
    .catch((err) => logError(hookName, err))
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
