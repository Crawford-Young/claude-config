// node --test scripts/test/source-hygiene.test.mjs
// Two hazards found in #77, made into failures instead of prose (#108).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { OVERRIDE_NAMES } from './_spawn.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// C1 controls, bidi marks, BOM. Escapes only: this file must not contain them literally.
const HAZARD = /[\u0080-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u;
const hex = (ch) => ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');

/** `file:line U+XXXX ...` for each hazardous character in `text`. */
function findHazards(file, text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    for (const ch of line) {
      if (HAZARD.test(ch)) {
        out.push(`${file}:${i + 1} U+${hex(ch)} - use a \\u${hex(ch).toLowerCase()} escape, not the literal character`);
      }
    }
  });
  return out;
}

/** Line numbers of calls spawning node (process.execPath or 'node') on something other than -e/-p. */
function bareSpawns(text) {
  const re = /\b(?:spawnSync|spawn|execFileSync|execFile)\(\s*(?:process\.execPath|'node'|"node")\s*,\s*(?!\s)(?!\[\s*['"]-[ep]['"])/g;
  return [...text.matchAll(re)].map((m) => text.slice(0, m.index).split('\n').length);
}

const listed = () =>
  execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);

/** File text, or null for a deleted-but-listed file or a binary (NUL byte). */
const readText = (f) => {
  let buf;
  try {
    buf = readFileSync(join(ROOT, f));
  } catch {
    return null;
  }
  return buf.subarray(0, 8000).includes(0) ? null : buf.toString('utf8');
};

test('findHazards flags C1, bidi and BOM with file:line and code point', () => {
  for (const s of ['a\u0085b', 'x\u200ey', 'x\u202ay', 'x\u2066y', '\ufeffz']) {
    assert.equal(findHazards('f.js', s).length, 1, JSON.stringify(s));
  }
  const msg = findHazards('f.js', 'ok\nok\u2067');
  assert.match(msg[0], /^f\.js:2 U\+2067 .*\\u2067 escape/);
  assert.deepEqual(findHazards('f.js', 'plain é — text \\u200e'), []);
});

test('no tracked text source contains literal C1 controls, bidi marks or a BOM', () => {
  const found = [];
  for (const f of listed()) {
    const text = readText(f);
    if (text !== null) found.push(...findHazards(f, text));
  }
  assert.deepEqual(found, []);
});

test('bareSpawns finds node-on-a-script spawns and ignores -e and git', () => {
  assert.deepEqual(bareSpawns('x\nspawnSync(process.execPath, [hook], {})'), [2]);
  assert.deepEqual(bareSpawns("execFileSync('node', [s, a])"), [1]);
  assert.deepEqual(bareSpawns("execFileSync(process.execPath, ['-e', 'x'])"), []);
  assert.deepEqual(bareSpawns("execFileSync('git', ['init'])"), []);
});

test('every test that spawns a harness script goes through scripts/test/_spawn.mjs', () => {
  const offenders = [];
  const self = 'scripts/test/source-hygiene.test.mjs'; // its detector samples contain spawn calls
  for (const f of listed().filter((p) => /\.test\.mjs$/.test(p) && p !== self)) {
    const text = readText(f);
    if (text === null) continue;
    for (const line of bareSpawns(text)) {
      offenders.push(`${f}:${line} spawns node on a script directly - use spawnHarness/execHarness from scripts/test/_spawn.mjs (temp HOME + ~/.claude overrides)`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the helper covers every CLAUDE_* path override the harness reads', () => {
  const src = execFileSync('git', ['grep', '-hoE', 'process\\.env\\.CLAUDE_[A-Z_]+', '--', 'hooks', 'scripts', 'statusline', ':!scripts/test'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const read = new Set(src.match(/CLAUDE_[A-Z_]+/g));
  // Not paths: identity, switches and thresholds (a test sets those per case).
  const notPaths = new Set(['CLAUDE_PID', 'CLAUDE_LAND_NO_GH', 'CLAUDE_SPEND_NO_REFRESH', 'CLAUDE_CTX_WINDOW', 'CLAUDE_CTX_NUDGE', 'CLAUDE_CTX_WARN', 'CLAUDE_CTX_BLOCK']);
  const missing = [...read].filter((n) => !notPaths.has(n) && !OVERRIDE_NAMES.includes(n));
  assert.deepEqual(missing, [], 'add these to PATH_OVERRIDES in scripts/test/_spawn.mjs (or to notPaths if not a path)');
});

test('no hook, script or statusline module uses the symlink-blind pathToFileURL(process.argv[1]) main guard (#129)', () => {
  const offenders = listed()
    .filter((p) => /^(hooks|scripts|statusline)\/.*\.mjs$/.test(p) && !p.startsWith('scripts/test/'))
    .filter((p) => (readText(p) ?? '').includes('pathToFileURL(process.argv[1])'));
  assert.deepEqual(offenders, [], 'use isMain(import.meta.url) from scripts/lib.mjs');
});

// ---- no harness script pushes or opens/merges a PR itself (#193) ------------
// bash-guard's push gate reads Bash command text only; a script that ran these
// internally would bypass the user-approval gate unseen. A remote branch delete is fine.

/** `git push` that deletes a remote branch (`--delete`, `-d`, `:branch` refspec) or only rehearses (`--dry-run`). */
const isSafePush = (argText) => /['"`\s](?:--delete|-d|--dry-run)['"`\s]|['"`\s]:[\w./-]+/.test(` ${argText} `);

/** Line numbers where `text` spawns `git push` or `gh pr create|merge`: argv arrays (`['push', ...]`,
 *  `git(dir, ['-C', x, 'push'])`) and shell strings handed to exec/spawn (`execSync(`git push`)`). */
function gatedSpawns(text) {
  const hits = [];
  const add = (index, what) => hits.push(`${text.slice(0, index).split('\n').length}:${what}`);
  for (const m of text.matchAll(/\[[^[\]]*\]/g)) {
    const els = [...m[0].matchAll(/(['"`])([^'"`]*)\1/g)].map((e) => e[2]);
    if (els.includes('push') && !isSafePush(m[0])) add(m.index, 'git push');
    const pr = els.indexOf('pr');
    if (pr >= 0 && ['create', 'merge'].includes(els[pr + 1])) add(m.index, `gh pr ${els[pr + 1]}`);
  }
  const shell = /\b(?:execSync|exec|spawnSync|spawn|execFileSync|execFile)\(\s*([`'"])((?:(?!\1).)*)\1/g;
  for (const m of text.matchAll(shell)) {
    const cmd = m[2];
    if (/\bgit\s+(?:\S+\s+)*?push\b/.test(cmd) && !isSafePush(cmd)) add(m.index, 'git push');
    const pr = cmd.match(/\bgh\s+(?:\S+\s+)*?pr\s+(create|merge)\b/);
    if (pr) add(m.index, `gh pr ${pr[1]}`);
  }
  return hits;
}

test('gatedSpawns flags git push and gh pr create/merge in every spawn shape the harness uses', () => {
  const bad = [
    "spawnSync('git', ['push', 'origin', 'x'])",
    "git(cfg, ['push', '-u', 'origin', branch])",
    "spawnSync('git', ['-C', dir, 'push'])",
    'execSync(`git push origin ${b}`)',
    "execSync('git -C repo push --force')",
    "spawnSync('gh', ['pr', 'create', '--fill'])",
    "gh(['pr', 'merge', n, '--rebase'])",
    'execSync(`gh -R o/r pr merge 5`)',
    "execFileSync('gh', ['pr', 'create'])",
  ];
  for (const s of bad) assert.equal(gatedSpawns(s).length, 1, s);
  assert.match(gatedSpawns('a\nb\nspawnSync("git", ["push"])')[0], /^3:git push$/);
});

test('gatedSpawns allows remote branch deletes, dry runs, prose and non-gated calls', () => {
  const ok = [
    "git(cfg, ['push', 'origin', '--delete', branch])",
    "git(cfg, ['push', '-d', 'origin', branch])",
    "git(cfg, ['push', 'origin', ':old-branch'])",
    "spawnSync('git', ['push', '--dry-run'])",
    "log('next: git push -u origin x and open the PR')",
    "lines.push('x'); out.push(a, b)",
    "spawnSync('gh', ['pr', 'view', branch])",
    "spawnSync('git', ['status'])",
    'execSync(`git push origin --delete ${b}`)',
  ];
  for (const s of ok) assert.deepEqual(gatedSpawns(s), [], s);
});

test('no tracked hook, script or statusline module spawns git push or gh pr create/merge (#193)', () => {
  const offenders = [];
  for (const f of listed().filter((p) => /^(hooks|scripts|statusline)\/.*\.mjs$/.test(p) && !p.startsWith('scripts/test/'))) {
    for (const hit of gatedSpawns(readText(f) ?? '')) {
      const [line, what] = hit.split(':');
      offenders.push(`${f}:${line} spawns ${what} - the user-approval gate reads Bash text only; print the command for the user instead`);
    }
  }
  assert.deepEqual(offenders, []);
});
