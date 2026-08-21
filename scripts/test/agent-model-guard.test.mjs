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

function runHook(script, payload, h) {
  const env = { ...process.env, HOME: h, USERPROFILE: h, CLAUDE_WORKSPACE_ROOT: join(h, 'code') };
  try {
    execFileSync(process.execPath, [script], { input: JSON.stringify(payload), encoding: 'utf8', env });
    return { code: 0 };
  } catch (e) {
    return { code: e.status, stderr: e.stderr };
  }
}

const marker = (h) => join(h, '.claude', 'fable-clearance.json');
const ledger = (h) => join(h, '.claude', 'fable-dispatch.log');

test('grant writes the marker on FABLE OK, not on a lowercase near-miss', () => {
  const h = home();
  assert.equal(runHook(grant, { prompt: 'go ahead, FABLE OK' }, h).code, 0);
  assert.ok(existsSync(marker(h)), 'marker written');

  const h2 = home();
  runHook(grant, { prompt: 'fable ok i guess' }, h2);
  assert.ok(!existsSync(marker(h2)), 'lowercase near-miss must not grant');
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
