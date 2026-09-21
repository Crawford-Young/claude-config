#!/usr/bin/env node
/**
 * harness-map.mjs — keeps harness-map.json true to the repo, and renders it.
 *
 *   node scripts/harness-map.mjs check            (CI; exit 1 on any drift)
 *   node scripts/harness-map.mjs render <out.html>
 *
 * Why: the map is what agents read instead of opening twenty files to learn how
 * the harness is wired. A map built by reading (2026-09-21) cost a subagent ~55k
 * tokens and still came back with wrong edges. So it's curated once and kept
 * honest mechanically: every skill, hook, agent def, script and CLAUDE.md in the
 * repo must have a node, every node's in-repo file must exist, and every edge
 * must join real nodes. Edges themselves are judgment, and they're reviewed in the PR.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const list = (root, dir, re) =>
  existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter((f) => re.test(f)).map((f) => `${dir}/${f}`) : [];

/** Every file that must appear on the map. README.md files and tests are not harness parts. */
export function harnessFiles(root = repoRoot) {
  const skills = existsSync(join(root, 'skills'))
    ? readdirSync(join(root, 'skills'), { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(root, 'skills', d.name, 'SKILL.md')))
        .map((d) => `skills/${d.name}/SKILL.md`)
    : [];
  const claudeMds = ['workspace/CLAUDE.md', ...['web', 'games', 'apps'].map((d) => `workspace/${d}/CLAUDE.md`)].filter((f) =>
    existsSync(join(root, f)),
  );
  return [
    ...skills,
    ...list(root, 'hooks', /\.(mjs|ps1)$/),
    ...list(root, 'agents', /\.md$/).filter((f) => !f.endsWith('README.md')),
    ...list(root, 'scripts', /\.(mjs|ps1)$/).filter((f) => !/\.template\./.test(f)),
    ...claudeMds,
  ].sort();
}

/** Drift between the map and the repo, as human-readable lines. Empty = clean. */
export function checkMap(map, root = repoRoot) {
  const problems = [];
  const ids = new Set();
  for (const n of map.nodes || []) {
    if (ids.has(n.id)) problems.push(`duplicate node id ${n.id}`);
    ids.add(n.id);
    if (n.file && !n.external && !existsSync(join(root, n.file))) problems.push(`node ${n.id}: file ${n.file} does not exist`);
  }
  for (const e of map.edges || []) {
    if (!ids.has(e.from)) problems.push(`edge ${e.from} → ${e.to}: no node ${e.from}`);
    if (!ids.has(e.to)) problems.push(`edge ${e.from} → ${e.to}: no node ${e.to}`);
  }
  const mapped = new Set((map.nodes || []).filter((n) => !n.external).map((n) => n.file));
  for (const f of harnessFiles(root)) if (!mapped.has(f)) problems.push(`${f} has no node in harness-map.json`);
  return problems;
}

/** The diagram page: the template with the map (and the commit it describes) inlined. */
export function render(map, template, generated) {
  const data = { ...map, generated };
  return template.replace('__DATA__', JSON.stringify(data).replace(/</g, '\\u003c'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, out] = process.argv.slice(2);
  const map = JSON.parse(readFileSync(join(repoRoot, 'harness-map.json'), 'utf8'));
  if (cmd === 'check') {
    const problems = checkMap(map);
    if (problems.length) {
      console.error(`harness-map.json has drifted from the repo:\n  ${problems.join('\n  ')}`);
      process.exit(1);
    }
    console.log(`PASS: harness-map.json covers ${harnessFiles().length} harness files (${map.nodes.length} nodes, ${map.edges.length} edges).`);
  } else if (cmd === 'render' && out) {
    const sha = spawnSync('git', ['-C', repoRoot, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout?.trim();
    const template = readFileSync(join(repoRoot, 'scripts', 'harness-map.template.html'), 'utf8');
    writeFileSync(out, render(map, template, `${new Date().toISOString().slice(0, 10)} from claude-config ${sha || '?'}`));
    console.log(`wrote ${out}`);
  } else {
    console.error('usage: harness-map.mjs check | render <out.html>');
    process.exit(2);
  }
}
