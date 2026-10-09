// node --test scripts/test/_hooklib.test.mjs — the shared hook plumbing, exercised
// through real hook processes (stdin bytes in, exit code out), because the defects
// this covers (H21 BOM, H3 unbounded logs) only appear across the process boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execHarness } from './_spawn.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hooksDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks');
const bashGuard = join(hooksDir, 'bash-guard.mjs');
const modelGuard = join(hooksDir, 'agent-model-guard.mjs');
const hooklibUrl = pathToFileURL(join(hooksDir, '_hooklib.mjs')).href;

const BOM = '\uFEFF'; // EF BB BF on the wire

/** A throwaway HOME so nothing here touches the real ~/.claude logs. */
function home({ claudeIsAFile = false } = {}) {
  const h = mkdtempSync(join(tmpdir(), 'hooklib-'));
  if (claudeIsAFile) writeFileSync(join(h, '.claude'), 'not a directory');
  else mkdirSync(join(h, '.claude'), { recursive: true });
  return h;
}

function runHook(script, input, h) {
  const stdin = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  try {
    const stdout = execHarness(script, [], { input: stdin, home: h });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** A one-off hook whose body throws, to exercise run()'s failure path directly. */
function throwingHook(h, name, opts = '') {
  const file = join(h, `${name}.mjs`);
  writeFileSync(
    file,
    `import { run } from ${JSON.stringify(hooklibUrl)};\n` +
      `run(${JSON.stringify(name)}, () => { throw new Error('boom'); }${opts});\n`,
  );
  return file;
}

const bigLog = (file, lines = 20_000) => writeFileSync(file, `${'x'.repeat(60)}\n`.repeat(lines));
const errorLog = (h) => join(h, '.claude', 'hook-errors.log');
const dispatchLog = (h) => join(h, '.claude', 'fable-dispatch.log');
const nonEmpty = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean);

// --- A1 (H21): a UTF-8 BOM on stdin must not disarm the guard ----------------

test('a BOM-prefixed payload still reaches the guard rules (the audit repro)', () => {
  const h = home();
  const payload = JSON.stringify({ tool_input: { command: 'git add -A' }, cwd: h });
  const r = runHook(bashGuard, BOM + payload, h);
  assert.equal(r.code, 2, 'a BOM must not turn a block into a silent allow');
  assert.match(r.stderr, /git add -A\/--all is banned/);
});

test('the same payload without a BOM blocks identically (control)', () => {
  const h = home();
  const payload = JSON.stringify({ tool_input: { command: 'git add -A' }, cwd: h });
  const r = runHook(bashGuard, payload, h);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /git add -A\/--all is banned/);
});

test('a BOM-prefixed payload that breaks no rule still proceeds', () => {
  const h = home();
  const payload = JSON.stringify({ tool_input: { command: 'git status' }, cwd: h });
  assert.equal(runHook(bashGuard, BOM + payload, h).code, 0);
});

// --- A2: opt-in failClosed for the guard hooks, fail-open everywhere else ----

test('run() is fail-open by default: a throwing hook body allows the action', () => {
  const h = home();
  const r = runHook(throwingHook(h, 'throwy'), '{}', h);
  assert.equal(r.code, 0, 'the default contract is fail-open');
  assert.match(readFileSync(errorLog(h), 'utf8'), /throwy: Error: boom/);
});

test('run() with failClosed blocks instead, naming the hook', () => {
  const h = home();
  const r = runHook(throwingHook(h, 'closey', ', { failClosed: true }'), '{}', h);
  assert.equal(r.code, 2, 'an opted-in guard must not fail open');
  assert.match(r.stderr, /closey/);
  assert.match(readFileSync(errorLog(h), 'utf8'), /closey: Error: boom/);
});

test('bash-guard fails closed on an unreadable payload rather than allowing', () => {
  const h = home();
  const r = runHook(bashGuard, '{ not json', h);
  assert.equal(r.code, 2, 'a guard that cannot parse its payload has not checked the command');
  assert.match(r.stderr, /bash-guard/);
  assert.match(readFileSync(errorLog(h), 'utf8'), /bash-guard/);
});

// --- A6 (H3): both loggers route through appendTrimmed, and never throw ------

test('logError trims the hook error log instead of growing it forever', () => {
  const h = home();
  bigLog(errorLog(h));
  assert.ok(statSync(errorLog(h)).size > 512 * 1024, 'precondition: log starts over the cap');

  runHook(throwingHook(h, 'throwy'), '{}', h);

  assert.ok(statSync(errorLog(h)).size < 512 * 1024, 'log must be trimmed back under the cap');
  const lines = nonEmpty(errorLog(h));
  assert.ok(lines.length <= 200, `kept ${lines.length} lines, expected the 200-line tail`);
  // The entry is a multi-line stack, so assert on the kept tail, not one line.
  assert.match(lines.join('\n'), /throwy: Error: boom/, 'the newest entry survives the trim');
});

test('logError never throws into the caller when the log path is unusable', () => {
  const h = home({ claudeIsAFile: true });
  const r = runHook(throwingHook(h, 'throwy'), '{}', h);
  // Exit 1 here would mean the logger's own failure escaped run()'s catch.
  assert.equal(r.code, 0, 'a fail-open hook stays fail-open when logging is impossible');
  assert.doesNotMatch(r.stderr, /Unhandled|ENOTDIR|EEXIST/);
});

test('agent-model-guard logLine trims the fable dispatch log', () => {
  const h = home();
  bigLog(dispatchLog(h));
  const r = runHook(modelGuard, JSON.stringify({ tool_input: { subagent_type: 'recon', model: 'claude-fable-5-1' } }), h);

  assert.equal(r.code, 2, 'precondition: an uncleared fable dispatch blocks');
  assert.ok(statSync(dispatchLog(h)).size < 512 * 1024, 'dispatch log must be trimmed back under the cap');
  const lines = nonEmpty(dispatchLog(h));
  assert.ok(lines.length <= 200, `kept ${lines.length} lines, expected the 200-line tail`);
  assert.match(lines.at(-1), /BLOCK type=recon/);
});

test('agent-model-guard still enforces when its audit log cannot be written', () => {
  const h = home({ claudeIsAFile: true });
  const r = runHook(modelGuard, JSON.stringify({ tool_input: { subagent_type: 'recon', model: 'claude-fable-5-1' } }), h);
  // This hook is fail-open, so a logger that threw would show up as exit 0 (or 1).
  assert.equal(r.code, 2, 'a broken audit log must not let a fable dispatch through');
  assert.match(r.stderr, /FABLE OK/);
});

// #103: one detector for a SKILL.md / INDEX.md read done through the shell
test('shellSkillReads: names skills/<name>/SKILL.md and skills/INDEX.md in either slash direction, any prefix', async () => {
  const { shellSkillReads } = await import(hooklibUrl);
  assert.deepEqual(shellSkillReads('cat ~/code/claude-config/skills/reflect/SKILL.md'), ['reflect']);
  assert.deepEqual(shellSkillReads('Get-Content C:\\Users\\y\\code\\claude-config\\skills\\qa\\SKILL.md'), ['qa']);
  assert.deepEqual(shellSkillReads('cat skills/plan/SKILL.md skills/plan/SKILL.md skills\\worktree\\SKILL.md'), ['plan', 'worktree']);
  assert.deepEqual(shellSkillReads('cat ./skills/INDEX.md'), ['INDEX']);
  assert.deepEqual(shellSkillReads('type "C:\\a b\\skills\\INDEX.md"'), ['INDEX']);
});

test('shellSkillReads: a bare mention of skills, other skill files, or non-strings are not reads', async () => {
  const { shellSkillReads } = await import(hooklibUrl);
  assert.deepEqual(shellSkillReads('ls skills'), []);
  assert.deepEqual(shellSkillReads('echo "read the skills first"'), []);
  assert.deepEqual(shellSkillReads('wc -c skills/reflect/gotchas.md skills/reflect/scripts/x.mjs'), []);
  assert.deepEqual(shellSkillReads(undefined), []);
});

// #117: only a reader verb reading the file is a skill read
test('shellSkillReads: counts reader verbs per command segment; grep/echo/wc/cp/node are not reads', async () => {
  const { shellSkillReads } = await import(hooklibUrl);
  assert.deepEqual(shellSkillReads('cat skills/a/SKILL.md | head'), ['a']);
  assert.deepEqual(shellSkillReads('FOO=1 /usr/bin/CAT.exe skills/a/SKILL.md'), ['a']);
  assert.deepEqual(shellSkillReads('echo hi && sed -n 1,5p skills/b/SKILL.md; ls'), ['b']);
  assert.deepEqual(shellSkillReads('head -5 skills/c/SKILL.md\ntail skills/d/SKILL.md'), ['c', 'd']);
  for (const c of ['grep x skills/a/SKILL.md', 'echo skills/a/SKILL.md', 'wc -c skills/a/SKILL.md', 'cp skills/a/SKILL.md /tmp/x', 'node scripts/land.mjs x skills/a/SKILL.md']) {
    assert.deepEqual(shellSkillReads(c), [], c);
  }
});

test('writeState writes atomically (no temp litter) and stays fail-open', async () => {
  const { writeState, readState } = await import(hooklibUrl);
  const h = home();
  const f = join(h, '.claude', 's.json');
  writeState(f, { a: 1 });
  writeState(f, { a: 2 });
  assert.deepEqual(readState(f), { a: 2 });
  assert.deepEqual(readdirSync(join(h, '.claude')), ['s.json']);
  writeState(join(home({ claudeIsAFile: true }), '.claude', 's.json'), { a: 1 }); // must not throw
});

test('writeState falls back to a direct write when the rename is refused (win32 EPERM on an open target)', async () => {
  const { writeState, readState } = await import(hooklibUrl);
  const h = home();
  const f = join(h, '.claude', 's.json');
  let tried = 0;
  const refuse = () => {
    tried++;
    throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
  };
  writeState(f, { a: 3 }, { renameSync: refuse });
  assert.equal(tried, 1, 'the atomic rename was attempted');
  assert.deepEqual(readState(f), { a: 3 });
  assert.deepEqual(readdirSync(join(h, '.claude')), ['s.json'], 'temp file removed');
});

test('writeState removes its temp file when writing the temp file itself fails', async () => {
  const { writeState } = await import(hooklibUrl);
  const h = home();
  const f = join(h, '.claude', 's.json');
  const half = (p, data) => {
    writeFileSync(p, data.slice(0, 2));
    throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
  };
  writeState(f, { a: 1 }, { writeFileSync: half });
  assert.deepEqual(readdirSync(join(h, '.claude')), []);
});

test('shellSkillReads: segment-start wrappers (sudo/time/env, parens, braces, $var =) and a single & are skipped', async () => {
  const { shellSkillReads } = await import(hooklibUrl);
  assert.deepEqual(shellSkillReads('sudo cat skills/a/SKILL.md'), ['a']);
  assert.deepEqual(shellSkillReads('time env FOO=1 cat skills/b/SKILL.md'), ['b']);
  assert.deepEqual(shellSkillReads("(Get-Content skills/c/SKILL.md) -join ''"), ['c']);
  assert.deepEqual(shellSkillReads('$c = Get-Content skills/d/SKILL.md'), ['d']);
  assert.deepEqual(shellSkillReads('{ cat skills/e/SKILL.md; }'), ['e']);
  assert.deepEqual(shellSkillReads('sleep 1 & cat skills/f/SKILL.md'), ['f']);
  assert.deepEqual(shellSkillReads('sudo grep x skills/a/SKILL.md'), []);
});
