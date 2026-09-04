// node --test scripts/test/agent-model-guard.test.mjs — .mjs ports of the
// fable clearance grant + Agent model guard (replaces the .ps1 test suite).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const hooksDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks');
const guard = join(hooksDir, 'agent-model-guard.mjs');
const grant = join(hooksDir, 'fable-clearance-grant.mjs');

function home() {
  const h = mkdtempSync(join(tmpdir(), 'amg-'));
  mkdirSync(join(h, '.claude'), { recursive: true });
  return h;
}

const envFor = (h) => ({ ...process.env, HOME: h, USERPROFILE: h, CLAUDE_WORKSPACE_ROOT: join(h, 'code') });

function runHook(script, payload, h) {
  try {
    execFileSync(process.execPath, [script], { input: JSON.stringify(payload), encoding: 'utf8', env: envFor(h) });
    return { code: 0 };
  } catch (e) {
    return { code: e.status, stderr: e.stderr };
  }
}

const marker = (h) => join(h, '.claude', 'fable-clearance.json');
const ledger = (h) => join(h, '.claude', 'fable-dispatch.log');
const fresh = (h) => writeFileSync(marker(h), JSON.stringify({ granted: new Date().toISOString() }));

/** The state post-model-switch.mjs writes: what model each session is on now. */
function liveModel(h, sessions, latest = null) {
  writeFileSync(
    join(h, '.claude', 'current-model.json'),
    JSON.stringify({ updated: new Date().toISOString(), latest, sessions }),
  );
}

const settingsModel = (h, model) => writeFileSync(join(h, '.claude', 'settings.json'), JSON.stringify({ model }));

test('the temp-home redirect actually takes effect in a spawned hook', () => {
  const h = home();
  const seen = execFileSync(process.execPath, ['-e', 'console.log(require("os").homedir())'], {
    encoding: 'utf8',
    env: envFor(h),
  }).trim();
  assert.equal(seen, h, 'os.homedir() in the child must resolve to the temp home (Windows reads USERPROFILE, not HOME)');
});

test('grant writes the marker when FABLE OK opens the (trimmed) prompt', () => {
  const h = home();
  assert.equal(runHook(grant, { prompt: 'FABLE OK' }, h).code, 0);
  assert.ok(existsSync(marker(h)), 'marker written for the bare token');

  const h2 = home();
  assert.equal(runHook(grant, { prompt: 'FABLE OK, go ahead' }, h2).code, 0);
  assert.ok(existsSync(marker(h2)), 'marker written when the token opens the prompt with trailing text');

  const h3 = home();
  assert.equal(runHook(grant, { prompt: '  FABLE OK' }, h3).code, 0);
  assert.ok(existsSync(marker(h3)), 'marker written when the token opens the prompt after leading whitespace');
});

test('grant does not fire when the prompt only mentions the token', () => {
  const h = home();
  runHook(grant, { prompt: 'go ahead, FABLE OK' }, h);
  assert.ok(!existsSync(marker(h)), 'token trailing other text must not grant');

  const h2 = home();
  runHook(grant, { prompt: 'the docs say FABLE OK grants a run' }, h2);
  assert.ok(!existsSync(marker(h2)), 'mid-sentence mention must not grant');

  const h3 = home();
  runHook(grant, { prompt: 'FABLE OKAY, proceed' }, h3);
  assert.ok(!existsSync(marker(h3)), 'a longer word starting with the token must not grant');

  const h4 = home();
  runHook(grant, { prompt: 'fable ok i guess' }, h4);
  assert.ok(!existsSync(marker(h4)), 'lowercase near-miss must not grant');
});

test('fable dispatch without clearance blocks and logs BLOCK', () => {
  const h = home();
  const r = runHook(guard, { tool_input: { subagent_type: 'recon', model: 'claude-fable-5' } }, h);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /FABLE OK/);
  assert.match(readFileSync(ledger(h), 'utf8'), /BLOCK/);
});

test('fable dispatch with a fresh marker passes once and consumes it', () => {
  const h = home();
  writeFileSync(marker(h), JSON.stringify({ granted: new Date().toISOString() }));
  const first = runHook(guard, { tool_input: { subagent_type: 'recon', model: 'fable' } }, h);
  assert.equal(first.code, 0);
  assert.ok(!existsSync(marker(h)), 'marker consumed (single use)');
  assert.match(readFileSync(ledger(h), 'utf8'), /ALLOW/);

  const second = runHook(guard, { tool_input: { subagent_type: 'recon', model: 'fable' } }, h);
  assert.equal(second.code, 2, 'a consumed marker never allows a second dispatch');
});

test('a stale (>30min) or corrupt marker blocks', () => {
  const h = home();
  writeFileSync(marker(h), JSON.stringify({ granted: new Date(Date.now() - 31 * 60000).toISOString() }));
  assert.equal(runHook(guard, { tool_input: { model: 'fable', subagent_type: 'recon' } }, h).code, 2);

  const h2 = home();
  writeFileSync(marker(h2), 'not json');
  const r = runHook(guard, { tool_input: { model: 'fable', subagent_type: 'recon' } }, h2);
  assert.equal(r.code, 2);
  assert.match(readFileSync(ledger(h2), 'utf8'), /BLOCK/, 'corrupt marker still writes a ledger line');
});

test('model omitted on a def-less type blocks; frontmatter-model type passes', () => {
  const h = home();
  const r = runHook(guard, { tool_input: { subagent_type: 'general-purpose' } }, h);
  assert.equal(r.code, 2, 'no model + no frontmatter default = block');
  assert.match(r.stderr, /ROUTING\.md/);

  const agents = join(h, '.claude', 'agents');
  mkdirSync(agents, { recursive: true });
  writeFileSync(join(agents, 'recon.md'), '---\nname: recon\nmodel: haiku\n---\n');
  assert.equal(runHook(guard, { tool_input: { subagent_type: 'recon' } }, h).code, 0);
});

test('non-fable explicit model passes with no ledger line', () => {
  const h = home();
  assert.equal(runHook(guard, { tool_input: { subagent_type: 'x', model: 'sonnet' } }, h).code, 0);
  assert.ok(!existsSync(ledger(h)), 'no fable ledger line for non-fable dispatches');
});

// --- fork dispatches: the model is the session's, not the dispatch's --------

test('a fork on a live fable session needs clearance', () => {
  const h = home();
  liveModel(h, { s1: { model: 'claude-fable-5-1', from: 'claude-opus-5', at: new Date().toISOString() } });
  const r = runHook(guard, { session_id: 's1', tool_input: { subagent_type: 'fork' } }, h);
  assert.equal(r.code, 2, 'a fork inherits the session model, so a fable session forks fable');
  assert.match(r.stderr, /FABLE OK/);
  assert.match(readFileSync(ledger(h), 'utf8'), /BLOCK/);
});

test('a fork on a live fable session passes with a fresh marker and consumes it', () => {
  const h = home();
  liveModel(h, { s1: { model: 'claude-fable-5-1', from: null, at: new Date().toISOString() } });
  fresh(h);
  assert.equal(runHook(guard, { session_id: 's1', tool_input: { subagent_type: 'fork' } }, h).code, 0);
  assert.ok(!existsSync(marker(h)), 'marker consumed (single use)');
  assert.match(readFileSync(ledger(h), 'utf8'), /ALLOW/);
});

test('a fork on a non-billed session passes with no model set and no ledger line', () => {
  const h = home();
  liveModel(h, { s1: { model: 'claude-opus-5', from: null, at: new Date().toISOString() } });
  assert.equal(
    runHook(guard, { session_id: 's1', tool_input: { subagent_type: 'fork' } }, h).code,
    0,
    'a fork cannot carry a model, so the omitted-model rule must not fire on it',
  );
  assert.ok(!existsSync(ledger(h)), 'no fable ledger line for a non-billed fork');
});

test('a fork ignores its own model: field — the tool does too', () => {
  const h = home();
  liveModel(h, { s1: { model: 'claude-fable-5-1', from: null, at: new Date().toISOString() } });
  assert.equal(
    runHook(guard, { session_id: 's1', tool_input: { subagent_type: 'fork', model: 'sonnet' } }, h).code,
    2,
    'a model override on a fork is ignored by the Agent tool and must not launder a fable session',
  );
});

test('another session switching to fable does not gate this one', () => {
  const h = home();
  settingsModel(h, 'opus');
  liveModel(h, { other: { model: 'claude-fable-5-1', from: null, at: new Date().toISOString() } });
  assert.equal(runHook(guard, { session_id: 's1', tool_input: { subagent_type: 'fork' } }, h).code, 0);
});

test('with no record for this session the guard falls back to the settings model', () => {
  const h = home();
  settingsModel(h, 'opus');
  assert.equal(runHook(guard, { session_id: 's1', tool_input: { subagent_type: 'fork' } }, h).code, 0);

  const h2 = home();
  settingsModel(h2, 'claude-fable-5-1[1m]');
  assert.equal(
    runHook(guard, { session_id: 's1', tool_input: { subagent_type: 'fork' } }, h2).code,
    2,
    'a fable session default gates forks even before any switch has been recorded',
  );
});

test('a payload with no session_id falls back to the last switch of any session', () => {
  const h = home();
  settingsModel(h, 'opus');
  liveModel(h, {}, { session_id: 'other', model: 'claude-fable-5-1', from: null, at: new Date().toISOString() });
  const r = runHook(guard, { tool_input: { subagent_type: 'fork' } }, h);
  assert.equal(r.code, 2, 'unable to tell whose switch it was, the guard assumes the billed one');
  assert.match(r.stderr, /FABLE OK/, 'blocked as a billed fork, not as a model-omitted dispatch');
});

test('a fork blocks when the live model cannot be determined at all', () => {
  const h = home();
  const r = runHook(guard, { session_id: 's1', tool_input: { subagent_type: 'fork' } }, h);
  assert.equal(r.code, 2, 'no record and no settings model = unknown, and unknown must not fork');
  assert.match(r.stderr, /current-model\.json/);

  const h2 = home();
  liveModel(h2, { s1: { model: null, from: 'claude-fable-5-1', at: new Date().toISOString() } });
  assert.equal(runHook(guard, { session_id: 's1', tool_input: { subagent_type: 'fork' } }, h2).code, 2, 'a recorded unknown is still unknown');
});

test('a live fable session does not gate ordinary dispatches', () => {
  const h = home();
  liveModel(h, { s1: { model: 'claude-fable-5-1', from: null, at: new Date().toISOString() } });
  assert.equal(
    runHook(guard, { session_id: 's1', tool_input: { subagent_type: 'recon', model: 'sonnet' } }, h).code,
    0,
    'a non-fork child runs on its own model, not the session one',
  );
});

// --- H55: mythos is billed too ---------------------------------------------

test('a mythos dispatch is gated exactly like fable', () => {
  const h = home();
  const r = runHook(guard, { tool_input: { subagent_type: 'recon', model: 'claude-mythos-5-1' } }, h);
  assert.equal(r.code, 2);
  assert.match(readFileSync(ledger(h), 'utf8'), /BLOCK/);

  const h2 = home();
  fresh(h2);
  assert.equal(runHook(guard, { tool_input: { subagent_type: 'recon', model: 'claude-mythos-5-1' } }, h2).code, 0);
});

// --- the guard fails closed ------------------------------------------------

test('the guard blocks when it cannot read the payload', () => {
  const h = home();
  let code = 0;
  let stderr = '';
  try {
    execFileSync(process.execPath, [guard], { input: 'not json', encoding: 'utf8', env: envFor(h) });
  } catch (e) {
    code = e.status;
    stderr = e.stderr;
  }
  assert.equal(code, 2, 'a guard that crashed has checked nothing — it must not wave the dispatch through');
  assert.match(stderr, /fails closed/);
});
