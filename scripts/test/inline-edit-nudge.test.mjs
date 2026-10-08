// node --test scripts/test/inline-edit-nudge.test.mjs — #99's main-session nudge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execHarness } from './_spawn.mjs';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const hook = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks', 'inline-edit-nudge.mjs');

const use = (name, input, id = `t${Math.random()}`) =>
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const edit = (f) => use('Edit', { file_path: f });

function setup(lines) {
  const h = mkdtempSync(join(tmpdir(), 'nudge-'));
  mkdirSync(join(h, '.claude'), { recursive: true });
  const transcript = join(h, 't.jsonl');
  writeFileSync(transcript, lines.join('\n') + '\n');
  return { h, transcript };
}

function fire(ctx, extra = {}, file = 'cur.ts') {
  const payload = { session_id: 's1', transcript_path: ctx.transcript, tool_input: { file_path: file }, ...extra };
  const stdout = execHarness(hook, [], { input: JSON.stringify(payload), home: ctx.h });
  return stdout ? JSON.parse(stdout) : null;
}

const five = ['a', 'b', 'c', 'd', 'e'].map((f) => edit(`${f}.ts`));

test('silent below six distinct files', () => {
  assert.equal(fire(setup(five.slice(0, 4))), null);
});

test('fires at six distinct files with the reminder, once per run', () => {
  const ctx = setup(five);
  const out = fire(ctx);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(out.hookSpecificOutput.additionalContext, /^6 files edited inline since the last dispatch/);
  assert.equal(fire(ctx, {}, 'seventh.ts'), null);
});

test('repeat edits of one file do not count', () => {
  assert.equal(fire(setup([...five, edit('a.ts'), edit('a.ts')]), {}, 'a.ts'), null);
});

test('a dispatch resets the run and re-arms the nudge', () => {
  const ctx = setup(five);
  assert.ok(fire(ctx));
  writeFileSync(ctx.transcript, [...five, use('Agent', {}, 'd1'), ...five].join('\n') + '\n');
  assert.ok(fire(ctx), 'new run fires again');
});

test('edits before the last dispatch are not counted', () => {
  assert.equal(fire(setup([...five, use('Agent', {}, 'd1'), edit('x.ts')])), null);
});

test('subagent calls (agent_id) never count and never fire', () => {
  assert.equal(fire(setup(five), { agent_id: 'agent-1', agent_type: 'implementer' }), null);
});

test('a --agent main session (agent_type only) still fires', () => {
  assert.ok(fire(setup(five), { agent_type: 'custom' }));
});

test('fail-open on a missing transcript', () => {
  const ctx = setup(five);
  assert.equal(fire(ctx, { transcript_path: join(ctx.h, 'nope.jsonl') }), null);
});

test('a dispatch older than one read chunk is still found', () => {
  const pad = 'x'.repeat(2000);
  const filler = Array.from({ length: 400 }, (_, i) => use('Bash', { command: pad }, `b${i}`));
  const ctx = setup([...five, use('Agent', {}, 'd1'), edit('x.ts'), ...filler]);
  assert.equal(fire(ctx), null);
});
