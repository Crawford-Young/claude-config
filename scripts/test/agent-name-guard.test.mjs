// node --test scripts/test/agent-name-guard.test.mjs — the Agent spawn name guard (#272):
// tree grammar, lineage from the caller's meta.json, director scope from the custom title.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnHarness, tempDir } from './_spawn.mjs';

const guard = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks', 'agent-name-guard.mjs');

/** A temp home holding one project dir with session `s1`: { home, proj, sessionDir, transcript }. */
function fixture() {
  const home = tempDir('ang-');
  const proj = join(home, '.claude', 'projects', 'C--code');
  const sessionDir = join(proj, 's1');
  mkdirSync(join(sessionDir, 'subagents'), { recursive: true });
  return { home, proj, sessionDir, transcript: join(proj, 's1.jsonl') };
}

const title = (f, customTitle) => writeFileSync(join(f.sessionDir, 'custom-title.json'), JSON.stringify({ customTitle }));
const meta = (f, id, m) => writeFileSync(join(f.sessionDir, 'subagents', `agent-${id}.meta.json`), JSON.stringify({ agentType: 'implementer', spawnDepth: 1, ...m }));

/** Run the guard on an Agent call named `name` (undefined: no name key) → { code, stderr }. */
function spawn(f, name, extra = {}) {
  const tool_input = { description: 'x', prompt: 'y', subagent_type: 'implementer', ...(name !== undefined && { name }) };
  const payload = { session_id: 's1', transcript_path: f.transcript, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input, ...extra };
  const r = spawnHarness(guard, [], { input: JSON.stringify(payload), home: f.home });
  return { code: r.status, stderr: r.stderr };
}

test('in tree context, a spawn with no name, or a blank one, is blocked with the command that builds one', () => {
  const f = fixture();
  title(f, 'director-harness');
  meta(f, 'lead', { name: 'harness_repo_t5' });
  for (const extra of [{}, { agent_id: 'lead' }]) {
    for (const name of [undefined, '', '   ']) {
      const r = spawn(f, name, extra);
      assert.equal(r.code, 2, JSON.stringify([name, extra]));
      assert.match(r.stderr, /session-name\.mjs tree/, JSON.stringify(name));
    }
  }
});

test('in tree context, a name outside the tree grammar is blocked: legacy, typed, dotted or capitalised', () => {
  const f = fixture();
  title(f, 'director-harness');
  for (const name of ['ticket-claude-config-264', 'general-audit-effort', 'claude-config-264', 'harness.claude-config', 'Harness_claude-config', ' harness_claude-config', 'harness_claude-config_t264_impl_recon', 'harness']) {
    const r = spawn(f, name);
    assert.equal(r.code, 2, name);
    assert.match(r.stderr, /tree name/, name);
    assert.match(r.stderr, /session-name\.mjs tree/, name);
  }
});

test('outside tree context every spawn passes untouched: unnamed built-ins, forks and any name', () => {
  const f = fixture();
  const builtIns = ['Explore', 'Plan', 'claude-code-guide', 'statusline-setup', 'general-purpose', 'fork'];
  const names = [undefined, '', 'ticket-claude-config-264', 'general-audit-effort', 'Anything Goes', 'harness_claude-config'];
  const contexts = [['no session files', () => {}], ['a non-director title', () => title(f, 'general-spend-review')]];
  for (const [what, setup] of contexts) {
    setup();
    for (const subagent_type of builtIns) for (const name of names) {
      const r = spawn(f, name, { tool_input: { description: 'x', prompt: 'y', subagent_type, ...(name !== undefined && { name }) } });
      assert.equal(r.code, 0, JSON.stringify([what, subagent_type, name]));
    }
  }
});

test("the main session under a director title spawns only into the director's scope", () => {
  const f = fixture();
  title(f, 'director-strate-audit');
  assert.equal(spawn(f, 'strate-audit_strate').code, 0);
  assert.equal(spawn(f, 'strate-audit_strate_e4_t9_impl').code, 0, 'a director may spawn any level of its own tree');
  const r = spawn(f, 'harness_strate');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /strate-audit_/);
});

test("a subagent's spawn must strictly extend its own tree name", () => {
  const f = fixture();
  title(f, 'director-harness');
  meta(f, 'a1b2', { name: 'harness_claude-config_e176' });
  const as = (name) => spawn(f, name, { agent_id: 'a1b2', agent_type: 'implementer' });
  assert.equal(as('harness_claude-config_e176_t264').code, 0);
  assert.equal(as('harness_claude-config_e176_t264_impl').code, 0, 'a lead may skip a level of its own subtree');
  assert.equal(as('harness_claude-config_e176_review').code, 0);
  for (const name of ['harness_claude-config_e176', 'harness_claude-config_t264', 'harness_claude-config', 'harness_claude-config_e17', 'harness_other_e176_t1']) {
    const r = as(name);
    assert.equal(r.code, 2, name);
    assert.match(r.stderr, /harness_claude-config_e176_/, name);
  }
});

test('a worker is a leaf: its spawn is refused with a pointer to its lead', () => {
  const f = fixture();
  meta(f, 'w1', { name: 'harness_repo_t5_impl' });
  const r = spawn(f, 'harness_repo_t5_recon', { agent_id: 'w1' });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /leaf/);
  assert.match(r.stderr, /harness_repo_t5\b/, 'names the lead to report to');
});

test('a subagent caller with no meta, no name in it, or a name outside the tree is outside tree context, even under a director', () => {
  const f = fixture();
  title(f, 'director-harness');
  meta(f, 'unnamed', {});
  meta(f, 'teammate', { name: 'ticket-claude-config-264' });
  for (const id of ['unnamed', 'teammate', 'absent']) {
    for (const name of [undefined, 'other_repo_t1', 'ticket-x-1']) assert.equal(spawn(f, name, { agent_id: id }).code, 0, JSON.stringify([id, name]));
  }
});

test('a transcript_path inside the subagents dir still finds the session', () => {
  const f = fixture();
  meta(f, 'a1', { name: 'harness_repo_t5' });
  const transcript_path = join(f.sessionDir, 'subagents', 'agent-a1.jsonl');
  assert.equal(spawn(f, 'harness_repo_t6', { agent_id: 'a1', transcript_path }).code, 2);
  assert.equal(spawn(f, 'harness_repo_t5_impl', { agent_id: 'a1', transcript_path }).code, 0);
});

test('an agent_id or session_id that is not a plain id is never joined into a path', () => {
  const f = fixture();
  writeFileSync(join(f.sessionDir, 'evil.meta.json'), JSON.stringify({ name: 'other_repo' }));
  assert.equal(spawn(f, 'harness_repo', { agent_id: 'x/../../evil' }).code, 0);
  title(f, 'director-harness');
  assert.equal(spawn(f, 'other_repo', { session_id: '../s1' }).code, 0, 'no title read through a traversal');
});

test('the guard fails open on a payload it cannot read, logging the error', () => {
  const f = fixture();
  const r = spawnHarness(guard, [], { input: '{not json', home: f.home });
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(f.home, '.claude', 'hook-errors.log'), 'utf8'), /agent-name-guard/);
});
