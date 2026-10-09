// node --test scripts/test/qa.test.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnHarness } from './_spawn.mjs';
import { discoverGates, gateVerdict } from '../qa.mjs';

const qaScript = join(dirname(fileURLToPath(import.meta.url)), '..', 'qa.mjs');
const made = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

function repo(files) {
  const r = mkdtempSync(join(tmpdir(), 'qa-'));
  made.push(r);
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(join(r, f, '..'), { recursive: true });
    writeFileSync(join(r, f), body);
  }
  return r;
}
const names = (r) => discoverGates(r).map((g) => g.name);

test('marker files give claude-config-style repos their gates', () => {
  const r = repo({
    'scripts/test/a.test.mjs': '',
    'scripts/verify-frontmatter.mjs': '',
    'scripts/harness-map.mjs': '',
  });
  const gates = discoverGates(r);
  assert.deepEqual(gates.map((g) => g.name), ['test', 'frontmatter', 'harness-map']);
  assert.equal(gates[0].cmd, 'node --test "scripts/test/*.test.mjs"');
  assert.equal(gates[1].cmd, 'node scripts/verify-frontmatter.mjs');
  assert.equal(gates[2].cmd, 'node scripts/harness-map.mjs check');
});

test('scripts/test without any *.test.mjs yields no test gate', () => {
  assert.deepEqual(names(repo({ 'scripts/test/_spawn.mjs': '' })), []);
});

test('justfile check and package.json still win over markers', () => {
  const markers = { 'scripts/test/a.test.mjs': '', 'scripts/harness-map.mjs': '' };
  assert.deepEqual(names(repo({ ...markers, justfile: 'check:\n  echo' })), ['check']);
  assert.deepEqual(names(repo({ ...markers, 'package.json': '{"scripts":{"test":"x"}}' })), ['test']);
  assert.equal(discoverGates(repo({ ...markers, 'package.json': '{"scripts":{"test":"x"}}' }))[0].cmd, 'pnpm test');
});

test('a node --test gate with no "tests N" (N>=1) line fails even on exit 0', () => {
  const g = { name: 'test', cmd: 'node --test "scripts/test/*.test.mjs"' };
  assert.equal(gateVerdict(g, 0, 'ℹ tests 0\nℹ pass 0\n').ok, false);
  assert.match(gateVerdict(g, 0, 'ℹ tests 0\n').reason, /tests/);
  assert.equal(gateVerdict(g, 0, 'nothing here').ok, false);
  assert.equal(gateVerdict(g, 0, 'ℹ tests 12\nℹ pass 12\n').ok, true);
  assert.equal(gateVerdict(g, 1, 'ℹ tests 12\n').ok, false);
  // a passing test titled "tests 0 ..." must not be read as the summary line
  assert.equal(gateVerdict(g, 0, '✔ tests 0 edge cases (1ms)\nℹ tests 3\nℹ pass 3\n').ok, true);
  assert.equal(gateVerdict(g, 0, '# tests 4\n# pass 4\n').ok, true);
  assert.equal(gateVerdict({ name: 'lint', cmd: 'pnpm lint' }, 0, '').ok, true);
});

test('CLI --list prints the marker gates (main guard does not make the script a no-op)', () => {
  const r = spawnHarness(qaScript, [repo({ '.git': '', 'scripts/test/a.test.mjs': '', 'scripts/verify-frontmatter.mjs': '', 'scripts/harness-map.mjs': '' }), '--list']);
  assert.equal(r.status, 0);
  const out = `${r.stdout}${r.stderr}`;
  for (const n of ['test:', 'frontmatter:', 'harness-map:']) assert.ok(out.includes(n), out);
});
