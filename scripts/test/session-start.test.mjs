// node --test scripts/test/session-start.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const hook = join(repo, 'hooks', 'session-start.mjs');
const index = readFileSync(join(repo, 'skills', 'INDEX.md'), 'utf8').replace(/\r\n/g, '\n').trim();

/** A node script standing in for `gh`; it records its argv and runs `body`. */
function ghStub(body) {
  const dir = mkdtempSync(join(tmpdir(), 'ss-gh-'));
  const script = join(dir, 'gh.mjs');
  writeFileSync(
    script,
    `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(join(dir, 'argv.json'))}, JSON.stringify(process.argv.slice(2)));\n${body}\n`,
  );
  return { cmd: JSON.stringify([process.execPath, script]), argv: join(dir, 'argv.json') };
}

const failingGh = ghStub('process.exit(1);').cmd;

/** Run the hook with `gh` stubbed (never the network); default stub fails. */
function runHook(payload, gh = failingGh) {
  return execFileSync(process.execPath, [hook], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, SESSION_START_GH: gh },
  }).replace(/\r\n/g, '\n');
}

test('the skill index leads with the Read-not-Skill-tool instruction and stays within 1 KB', () => {
  assert.match(index.split('\n')[0], /Read the path; skills are not Skill-tool invocable\./);
  assert.ok(Buffer.byteLength(index, 'utf8') <= 1024, `INDEX.md is ${Buffer.byteLength(index, 'utf8')} B`);
});

for (const source of ['startup', 'clear', 'resume', 'compact']) {
  test(`the skill index is injected on source=${source}`, () => {
    assert.ok(runHook({ source }).includes(index));
  });
}

test('the post-compaction reminder says Read, never re-invoke, and re-orients from the issue', () => {
  const out = runHook({ source: 'compact' }).split('\n').find((l) => l.startsWith('Post-compaction'));
  assert.ok(out);
  assert.doesNotMatch(out, /invoke|checklist/i);
  assert.match(out, /Done-when/);
});

test('in-progress issues across the owner are listed one line each', () => {
  const issues = [
    { repository: { name: 'claude-config', nameWithOwner: 'Crawford-Young/claude-config' }, number: 72, title: 'Issues tracker' },
    { repository: { name: 'portfolio', nameWithOwner: 'Crawford-Young/portfolio' }, number: 5, title: 'Hero' },
  ];
  const stub = ghStub(`process.stdout.write(${JSON.stringify(JSON.stringify(issues))});`);
  const out = runHook({ source: 'startup' }, stub.cmd);
  assert.match(out, /^In progress:\n- claude-config#72 Issues tracker\n- portfolio#5 Hero$/m);
  assert.deepEqual(JSON.parse(readFileSync(stub.argv, 'utf8')), [
    'search', 'issues', '--owner', 'Crawford-Young', '--label', 'in-progress', '--state', 'open',
    '--limit', '10', '--json', 'repository,number,title',
  ]);
});

test('no in-progress issues → no header', () => {
  const out = runHook({ source: 'startup' }, ghStub("process.stdout.write('[]');").cmd);
  assert.doesNotMatch(out, /In progress/);
});

test('gh failing, missing or hanging fails open silently', () => {
  for (const gh of [failingGh, JSON.stringify([join(tmpdir(), 'no-such-gh.exe')]), ghStub('setTimeout(() => {}, 10000);').cmd]) {
    const out = runHook({ source: 'startup' }, gh);
    assert.ok(out.includes(index));
    assert.doesNotMatch(out, /In progress/);
  }
});
