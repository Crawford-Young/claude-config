import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = resolve(HERE, '..', 'verify-frontmatter.mjs');

const VALID = `---
name: demo-skill
description: Use when doing a thing — covers the thing and its neighbours.
---

# Demo Skill

Body text.
`;

const VALID_AGENT = `---
name: demo-agent
description: Handles one scoped task end-to-end — dispatched with a Goal/Scope block.
tools: Read, Grep, Glob
model: sonnet
---

You are a demo agent.
`;

/** Build a throwaway skills root holding one SKILL.md with the given body. */
function skillsRootWith(name, contents) {
  const root = mkdtempSync(join(tmpdir(), 'skills-'));
  mkdirSync(join(root, name));
  writeFileSync(join(root, name, 'SKILL.md'), contents, 'utf8');
  return root;
}

/** Build a throwaway agents root holding flat `<name>.md` files (the real agents/ layout). */
function agentsRootWith(files) {
  const root = mkdtempSync(join(tmpdir(), 'agents-'));
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(root, name), contents, 'utf8');
  }
  return root;
}

/** A throwaway skills root that is known-clean, for tests that aren't exercising skills. */
function validSkillsRoot() {
  return skillsRootWith('demo-skill', VALID);
}

/** A throwaway agents root that is known-clean, for tests that aren't exercising agents. */
function validAgentsRoot() {
  return agentsRootWith({ 'demo-agent.md': VALID_AGENT });
}

/**
 * Run the checker against explicit skills and agents roots. Every call passes BOTH flags
 * explicitly — the checker falls back to the live repo's real skills/ or agents/ directory
 * for whichever flag is omitted, and a test result must never depend on that live content.
 * Returns { status, out }; never throws on non-zero exit.
 */
function run(skillsRoot, agentsRoot) {
  const r = spawnSync(
    process.execPath,
    [CHECK, '--skills', skillsRoot, '--agents', agentsRoot],
    { encoding: 'utf8' },
  );
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Run with a fixed valid agents root, varying only the skills root under test. */
function runSkillsCheck(skillsRoot) {
  const agentsRoot = validAgentsRoot();
  try {
    return run(skillsRoot, agentsRoot);
  } finally {
    rmSync(agentsRoot, { recursive: true, force: true });
  }
}

/** Run with a fixed valid skills root, varying only the agents root under test. */
function runAgentsCheck(agentsRoot) {
  const skillsRoot = validSkillsRoot();
  try {
    return run(skillsRoot, agentsRoot);
  } finally {
    rmSync(skillsRoot, { recursive: true, force: true });
  }
}

test('a well-formed SKILL.md passes', () => {
  const root = skillsRootWith('demo-skill', VALID);
  try {
    const { status } = runSkillsCheck(root);
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
    const { status, out } = runSkillsCheck(root);
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
    const { status } = runSkillsCheck(root);
    assert.equal(status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing description key fails', () => {
  const root = skillsRootWith('demo-skill', VALID.split('\n').filter((l) => !l.startsWith('description:')).join('\n'));
  try {
    const { status, out } = runSkillsCheck(root);
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
    const { status } = runSkillsCheck(root);
    assert.equal(status, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('frontmatter with no closing delimiter fails', () => {
  const root = skillsRootWith('demo-skill', VALID.replace(/^---\n/m, '').replace('---\n\n# Demo', '\n# Demo'));
  try {
    const { status } = runSkillsCheck(root);
    assert.equal(status, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Same exit contract as verify-relocation.mjs: 0 pass, 1 a real problem, 2 could not run.
// Kept distinct on purpose — a checker that cannot find its input must not look like a clean run.
test('a missing skills root exits 2, not 0 and not 1', () => {
  const { status } = runSkillsCheck(resolve(tmpdir(), 'definitely-not-a-skills-root-9271'));
  assert.equal(status, 2);
});

test('a well-formed agent .md passes', () => {
  const root = agentsRootWith({ 'demo-agent.md': VALID_AGENT });
  try {
    const { status } = runAgentsCheck(root);
    assert.equal(status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a colon-space inside an unquoted agent description is a failure, not a pass', () => {
  const root = agentsRootWith({
    'demo-agent.md': VALID_AGENT.replace('dispatched with', 'note: dispatched with'),
  });
  try {
    const { status, out } = runAgentsCheck(root);
    assert.equal(status, 1);
    assert.match(out, /colon/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The agents/ layout is flat `<name>.md` files, not `<dir>/SKILL.md` subdirectories. An
// enumerator that still looked for SKILL.md nested a directory deep (i.e. the skills
// enumerator, re-pointed but not rewritten) would find nothing here and silently report
// "agents checked: 0" with exit 0 — a clean-looking pass that checked nothing at all. This
// is the regression test for exactly that bug class: the count must be non-zero and must
// match the number of real agent-definition files in the root.
test('a flat directory of agent .md files is actually enumerated, not silently skipped', () => {
  const root = agentsRootWith({
    'one-agent.md': VALID_AGENT,
    'two-agent.md': VALID_AGENT.replace('demo-agent', 'two-agent'),
    'three-agent.md': VALID_AGENT.replace('demo-agent', 'three-agent'),
  });
  try {
    const { status, out } = runAgentsCheck(root);
    assert.equal(status, 0);
    assert.match(out, /agents checked: 3\b/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// agents/ROUTING.md is a declared exclusion (NON_AGENT_DOCS), not an inference from its
// content — it must be skipped (not counted, not failed) regardless of what it contains.
test('a file on the declared non-agent-doc exclusion list is skipped, not failed', () => {
  const root = agentsRootWith({
    'demo-agent.md': VALID_AGENT,
    'ROUTING.md': '# Model Routing\n\nSome reference table, no frontmatter at all.\n',
  });
  try {
    const { status, out } = runAgentsCheck(root);
    assert.equal(status, 0);
    assert.match(out, /agents checked: 1\b/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The critical regression this checker must never reintroduce: a real agent definition
// (not on the NON_AGENT_DOCS list) that loses its frontmatter must be counted AND fail,
// never silently excluded from the count the way "classify by whether it opens with ---"
// used to exclude it. Two agent files are used so a wrong fix that also fails to count the
// broken one can't coincidentally still show "agents checked: 1" and look plausible.
test('a real agent def that loses its frontmatter is counted and fails, not silently excluded', () => {
  const root = agentsRootWith({
    'demo-agent.md': VALID_AGENT,
    'implementer.md': VALID_AGENT.split('\n').slice(6).join('\n'), // strips the whole --- block
  });
  try {
    const { status, out } = runAgentsCheck(root);
    assert.equal(status, 1);
    assert.match(out, /agents checked: 2\b/);
    assert.match(out, /implementer\.md: no frontmatter/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an agents root that yields zero checked files is a checker failure, not a clean pass', () => {
  const root = agentsRootWith({
    'ROUTING.md': '# Model Routing\n\nNo frontmatter here either.\n',
  });
  try {
    const { status, out } = runAgentsCheck(root);
    assert.equal(status, 2);
    assert.match(out, /agents enumerator/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a skills root that yields zero checked files is a checker failure, not a clean pass', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-'));
  try {
    const { status, out } = runSkillsCheck(root);
    assert.equal(status, 2);
    assert.match(out, /skills enumerator/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing agents root exits 2, not 0 and not 1', () => {
  const { status } = runAgentsCheck(resolve(tmpdir(), 'definitely-not-an-agents-root-4471'));
  assert.equal(status, 2);
});
