// node --test scripts/test/subagent-budget.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnHarness, tempDir } from './_spawn.mjs';
import { contextTokens } from '../../hooks/context-gauge.mjs';
import { ALLOWED_AT_HARD, LINES, agentTranscript, lines } from '../../hooks/subagent-budget.mjs';

const HOOK = fileURLToPath(new URL('../../hooks/subagent-budget.mjs', import.meta.url));
const SID = '0b5e1c2d-1111-2222-3333-444455556666';

/** An assistant record as a subagent transcript holds it: every line is a sidechain line. */
const rec = (input, cacheRead, cacheWrite = 0) =>
  JSON.stringify({
    type: 'assistant',
    isSidechain: true,
    agentId: 'a1',
    message: { role: 'assistant', usage: { input_tokens: input, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite, output_tokens: 400 } },
  });

/** A temp home with a project dir: the main transcript `<sid>.jsonl` and, per agent,
 *  `<sid>/subagents/agent-<id>.jsonl` — the layout Claude Code writes. */
function fixture() {
  const home = tempDir('subagent-budget-');
  const project = join(home, '.claude', 'projects', 'p');
  const subagents = join(project, SID, 'subagents');
  mkdirSync(subagents, { recursive: true });
  const main = join(project, `${SID}.jsonl`);
  writeFileSync(main, `${JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 0, cache_read_input_tokens: 300_000 } } })}\n`);
  const agent = (id, ...records) => {
    const p = join(subagents, `agent-${id}.jsonl`);
    writeFileSync(p, `${records.join('\n')}\n`);
    return p;
  };
  return { home, main, agent };
}

/** One PreToolUse call of the hook. */
function call(f, tool, extra = {}, env = {}) {
  const payload = { session_id: SID, transcript_path: f.main, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: {}, agent_id: 'a1', agent_type: 'implementer', ...extra };
  const r = spawnHarness(HOOK, [], { input: JSON.stringify(payload), home: f.home, env });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const note = (r) => JSON.parse(r.stdout).hookSpecificOutput;

test('contextTokens reads a subagent file only when asked to count sidechain lines', () => {
  const t = rec(2, 180_000, 1_000);
  assert.equal(contextTokens(t), null, 'the main-session reading still skips sidechain lines');
  assert.equal(contextTokens(t, { sidechain: true }), 181_002, 'peak rule: input + cache read + cache write');
});

test('lines default to soft 150k / hard 200k and take env overrides', () => {
  assert.deepEqual(LINES, { soft: 150_000, hard: 200_000 });
  assert.deepEqual(lines({}), { soft: 150_000, hard: 200_000 });
  assert.deepEqual(lines({ CLAUDE_CTX_AGENT_SOFT: '50000', CLAUDE_CTX_AGENT_HARD: '80000' }), { soft: 50_000, hard: 80_000 });
  assert.deepEqual(lines({ CLAUDE_CTX_AGENT_SOFT: 'x', CLAUDE_CTX_AGENT_HARD: '-1' }), { soft: 150_000, hard: 200_000 }, 'junk falls back');
});

test('the subagent transcript is <session>/subagents/agent-<agent_id>.jsonl, from a main or a subagent transcript_path', () => {
  const f = fixture();
  const p = f.agent('a1', rec(0, 1));
  assert.equal(agentTranscript({ session_id: SID, agent_id: 'a1', transcript_path: f.main }), p);
  assert.equal(agentTranscript({ session_id: SID, agent_id: 'a1', transcript_path: p }), p);
  assert.equal(agentTranscript({ session_id: SID, agent_id: 'agent-a1', transcript_path: f.main }), p, 'an id that already carries the agent- prefix');
  assert.equal(agentTranscript({ session_id: SID, agent_id: 'a2', transcript_path: f.main }), null, 'no file: nothing to measure');
  assert.equal(agentTranscript({ session_id: SID, agent_id: '../../x', transcript_path: f.main }), null, 'never joins a non-plain id');
  assert.equal(agentTranscript({ session_id: '../s', agent_id: 'a1', transcript_path: f.main }), null);
  assert.equal(agentTranscript({ session_id: SID, agent_id: 'a1' }), null);
});

test('block: past the hard line a subagent tool call outside the allow set is blocked, saying what is left to do', () => {
  const f = fixture();
  f.agent('a1', rec(0, 120_000), rec(3, 205_000, 2_000));
  for (const tool of ['Bash', 'Grep', 'Agent', 'PowerShell', 'WebFetch']) {
    const r = call(f, tool);
    assert.equal(r.code, 2, tool);
    assert.match(r.stderr, /207k/, tool);
    assert.match(r.stderr, /200k hard line/, tool);
    assert.match(r.stderr, /commit-message file/, tool);
    assert.match(r.stderr, /hand back with what is left/, tool);
    assert.match(r.stderr, new RegExp(`${tool} is blocked`), tool);
  }
});

test('allow: past the hard line the commit-message file and the hand-back still go through', () => {
  const f = fixture();
  f.agent('a1', rec(0, 230_000));
  assert.deepEqual([...ALLOWED_AT_HARD].sort(), ['Edit', 'MultiEdit', 'Read', 'SubagentHandback', 'ToolSearch', 'Write']);
  for (const tool of ALLOWED_AT_HARD) {
    const r = call(f, tool);
    assert.equal(r.code, 0, tool);
    assert.equal(r.stderr, '', tool);
  }
});

test('allow: under the soft line nothing is said or blocked', () => {
  const f = fixture();
  f.agent('a1', rec(0, 149_000));
  const r = call(f, 'Bash');
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('soft line: one note into the subagent context, once per agent', () => {
  const f = fixture();
  f.agent('a1', rec(0, 160_000));
  const first = call(f, 'Bash');
  assert.equal(first.code, 0);
  const n = note(first);
  assert.equal(n.hookEventName, 'PreToolUse');
  assert.equal(n.permissionDecision, undefined, 'a note, not a decision');
  assert.match(n.additionalContext, /160k/);
  assert.match(n.additionalContext, /soft line 150k/);
  assert.match(n.additionalContext, /[Ff]inish the current step/);
  assert.match(n.additionalContext, /commit-message file/);
  assert.match(n.additionalContext, /hand back with what is left/);
  assert.match(n.additionalContext, /200k/);

  f.agent('a1', rec(0, 160_000), rec(0, 175_000));
  const again = call(f, 'Read');
  assert.equal(again.code, 0);
  assert.equal(again.stdout, '', 'the note is not repeated');

  f.agent('b2', rec(0, 160_000));
  assert.match(note(call(f, 'Bash', { agent_id: 'b2' })).additionalContext, /soft line/, 'another agent gets its own note');
});

test('main sessions are untouched: no agent_id, no note and no block at any size', () => {
  const f = fixture();
  f.agent('a1', rec(0, 300_000));
  const r = call(f, 'Bash', { agent_id: undefined, agent_type: undefined });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('env overrides move both lines', () => {
  const f = fixture();
  f.agent('a1', rec(0, 60_000));
  assert.equal(call(f, 'Bash', {}, { CLAUDE_CTX_AGENT_SOFT: '30000', CLAUDE_CTX_AGENT_HARD: '50000' }).code, 2);
  assert.equal(call(f, 'Bash').code, 0, 'default lines: 60k passes');
});

test('a subagent with no transcript on disk passes (fail open)', () => {
  const f = fixture();
  const r = call(f, 'Bash', { agent_id: 'gone' });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
});
