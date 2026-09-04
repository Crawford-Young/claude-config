// node --test scripts/test/context-gauge.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BANDS,
  classify,
  contextTokens,
  contextWindow,
  readTail,
  shouldFire,
  thresholds,
  nudgeText,
  warnText,
  blockText,
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

// A usage-history record, in the shape statusline/usage-statusline.ps1 writes.
const sample = (session_id, context_window_size, extra = {}) =>
  JSON.stringify({ ts: new Date().toISOString(), session_id, context_window_size, context_pct: 12, ...extra });

/** Temp dir shaped like a home dir with ~/.claude inside it. */
function claudeHome({ settings, history, month = '2026-09' } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ctxgauge-home-'));
  const dir = join(home, '.claude');
  mkdirSync(dir, { recursive: true });
  if (settings !== undefined) writeFileSync(join(dir, 'settings.json'), settings);
  if (history !== undefined) {
    mkdirSync(join(dir, 'usage-history'), { recursive: true });
    writeFileSync(join(dir, 'usage-history', `${month}.jsonl`), history);
  }
  return { home, dir };
}

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
  assert.equal(classify(null, { nudge: 1, warn: 2, blockAt: 3 }), 'unknown');
});

// --- the window the bands are derived from ---

test('the window comes from the usage-history log the statusline writes', () => {
  // The bug this guards: a hardcoded 250k window made every band and every
  // message wrong on a session whose real window is 1M.
  const { home, dir } = claudeHome({
    history: [sample('other', 200_000), sample('mine', 1_000_000)].join('\n'),
  });
  try {
    assert.equal(contextWindow({ dir, env: {} }), 1_000_000);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('the session own record wins over a newer record from another session', () => {
  const { home, dir } = claudeHome({
    history: [sample('mine', 1_000_000), sample('other', 200_000)].join('\n'),
  });
  try {
    assert.equal(contextWindow({ dir, env: {}, sessionId: 'mine' }), 1_000_000);
    assert.equal(contextWindow({ dir, env: {}, sessionId: 'unseen' }), 200_000); // newest overall
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('the newest month file is the one read, and junk records are skipped', () => {
  const { home, dir } = claudeHome({ month: '2026-08', history: sample('a', 200_000) });
  try {
    writeFileSync(
      join(dir, 'usage-history', '2026-09.jsonl'),
      [sample('a', null), '{ not json', sample('a', 0), sample('a', 1_000_000), ''].join('\n'),
    );
    assert.equal(contextWindow({ dir, env: {} }), 1_000_000);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a contextGaugeWindow settings key overrides the history log', () => {
  const { home, dir } = claudeHome({
    settings: JSON.stringify({ contextGaugeWindow: 500_000 }),
    history: sample('a', 1_000_000),
  });
  try {
    assert.equal(contextWindow({ dir, env: {} }), 500_000);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('settings that are absent, unreadable, or carry a junk key fall through to history', () => {
  // The settings key does not exist on this machine today, so the fall-through
  // is the live path, not the exotic one.
  const { home, dir } = claudeHome({ settings: '{ not json', history: sample('a', 1_000_000) });
  try {
    assert.equal(contextWindow({ dir, env: {} }), 1_000_000);
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ contextGaugeWindow: 'lots' }));
    assert.equal(contextWindow({ dir, env: {} }), 1_000_000);
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ model: 'opus' }));
    assert.equal(contextWindow({ dir, env: {} }), 1_000_000);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('CLAUDE_CTX_WINDOW overrides every other source', () => {
  const { home, dir } = claudeHome({
    settings: JSON.stringify({ contextGaugeWindow: 500_000 }),
    history: sample('a', 1_000_000),
  });
  try {
    assert.equal(contextWindow({ dir, env: { CLAUDE_CTX_WINDOW: '300000' } }), 300_000);
    assert.equal(contextWindow({ dir, env: { CLAUDE_CTX_WINDOW: 'nope' } }), 500_000);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('CLAUDE_USAGE_HISTORY_DIR relocates the log, as it does for the statusline', () => {
  const { home, dir } = claudeHome({});
  const alt = mkdtempSync(join(tmpdir(), 'ctxgauge-hist-'));
  try {
    writeFileSync(join(alt, '2026-09.jsonl'), sample('a', 1_000_000));
    assert.equal(contextWindow({ dir, env: { CLAUDE_USAGE_HISTORY_DIR: alt } }), 1_000_000);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(alt, { recursive: true, force: true });
  }
});

test('with no source at all the window is null — the gauge never invents one', () => {
  const { home, dir } = claudeHome({});
  try {
    assert.equal(contextWindow({ dir, env: {} }), null);
    assert.equal(contextWindow({ dir: join(dir, 'nope'), env: {} }), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// --- bands as fractions of that window ---

test('bands are fractions of the live window, not constants', () => {
  assert.deepEqual(thresholds(1_000_000, {}), { nudge: 400_000, warn: 700_000, blockAt: 940_000 });
  // The shipped ratios are preserved: the old 100k/175k/235k were these same
  // fractions of the 250k window the hook used to assume.
  assert.deepEqual(thresholds(250_000, {}), { nudge: 100_000, warn: 175_000, blockAt: 235_000 });
  assert.deepEqual(BANDS, { nudge: 0.4, warn: 0.7, blockAt: 0.94 });
});

test('the hard stop leaves headroom below the window it is protecting', () => {
  const t = thresholds(1_000_000, {});
  assert.ok(t.blockAt < 1_000_000);
  assert.ok(t.nudge < t.warn && t.warn < t.blockAt);
});

test('an unknown window yields no thresholds rather than guessed ones', () => {
  assert.equal(thresholds(null, {}), null);
  assert.equal(thresholds(0, {}), null);
  assert.equal(thresholds(null, { CLAUDE_CTX_NUDGE: '1000' }), null); // a partial set is no set
  assert.deepEqual(thresholds(null, { CLAUDE_CTX_NUDGE: '10', CLAUDE_CTX_WARN: '20', CLAUDE_CTX_BLOCK: '30' }), {
    nudge: 10,
    warn: 20,
    blockAt: 30,
  });
});

test('bands split at the thresholds', () => {
  const t = thresholds(250_000, {});
  assert.equal(classify(99_999, t), 'ok');
  assert.equal(classify(100_000, t), 'nudge');
  assert.equal(classify(174_999, t), 'nudge');
  assert.equal(classify(175_000, t), 'warn');
  assert.equal(classify(235_000, t), 'block');
});

test('thresholds stay env-tunable, and junk overrides fall back to the derived band', () => {
  assert.equal(thresholds(1_000_000, { CLAUDE_CTX_NUDGE: '50000' }).nudge, 50_000);
  assert.equal(thresholds(1_000_000, { CLAUDE_CTX_BLOCK: 'nope' }).blockAt, 940_000);
  assert.equal(thresholds(1_000_000, { CLAUDE_CTX_WARN: '0' }).warn, 700_000);
});

// --- what the messages say ---

test('the nudge does not tell the session to stop work early', () => {
  // The bug this guards: the old nudge said "Finish the task in flight", which
  // reads as a cost signal. The gate is auto-compact avoidance, not cost.
  const t = thresholds(1_000_000, {});
  const text = nudgeText(450_000, t, 1_000_000);
  assert.doesNotMatch(text, /finish the task in flight/i);
  assert.match(text, /never artificially stop a task early/i);
  assert.match(text, /not cost/i);
});

test('every message quotes the live window, never a hardcoded 250k', () => {
  const t = thresholds(1_000_000, {});
  const texts = [nudgeText(450_000, t, 1_000_000), warnText(750_000, t, 1_000_000), blockText(950_000, t, 1_000_000)];
  for (const text of texts) {
    assert.match(text, /1\.0M/);
    assert.doesNotMatch(text, /250k/);
  }
  assert.match(texts[2], /940k/);
  assert.match(texts[2], /CONTEXT OK/);
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

function runHook(prompt, transcript, { window = 1_000_000, env = {} } = {}) {
  const { home } = claudeHome({ history: window == null ? undefined : sample('e2e', window) });
  const t = join(home, 'transcript.jsonl');
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
      env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_USAGE_HISTORY_DIR: '', ...env },
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test('on a 1M window a 240k session is quiet — the old 235k block was window-blind', () => {
  const r = runHook('carry on', line(usage(0, 240_000)));
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
});

test('past the derived nudge line it writes a note to stdout and still exits 0', () => {
  const r = runHook('carry on', line(usage(0, 450_000)));
  assert.equal(r.code, 0);
  assert.match(r.stdout, /context-gauge.*450k/s);
  assert.match(r.stdout, /1\.0M/);
});

test('past the derived hard stop it blocks with exit 2 and names the way out', () => {
  const r = runHook('keep building', line(usage(0, 950_000)));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /950k/);
  assert.match(r.stderr, /\/clear/);
  assert.match(r.stderr, /CONTEXT OK/);
});

test('a slash command is never blocked — /clear is the escape hatch', () => {
  // The bug this guards: blocking every prompt at the hard stop also blocks
  // the command that resolves it, wedging the session with no way out.
  const r = runHook('/clear', line(usage(0, 950_000)));
  assert.equal(r.code, 0);
});

test('CONTEXT OK overrides the hard stop', () => {
  const r = runHook('CONTEXT OK, finishing this wave', line(usage(0, 950_000)));
  assert.equal(r.code, 0);
});

test('a smaller window blocks earlier — the bands follow the window they are given', () => {
  const r = runHook('keep building', line(usage(0, 240_000)), { window: 250_000 });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /235k/);
});

test('with no window source the hook stays silent rather than guessing a band', () => {
  const r = runHook('keep building', line(usage(0, 950_000)), { window: null });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
});

test('a broken transcript path fails open rather than wedging the session', () => {
  const payload = JSON.stringify({ prompt: 'hi', session_id: 'x', transcript_path: '/no/such/file' });
  const out = execFileSync(process.execPath, [HOOK], { input: payload, encoding: 'utf8' });
  assert.equal(out.trim(), '');
});
