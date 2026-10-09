// node --test scripts/test/inline-edit-nudge.test.mjs — #99's main-session nudge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execHarness } from './_spawn.mjs';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
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

test('a missing transcript logs no hook error', () => {
  const ctx = setup(five);
  assert.equal(fire(ctx, { transcript_path: join(ctx.h, 'nope.jsonl') }), null);
  assert.equal(existsSync(join(ctx.h, '.claude', 'hook-errors.log')), false);
});

test('one file spelled with backslashes, slashes and another case counts once', () => {
  const ctx = setup(['C:\\a\\x.md', 'C:/a/x.md', 'c:/a/x.md', 'c:/a/y.md', 'c:/a/z.md', 'c:/a/w.md', 'c:/a/v.md'].map(edit));
  assert.equal(fire(ctx, {}, 'C:\\a\\X.md'), null, '5 distinct files');
  assert.ok(fire(ctx, {}, 'c:/a/u.md'), '6 distinct files');
});

test('files under the OS temp dir (scratchpad, commit/PR drafts) never count', () => {
  const tmp = (f) => join(tmpdir(), 'scratchpad', f);
  const ctx = setup([...five.slice(0, 3), ...['m1.txt', 'm2.txt', 'm3.txt', 'm4.txt'].map((f) => edit(tmp(f)))]);
  assert.equal(fire(ctx, {}, tmp('pr.md')), null, '3 real files + 5 temp files');
  assert.equal(fire(ctx, {}, 'real4.ts'), null, '4 real files');
});

// ---- #117 review minors ----
const result = (id, isError) =>
  JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'x', ...(isError ? { is_error: true } : {}) }] } });
const editWith = (f, id, isError) => [use('Edit', { file_path: f }, id), result(id, isError)];

test('edits whose tool_result is an error do not count toward the distinct files', () => {
  const lines = [...five.slice(0, 3).flatMap((f, i) => editWith(f, `ok${i}`, false)), ...['x.ts', 'y.ts', 'z.ts'].flatMap((f, i) => editWith(f, `bad${i}`, true))];
  assert.equal(fire(setup(lines), {}, 'cur.ts'), null, '3 ok + 1 current = 4 files; 3 errored ones ignored');
  const ok = [...five.flatMap((f, i) => editWith(f, `k${i}`, false))];
  assert.ok(fire(setup(ok)), '5 ok + current = 6 still fires');
});

test('a line longer than one read chunk is decoded once, not once per chunk', async () => {
  const { currentRun } = await import('../../hooks/inline-edit-nudge.mjs');
  const big = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'y'.repeat(1.5 * 1024 * 1024) }] } });
  const ctx = setup([use('Agent', {}, 'd1'), big, edit('a.ts')]);
  const size = Buffer.byteLength(readFileSync(ctx.transcript));
  const orig = Buffer.prototype.toString;
  let decoded = 0;
  Buffer.prototype.toString = function (enc, ...rest) {
    if (enc === 'utf8') decoded += this.length;
    return orig.call(this, enc, ...rest);
  };
  let cur;
  try {
    cur = currentRun(ctx.transcript);
  } finally {
    Buffer.prototype.toString = orig;
  }
  assert.equal(cur.runId, 'd1');
  assert.ok(decoded <= size * 1.2, `decoded ${decoded} bytes of a ${size}-byte transcript`);
});

test('subagent transcripts are separate files: an isSidechain flag does not hide a tool_use', async () => {
  const { currentRun } = await import('../../hooks/inline-edit-nudge.mjs');
  const line = JSON.stringify({ isSidechain: true, type: 'assistant', message: { content: [{ type: 'tool_use', id: 'q', name: 'Edit', input: { file_path: 'S.ts' } }] } });
  assert.deepEqual([...currentRun(setup([line]).transcript).files], ['s.ts']);
});

test('a fresh claim by a concurrent hook suppresses the second nudge; a stale one does not', async () => {
  const { nudge } = await import('../../hooks/inline-edit-nudge.mjs');
  const ctx = setup(five);
  const state = join(ctx.h, 'state.json');
  const payload = { session_id: 's9', transcript_path: ctx.transcript, tool_input: { file_path: 'cur.ts' } };
  writeFileSync(`${state}.lock`, '');
  assert.equal(nudge(payload, state), null, 'lock held by a parallel hook');
  const old = new Date(Date.now() - 60_000);
  utimesSync(`${state}.lock`, old, old);
  assert.ok(nudge(payload, state), 'stale lock is broken');
  assert.equal(existsSync(`${state}.lock`), false, 'lock released');
  assert.equal(nudge(payload, state), null, 'run recorded');
});

test('claimRun fails open (fires) when a stale lock cannot be removed or its mtime is in the future', async () => {
  const { nudge } = await import('../../hooks/inline-edit-nudge.mjs');
  const ctx = setup(five);
  const state = join(ctx.h, 'state.json');
  const payload = { session_id: 's8', transcript_path: ctx.transcript, tool_input: { file_path: 'cur.ts' } };
  writeFileSync(`${state}.lock`, '');
  const future = new Date(Date.now() + 3_600_000);
  utimesSync(`${state}.lock`, future, future);
  assert.ok(nudge(payload, state), 'future-dated lock does not silence the nudge');
  // a lock that is a directory is stale-by-age but cannot be unlinked
  const state2 = join(ctx.h, 'state2.json');
  mkdirSync(`${state2}.lock`);
  const old = new Date(Date.now() - 60_000);
  utimesSync(`${state2}.lock`, old, old);
  assert.ok(nudge({ ...payload, session_id: 's7' }, state2), 'undeletable stale lock fires');
});
