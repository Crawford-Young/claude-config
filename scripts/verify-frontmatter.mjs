#!/usr/bin/env node
/**
 * verify-frontmatter.mjs — every SKILL.md and agent definition publishes usable frontmatter.
 *
 * Why this exists, and why it is separate from verify-relocation.mjs:
 * a skill whose frontmatter fails to parse is listed by its H1 with NO description at all,
 * which is the most unreachable a skill can be. The relocation gate cannot see this class —
 * it compares body paragraphs and never reads frontmatter — so a skill can be completely
 * unroutable with that gate fully green. (2026-07-28 description-audit, issue #3: a `: `
 * written into a description silently unpublished a skill; it was caught by luck.)
 *
 * Agent definitions in agents/ carry the same failure mode and the same fix, but a
 * structurally different layout: skills are `<dir>/SKILL.md`, agents are flat `<name>.md`
 * files directly in the root. The two roots are checked with separate enumerators below —
 * re-pointing the skills enumerator at a flat directory would silently find zero files and
 * report a clean "0 checked" pass, which is exactly the kind of unroutable-but-green result
 * this checker exists to prevent. See the zero-count assertion after both roots are checked.
 *
 * agents/ROUTING.md is a routing reference doc, never loaded by Claude Code as a subagent
 * type, and it carries no frontmatter. It is excluded via the declared NON_AGENT_DOCS list
 * below, NOT by inferring "no frontmatter opener means not an agent def" from the file's own
 * content. That inference was tried and reverted (2026-09-04): it made the classifier and the
 * validator the same test, so a real agent def that lost its frontmatter block (e.g. a bad
 * edit) was silently excluded from the count instead of failing — worse than the bug this
 * checker exists to catch, and verified by reproduction (stripping implementer.md's
 * frontmatter dropped "agents checked" from 7 to 6 with a silent PASS). Every `.md` file not
 * on NON_AGENT_DOCS is now always counted and always required to publish valid frontmatter,
 * exactly like SKILL.md.
 *
 * Exit contract, deliberately identical to verify-relocation.mjs:
 *   0  every checked file publishes cleanly
 *   1  the checker ran and found a real problem
 *   2  the checker could not run (bad/missing root, or a root's enumerator found zero files
 *      to check — the latter is its own class of "could not run": a structurally broken
 *      enumerator must never look like a clean sweep)
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SKILLS = resolve(HERE, '..', 'skills');
const DEFAULT_AGENTS = resolve(HERE, '..', 'agents');

const argv = process.argv.slice(2);
const skillsIdx = argv.indexOf('--skills');
const SKILLS_ROOT = skillsIdx === -1 ? DEFAULT_SKILLS : resolve(argv[skillsIdx + 1] ?? '');
const agentsIdx = argv.indexOf('--agents');
const AGENTS_ROOT = agentsIdx === -1 ? DEFAULT_AGENTS : resolve(argv[agentsIdx + 1] ?? '');

for (const [label, root] of [
  ['skills', SKILLS_ROOT],
  ['agents', AGENTS_ROOT],
]) {
  if (!root || !existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`ABORT: no ${label} directory at ${root}`);
    process.exit(2);
  }
}

const REQUIRED = ['name', 'description'];
/** Values opening with these are quoted or block scalars — YAML parses the colon fine. */
const SAFE_OPENERS = ["'", '"', '|', '>'];

/**
 * Declared, auditable exclusion list for the agents root: files that are not agent
 * definitions Claude Code loads as a subagent type, so they are never expected to carry
 * frontmatter at all. Adding to this list is a visible diff line, not an inferred property
 * of a file's content — see the file-header comment for why that distinction matters.
 */
const NON_AGENT_DOCS = ['ROUTING.md'];

/** Enumerate `<dir>/SKILL.md` for every subdirectory of root that has one. */
function enumerateSkills(root) {
  const entries = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(root, entry.name, 'SKILL.md');
    if (!existsSync(file)) continue;
    entries.push({ file, rel: `${entry.name}/SKILL.md` });
  }
  return entries;
}

/** Enumerate flat `<name>.md` files directly in root — the agents/ layout — minus NON_AGENT_DOCS. */
function enumerateAgents(root) {
  const entries = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (NON_AGENT_DOCS.includes(entry.name)) continue;
    entries.push({ file: join(root, entry.name), rel: entry.name });
  }
  return entries;
}

/**
 * Check one root's frontmatter. Every entry passed in is always counted and always required
 * to open with `---` and publish valid REQUIRED keys — there is no content-based skip here;
 * exclusion happens once, up front, in the enumerator (NON_AGENT_DOCS), never inside the
 * validator itself.
 */
function checkRoot(entries) {
  const problems = [];
  let checked = 0;

  for (const { file, rel } of entries) {
    checked++;
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);

    if (lines[0]?.trim() !== '---') {
      problems.push(`${rel}: no frontmatter — the file must open with a --- delimiter`);
      continue;
    }

    const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (close === -1) {
      problems.push(`${rel}: frontmatter is never closed — no second --- delimiter`);
      continue;
    }

    const fields = new Map();
    for (const line of lines.slice(1, close)) {
      const m = /^([A-Za-z_][\w-]*):(.*)$/.exec(line);
      if (m) fields.set(m[1], m[2].trim());
    }

    for (const key of REQUIRED) {
      if (!fields.has(key)) {
        problems.push(`${rel}: missing required frontmatter key "${key}"`);
        continue;
      }
      const value = fields.get(key);
      if (value === '') {
        problems.push(`${rel}: "${key}" is empty`);
        continue;
      }
      if (SAFE_OPENERS.includes(value[0])) continue;
      if (/:(\s|$)/.test(value)) {
        problems.push(
          `${rel}: "${key}" contains an unquoted colon, which truncates the value and unpublishes the skill — use an em-dash, or quote the whole value`,
        );
      }
    }
  }

  return { checked, problems };
}

const skillsResult = checkRoot(enumerateSkills(SKILLS_ROOT));
const agentsResult = checkRoot(enumerateAgents(AGENTS_ROOT));

console.log(`skills checked: ${skillsResult.checked}`);
console.log(`agents checked: ${agentsResult.checked}`);

// Both roots are always fully checked before any decision is made, and every real problem
// from both roots is always printed in this one run — an operator should never have to fix
// one root, re-run CI, and only then discover the other root also had a problem.
const problems = [...skillsResult.problems, ...agentsResult.problems];
if (problems.length > 0) {
  console.error(`\n--- UNPUBLISHABLE FRONTMATTER (${problems.length}) — BLOCKER ---`);
  for (const p of problems) console.error(`  ${p}`);
}

const zeroCountRoots = [];
if (skillsResult.checked === 0) zeroCountRoots.push(['skills', SKILLS_ROOT]);
if (agentsResult.checked === 0) zeroCountRoots.push(['agents', AGENTS_ROOT]);

if (zeroCountRoots.length > 0) {
  for (const [label, root] of zeroCountRoots) {
    console.error(
      `ABORT: 0 files were frontmatter-checked by the ${label} enumerator at ${root} — this means the ${label} enumerator is broken for this root's layout, not that the root is clean.`,
    );
  }
  process.exit(2);
}

if (problems.length > 0) {
  console.error(`\nFAIL: ${problems.length} problem(s).`);
  process.exit(1);
}

console.log('PASS: every SKILL.md and agent definition publishes a name and description.');
