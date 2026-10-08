// node --test scripts/test/stop-reflect-gate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lastMerge } from '../../hooks/stop-reflect-gate.mjs';

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
    execFileSync(process.execPath, [hook], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: { ...process.env, HOME: home, USERPROFILE: home },
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
