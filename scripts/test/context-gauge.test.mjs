// node --test scripts/test/context-gauge.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULTS,
  autoCompactWindow,
  classify,
  contextTokens,
  readTail,
  shouldFire,
  thresholds,
} from '../../hooks/context-gauge.mjs';

const HOOK = fileURLToPath(new URL('../../hooks/context-gauge.mjs', import.meta.url));

// Real transcript shape: one JSON object per line, usage on assistant messages.
const line = (usage, extra = {}) =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage }, ...extra });

const usage = (input, cacheRead, cacheCreate = 0) => ({
  input_tokens: input,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheCreate,
  output_tokens: 500,
});

test('context is input + cache_read + cache_creation of the last assistant message', () => {
  const t = [line(usage(3, 50_000)), line(usage(2, 212_226, 1_259))].join('\n');
  assert.equal(contextTokens(t), 213_487);
});

test('sidechain lines are skipped — a subagent context is not the session context', () => {
  // The bug this guards: a subagent finishing last leaves its own small usage
  // as the final line, and the gauge reads ~8k for a session sitting at 213k.
  const t = [line(usage(2, 212_226, 1_259)), line(usage(1, 8_000), { isSidechain: true })].join('\n');
  assert.equal(contextTokens(t), 213_487);
});

test('lines without usage, and a half-line from a tail read, are tolerated', () => {
  const t = ['_226,"output_tokens":5}}', JSON.stringify({ type: 'user' }), line(usage(0, 120_000))].join('\n');
  assert.equal(contextTokens(t), 120_000);
});

test('a transcript with no usage yields null, and null classifies as unknown', () => {
  assert.equal(contextTokens(JSON.stringify({ type: 'user' })), null);
  assert.equal(classify(null), 'unknown');
});

test('bands split at the thresholds', () => {
  const t = thresholds({});
  assert.deepEqual(t, { nudge: DEFAULTS.nudge, warn: DEFAULTS.warn, blockAt: DEFAULTS.blockAt });
  assert.equal(classify(99_999, t), 'ok');
  assert.equal(classify(100_000, t), 'nudge');
  assert.equal(classify(174_999, t), 'nudge');
  assert.equal(classify(175_000, t), 'warn');
  assert.equal(classify(235_000, t), 'block');
});

test('the hard stop sits under the 250k auto-compact it exists to preempt', () => {
  assert.ok(DEFAULTS.blockAt < 250_000);
});

test('thresholds are env-tunable, and junk overrides fall back to defaults', () => {
  assert.equal(thresholds({ CLAUDE_CTX_NUDGE: '50000' }).nudge, 50_000);
  assert.equal(thresholds({ CLAUDE_CTX_BLOCK: 'nope' }).blockAt, DEFAULTS.blockAt);
  assert.equal(thresholds({ CLAUDE_CTX_WARN: '0' }).warn, DEFAULTS.warn);
});

test('the auto-compact figure quoted in messages comes from settings, not a constant', () => {
  // The bug this guards: hardcoding 250k means the block message keeps naming a
  // threshold the user has since changed in settings.json.
  const dir = mkdtempSync(join(tmpdir(), 'ctxgauge-cfg-'));
  try {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ autoCompactWindow: 400_000 }));
    assert.equal(autoCompactWindow(dir), 400_000);
    writeFileSync(join(dir, 'settings.json'), '{ not json');
    assert.equal(autoCompactWindow(dir), 250_000); // unreadable settings fall back
    assert.equal(autoCompactWindow(join(dir, 'nope')), 250_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bands fire once and only escalate', () => {
  assert.equal(shouldFire('nudge', {}), true);
  assert.equal(shouldFire('nudge', { fired: 'nudge' }), false);
  assert.equal(shouldFire('warn', { fired: 'nudge' }), true);
  assert.equal(shouldFire('nudge', { fired: 'warn' }), false);
});

test('readTail returns the end of a file larger than the window', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ctxgauge-'));
  try {
    const f = join(dir, 'big.jsonl');
    writeFileSync(f, `${'x'.repeat(5000)}\n${line(usage(0, 150_000))}`);
    const tail = readTail(f, 1024);
    assert.ok(tail.length <= 1024);
    assert.equal(contextTokens(tail), 150_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- end-to-end: pipe a payload to the hook, same contract as the others ---

function runHook(prompt, transcript, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ctxgauge-e2e-'));
  const t = join(dir, 'transcript.jsonl');
  writeFileSync(t, transcript);
  const payload = JSON.stringify({
    prompt,
    session_id: `test-${Math.random().toString(36).slice(2)}`,
    transcript_path: t,
  });
  try {
    const stdout = execFileSync(process.execPath, [HOOK], {
      input: payload,
      encoding: 'utf8',
      env: { ...process.env, HOME: dir, USERPROFILE: dir, ...env },
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('under the nudge line the hook is silent and exits 0', () => {
  const r = runHook('carry on', line(usage(0, 50_000)));
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
});

test('past the nudge line it writes a note to stdout and still exits 0', () => {
  const r = runHook('carry on', line(usage(0, 120_000)));
  assert.equal(r.code, 0);
  assert.match(r.stdout, /context-gauge.*120k/s);
});

test('past the hard stop it blocks with exit 2 and names the way out', () => {
  const r = runHook('keep building', line(usage(0, 240_000)));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /240k/);
  assert.match(r.stderr, /\/clear/);
  assert.match(r.stderr, /CONTEXT OK/);
});

test('a slash command is never blocked — /clear is the escape hatch', () => {
  // The bug this guards: blocking every prompt at the hard stop also blocks
  // the command that resolves it, wedging the session with no way out.
  const r = runHook('/clear', line(usage(0, 240_000)));
  assert.equal(r.code, 0);
});

test('CONTEXT OK overrides the hard stop', () => {
  const r = runHook('CONTEXT OK, finishing this wave', line(usage(0, 240_000)));
  assert.equal(r.code, 0);
});

test('a broken transcript path fails open rather than wedging the session', () => {
  const payload = JSON.stringify({ prompt: 'hi', session_id: 'x', transcript_path: '/no/such/file' });
  const out = execFileSync(process.execPath, [HOOK], { input: payload, encoding: 'utf8' });
  assert.equal(out.trim(), '');
});
