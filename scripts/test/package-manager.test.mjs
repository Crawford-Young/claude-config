// node --test scripts/test/package-manager.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './_spawn.mjs';
import { isBunRepo, installCommand } from '../lib.mjs';

function dir(files) {
  const d = tempDir('pm-');
  for (const f of files) writeFileSync(join(d, f), '');
  return d;
}

test('bun.lock or bun.lockb marks a Bun repo; pnpm-lock or no lockfile does not', () => {
  assert.equal(isBunRepo(dir(['bun.lock'])), true);
  assert.equal(isBunRepo(dir(['bun.lockb'])), true);
  assert.equal(isBunRepo(dir(['pnpm-lock.yaml'])), false);
  assert.equal(isBunRepo(dir([])), false);
});

test('installCommand is bun install in a Bun repo, else pnpm install', () => {
  assert.deepEqual(installCommand(dir(['bun.lock'])), ['bun', 'install']);
  assert.deepEqual(installCommand(dir(['bun.lockb'])), ['bun', 'install']);
  assert.deepEqual(installCommand(dir(['pnpm-lock.yaml'])), ['pnpm', 'install']);
  assert.deepEqual(installCommand(dir([])), ['pnpm', 'install']);
});
