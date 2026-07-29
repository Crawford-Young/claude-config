import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = resolve(HERE, '..', 'verify-frontmatter.mjs');

/** Run the checker against a skills root; return { status, out }. Never throws on non-zero exit. */
function runCheck(skillsRoot) {
  const r = spawnSync(process.execPath, [CHECK, '--skills', skillsRoot], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Build a throwaway skills root holding one SKILL.md with the given body. */
function skillsRootWith(name, contents) {
  const root = mkdtempSync(join(tmpdir(), 'skills-'));
  mkdirSync(join(root, name));
  writeFileSync(join(root, name, 'SKILL.md'), contents, 'utf8');
  return root;
}

const VALID = `---
name: demo-skill
description: Use when doing a thing — covers the thing and its neighbours.
---

# Demo Skill

Body text.
`;

test('a well-formed SKILL.md passes', () => {
  const root = skillsRootWith('demo-skill', VALID);
  try {
    const { status } = runCheck(root);
    assert.equal(status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The regression test for the bug this checker exists to catch. In an unquoted YAML scalar
// `: ` terminates the value, so the frontmatter fails to parse and the harness lists the skill
// with NO description — strictly more unreachable than a badly-worded one, and invisible to
// verify-relocation.mjs, which only ever reads body paragraphs.
test('a colon-space inside an unquoted description is a failure, not a pass', () => {
  const root = skillsRootWith(
    'demo-skill',
    VALID.replace('covers the thing', 'note: covers the thing'),
  );
  try {
    const { status, out } = runCheck(root);
    assert.equal(status, 1);
    assert.match(out, /colon/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a quoted description may contain a colon-space', () => {
  const root = skillsRootWith(
    'demo-skill',
    VALID.replace(
      'description: Use when doing a thing — covers the thing and its neighbours.',
      'description: "Use when doing a thing: covers the thing."',
    ),
  );
  try {
    const { status } = runCheck(root);
    assert.equal(status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing description key fails', () => {
  const root = skillsRootWith('demo-skill', VALID.split('\n').filter((l) => !l.startsWith('description:')).join('\n'));
  try {
    const { status, out } = runCheck(root);
    assert.equal(status, 1);
    assert.match(out, /description/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an empty description fails', () => {
  const root = skillsRootWith(
    'demo-skill',
    VALID.replace('description: Use when doing a thing — covers the thing and its neighbours.', 'description:   '),
  );
  try {
    const { status } = runCheck(root);
    assert.equal(status, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('frontmatter with no closing delimiter fails', () => {
  const root = skillsRootWith('demo-skill', VALID.replace(/^---\n/m, '').replace('---\n\n# Demo', '\n# Demo'));
  try {
    const { status } = runCheck(root);
    assert.equal(status, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Same exit contract as verify-relocation.mjs: 0 pass, 1 a real problem, 2 could not run.
// Kept distinct on purpose — a checker that cannot find its input must not look like a clean run.
test('a missing skills root exits 2, not 0 and not 1', () => {
  const { status } = runCheck(resolve(tmpdir(), 'definitely-not-a-skills-root-9271'));
  assert.equal(status, 2);
});
