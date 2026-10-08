// node --test scripts/test/browser-gate.test.mjs — the browser consent gate,
// through the real hook process (payload on stdin, exit code out).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isGatedBrowserTool } from '../../hooks/browser-gate.mjs';
import { isBrowserApproving } from '../../hooks/_hooklib.mjs';

const hookPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks', 'browser-gate.mjs');

function tmp() {
  const h = mkdtempSync(join(tmpdir(), 'bgate-'));
  return { h, state: join(h, 'browser.json') };
}

function transcript(dir, answers, uuid = 'u1') {
  const path = join(dir, `t-${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(path, `${JSON.stringify({ type: 'user', uuid, timestamp: new Date().toISOString(), toolUseResult: { questions: [], answers } })}\n`);
  return path;
}

function gate(tool_name, { transcriptPath, session_id, state }) {
  try {
    execFileSync(process.execPath, [hookPath], {
      input: JSON.stringify({ tool_name, tool_input: {}, transcript_path: transcriptPath, session_id }),
      env: { ...process.env, CLAUDE_BROWSER_GATE_STATE: state },
      encoding: 'utf8',
    });
    return 0;
  } catch (e) {
    return e.status;
  }
}

test('chrome tools are gated except the read-only context calls', () => {
  assert.equal(isGatedBrowserTool('mcp__claude-in-chrome__navigate'), true);
  assert.equal(isGatedBrowserTool('mcp__claude-in-chrome__computer'), true);
  assert.equal(isGatedBrowserTool('mcp__claude-in-chrome__tabs_context_mcp'), false);
  assert.equal(isGatedBrowserTool('mcp__claude-in-chrome__list_connected_browsers'), false);
  assert.equal(isGatedBrowserTool('Bash'), false);
  assert.equal(isGatedBrowserTool('mcp__other__navigate'), false);
});

test('browser approval wording: intent without refusal', () => {
  assert.equal(isBrowserApproving({ 'Launch?': 'Launch the browser lab' }), true);
  assert.equal(isBrowserApproving({ 'How?': 'Open Chrome' }), true);
  assert.equal(isBrowserApproving({ 'How?': 'Headed playwright run' }), true);
  assert.equal(isBrowserApproving({ 'How?': "Don't open the browser" }), false);
  assert.equal(isBrowserApproving({ 'Ship?': 'Push + open PR' }), false);
});

test('no answer, a non-browser answer, or an unreadable transcript blocks', () => {
  const { h, state } = tmp();
  assert.equal(gate('mcp__claude-in-chrome__navigate', { transcriptPath: join(h, 'missing.jsonl'), session_id: 's', state }), 2);
  assert.equal(gate('mcp__claude-in-chrome__navigate', { transcriptPath: undefined, session_id: 's', state }), 2);
  const push = transcript(h, { 'Ship?': 'Push + PR' });
  assert.equal(gate('mcp__claude-in-chrome__navigate', { transcriptPath: push, session_id: 's', state }), 2);
  const deny = transcript(h, { 'Open the browser?': 'No, not yet' });
  assert.equal(gate('mcp__claude-in-chrome__navigate', { transcriptPath: deny, session_id: 's', state }), 2);
});

test('an approving answer grants the whole session, not just one call', () => {
  const { h, state } = tmp();
  const yes = transcript(h, { 'Launch the lab?': 'Yes, open the browser' });
  const later = transcript(h, { 'Next?': 'Push + PR' }, 'u2');
  assert.equal(gate('mcp__claude-in-chrome__navigate', { transcriptPath: yes, session_id: 's1', state }), 0);
  assert.equal(gate('mcp__claude-in-chrome__computer', { transcriptPath: yes, session_id: 's1', state }), 0);
  assert.equal(gate('mcp__claude-in-chrome__computer', { transcriptPath: later, session_id: 's1', state }), 0);
  assert.equal(gate('mcp__claude-in-chrome__computer', { transcriptPath: later, session_id: 's2', state }), 2);
});

test('read-only context calls never read the transcript', () => {
  const { h, state } = tmp();
  assert.equal(gate('mcp__claude-in-chrome__tabs_context_mcp', { transcriptPath: join(h, 'missing.jsonl'), session_id: 's', state }), 0);
  assert.equal(gate('mcp__claude-in-chrome__list_connected_browsers', { transcriptPath: undefined, session_id: 's', state }), 0);
});
