// node --test scripts/test/context-gauge.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execHarness, raceHarness, tempDir } from './_spawn.mjs';
import { existsSync, mkdirSync, readdirSync, utimesSync, writeFileSync, rmSync } from 'node:fs';
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
  blockFloored,
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

// A usage-history record, in the shape statusline/statusline.mjs writes.
const sample = (session_id, context_window_size, extra = {}) =>
  JSON.stringify({ ts: new Date().toISOString(), session_id, context_window_size, context_pct: 12, ...extra });

/** Temp dir shaped like a home dir with ~/.claude inside it. */
function claudeHome({ settings, history, month = '2026-09' } = {}) {
  const home = tempDir('ctxgauge-home-');
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
  const { dir } = claudeHome({
    history: [sample('other', 200_000), sample('mine', 1_000_000)].join('\n'),
  });
  assert.equal(contextWindow({ dir, env: {} }), 1_000_000);
});

test('the session own record wins over a newer record from another session', () => {
  const { dir } = claudeHome({
    history: [sample('mine', 1_000_000), sample('other', 200_000)].join('\n'),
  });
  assert.equal(contextWindow({ dir, env: {}, sessionId: 'mine' }), 1_000_000);
  assert.equal(contextWindow({ dir, env: {}, sessionId: 'unseen' }), 200_000); // newest overall
});

test('the newest month file is the one read, and junk records are skipped', () => {
  const { dir } = claudeHome({ month: '2026-08', history: sample('a', 200_000) });
  writeFileSync(
    join(dir, 'usage-history', '2026-09.jsonl'),
    [sample('a', null), '{ not json', sample('a', 0), sample('a', 1_000_000), ''].join('\n'),
  );
  assert.equal(contextWindow({ dir, env: {} }), 1_000_000);
});

test('a contextGaugeWindow settings key overrides the history log', () => {
  const { dir } = claudeHome({
    settings: JSON.stringify({ contextGaugeWindow: 500_000 }),
    history: sample('a', 1_000_000),
  });
  assert.equal(contextWindow({ dir, env: {} }), 500_000);
});

test('settings that are absent, unreadable, or carry a junk key fall through to history', () => {
  // The settings key does not exist on this machine today, so the fall-through
  // is the live path, not the exotic one.
  const { dir } = claudeHome({ settings: '{ not json', history: sample('a', 1_000_000) });
  assert.equal(contextWindow({ dir, env: {} }), 1_000_000);
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ contextGaugeWindow: 'lots' }));
  assert.equal(contextWindow({ dir, env: {} }), 1_000_000);
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ model: 'opus' }));
  assert.equal(contextWindow({ dir, env: {} }), 1_000_000);
});

test('CLAUDE_CTX_WINDOW overrides every other source', () => {
  const { dir } = claudeHome({
    settings: JSON.stringify({ contextGaugeWindow: 500_000 }),
    history: sample('a', 1_000_000),
  });
  assert.equal(contextWindow({ dir, env: { CLAUDE_CTX_WINDOW: '300000' } }), 300_000);
  assert.equal(contextWindow({ dir, env: { CLAUDE_CTX_WINDOW: 'nope' } }), 500_000);
});

test('CLAUDE_USAGE_HISTORY_DIR relocates the log, as it does for the statusline', () => {
  const { dir } = claudeHome({});
  const alt = tempDir('ctxgauge-hist-');
  writeFileSync(join(alt, '2026-09.jsonl'), sample('a', 1_000_000));
  assert.equal(contextWindow({ dir, env: { CLAUDE_USAGE_HISTORY_DIR: alt } }), 1_000_000);
});

test('with no source at all the window is null — the gauge never invents one', () => {
  const { dir } = claudeHome({});
  assert.equal(contextWindow({ dir, env: {} }), null);
  assert.equal(contextWindow({ dir: join(dir, 'nope'), env: {} }), null);
});

test('skipHistory keeps the 128 KB history tail unread', () => {
  const { dir } = claudeHome({ history: sample('a', 1_000_000) });
  assert.equal(contextWindow({ dir, env: {}, skipHistory: true }), null);
  assert.equal(contextWindow({ dir, env: { CLAUDE_CTX_WINDOW: '300000' }, skipHistory: true }), 300_000);
});

// --- absolute bands, the window only a floor ---

test('bands are absolute tokens, with or without a window', () => {
  assert.deepEqual(BANDS, { nudge: 150_000, warn: 200_000, blockAt: 250_000 });
  assert.deepEqual(thresholds(null, {}), { nudge: 150_000, warn: 200_000, blockAt: 250_000 });
  assert.deepEqual(thresholds(1_000_000, {}), { nudge: 150_000, warn: 200_000, blockAt: 250_000 });
});

test('a small window is a floor: blockAt = 0.94 x window, warn and nudge clamped under it', () => {
  assert.deepEqual(thresholds(200_000, {}), { nudge: 112_800, warn: 150_400, blockAt: 188_000 });
  assert.deepEqual(thresholds(100_000, {}), { nudge: 56_400, warn: 75_200, blockAt: 94_000 });
  for (const w of [100_000, 128_000, 200_000, 213_000, 266_000]) {
    const b = thresholds(w, {});
    assert.ok(b.nudge < b.warn && b.warn < b.blockAt, `ordered at window ${w}`);
  }
  // an explicit per-band override still wins over the derived band
  assert.equal(thresholds(200_000, { CLAUDE_CTX_WARN: '170000' }).warn, 170_000);
  assert.ok(blockFloored(200_000, {}));
  assert.ok(!blockFloored(1_000_000, {}));
  assert.ok(!blockFloored(null, {}));
});

test('env overrides stay, and junk falls back to the absolute band', () => {
  assert.equal(thresholds(null, { CLAUDE_CTX_NUDGE: '50000' }).nudge, 50_000);
  assert.equal(thresholds(null, { CLAUDE_CTX_BLOCK: 'nope' }).blockAt, 250_000);
  assert.equal(thresholds(null, { CLAUDE_CTX_WARN: '0' }).warn, 200_000);
  assert.deepEqual(thresholds(null, { CLAUDE_CTX_NUDGE: '10', CLAUDE_CTX_WARN: '20', CLAUDE_CTX_BLOCK: '30' }), {
    nudge: 10,
    warn: 20,
    blockAt: 30,
  });
  // an explicit block override beats the window floor
  assert.equal(thresholds(200_000, { CLAUDE_CTX_BLOCK: '300000' }).blockAt, 300_000);
  assert.ok(!blockFloored(200_000, { CLAUDE_CTX_BLOCK: '300000' }));
});

test('bands split at the thresholds', () => {
  const t = thresholds(null, {});
  assert.equal(classify(149_999, t), 'ok');
  assert.equal(classify(150_000, t), 'nudge');
  assert.equal(classify(199_999, t), 'nudge');
  assert.equal(classify(200_000, t), 'warn');
  assert.equal(classify(250_000, t), 'block');
});

// --- what the messages say ---

test('nudge says stop at the next green commit, with no auto-compact framing', () => {
  const text = nudgeText(160_000, thresholds(null, {}));
  assert.match(text, /160k/);
  assert.match(text, /next green commit/i);
  assert.doesNotMatch(text, /auto-compact|not cost|window/i);
});

test('warn says checkpoint, then run the continuation skill', () => {
  const text = warnText(210_000, thresholds(null, {}));
  assert.match(text, /What\/Verified\/Next\/Ruled out/);
  assert.match(text, /comment/i);
  assert.match(text, /continuation\/SKILL\.md/);
  assert.doesNotMatch(text, /AskUserQuestion/);
  assert.doesNotMatch(text, /auto-compact|window/i);
});

test('the window is named only when the floor applied', () => {
  const t = thresholds(200_000, {});
  assert.doesNotMatch(nudgeText(160_000, t), /window/);
  assert.match(nudgeText(160_000, t, 200_000), /200k window/);
  assert.match(warnText(190_000, t, 200_000), /200k window/);
  const b = blockText(190_000, t, 200_000);
  assert.match(b, /200k window/);
  assert.match(b, /188k/);
  assert.match(b, /CONTEXT OK/);
  assert.doesNotMatch(blockText(260_000, thresholds(null, {})), /window|auto-compact/i);
});

test('bands fire once and only escalate', () => {
  assert.equal(shouldFire('nudge', {}), true);
  assert.equal(shouldFire('nudge', { fired: 'nudge' }), false);
  assert.equal(shouldFire('warn', { fired: 'nudge' }), true);
  assert.equal(shouldFire('nudge', { fired: 'warn' }), false);
});

test('readTail returns the end of a file larger than the window', () => {
  const dir = tempDir('ctxgauge-');
  const f = join(dir, 'big.jsonl');
  writeFileSync(f, `${'x'.repeat(5000)}\n${line(usage(0, 150_000))}`);
  const tail = readTail(f, 1024);
  assert.ok(tail.length <= 1024);
  assert.equal(contextTokens(tail), 150_000);
});

// --- end-to-end: pipe a payload to the hook, same contract as the others ---

/** One hook spawn. A `home` passed in is shared across calls, so state persists. */
function spawnGauge(payloadExtra, transcript, { window, env = {}, home: given, sid = 'e2e-sid' } = {}) {
  const home = given ?? claudeHome({ history: window == null ? undefined : sample(sid, window) }).home;
  const t = join(home, 'transcript.jsonl');
  writeFileSync(t, transcript);
  const payload = JSON.stringify({ session_id: sid, transcript_path: t, ...payloadExtra });
  try {
    const stdout = execHarness(HOOK, [], { input: payload, home, env });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

const runHook = (prompt, transcript, opts) => spawnGauge({ prompt }, transcript, opts);
const runPost = (transcript, opts, extra = {}) =>
  spawnGauge({ hook_event_name: 'PostToolUse', tool_name: 'Bash', ...extra }, transcript, opts);
const sharedHome = () => claudeHome({}).home;

test('with no window source the absolute bands still fire: 160k nudges, 260k blocks', () => {
  const n = runHook('carry on', line(usage(0, 160_000)), { window: null });
  assert.equal(n.code, 0);
  assert.match(n.stdout, /context-gauge.*160k/s);
  const b = runHook('keep building', line(usage(0, 260_000)), { window: null });
  assert.equal(b.code, 2);
  assert.match(b.stderr, /260k/);
  assert.doesNotMatch(b.stderr, /fresh-session-or-continue|AskUserQuestion/);
  assert.match(b.stderr, /\/exit, run the launch line/);
  assert.match(b.stderr, /\/compact/);
  assert.doesNotMatch(b.stderr, /clear-vs-continue|\/clear\b/);
  assert.match(b.stderr, /CONTEXT OK/);
});

test('a big window does not delay the bands: 1M window, 260k still blocks', () => {
  assert.equal(runHook('keep building', line(usage(0, 260_000)), { window: 1_000_000 }).code, 2);
  assert.equal(runHook('carry on', line(usage(0, 140_000)), { window: 1_000_000 }).stdout.trim(), '');
});

test('the floor: a 200k window blocks at 188k, via history and via CLAUDE_CTX_WINDOW', () => {
  const viaHistory = runHook('keep building', line(usage(0, 190_000)), { window: 200_000 });
  assert.equal(viaHistory.code, 2);
  assert.match(viaHistory.stderr, /188k/);
  assert.match(viaHistory.stderr, /200k window/);
  const viaEnv = runHook('keep building', line(usage(0, 95_000)), { window: null, env: { CLAUDE_CTX_WINDOW: '100000' } });
  assert.equal(viaEnv.code, 2);
  assert.match(viaEnv.stderr, /94k/);
});

test('a slash command is never blocked, and CONTEXT OK overrides the hard stop', () => {
  assert.equal(runHook('/clear', line(usage(0, 260_000)), { window: null }).code, 0);
  assert.equal(runHook('CONTEXT OK, finishing this wave', line(usage(0, 260_000)), { window: null }).code, 0);
});

test('env overrides move the bands end to end', () => {
  const env = { CLAUDE_CTX_NUDGE: '1000', CLAUDE_CTX_WARN: '2000', CLAUDE_CTX_BLOCK: '3000' };
  assert.match(runHook('x', line(usage(0, 1500)), { window: null, env }).stdout, /context-gauge.*2k|context-gauge.*1k/s);
  assert.equal(runHook('x', line(usage(0, 3500)), { window: null, env }).code, 2);
});

test('PostToolUse emits additionalContext JSON per band and exits 0', () => {
  const nudge = runPost(line(usage(0, 160_000)), { window: null });
  assert.equal(nudge.code, 0);
  const n = JSON.parse(nudge.stdout);
  assert.equal(n.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(n.hookSpecificOutput.additionalContext, /160k.*next green commit/s);

  const w = JSON.parse(runPost(line(usage(0, 210_000)), { window: null }).stdout);
  assert.match(w.hookSpecificOutput.additionalContext, /continuation\/SKILL\.md/);
  assert.doesNotMatch(w.hookSpecificOutput.additionalContext, /fresh-session-or-continue|AskUserQuestion/);
  assert.doesNotMatch(w.hookSpecificOutput.additionalContext, /clear-or-continue/);

  const blockRun = runPost(line(usage(0, 260_000)), { window: null });
  assert.equal(blockRun.code, 0); // a tool that already ran can't be blocked
  assert.match(JSON.parse(blockRun.stdout).hookSpecificOutput.additionalContext, /260k.*\/exit/s);

  assert.equal(runPost(line(usage(0, 100_000)), { window: null }).stdout.trim(), '');
});

test('a tool-call payload without hook_event_name is treated as PostToolUse, never blocked', () => {
  const r = spawnGauge({ tool_name: 'Bash' }, line(usage(0, 260_000)), { window: null });
  assert.equal(r.code, 0);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /260k/);
});

test('PostToolUse skips subagent tool calls (agent_id)', () => {
  const r = runPost(line(usage(0, 260_000)), { window: null }, { agent_id: 'sub-1' });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
});

test('PostToolUse fires each band once per session', () => {
  const home = sharedHome();
  assert.match(runPost(line(usage(0, 160_000)), { home }).stdout, /next green commit/);
  assert.equal(runPost(line(usage(0, 165_000)), { home }).stdout.trim(), '');
  assert.match(runPost(line(usage(0, 210_000)), { home }).stdout, /continuation/);
});

test('state is shared: a nudge on PostToolUse does not re-fire on UserPromptSubmit, and vice versa', () => {
  const home = sharedHome();
  assert.match(runPost(line(usage(0, 160_000)), { home, sid: 'a' }).stdout, /next green commit/);
  assert.equal(runHook('go on', line(usage(0, 165_000)), { home, sid: 'a' }).stdout.trim(), '');
  assert.match(runHook('go on', line(usage(0, 210_000)), { home, sid: 'b' }).stdout, /continuation/);
  assert.equal(runPost(line(usage(0, 215_000)), { home, sid: 'b' }).stdout.trim(), '');
});

// Sized to reproduce the pre-#139 duplicate without starving other test files on a small CI runner.
const RACERS = 8;
const RACE_TRIALS = 2;

test('parallel PostToolUse calls crossing a band together announce it once, and a lost race still announces next call (#139)', async () => {
  for (let trial = 0; trial < RACE_TRIALS; trial++) {
    const home = sharedHome();
    const transcript = join(home, 'transcript.jsonl');
    writeFileSync(transcript, line(usage(0, 160_000)));
    const payload = { hook_event_name: 'PostToolUse', tool_name: 'Bash', session_id: 'race', transcript_path: transcript };
    const env = { CLAUDE_CTX_WINDOW: '', CLAUDE_CTX_NUDGE: '', CLAUDE_CTX_WARN: '', CLAUDE_CTX_BLOCK: '' };
    const outs = await raceHarness(RACERS, HOOK, `m.main(${JSON.stringify(payload)});`, { home, env });
    const announced = outs.filter((o) => /next green commit/.test(o)).length;
    assert.ok(announced <= 1, `trial ${trial}: ${announced} of ${RACERS} parallel calls announced the nudge`);
    const next = runPost(line(usage(0, 160_000)), { home, sid: 'race', env }).stdout;
    assert.equal(announced + (/next green commit/.test(next) ? 1 : 0), 1, `trial ${trial}: the band is announced exactly once`);
  }
});

test('while a PostToolUse holds the claim, UserPromptSubmit still blocks and still records CONTEXT OK (#139)', async () => {
  const { claimFile, CLAIM_LEASE_MS } = await import('../../hooks/_hooklib.mjs');
  const home = sharedHome();
  const base = join(home, '.claude', 'context-gauge', 'e2e-sid.json');
  mkdirSync(join(home, '.claude', 'context-gauge'), { recursive: true });
  const e = Math.floor(Date.now() / CLAIM_LEASE_MS);
  for (const k of [e - 1, e, e + 1, e + 2]) writeFileSync(claimFile(base, k), ''); // held across any rollover mid-test
  assert.equal(runHook('keep building', line(usage(0, 262_000)), { home }).code, 2, 'the block is never gated by the claim');
  assert.equal(runHook('CONTEXT OK', line(usage(0, 262_000)), { home }).code, 0);
  for (const k of [e - 1, e, e + 1, e + 2]) rmSync(claimFile(base, k));
  assert.equal(runHook('keep building', line(usage(0, 262_000)), { home }).code, 0, 'the bypass was recorded despite the held claim');
});

test('a block announced on PostToolUse is announced once, and UserPromptSubmit still exits 2', () => {
  const home = sharedHome();
  assert.match(runPost(line(usage(0, 260_000)), { home }).stdout, /additionalContext/);
  assert.equal(runPost(line(usage(0, 262_000)), { home }).stdout.trim(), '');
  const prompt = runHook('keep building', line(usage(0, 262_000)), { home });
  assert.equal(prompt.code, 2);
  assert.match(prompt.stderr, /\/exit/);
});

test('dropping under the nudge line re-arms the bands for both triggers', () => {
  const home = sharedHome();
  assert.match(runPost(line(usage(0, 160_000)), { home }).stdout, /next green commit/);
  assert.equal(runPost(line(usage(0, 20_000)), { home }).stdout.trim(), '');
  assert.match(runPost(line(usage(0, 160_000)), { home }).stdout, /next green commit/);
});

test('a write prunes week-old sessions and their sidecars, and the legacy inline-edit-nudge lock (#217)', () => {
  const home = sharedHome();
  const dir = join(home, '.claude', 'context-gauge');
  mkdirSync(dir, { recursive: true });
  const touch = (name, daysAgo) => {
    const p = join(dir, name);
    writeFileSync(p, '{}');
    const t = new Date(Date.now() - daysAgo * 24 * 3600 * 1000);
    utimesSync(p, t, t);
  };
  for (const f of ['dead.json', 'dead.json.lock.123', 'dead.json.4242.tmp']) touch(f, 8);
  touch('recent.json', 6);
  const legacy = join(home, '.claude', 'inline-edit-nudge.json.lock');
  writeFileSync(legacy, '');
  assert.equal(runPost(line(usage(0, 20_000)), { home }).stdout.trim(), '', 'under the nudge line nothing is written');
  assert.equal(readdirSync(dir).length, 4, 'only a write prunes');
  assert.match(runPost(line(usage(0, 160_000)), { home }).stdout, /next green commit/);
  assert.deepEqual(readdirSync(dir).sort(), ['e2e-sid.json', 'recent.json']);
  assert.ok(!existsSync(legacy), 'the legacy lock is removed');
});

test('a broken transcript path fails open rather than wedging the session', () => {
  const payload = JSON.stringify({ prompt: 'hi', session_id: 'x', transcript_path: '/no/such/file' });
  const out = execHarness(HOOK, [], { input: payload });
  assert.equal(out.trim(), '');
});
