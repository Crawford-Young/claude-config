// node --test scripts/test/checklist.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { taskLines } from '../checklist.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'checklist.mjs');
const runCli = (args, opts = {}) => execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', ...opts });

test('taskLines skips fenced examples', () => {
  const text = ['- [ ] real task', '```', '- [ ] fenced example', '```', '- [x] done task'].join('\n');
  const { tasks } = taskLines(text);
  assert.equal(tasks.length, 2);
  assert.equal(tasks.filter((t) => t.done).length, 1);
});

test('new + tick + status + done round-trip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cl-'));
  const project = join(dir, 'proj');
  mkdirSync(project, { recursive: true });

  const file = runCli(['new', project, 'wave-1', '--branch', 'feat/x']).trim();
  assert.ok(existsSync(file));
  assert.match(readFileSync(file, 'utf8'), /feat\/x/);

  runCli(['tick', file, 'Task 1', '--note', 'went fine']);
  const after = readFileSync(file, 'utf8');
  assert.match(after, /- \[x\] \*\*Task 1\*\*.*went fine <!-- done \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z -->/);

  // status exits 1 while reflect is unticked
  assert.throws(() => runCli(['status', file]));
  runCli(['tick', file, 'Reflect']);
  runCli(['status', file]);

  runCli(['done', file]);
  assert.ok(!existsSync(file));
  assert.ok(existsSync(join(project, 'checklists', 'done', 'wave-1.md')));
});

test('done refuses with open tasks unless --force', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cl-'));
  const project = join(dir, 'proj');
  mkdirSync(project, { recursive: true });
  const file = runCli(['new', project, 'wave-2']).trim();
  assert.throws(() => runCli(['done', file]));
  runCli(['done', file, '--force']);
  assert.ok(existsSync(join(project, 'checklists', 'done', 'wave-2.md')));
});
