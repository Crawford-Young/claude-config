#!/usr/bin/env node
/**
 * verify-frontmatter.mjs — every SKILL.md publishes a usable `name` and `description`.
 *
 * Why this exists, and why it is separate from verify-relocation.mjs:
 * a skill whose frontmatter fails to parse is listed by its H1 with NO description at all,
 * which is the most unreachable a skill can be. The relocation gate cannot see this class —
 * it compares body paragraphs and never reads frontmatter — so a skill can be completely
 * unroutable with that gate fully green. (2026-07-28 description-audit, issue #3: a `: `
 * written into a description silently unpublished a skill; it was caught by luck.)
 *
 * The colon rule is the load-bearing check. In an unquoted YAML scalar a colon followed by
 * whitespace (or ending the line) terminates the value, so `description: Use when X: does Y`
 * is not a long description — it is a parse error. Quoting the value makes it legal, so
 * quoted values are exempt rather than banned.
 *
 * Exit contract, deliberately identical to verify-relocation.mjs:
 *   0  every SKILL.md publishes cleanly
 *   1  the checker ran and found a real problem
 *   2  the checker could not run (bad or missing skills root) — kept distinct from 1 so a
 *      misconfigured invocation can never be mistaken for a clean sweep
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SKILLS = resolve(HERE, '..', 'skills');

const argv = process.argv.slice(2);
const skillsIdx = argv.indexOf('--skills');
const SKILLS_ROOT = skillsIdx === -1 ? DEFAULT_SKILLS : resolve(argv[skillsIdx + 1] ?? '');

if (!SKILLS_ROOT || !existsSync(SKILLS_ROOT) || !statSync(SKILLS_ROOT).isDirectory()) {
  console.error(`ABORT: no skills directory at ${SKILLS_ROOT}`);
  process.exit(2);
}

const REQUIRED = ['name', 'description'];
/** Values opening with these are quoted or block scalars — YAML parses the colon fine. */
const SAFE_OPENERS = ["'", '"', '|', '>'];

const problems = [];
let checked = 0;

for (const entry of readdirSync(SKILLS_ROOT, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const file = join(SKILLS_ROOT, entry.name, 'SKILL.md');
  if (!existsSync(file)) continue;
  checked++;

  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const rel = `${entry.name}/SKILL.md`;

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

console.log(`skills checked: ${checked}`);

if (problems.length > 0) {
  console.error(`\n--- UNPUBLISHABLE FRONTMATTER (${problems.length}) — BLOCKER ---`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(`\nFAIL: ${problems.length} problem(s).`);
  process.exit(1);
}

console.log('PASS: every SKILL.md publishes a name and description.');
