// node --test scripts/test/subagentstop-log.test.mjs — spawns the real hook process
// with realistic SubagentStop payloads (observed shape, P10 WS-A A7 phase 1) and
// asserts the resulting log line, off the real ~/.claude/subagent-stops.log.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const hooksDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks');
const hook = join(hooksDir, 'subagentstop-log.mjs');

/** A throwaway HOME so nothing here touches the real ~/.claude/subagent-stops.log. */
function home() {
  const h = mkdtempSync(join(tmpdir(), 'subagentstop-log-'));
  mkdirSync(join(h, '.claude'), { recursive: true });
  return h;
}

function runHook(payload, h) {
  const env = { ...process.env, HOME: h, USERPROFILE: h };
  try {
    execFileSync(process.execPath, [hook], { input: JSON.stringify(payload), encoding: 'utf8', env });
    return { code: 0 };
  } catch (e) {
    return { code: e.status, stderr: e.stderr };
  }
}

const logFile = (h) => join(h, '.claude', 'subagent-stops.log');

// A payload shaped like a real observed SubagentStop (phase-1 dump), typed dispatch.
const typedPayload = {
  session_id: 'sess-abc123',
  transcript_path: 'C:\\Users\\young\\.claude\\projects\\x\\sess.jsonl',
  cwd: 'C:\\Users\\young\\code\\claude-config',
  scratchpad_dir: 'C:\\Users\\young\\AppData\\Local\\Temp\\claude\\scratchpad',
  prompt_id: 'prompt-1',
  permission_mode: 'default',
  agent_id: 'a4124eb9cb4922701',
  agent_type: 'implementer',
  effort: 'medium',
  hook_event_name: 'SubagentStop',
  stop_hook_active: false,
  agent_transcript_path: 'C:\\Users\\young\\.claude\\projects\\x\\agent-a4124eb9.jsonl',
  last_assistant_message: 'done',
  background_tasks: [],
  session_crons: [],
};

// The untyped case: agent_type is an empty string, not absent (observed in phase 1).
const untypedPayload = { ...typedPayload, agent_id: 'b99887766c1122334', agent_type: '' };

test('does not write to the real ~/.claude log (isolation check)', () => {
  const h = home();
  runHook(typedPayload, h);
  const realLog = join(process.env.USERPROFILE || process.env.HOME, '.claude', 'subagent-stops.log');
  // The spawned hook must have written under the throwaway HOME, not the real one.
  assert.ok(existsSync(logFile(h)), 'log written under the throwaway HOME');
  if (existsSync(realLog)) {
    assert.doesNotMatch(readFileSync(realLog, 'utf8'), /a4124eb9cb4922701|b99887766c1122334/);
  }
});

test('logs agent_id and agent_type for a typed dispatch', () => {
  const h = home();
  const r = runHook(typedPayload, h);
  assert.equal(r.code, 0);
  const line = readFileSync(logFile(h), 'utf8').trim();
  assert.match(line, /session=sess-abc123/);
  assert.match(line, /agent_id=a4124eb9cb4922701/);
  assert.match(line, /agent_type=implementer/);
});

test('an empty-string agent_type falls back to "?" (not left blank)', () => {
  const h = home();
  const r = runHook(untypedPayload, h);
  assert.equal(r.code, 0);
  const line = readFileSync(logFile(h), 'utf8').trim();
  assert.match(line, /agent_id=b99887766c1122334/);
  assert.match(line, /agent_type=\?/); // '' || '?' — NOT '' ?? '?' (?? would leave it blank)
});

test('no temp payload-dump file is written anywhere under HOME', () => {
  const h = home();
  runHook(typedPayload, h);
  assert.ok(!existsSync(join(h, 'subagentstop-payload.json')));
});
