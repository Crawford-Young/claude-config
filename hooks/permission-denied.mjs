#!/usr/bin/env node
// permission-denied.mjs — PermissionDenied hook.
//
// Fires when auto mode denies a tool call, including denials without a
// classifier verdict. This event cannot block: "Exit code and stderr are
// ignored; the denial stands" (Claude Code hooks docs). It also supports
// hookSpecificOutput.retry: true to let the model retry — deliberately not
// used here; this hook is a logger only, and granting retries is a
// behaviour change nobody asked for (P10 WS-A task A8).
//
// One line per denial, appended to ~/.claude/permission-denials.log via
// appendTrimmed (self-trims at 512KB to the last 200 lines), fail-open.

import { join } from 'node:path';
import { appendTrimmed, claudeDir, run } from './_hooklib.mjs';

// appendTrimmed trims this log by *line count*, so any interpolated field
// that can carry a raw newline breaks the one-line-per-denial contract: it
// splits one denial into several physical lines (which then mis-parse as
// unrelated fragments) and can get cut in half at the trim boundary. This is
// not a corner case — tool_input for a denied Bash call is very often a
// multi-line heredoc or script, and denial_reason is prose that may wrap.
// JSON.stringify already escapes \, \r, \n, \t and every other control
// character into a readable, reversible two-(or six-)character sequence and
// quotes the boundary — reuse that instead of hand-rolling escaping, and
// apply it to every interpolated field (session_id, tool_name, denial_reason,
// classifier_verdict, tool_input), not just the one that was observed to
// break. Absent/empty values fall back to the bare, unquoted `?` marker so
// "field was missing" stays visually distinct from an escaped empty string.
function safe(value, fallback = '?') {
  if (value === undefined || value === null || value === '') return fallback;
  return JSON.stringify(value);
}

// tool_input can be large and may hold secrets (paths, command text, file
// contents in some tool calls), so it is only ever logged truncated, and
// the line says so via the trailing "(truncated N chars)" marker when it
// applies. tool_name / denial_reason / classifier_verdict carry the actual
// diagnostic signal and are never truncated.
//
// Truncation is applied AFTER safe()'s escaping, to the already-quoted
// string, deliberately: MAX_INPUT_CHARS then bounds what is actually written
// to disk (the quantity appendTrimmed's size cap cares about), not the raw
// source length. Truncating before escaping would let escape expansion
// (every raw character can become a 2-6 char escape sequence) push the
// written bytes well past the intended cap.
const MAX_INPUT_CHARS = 200;

function truncatedInput(value) {
  const str = safe(value);
  if (str.length <= MAX_INPUT_CHARS) return str;
  return `${str.slice(0, MAX_INPUT_CHARS)}…(truncated ${str.length - MAX_INPUT_CHARS} chars)`;
}

run('permission-denied', (payload) => {
  const line = [
    new Date().toISOString(),
    `session=${safe(payload?.session_id)}`,
    `tool=${safe(payload?.tool_name)}`,
    `reason=${safe(payload?.denial_reason)}`,
    `verdict=${safe(payload?.classifier_verdict)}`,
    `input=${truncatedInput(payload?.tool_input)}`,
  ].join(' ');
  appendTrimmed(join(claudeDir, 'permission-denials.log'), line);
});
