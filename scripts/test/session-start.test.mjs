// node --test scripts/test/session-start.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const hook = join(repo, 'hooks', 'session-start.mjs');
const index = readFileSync(join(repo, 'skills', 'INDEX.md'), 'utf8').replace(/\r\n/g, '\n').trim();

/** Run the hook against an empty docs root, so no checklist lines muddy the output. */
function runHook(payload) {
  const docs = mkdtempSync(join(tmpdir(), 'ss-'));
  return execFileSync(process.execPath, [hook], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, STOP_GATE_DOCS_ROOT: docs },
  }).replace(/\r\n/g, '\n');
}

test('the skill index leads with the Read-not-Skill-tool instruction and stays within 1 KB', () => {
  assert.match(index.split('\n')[0], /Read the path; skills are not Skill-tool invocable\./);
  assert.ok(Buffer.byteLength(index, 'utf8') <= 1024, `INDEX.md is ${Buffer.byteLength(index, 'utf8')} B`);
});

for (const source of ['startup', 'clear', 'resume', 'compact']) {
  test(`the skill index is injected on source=${source}`, () => {
    assert.ok(runHook({ source }).includes(index));
  });
}

test('the post-compaction reminder says Read, never re-invoke', () => {
  const out = runHook({ source: 'compact' });
  assert.match(out, /Post-compaction/);
  assert.doesNotMatch(out, /invoke/i);
});
