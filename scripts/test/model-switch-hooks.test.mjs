// node --test scripts/test/model-switch-hooks.test.mjs — the two model-switch
// hooks: post-model-switch.mjs (records the live model) and
// pre-model-switch.mjs (gates a switch *to* a usage-billed model).
//
// Every test runs against a throwaway home. A clearance marker or a
// current-model.json written into the real ~/.claude would grant a real
// usage-billed run, so the redirect is asserted, not assumed (first test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const hooksDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks');
const postSwitch = join(hooksDir, 'post-model-switch.mjs');
const preSwitch = join(hooksDir, 'pre-model-switch.mjs');

function home() {
  const h = mkdtempSync(join(tmpdir(), 'msw-'));
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
const modelFile = (h) => join(h, '.claude', 'current-model.json');
const readModel = (h) => JSON.parse(readFileSync(modelFile(h), 'utf8'));
const fresh = (h) => writeFileSync(marker(h), JSON.stringify({ granted: new Date().toISOString() }));

test('the temp-home redirect actually takes effect in a spawned hook', () => {
  const h = home();
  const seen = execFileSync(process.execPath, ['-e', 'console.log(require("os").homedir())'], {
    encoding: 'utf8',
    env: envFor(h),
  }).trim();
  assert.equal(seen, h, 'os.homedir() in the child must resolve to the temp home (Windows reads USERPROFILE, not HOME)');
});

// --- post-model-switch: the writer -----------------------------------------

test('post-model-switch records the session model from to_model', () => {
  const h = home();
  const r = runHook(postSwitch, { session_id: 's1', from_model: 'claude-opus-5', to_model: 'claude-fable-5-1' }, h);
  assert.equal(r.code, 0);
  const state = readModel(h);
  assert.equal(state.sessions.s1.model, 'claude-fable-5-1');
  assert.equal(state.sessions.s1.from, 'claude-opus-5');
  assert.equal(state.latest.session_id, 's1');
  assert.equal(state.latest.model, 'claude-fable-5-1');
});

test('post-model-switch keeps other sessions and overwrites its own', () => {
  const h = home();
  runHook(postSwitch, { session_id: 's1', to_model: 'claude-fable-5-1' }, h);
  runHook(postSwitch, { session_id: 's2', to_model: 'claude-haiku-4-5' }, h);
  runHook(postSwitch, { session_id: 's1', from_model: 'claude-fable-5-1', to_model: 'claude-opus-5' }, h);
  const state = readModel(h);
  assert.equal(state.sessions.s1.model, 'claude-opus-5', 'own entry replaced, not appended');
  assert.equal(state.sessions.s2.model, 'claude-haiku-4-5', 'a concurrent session must survive');
});

test('post-model-switch records an unknown model rather than dropping the switch', () => {
  const h = home();
  runHook(postSwitch, { session_id: 's1', to_model: 'claude-fable-5-1' }, h);
  runHook(postSwitch, { session_id: 's1', from_model: 'claude-fable-5-1' }, h); // to_model absent
  const state = readModel(h);
  assert.equal(state.sessions.s1.model, null, 'an unnameable model is recorded as unknown, never left reading fable-clear');
});

test('post-model-switch survives a corrupt state file', () => {
  const h = home();
  writeFileSync(modelFile(h), '{not json');
  assert.equal(runHook(postSwitch, { session_id: 's1', to_model: 'claude-opus-5' }, h).code, 0);
  assert.equal(readModel(h).sessions.s1.model, 'claude-opus-5');
});

test('post-model-switch bounds the sessions map', () => {
  const h = home();
  const state = { updated: new Date(0).toISOString(), latest: null, sessions: {} };
  for (let i = 0; i < 80; i += 1) {
    state.sessions[`old-${i}`] = { model: 'claude-opus-5', from: null, at: new Date(1000 + i).toISOString() };
  }
  writeFileSync(modelFile(h), JSON.stringify(state));
  runHook(postSwitch, { session_id: 'new', to_model: 'claude-fable-5-1' }, h);
  const after = readModel(h);
  assert.ok(Object.keys(after.sessions).length <= 50, 'map is trimmed');
  assert.equal(after.sessions.new.model, 'claude-fable-5-1', 'the newest entry is always kept');
  assert.ok(!after.sessions['old-0'], 'the oldest entries are the ones dropped');
});

// --- pre-model-switch: the gate --------------------------------------------

test('a switch to fable without clearance is blocked and logged', () => {
  const h = home();
  const r = runHook(preSwitch, { session_id: 's1', from_model: 'claude-opus-5', to_model: 'claude-fable-5-1' }, h);
  assert.equal(r.code, 2, 'exit 2 blocks the model switch');
  assert.match(r.stderr, /FABLE OK/);
  assert.match(readFileSync(ledger(h), 'utf8'), /BLOCK switch/);
});

test('a switch to mythos is gated the same way as fable', () => {
  const h = home();
  assert.equal(runHook(preSwitch, { session_id: 's1', to_model: 'claude-mythos-5-1' }, h).code, 2);
});

test('model matching is case-insensitive', () => {
  const h = home();
  assert.equal(runHook(preSwitch, { session_id: 's1', to_model: 'Claude-Fable-5-1[1m]' }, h).code, 2);
});

test('a switch to fable with a fresh marker passes once and consumes it', () => {
  const h = home();
  fresh(h);
  const first = runHook(preSwitch, { session_id: 's1', to_model: 'claude-fable-5-1' }, h);
  assert.equal(first.code, 0);
  assert.ok(!existsSync(marker(h)), 'marker consumed (single use)');
  assert.match(readFileSync(ledger(h), 'utf8'), /ALLOW switch/);
  assert.equal(
    runHook(preSwitch, { session_id: 's1', to_model: 'claude-fable-5-1' }, h).code,
    2,
    'a consumed marker never allows a second switch',
  );
});

test('a stale marker does not clear a switch', () => {
  const h = home();
  writeFileSync(marker(h), JSON.stringify({ granted: new Date(Date.now() - 31 * 60000).toISOString() }));
  assert.equal(runHook(preSwitch, { session_id: 's1', to_model: 'claude-fable-5-1' }, h).code, 2);
});

test('switching away from fable is never gated and never spends clearance', () => {
  const h = home();
  fresh(h);
  assert.equal(runHook(preSwitch, { session_id: 's1', from_model: 'claude-fable-5-1', to_model: 'claude-opus-5' }, h).code, 0);
  assert.ok(existsSync(marker(h)), 'a non-billed switch must not consume the user clearance');
  assert.ok(!existsSync(ledger(h)), 'no ledger line for a non-billed switch');
});

test('a switch whose target cannot be named is allowed but recorded', () => {
  const h = home();
  const r = runHook(preSwitch, { session_id: 's1', from_model: 'claude-opus-5' }, h); // to_model absent
  assert.equal(r.code, 0, 'the switch itself is not billed, and the fork/dispatch gates still see the unknown model');
  assert.match(readFileSync(ledger(h), 'utf8'), /UNKNOWN switch/, 'an unidentifiable switch target is auditable');
});

test('pre-model-switch fails closed when it cannot read the payload', () => {
  const h = home();
  let code = 0;
  let stderr = '';
  try {
    execFileSync(process.execPath, [preSwitch], { input: 'not json', encoding: 'utf8', env: envFor(h) });
  } catch (e) {
    code = e.status;
    stderr = e.stderr;
  }
  assert.equal(code, 2, 'a gate that crashed has checked nothing — it blocks rather than waving the switch through');
  assert.match(stderr, /fails closed/);
});
