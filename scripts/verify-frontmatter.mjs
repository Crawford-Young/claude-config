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
 *
 * Resident-byte caps (issue #63): past the frontmatter-publishes check above, this script
 * also enforces that resident context — the bytes every session loads before doing any work —
 * cannot silently re-bloat. Three caps, reusing the same enumerators and parser as the
 * publishes-check above rather than a second YAML reader:
 *   - a per-description byte cap (every skill + agent description individually)
 *   - a total byte cap across all skill + agent descriptions combined
 *   - a byte cap per CLAUDE.md file
 * All three are set at today's measured value (2026-10-08), rounded UP to the next 256 B so
 * the cap itself never flickers red on an unrelated single-byte change, plus +768 B headroom
 * on the root CLAUDE.md for a concurrent PR (#61) already landing a small, known addition
 * there. Later issues (#64, #65, #66) lower these in one place — see CAPS below. Bytes are
 * measured as UTF-8 bytes with CRLF normalized to LF first, so Windows and CI agree.
 *
 * Skill index (issue #64): a skill flagged `disable-model-invocation: true` keeps its
 * description out of context (it only feeds the `/` menu), so it drops out of both description
 * caps. Routing to it moves to skills/INDEX.md, which session-start.mjs injects every session —
 * so INDEX.md is resident instead, under its own cap, and every skill must be listed in it by its
 * `<name>/SKILL.md` path. A flagged skill missing from the index is reachable only by `/name`,
 * the same unroutable-but-green class the frontmatter check above exists for.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const DEFAULT_SKILLS = resolve(REPO_ROOT, 'skills');
const DEFAULT_AGENTS = resolve(REPO_ROOT, 'agents');
const DEFAULT_WORKSPACE = REPO_ROOT;

const argv = process.argv.slice(2);
const skillsIdx = argv.indexOf('--skills');
const SKILLS_ROOT = skillsIdx === -1 ? DEFAULT_SKILLS : resolve(argv[skillsIdx + 1] ?? '');
const agentsIdx = argv.indexOf('--agents');
const AGENTS_ROOT = agentsIdx === -1 ? DEFAULT_AGENTS : resolve(argv[agentsIdx + 1] ?? '');
const workspaceIdx = argv.indexOf('--workspace');
const WORKSPACE_ROOT = workspaceIdx === -1 ? DEFAULT_WORKSPACE : resolve(argv[workspaceIdx + 1] ?? '');

for (const [label, root] of [
  ['skills', SKILLS_ROOT],
  ['agents', AGENTS_ROOT],
]) {
  if (!root || !existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`ABORT: no ${label} directory at ${root}`);
    process.exit(2);
  }
}

/**
 * Every cap in ONE obvious place — see file header. `perDescriptionBytes` and
 * `totalDescriptionBytes` are rounded-up-to-256 versions of the measured resident max (271 B,
 * agents/reviewer.md) and resident sum (768 B across 3 agents, #66; held one step above the exact 768 so it never flickers — all 14 skills are flagged,
 * 2026-10-08, #64). `skillIndexBytes` is the ≤1 KB budget for skills/INDEX.md.
 * `claudeMd` keys are repo-relative paths under WORKSPACE_ROOT; values are each file's
 * measured byte count rounded up to the next 256 B (root CLAUDE.md additionally gets +768 B
 * for the #61 headroom described above).
 */
const CAPS = {
  perDescriptionBytes: 512,
  totalDescriptionBytes: 1024,
  skillIndexBytes: 1024,
  claudeMd: {
    'workspace/CLAUDE.md': 11520,
    'workspace/web/CLAUDE.md': 7936,
    'workspace/games/CLAUDE.md': 7936,
    'workspace/apps/CLAUDE.md': 3072,
  },
};

/** UTF-8 byte length of a string, CRLF normalized to LF first so Windows checkouts and CI agree. */
function byteLength(str) {
  return Buffer.byteLength(str.replace(/\r\n/g, '\n'), 'utf8');
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
  const descriptions = [];
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

    const resident = fields.get('disable-model-invocation') !== 'true';
    if (resident && fields.has('description') && fields.get('description') !== '') {
      descriptions.push({ rel, bytes: byteLength(fields.get('description')) });
    }
  }

  return { checked, problems, descriptions };
}

/**
 * Resident-byte checks for the parsed descriptions of BOTH roots combined, per CAPS. Takes
 * already-parsed `{ rel, bytes }` entries (not a filesystem root) so it reuses the same
 * parser as checkRoot instead of re-reading files.
 */
function checkDescriptionCaps(descriptions) {
  const problems = [];
  for (const { rel, bytes } of descriptions) {
    if (bytes > CAPS.perDescriptionBytes) {
      problems.push(
        `${rel}: description is ${bytes} B, over the per-description cap of ${CAPS.perDescriptionBytes} B`,
      );
    }
  }
  const total = descriptions.reduce((sum, d) => sum + d.bytes, 0);
  if (total > CAPS.totalDescriptionBytes) {
    problems.push(
      `all descriptions combined: ${total} B, over the total cap of ${CAPS.totalDescriptionBytes} B`,
    );
  }
  return { problems, total };
}

/**
 * skills/INDEX.md (#64): must exist, stay under CAPS.skillIndexBytes, and name every skill's
 * `<name>/SKILL.md` path — session-start.mjs injects it as the only routing to flagged skills.
 */
function checkSkillIndex(skillsRoot, skillEntries) {
  const file = join(skillsRoot, 'INDEX.md');
  if (!existsSync(file)) {
    return { problems: [`INDEX.md: missing at ${file} — session-start would inject no skill routing`], bytes: 0 };
  }
  const text = readFileSync(file, 'utf8');
  const bytes = byteLength(text);
  const problems = [];
  if (bytes > CAPS.skillIndexBytes) {
    problems.push(`INDEX.md: ${bytes} B, over the cap of ${CAPS.skillIndexBytes} B`);
  }
  for (const { rel } of skillEntries) {
    if (!text.includes(rel)) problems.push(`INDEX.md: ${rel} is not listed — the skill is unroutable`);
  }
  return { problems, bytes };
}

/**
 * Recursively find every `CLAUDE.md` under `<workspaceRoot>/workspace`, so a new domain's
 * CLAUDE.md is caught the moment it exists — not only once someone remembers to add it to
 * CAPS.claudeMd. Returns paths relative to workspaceRoot (matching the CAPS.claudeMd key
 * shape, e.g. `workspace/web/CLAUDE.md`), sorted for deterministic output. Noise directories
 * (node_modules, dotdirs) are skipped; depth is capped the same way findActiveChecklists caps
 * it in lib.mjs, as a cheap guard against an accidental symlink loop.
 */
function findAllClaudeMdFiles(workspaceRoot) {
  const base = join(workspaceRoot, 'workspace');
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(p, depth + 1);
      } else if (entry.isFile() && entry.name === 'CLAUDE.md') {
        found.push(p);
      }
    }
  };
  walk(base, 0);
  return found
    .map((file) => file.slice(workspaceRoot.length + 1).replace(/\\/g, '/'))
    .sort();
}

/**
 * Byte cap per CLAUDE.md file, read relative to `workspaceRoot`. Checks BOTH directions: every
 * CAPS.claudeMd entry must exist on disk (unchanged from before), AND every CLAUDE.md actually
 * found on disk under workspace/ must have a CAPS.claudeMd entry — a new domain's CLAUDE.md
 * must never be resident context the gate silently never measures.
 */
function checkClaudeMdCaps(workspaceRoot) {
  const problems = [];
  const sizes = [];
  const onDisk = new Set(findAllClaudeMdFiles(workspaceRoot));

  for (const [rel, cap] of Object.entries(CAPS.claudeMd)) {
    const file = join(workspaceRoot, rel);
    if (!existsSync(file)) {
      problems.push(`${rel}: expected at ${file}, but it does not exist`);
      continue;
    }
    const bytes = byteLength(readFileSync(file, 'utf8'));
    sizes.push({ rel, bytes, cap });
    if (bytes > cap) {
      problems.push(`${rel}: ${bytes} B, over the cap of ${cap} B`);
    }
  }

  for (const rel of onDisk) {
    if (!(rel in CAPS.claudeMd)) {
      problems.push(`${rel}: found on disk with no cap in CAPS.claudeMd — add a cap for ${rel}`);
    }
  }

  return { problems, sizes };
}

const skillEntries = enumerateSkills(SKILLS_ROOT);
const skillsResult = checkRoot(skillEntries);
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

// Resident-byte caps (issue #63) — run regardless of the publishes-check result above, so one
// run always surfaces every class of problem rather than making an operator fix frontmatter,
// re-run, and only then discover a byte cap is also blown.
const allDescriptions = [...skillsResult.descriptions, ...agentsResult.descriptions];
const descriptionCapResult = checkDescriptionCaps(allDescriptions);
const claudeMdCapResult = checkClaudeMdCaps(WORKSPACE_ROOT);
const skillIndexResult = checkSkillIndex(SKILLS_ROOT, skillEntries);

console.log(`descriptions measured: ${allDescriptions.length} (${descriptionCapResult.total} B total)`);
console.log(`skills/INDEX.md: ${skillIndexResult.bytes} B (cap ${CAPS.skillIndexBytes} B)`);
for (const { rel, bytes, cap } of claudeMdCapResult.sizes) {
  console.log(`${rel}: ${bytes} B (cap ${cap} B)`);
}

const residentProblems = [
  ...descriptionCapResult.problems,
  ...skillIndexResult.problems,
  ...claudeMdCapResult.problems,
];
if (residentProblems.length > 0) {
  console.error(`\n--- RESIDENT BYTE CAP EXCEEDED (${residentProblems.length}) — BLOCKER ---`);
  for (const p of residentProblems) console.error(`  ${p}`);
}

const allProblems = [...problems, ...residentProblems];
if (allProblems.length > 0) {
  console.error(`\nFAIL: ${allProblems.length} problem(s).`);
  process.exit(1);
}

console.log(
  'PASS: every SKILL.md and agent definition publishes a name and description, and resident bytes are within cap.',
);
