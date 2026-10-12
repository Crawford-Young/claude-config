// node --test scripts/test/main-guard.test.mjs
// #129: the main guard must hold when a script is invoked through a junction or symlink.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnHarness } from './_spawn.mjs';
import { isMain } from '../lib.mjs';

const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const made = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
const tmp = (prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
};

test('qa.mjs --list still lists gates when invoked through a junction/symlink to scripts/', () => {
  const link = join(tmp('main-guard-'), 'linked-scripts');
  symlinkSync(scriptsDir, link, process.platform === 'win32' ? 'junction' : 'dir');
  const repo = tmp('main-guard-repo-');
  for (const f of ['.git', 'scripts/test/a.test.mjs', 'scripts/verify-frontmatter.mjs', 'scripts/harness-map.mjs']) {
    mkdirSync(join(repo, f, '..'), { recursive: true });
    writeFileSync(join(repo, f), '');
  }
  const r = spawnHarness(join(link, 'qa.mjs'), [repo, '--list']);
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 0, out);
  for (const n of ['test:', 'frontmatter:', 'harness-map:']) assert.ok(out.includes(n), out);
});

test('isMain is false when argv[1] is missing', () => {
  const saved = process.argv[1];
  try {
    process.argv.length = 1;
    assert.equal(isMain(import.meta.url), false);
  } finally {
    process.argv[1] = saved;
  }
});

test('isMain is false when a path does not exist', () => {
  const saved = process.argv[1];
  try {
    process.argv[1] = join(tmpdir(), 'main-guard-does-not-exist.mjs');
    assert.equal(isMain(import.meta.url), false);
    process.argv[1] = saved;
    assert.equal(isMain(pathToFileURL(join(tmpdir(), 'main-guard-does-not-exist.mjs')).href), false);
  } finally {
    process.argv[1] = saved;
  }
});

test('isMain is true when argv[1] is the module itself', () => {
  assert.equal(isMain(import.meta.url), true);
});
