// node --test scripts/test/stop-reflect-gate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execHarness } from './_spawn.mjs';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { continuationAsked, lastMerge, lastReflectAt } from '../../hooks/stop-reflect-gate.mjs';

const hook = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks', 'stop-reflect-gate.mjs');

const call = (id, command, name = 'Bash') => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: { command } }] } });
const result = (id, is_error = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error, content: 'x' }] } });

/** A transcript file holding `records`, one JSON object per line. */
function transcript(...records) {
  const p = join(mkdtempSync(join(tmpdir(), 'gate-tx-')), 't.jsonl');
  writeFileSync(p, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return p;
}

function runHook(payload, home) {
  try {
    execHarness(hook, [], {
      input: JSON.stringify(payload),
      home,
    });
    return { code: 0 };
  } catch (e) {
    return { code: e.status, stderr: e.stderr };
  }
}

test('lastMerge: the newest successful gh pr merge call, else null', () => {
  const lines = [call('a', 'gh pr merge 5 --rebase'), result('a'), call('b', 'git status'), result('b')].map((r) => JSON.stringify(r));
  assert.equal(lastMerge(lines.join('\n')), 'a');
  assert.equal(lastMerge([call('c', 'gh pr merge 6'), result('c', true)].map((r) => JSON.stringify(r)).join('\n')), null);
  assert.equal(lastMerge([call('d', 'gh pr view 6')].map((r) => JSON.stringify(r)).join('\n')), null);
});

test('reminds once per merged PR, then stays quiet', () => {
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
  const transcript_path = transcript(call('m1', 'gh pr merge 72 --rebase'), result('m1'));

  const first = runHook({ transcript_path }, home);
  assert.equal(first.code, 2, 'first stop after the merge blocks with the reminder');
  assert.match(first.stderr, /prompt the user/i);
  assert.match(first.stderr, /Read ~\/code\/claude-config\/skills\/reflect\/SKILL\.md/);

  assert.equal(runHook({ transcript_path, stop_hook_active: true }, home).code, 0, 'the retry passes');
  assert.equal(runHook({ transcript_path }, home).code, 0, 'a later turn end on the same merge passes');
});

const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const reflectRead = (id, min, path = 'C:\\Users\\u\\code\\claude-config\\skills\\reflect\\SKILL.md') => ({
  type: 'assistant',
  timestamp: ago(min),
  message: { content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: path } }] },
});

test('lastReflectAt: the newest reflect SKILL.md read or reflect Skill call, else null', () => {
  const at = lastReflectAt(
    [
      reflectRead('r1', 90),
      reflectRead('r2', 5, '~/code/claude-config/skills/reflect/SKILL.md'),
      { type: 'assistant', timestamp: ago(1), message: { content: [{ type: 'tool_use', id: 'o', name: 'Read', input: { file_path: 'skills/qa/SKILL.md' } }] } },
    ]
      .map((r) => JSON.stringify(r))
      .join('\n'),
  );
  assert.ok(Math.abs(at - (Date.now() - 5 * 60_000)) < 5_000, 'newest reflect read wins; other skills do not count');
  const skill = { type: 'assistant', timestamp: ago(3), message: { content: [{ type: 'tool_use', id: 's', name: 'Skill', input: { skill: 'reflect' } }] } };
  assert.ok(lastReflectAt(JSON.stringify(skill)));
  assert.equal(lastReflectAt(JSON.stringify(call('a', 'gh pr merge 5'))), null);
});

test('lastReflectAt: a Bash cat or PowerShell Get-Content of reflect SKILL.md counts; mentions and Edit/Write do not', () => {
  const tx = (...r) => r.map((x) => JSON.stringify({ type: 'assistant', timestamp: ago(4), message: { content: [x] } })).join('\n');
  const use = (name, input) => ({ type: 'tool_use', id: 'u', name, input });
  assert.ok(lastReflectAt(tx(use('Bash', { command: 'cat ~/code/claude-config/skills/reflect/SKILL.md' }))), 'Bash cat');
  assert.ok(lastReflectAt(tx(use('PowerShell', { command: 'Get-Content C:\\Users\\u\\code\\claude-config\\skills\\reflect\\SKILL.md' }))), 'PowerShell');
  assert.ok(lastReflectAt(tx(use('Bash', { command: 'cat skills/INDEX.md skills/reflect/SKILL.md' }))), 'relative path');
  assert.equal(lastReflectAt(tx(use('Bash', { command: 'echo reflect on the skills' }))), null, 'a mention is not a read');
  assert.equal(lastReflectAt(tx(use('Bash', { command: 'cat skills/qa/SKILL.md # reflect' }))), null, 'another skill is not reflect');
  assert.equal(lastReflectAt(tx(use('Edit', { file_path: 'skills/reflect/SKILL.md', old_string: 'a', new_string: 'b' }))), null, 'Edit is not a read');
  assert.equal(lastReflectAt(tx(use('Write', { file_path: 'skills/reflect/SKILL.md', content: 'x' }))), null, 'Write is not a read');
});

test('a merge within 60 min of a reflect read is the reflect landing itself: quiet, and stays quiet', () => {
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
  const transcript_path = transcript(reflectRead('r', 10), ...mergeAt('m94', 5), ask(2, clearQ));
  assert.equal(runHook({ transcript_path }, home).code, 0, 'the reflect-landing merge does not re-prompt reflect (clear-or-continue already asked)');
  assert.equal(runHook({ transcript_path }, home).code, 0);
});

test('a reflect read older than 60 min does not cover a later merge', () => {
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
  const transcript_path = transcript(reflectRead('r', 120), call('m2', 'gh pr merge 95 --rebase'), result('m2'));
  assert.equal(runHook({ transcript_path }, home).code, 2, "a later wave's merge still prompts");
});

test('quiet with no merge, a failed merge, or no transcript', () => {
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
  assert.equal(runHook({ transcript_path: transcript(call('x', 'git push'), result('x')) }, home).code, 0);
  assert.equal(runHook({ transcript_path: transcript(call('y', 'gh pr merge 1'), result('y', true)) }, home).code, 0);
  assert.equal(runHook({}, home).code, 0);
});

test('lastMerge: PowerShell merges and gh -R forms count; --auto only queues', () => {
  const tx = (...r) => r.map((x) => JSON.stringify(x)).join('\n');
  assert.equal(lastMerge(tx(call('p', 'gh pr merge 5 --rebase', 'PowerShell'), result('p'))), 'p');
  assert.equal(lastMerge(tx(call('r', 'gh -R owner/repo pr merge 12 --rebase'), result('r'))), 'r');
  assert.equal(lastMerge(tx(call('s', 'gh pr -R owner/repo merge 12'), result('s'))), 's');
  assert.equal(lastMerge(tx(call('q', 'gh pr merge 5 --auto --rebase'), result('q'))), null);
  assert.equal(lastMerge(tx(call('v', 'gh -R owner/repo pr view 12'), result('v'))), null);
  assert.equal(lastMerge(tx(call('e', 'echo "gh pr merge 5"'), result('e'))), null);
});

test('parallel sessions each get their own reminder once, with no ping-pong', () => {
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
  const a = transcript(call('ma', 'gh pr merge 1 --rebase'), result('ma'));
  const b = transcript(call('mb', 'gh pr merge 2 --rebase'), result('mb'));
  assert.equal(runHook({ transcript_path: a }, home).code, 2);
  assert.equal(runHook({ transcript_path: b }, home).code, 2);
  assert.equal(runHook({ transcript_path: a }, home).code, 0, 'session A stays quiet after B fired');
  assert.equal(runHook({ transcript_path: b }, home).code, 0, 'session B stays quiet after A ran again');
});

test('lastReflectAt: heredoc bodies and commit messages naming the path are not reads; mixed case is', () => {
  const tx = (command) => JSON.stringify({ type: 'assistant', timestamp: ago(4), message: { content: [{ type: 'tool_use', id: 'u', name: 'Bash', input: { command } }] } });
  assert.equal(lastReflectAt(tx("cat > n.md <<'EOF'\nsee skills/reflect/SKILL.md\nEOF")), null, 'heredoc body');
  assert.equal(lastReflectAt(tx('git commit -m "edit skills/reflect/SKILL.md"')), null, 'commit message');
  assert.ok(lastReflectAt(tx('cat skills/Reflect/skill.md')), 'mixed case');
});

// ---- second gate: continuation ask after reflect (issue #122) ----
const at = (min, rec) => ({ ...rec, timestamp: ago(min) });
const mergeAt = (id, min) => [at(min, call(id, 'gh pr merge 9 --rebase')), at(min, result(id))];
const ask = (min, input) => ({
  type: 'assistant',
  timestamp: ago(min),
  message: { content: [{ type: 'tool_use', id: `q${min}`, name: 'AskUserQuestion', input }] },
});
const clearQ = { questions: [{ question: 'Clear or continue in this session?', options: [{ label: 'Yes' }, { label: 'No' }] }] };
const optionsOnly = { questions: [{ question: 'Next step?', options: [{ label: 'Clear context' }, { label: 'Continue here', description: 'keep going' }] }] };
const unrelated = { questions: [{ question: 'Which branch name?', options: [{ label: 'a' }, { label: 'b' }] }] };

test('continuationAsked: question text or option labels with clear and continue, after the cutoff only', () => {
  const tx = (...r) => r.map((x) => JSON.stringify(x)).join('\n');
  const cut = Date.now() - 20 * 60_000;
  assert.equal(continuationAsked(tx(ask(5, clearQ)), cut), true, 'words in question text');
  assert.equal(continuationAsked(tx(ask(5, optionsOnly)), cut), true, 'words only in option labels');
  assert.equal(continuationAsked(tx(ask(5, unrelated)), cut), false, 'unrelated ask');
  assert.equal(continuationAsked(tx(ask(30, clearQ)), cut), false, 'asked before the cutoff');
});

test('after reflect read post-merge: blocks once for the continuation ask, then stays quiet', () => {
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
  const transcript_path = transcript(...mergeAt('c1', 30), reflectRead('r', 10));
  const first = runHook({ transcript_path }, home);
  assert.equal(first.code, 2);
  assert.match(first.stderr, /continuation\/SKILL\.md/);
  assert.equal(runHook({ transcript_path }, home).code, 0, 'one block per merge');
});

test('reflect landing PR (merge within 60 min after the read) also needs the continuation ask', () => {
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
  const transcript_path = transcript(reflectRead('r', 10), ...mergeAt('c2', 5));
  const r = runHook({ transcript_path }, home);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /continuation/);
});

test('a clear-or-continue ask after reflect satisfies the gate (either shape)', () => {
  for (const input of [clearQ, optionsOnly]) {
    const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
    const transcript_path = transcript(...mergeAt('c3', 30), reflectRead('r', 10), ask(2, input));
    assert.equal(runHook({ transcript_path }, home).code, 0);
  }
});

test('an unrelated ask, or a clear-or-continue ask before the reflect read, still blocks', () => {
  const h1 = mkdtempSync(join(tmpdir(), 'gate-home-'));
  assert.equal(runHook({ transcript_path: transcript(...mergeAt('c4', 30), reflectRead('r', 10), ask(2, unrelated)) }, h1).code, 2);
  const h2 = mkdtempSync(join(tmpdir(), 'gate-home-'));
  assert.equal(runHook({ transcript_path: transcript(...mergeAt('c5', 30), ask(20, clearQ), reflectRead('r', 10)) }, h2).code, 2);
});

test('no reflect read: only the reflect reminder applies, and the continuation gate stays quiet after it', () => {
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
  const transcript_path = transcript(...mergeAt('c6', 30));
  const first = runHook({ transcript_path }, home);
  assert.equal(first.code, 2);
  assert.match(first.stderr, /reflect now/);
  assert.equal(runHook({ transcript_path }, home).code, 0);
});

test('old state files without cont still work, and cont keeps the reminder ids', () => {
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
  const transcript_path = transcript(...mergeAt('c7', 30), reflectRead('r', 10));
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'stop-reflect-gate.json'), JSON.stringify({ ids: ['c7'] }));
  assert.equal(runHook({ transcript_path }, home).code, 2, 'reminder already handled, continuation gate fires');
  const state = JSON.parse(readFileSync(join(home, '.claude', 'stop-reflect-gate.json'), 'utf8'));
  assert.deepEqual(state, { ids: ['c7'], cont: ['c7'] });
});

test('stop_hook_active passes even when the second-gate conditions are met', () => {
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
  const transcript_path = transcript(...mergeAt('c1b', 30), reflectRead('r', 10));
  assert.equal(runHook({ transcript_path, stop_hook_active: true }, home).code, 0);
  assert.equal(runHook({ transcript_path }, home).code, 2, 'the passed retry recorded nothing');
});

test('a previous wave clear-or-continue ask does not satisfy the next wave merge', () => {
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
  const transcript_path = transcript(...mergeAt('w1', 70), reflectRead('r', 50), ask(45, clearQ), ...mergeAt('w2', 20));
  assert.equal(runHook({ transcript_path }, home).code, 2, 'the ask predates the newest merge');
});
