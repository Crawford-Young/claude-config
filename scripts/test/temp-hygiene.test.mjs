// node --test scripts/test/temp-hygiene.test.mjs
// Test files make temp dirs only through _spawn.mjs `tempDir` (#275: 14k leaked wt-* dirs,
// 1.8 GB). It removes them with async fs/promises rm, because Node 24's rmSync throws EPERM
// at once on a dir a live process still holds and never retries (#172).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { spawnHarness, tempDir } from './_spawn.mjs';

const TEST_DIR = fileURLToPath(new URL('.', import.meta.url));
const SPAWN = join(TEST_DIR, '_spawn.mjs');
const MAKES = /\bmkdtemp(?:Sync)?\s*\(/;

/** True when `src` calls mkdtemp/mkdtempSync itself instead of going through tempDir. */
export const makesRawTempDir = (src) => MAKES.test(src);

test('matcher: any raw mkdtemp is flagged, even beside an unrelated rm()', () => {
  assert.equal(makesRawTempDir("const d = mkdtempSync(join(tmpdir(), 'x-'));"), true);
  assert.equal(makesRawTempDir("const d = await mkdtemp(join(tmpdir(), 'x-'));"), true);
  assert.equal(makesRawTempDir("const d = mkdtempSync(p);\nawait rm(other, { recursive: true });"), true, 'an rm() of something else is no cleanup');
  assert.equal(makesRawTempDir("const d = tempDir('x-');"), false);
});

test('no test file calls mkdtemp directly except _spawn.mjs', () => {
  const raw = readdirSync(TEST_DIR)
    .filter((f) => f.endsWith('.mjs') && f !== '_spawn.mjs' && f !== 'temp-hygiene.test.mjs')
    .filter((f) => makesRawTempDir(readFileSync(join(TEST_DIR, f), 'utf8')));
  assert.deepEqual(raw, [], 'use tempDir() from ./_spawn.mjs: it removes the dir when the test file finishes');
});

test('tempDir removes its dirs once the test file that made them exits', () => {
  const work = tempDir('temp-hygiene-');
  const out = join(work, 'made.txt');
  const fixture = join(work, 'fixture.test.mjs');
  writeFileSync(
    fixture,
    `import test from 'node:test';
import { writeFileSync } from 'node:fs';
import { tempDir } from ${JSON.stringify(pathToFileURL(SPAWN).href)};
test('makes a dir', () => {
  const d = tempDir('temp-hygiene-child-');
  writeFileSync(${JSON.stringify(out)}, d);
});
`,
  );
  // The runner marks its children with NODE_TEST_CONTEXT; a nested `--test` must not inherit it.
  const r = spawnHarness('--test', [fixture], { env: { NODE_TEST_CONTEXT: undefined } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const made = readFileSync(out, 'utf8');
  assert.match(made, /temp-hygiene-child-/);
  assert.equal(existsSync(made), false, 'the child test file left its tempDir behind');
});
