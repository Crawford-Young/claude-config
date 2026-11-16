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

function pkgDir(pkg, files = ['pnpm-lock.yaml']) {
  const d = dir(files);
  writeFileSync(join(d, 'package.json'), JSON.stringify(pkg));
  return d;
}

test('a pnpm-field repo with no packageManager installs with pnpm 10 (pnpm 11 ignores the field)', () => {
  const d = pkgDir({ pnpm: { overrides: { x: '1.0.0' } } });
  assert.deepEqual(installCommand(d), ['npx', '-y', 'pnpm@10.33.0', 'install']);
});

test('a pnpm-field repo pinned to pnpm 10 installs with its own pinned version', () => {
  const d = pkgDir({ packageManager: 'pnpm@10.4.1+sha512.abc', pnpm: { overrides: {} } });
  assert.deepEqual(installCommand(d), ['npx', '-y', 'pnpm@10.4.1', 'install']);
});

test('a pnpm-11 repo (packageManager pnpm@11) installs with plain pnpm, field or not', () => {
  assert.deepEqual(installCommand(pkgDir({ packageManager: 'pnpm@11.0.2', pnpm: {} })), ['pnpm', 'install']);
  assert.deepEqual(installCommand(pkgDir({ packageManager: 'pnpm@11.0.2' })), ['pnpm', 'install']);
});

test('a pnpm repo without a pnpm field, or with unreadable package.json, installs with plain pnpm', () => {
  assert.deepEqual(installCommand(pkgDir({ name: 'x' })), ['pnpm', 'install']);
  const bad = dir(['pnpm-lock.yaml']);
  writeFileSync(join(bad, 'package.json'), '{not json');
  assert.deepEqual(installCommand(bad), ['pnpm', 'install']);
});

test('a Bun repo stays bun install even when package.json has a pnpm field', () => {
  assert.deepEqual(installCommand(pkgDir({ pnpm: { overrides: {} } }, ['bun.lock'])), ['bun', 'install']);
});

test('installCommand is bun install in a Bun repo, else pnpm install', () => {
  assert.deepEqual(installCommand(dir(['bun.lock'])), ['bun', 'install']);
  assert.deepEqual(installCommand(dir(['bun.lockb'])), ['bun', 'install']);
  assert.deepEqual(installCommand(dir(['pnpm-lock.yaml'])), ['pnpm', 'install']);
  assert.deepEqual(installCommand(dir([])), ['pnpm', 'install']);
});
