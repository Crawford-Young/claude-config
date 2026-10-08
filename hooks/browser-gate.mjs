#!/usr/bin/env node
// browser-gate.mjs — PreToolUse consent gate on the Chrome MCP tools. Wire with
// matcher "mcp__claude-in-chrome__.*".
//
// A visible browser is the user's screen, not the model's: the first browser
// call of a session needs the user's most recent AskUserQuestion answer to
// approve it (browser/Chrome/launch/Playwright/headed wording, no refusal).
// The grant is per session — recorded by session_id in
// ~/.claude/browser-gate-sessions.json (CLAUDE_BROWSER_GATE_STATE overrides) —
// so later calls in that session pass without re-asking. Read-only context
// calls (tabs_context_mcp, list_connected_browsers) are never gated.
// bash-guard.mjs applies the same rule to headed Playwright via the shared
// _hooklib.mjs browserGateReason.
//
// Fails CLOSED, like the other guards: an unreadable transcript blocks.

import { pathToFileURL } from 'node:url';
import { block, browserGateReason, run } from './_hooklib.mjs';

const CHROME = /^mcp__claude-in-chrome__(.+)$/;
const READ_ONLY = new Set(['tabs_context_mcp', 'list_connected_browsers']);

/** Is this tool call a Chrome MCP call that touches the browser? */
export function isGatedBrowserTool(name) {
  const m = CHROME.exec(name || '');
  return Boolean(m) && !READ_ONLY.has(m[1]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(
    'browser-gate',
    (payload) => {
      const tool = payload?.tool_name || '';
      if (!isGatedBrowserTool(tool)) return;
      const reason = browserGateReason(tool, payload?.session_id, payload?.transcript_path);
      if (reason) block(reason);
    },
    { failClosed: true },
  );
}
