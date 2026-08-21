// node --test scripts/test/stop-reflect-gate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { needsReflect } from '../../hooks/stop-reflect-gate.mjs';

const hook = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks', 'stop-reflect-gate.mjs');

function runHook(payload, docsRoot) {
  try {
    execFileSync(process.execPath, [hook], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: { ...process.env, STOP_GATE_DOCS_ROOT: docsRoot },
    });
    return { code: 0 };
  } catch (e) {
    return { code: e.status, stderr: e.stderr };
  }
}

test('needsReflect: all ticked except reflect → true', () => {
  assert.equal(needsReflect('- [x] Task 1\n- [ ] **Reflect** — run the reflect skill'), true);
  assert.equal(needsReflect('- [ ] Task 1\n- [ ] Reflect'), false); // real work open
  assert.equal(needsReflect('- [x] Task 1\n- [x] Reflect'), false); // reflect done
  assert.equal(needsReflect('no tasks here'), false);
});

test('reminds once, then lets the stop pass', () => {
  const docs = mkdtempSync(join(tmpdir(), 'gate-'));
  const active = join(docs, 'proj', 'checklists', 'active');
  mkdirSync(active, { recursive: true });
  writeFileSync(join(active, 'w1.md'), '- [x] Task 1 <!-- done 2026-08-21T00:00:00Z -->\n- [ ] Reflect\n');

  const first = runHook({}, docs);
  assert.equal(first.code, 2, 'first stop attempt should block with the reminder');
  assert.match(first.stderr, /prompt the user/i);

  const second = runHook({ stop_hook_active: true }, docs);
  assert.equal(second.code, 0, 'retry must pass — relaxed gate reminds once');
});

test('quiet when no checklist needs reflect', () => {
  const docs = mkdtempSync(join(tmpdir(), 'gate-'));
  assert.equal(runHook({}, docs).code, 0);
});
