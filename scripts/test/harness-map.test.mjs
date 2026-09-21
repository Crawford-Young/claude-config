// node --test scripts/test/harness-map.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMap, harnessFiles, render } from '../harness-map.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A throwaway repo with one of each harness part. */
function fixture() {
  const r = mkdtempSync(join(tmpdir(), 'hmap-'));
  for (const d of ['skills/plan', 'hooks', 'agents', 'scripts', 'workspace']) mkdirSync(join(r, d), { recursive: true });
  for (const f of ['skills/plan/SKILL.md', 'hooks/guard.mjs', 'hooks/README.md', 'agents/recon.md', 'agents/README.md', 'scripts/qa.mjs', 'scripts/x.template.html', 'workspace/CLAUDE.md'])
    writeFileSync(join(r, f), 'x');
  return r;
}
const node = (id, file, extra = {}) => ({ id, kind: 'script', label: id, file, ...extra });
const full = () => ({
  nodes: [node('a', 'skills/plan/SKILL.md'), node('b', 'hooks/guard.mjs'), node('c', 'agents/recon.md'), node('d', 'scripts/qa.mjs'), node('e', 'workspace/CLAUDE.md'), node('x', '~/.claude/settings.json', { external: true })],
  edges: [{ from: 'a', to: 'd', kind: 'invokes' }],
});

test('harnessFiles lists skills, hooks, agents, scripts and CLAUDE.md — not READMEs or templates', () => {
  assert.deepEqual(harnessFiles(fixture()), ['agents/recon.md', 'hooks/guard.mjs', 'scripts/qa.mjs', 'skills/plan/SKILL.md', 'workspace/CLAUDE.md']);
});

test('a complete map is clean; external nodes are not looked up on disk', () => {
  assert.deepEqual(checkMap(full(), fixture()), []);
});

test('an unmapped harness file is drift', () => {
  const r = fixture();
  writeFileSync(join(r, 'hooks', 'new-hook.mjs'), 'x');
  assert.deepEqual(checkMap(full(), r), ['hooks/new-hook.mjs has no node in harness-map.json']);
});

test('a node whose file is gone, a dangling edge, and a duplicate id are drift', () => {
  const m = full();
  m.nodes.push(node('gone', 'scripts/removed.mjs'), node('a', 'skills/plan/SKILL.md'));
  m.edges.push({ from: 'a', to: 'nobody', kind: 'reads' });
  const p = checkMap(m, fixture());
  assert.ok(p.includes('node gone: file scripts/removed.mjs does not exist'));
  assert.ok(p.includes('edge a → nobody: no node nobody'));
  assert.ok(p.includes('duplicate node id a'));
});

test('render inlines the map with < escaped so it cannot close the script tag', () => {
  const html = render({ nodes: [node('a', 'f', { summary: '</script>' })], edges: [] }, '<script>__DATA__</script>', 'today');
  assert.ok(!html.slice(8, -9).includes('</script>'));
  assert.equal(JSON.parse(html.slice(8, -9)).generated, 'today');
});

test('the real harness-map.json matches the real repo', () => {
  const map = JSON.parse(readFileSync(join(repoRoot, 'harness-map.json'), 'utf8'));
  assert.deepEqual(checkMap(map), []);
});
