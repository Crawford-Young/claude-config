// node --test scripts/test/guard-replay.test.mjs — guard-replay over a fixture
// transcript and two tiny fake checkouts whose staticCheck differs on one command.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execHarness } from './_spawn.mjs';
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'guard-replay.mjs');

function checkout(staticBody, approving = 'true') {
  const dir = mkdtempSync(join(tmpdir(), 'gr-co-'));
  mkdirSync(join(dir, 'hooks'));
  writeFileSync(
    join(dir, 'hooks', 'bash-guard.mjs'),
    `export const staticCheck = (c) => { ${staticBody} };
export const gatedVerbs = () => [];
export const browserCommand = () => null;
export const isApproving = () => ${approving};
`,
  );
  writeFileSync(join(dir, 'hooks', '_hooklib.mjs'), 'export const isBrowserApproving = () => false;\n');
  return dir;
}

const bash = (command, name = 'Bash') => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input: { command } }] } });
const answer = (a) => ({ type: 'user', uuid: 'u', toolUseResult: { answers: a } });

function config(files) {
  const cfg = mkdtempSync(join(tmpdir(), 'gr-cfg-'));
  mkdirSync(join(cfg, 'projects', 'p'), { recursive: true });
  for (const [name, rows] of Object.entries(files)) {
    writeFileSync(join(cfg, 'projects', 'p', name), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  return cfg;
}

function run(configDir, ...args) {
  return execHarness(script, args, { env: { CLAUDE_CONFIG_DIR: configDir } });
}

test('prints exactly one line per changed verdict, deduped, plus a summary', () => {
  const cfg = config({
    's.jsonl': [bash('git add -A'), bash('git add -A'), bash('ls'), bash('Get-ChildItem', 'PowerShell'), answer({ q: 'Push it' })],
  });
  const oldCo = checkout("return c === 'git add -A' ? 'blocked' : null;");
  const newCo = checkout('return null;');
  const lines = run(cfg, oldCo, newCo).trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^staticCheck: "blocked" -> null \| git add -A$/);
  assert.match(lines[1], /^summary: 1 changed; 3 commands, 1 answers from 1 files$/);
});

test('an approval-parser change is reported per answer', () => {
  const cfg = config({ 's.jsonl': [answer({ q: 'Push it' })] });
  const lines = run(cfg, checkout('return null;', 'true'), checkout('return null;', 'false')).trim().split('\n');
  assert.equal(lines.length, 2); // one changed verdict, then summary
  assert.match(lines[0], /^isApproving: true -> false \| Push it$/);
});

test('identical checkouts print only the summary with zero changes', () => {
  const cfg = config({ 's.jsonl': [bash('git add -A')] });
  const co = checkout('return null;');
  assert.match(run(cfg, co, co).trim(), /^summary: 0 changed; 1 commands, 0 answers from 1 files$/);
});

test('--files limits scanning to the newest N transcripts', () => {
  const cfg = config({ 'a.jsonl': [bash('one')], 'b.jsonl': [bash('two')] });
  const co = checkout('return null;');
  assert.match(run(cfg, co, co, '--files', '1').trim(), /1 commands, 0 answers from 1 files/);
});

test('subagent transcripts (projects/*/<session>/subagents/*.jsonl) are scanned too', () => {
  const cfg = config({ 's.jsonl': [bash('one')] });
  const sub = join(cfg, 'projects', 'p', 'sess', 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, 'agent-a.jsonl'), JSON.stringify(bash('two')) + '\n');
  const co = checkout('return null;');
  assert.match(run(cfg, co, co).trim(), /2 commands, 0 answers from 2 files/);
});

test('--files selects the newest N across top-level and subagent transcripts', () => {
  const cfg = config({ 'old.jsonl': [bash('old1'), bash('old2')] });
  const sub = join(cfg, 'projects', 'p', 'sess', 'subagents');
  mkdirSync(sub, { recursive: true });
  const f = join(sub, 'agent-a.jsonl');
  writeFileSync(f, JSON.stringify(bash('newer')) + '\n');
  utimesSync(join(cfg, 'projects', 'p', 'old.jsonl'), new Date(Date.now() - 5000), new Date(Date.now() - 5000));
  const co = checkout('return null;');
  assert.match(run(cfg, co, co, '--files', '1').trim(), /1 commands, 0 answers from 1 files/);
});

test('--files and --days with a missing or non-numeric value print usage', () => {
  const cfg = config({ 's.jsonl': [bash('one')] });
  const co = checkout('return null;');
  for (const args of [['--files'], ['--files', 'abc'], ['--days'], ['--days', 'x']]) {
    assert.match(run(cfg, co, co, ...args).trim(), /^usage:/, args.join(' '));
  }
});

test('answers differing only in key order dedupe to one', () => {
  const cfg = config({ 's.jsonl': [answer({ a: '1', b: '2' }), answer({ b: '2', a: '1' })] });
  const co = checkout('return null;');
  assert.match(run(cfg, co, co).trim(), /0 commands, 1 answers from 1 files/);
});

test('env-assignment secrets are redacted in printed commands', () => {
  const cfg = config({ 's.jsonl': [bash('GH_TOKEN=abc123 API_KEY="s p" MY_SECRET=x curl u')] });
  const out = run(cfg, checkout("return c.includes('curl') ? 'blocked' : null;"), checkout('return null;'));
  assert.match(out, /\| GH_TOKEN=\*\*\* API_KEY=\*\*\* MY_SECRET=\*\*\* curl u\n/);
  assert.doesNotMatch(out, /abc123|s p|=x /);
});

test('a missing projects root reports zero files rather than failing', () => {
  const co = checkout('return null;');
  assert.match(run(mkdtempSync(join(tmpdir(), 'gr-empty-')), co, co).trim(), /^summary: 0 changed; 0 commands, 0 answers from 0 files$/);
});

test('more secret shapes are redacted; ordinary names and flags are kept', () => {
  const cmds = [
    'DB_PASSWORD=hunter2 run',
    'NPM_PASS=hunter3 run',
    'GH_PAT=ghp_abc run',
    '$env:GH_TOKEN = "tok4" ; run',
    'curl -H "Authorization: Bearer bearer5" u',
    'gh auth login --with-token tok6',
    'monkey=banana run',
    'sort --sort-key=name f',
  ];
  const cfg = config({ 's.jsonl': cmds.map((c) => bash(c)) });
  const out = run(cfg, checkout("return 'blocked';"), checkout('return null;'));
  for (const s of ['hunter2', 'hunter3', 'ghp_abc', 'tok4', 'bearer5', 'tok6']) assert.doesNotMatch(out, new RegExp(s), s);
  assert.match(out, /DB_PASSWORD=\*\*\* run/);
  assert.match(out, /\$env:GH_TOKEN = \*\*\* ; run/);
  assert.match(out, /Authorization: Bearer \*\*\*/);
  assert.match(out, /--with-token \*\*\*/);
  assert.match(out, /monkey=banana run/);
  assert.match(out, /--sort-key=name f/);
});
