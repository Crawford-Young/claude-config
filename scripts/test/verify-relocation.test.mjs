import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(HERE, '..', 'verify-relocation.mjs');
const FIX = resolve(HERE, 'fixtures');

/** Run the gate with args; return { status, out }. Never throws on non-zero exit. */
function runGate(args) {
  const r = spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const BASELINE = ['--baseline', resolve(FIX, 'baseline-a.md')];

test('a paragraph living only in an archival destination is UNREACHABLE, not a pass', () => {
  const { status, out } = runGate([...BASELINE, '--dest', `${resolve(FIX, 'archive.md')}:archival`]);
  assert.equal(status, 1);
  assert.match(out, /UNREACHABLE/);
  assert.doesNotMatch(out, /PASS:/);
});

test('the same paragraph in an on-demand destination passes', () => {
  const { status, out } = runGate([...BASELINE, '--dest', `${resolve(FIX, 'live.md')}:on-demand`]);
  assert.equal(status, 0);
  assert.match(out, /PASS:/);
});

test('an always-loaded destination passes too', () => {
  const { status } = runGate([...BASELINE, '--dest', `${resolve(FIX, 'live.md')}:always`]);
  assert.equal(status, 0);
});

test('a destination with no class aborts rather than defaulting', () => {
  const { status, out } = runGate([...BASELINE, '--dest', resolve(FIX, 'live.md')]);
  assert.notEqual(status, 0);
  assert.match(out, /classify/i);
});

test('a destination with an unknown class aborts', () => {
  const { status, out } = runGate([...BASELINE, '--dest', `${resolve(FIX, 'live.md')}:sometimes`]);
  assert.notEqual(status, 0);
  assert.match(out, /classify/i);
});

test('an un-junctioned skill directory is archival, so its content reads UNREACHABLE', () => {
  const { status, out } = runGate([
    ...BASELINE,
    '--skills-root',
    resolve(FIX, 'skills-root'),
    '--junction-root',
    resolve(FIX, 'junction-root'),
  ]);
  assert.equal(status, 1);
  assert.match(out, /UNREACHABLE/);
});

test('the same skill directory with its junction present is on-demand and passes', () => {
  const { status } = runGate([
    ...BASELINE,
    '--skills-root',
    resolve(FIX, 'skills-root'),
    '--junction-root',
    resolve(FIX, 'junction-root-linked'),
  ]);
  assert.equal(status, 0);
});

test('a paragraph allowlisted as archival-by-design is exempt, not a blocker', () => {
  const { status, out } = runGate([
    ...BASELINE,
    '--dest',
    `${resolve(FIX, 'archive.md')}:archival`,
    '--archive-ok',
    'A relocated rule that must be reachable',
  ]);
  assert.equal(status, 0);
  assert.match(out, /ARCHIVED BY DESIGN/);
});
