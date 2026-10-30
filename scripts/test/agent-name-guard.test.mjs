// node --test scripts/test/agent-name-guard.test.mjs — the Agent spawn name guard (#272, #360):
// in company context (the caller's own name parses, non-bare) every spawn names a role and a charge.
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

const COMMAND = /session-name\.mjs <role> <kind> <target/;
const GRAMMAR = /<role>_<kind>_<target>/;

test('a main session is in company context only under an agent name or a legacy director title', () => {
  for (const t of ['director-harness', 'manager_epic_strate-105', 'lead_repo_strate']) {
    const f = fixture();
    title(f, t);
    assert.equal(spawn(f, undefined).code, 2, t);
  }
});

test('any other main-session title is outside company context: Explore, Plan and fork spawns pass there', () => {
  const titles = ['my_notes', 'harness_claude-config', 'harness_claude-config_t264_impl', 'general-spend-review', 'ticket-claude-config-264', 'ticket-claude-config-264-review', 'epic-strate-9', 'issue_claude-config-360', 'issue_strate-16', 'claude-config-62', 'Agent orchestration app naming'];
  for (const t of [undefined, ...titles]) {
    const f = fixture();
    if (t !== undefined) title(f, t);
    for (const subagent_type of ['Explore', 'Plan', 'fork']) {
      for (const name of [undefined, 'Find the callers']) {
        const r = spawn(f, undefined, { tool_input: { description: name ?? '', prompt: 'y', subagent_type } });
        assert.equal(r.code, 0, JSON.stringify([t, subagent_type, name]));
      }
    }
  }
});

test('in company context, a spawn with no name, or a blank one, is blocked with the grammar, an example and the command', () => {
  const f = fixture();
  title(f, 'director-harness');
  meta(f, 'lead', { name: 'manager_issue_repo-5' });
  for (const extra of [{}, { agent_id: 'lead' }]) {
    for (const name of [undefined, '', '   ']) {
      const r = spawn(f, name, { ...extra, tool_input: { prompt: 'y', ...(name !== undefined && { name }) } });
      assert.equal(r.code, 2, JSON.stringify([name, extra]));
      assert.match(r.stderr, GRAMMAR, JSON.stringify(name));
      assert.match(r.stderr, /impl_issue_claude-config-360/, 'an example');
      assert.match(r.stderr, COMMAND, JSON.stringify(name));
    }
  }
});

test('in company context, a name that is not an agent name or a tree name with a worker is blocked', () => {
  const f = fixture();
  title(f, 'director-harness');
  const refused = ['issue_claude-config-360', 'repo_strate', 'ticket-claude-config-264', 'ticket-claude-config-264-review', 'epic-strate-9-recon-r2', 'director-harness', 'general-audit-effort', 'claude-config-264', 'harness_claude-config', 'harness_claude-config_t264', 'Fix the bug', 'impl.issue.claude-config-360', 'impl_issue_claude-config', 'impl_ticket_claude-config-360', 'harness'];
  for (const name of refused) {
    const r = spawn(f, name);
    assert.equal(r.code, 2, name);
    assert.match(r.stderr, /names no role and charge/, name);
    assert.match(r.stderr, GRAMMAR, name);
    assert.match(r.stderr, COMMAND, name);
  }
});

test('in company context, an uppercase or space-padded name that would pass gets told its lowercase, trimmed form', () => {
  const f = fixture();
  title(f, 'director-harness');
  for (const [name, fixed] of [['Impl_issue_claude-config-360', 'impl_issue_claude-config-360'], [' impl_issue_claude-config-360', 'impl_issue_claude-config-360'], ['Harness_repo_t5_impl ', 'harness_repo_t5_impl']]) {
    const r = spawn(f, name);
    assert.equal(r.code, 2, name);
    assert.ok(r.stderr.includes(`must be lowercase with no surrounding spaces: ${fixed}`), r.stderr);
    assert.doesNotMatch(r.stderr, /names no role and charge/, name);
  }
  const r = spawn(f, 'Fix The Bug');
  assert.match(r.stderr, /names no role and charge/, 'a name that would not pass anyway gets the grammar message');
});

test('in company context, an agent name or a tree name with a worker passes', () => {
  const f = fixture();
  title(f, 'manager_epic_strate-105');
  for (const name of ['impl_issue_claude-config-360', 'review-2_pr_strate-31', 'researcher_topic_pricing', 'lead_repo_strate', 'manager_epic_strate-105', 'harness_repo_t5_impl', 'harness_repo_t5_review-r3']) {
    assert.equal(spawn(f, name).code, 0, name);
  }
});

test('the subtree, director-scope and worker-is-a-leaf rules are gone: any role + charge passes from any caller', () => {
  const f = fixture();
  title(f, 'director-strate-audit');
  assert.equal(spawn(f, 'impl_issue_dog-eat-dog-3').code, 0, 'a director spawns outside its old scope');
  meta(f, 'w1', { name: 'harness_repo_t5_impl' });
  assert.equal(spawn(f, 'recon_issue_repo-5', { agent_id: 'w1' }).code, 0, 'a worker spawns');
  meta(f, 'lead', { name: 'manager_epic_claude-config-176' });
  assert.equal(spawn(f, 'impl_issue_strate-16', { agent_id: 'lead' }).code, 0, 'a manager spawns outside its own charge');
});

test("a subagent caller is in context under an agent name, a tree name, or a typed name with a role: meta.json name, else description", () => {
  const f = fixture();
  meta(f, 'named', { name: 'impl_issue_repo-5', description: 'Fix the bug' });
  meta(f, 'described', { description: 'impl_issue_repo-5' });
  meta(f, 'tree', { name: 'harness_repo_t5' });
  meta(f, 'typed-role', { name: 'ticket-repo-5-review' });
  meta(f, 'prose', { description: 'Fix the bug' });
  meta(f, 'bare', { name: 'repo-5' });
  meta(f, 'charge', { name: 'issue_repo-5' });
  meta(f, 'typed-no-role', { name: 'ticket-repo-5' });
  meta(f, 'general', { name: 'general-cleanup' });
  meta(f, 'unnamed', {});
  for (const id of ['named', 'described', 'tree', 'typed-role']) {
    assert.equal(spawn(f, 'Fix the bug', { agent_id: id }).code, 2, id);
    assert.equal(spawn(f, 'recon_issue_repo-5', { agent_id: id }).code, 0, id);
  }
  title(f, 'director-harness');
  for (const id of ['prose', 'bare', 'charge', 'typed-no-role', 'general', 'unnamed', 'absent']) {
    for (const name of [undefined, 'Fix the bug', 'ticket-x-1']) assert.equal(spawn(f, name, { agent_id: id }).code, 0, JSON.stringify([id, name]));
  }
});

test('an Agent tool with no name parameter: the name in description stands in, name wins when both are present (#318)', () => {
  const f = fixture();
  title(f, 'director-harness');
  const byDesc = (description) => {
    const payload = { session_id: 's1', transcript_path: f.transcript, tool_name: 'Agent', tool_input: { description, prompt: 'y', subagent_type: 'implementer' } };
    return spawnHarness(guard, [], { input: JSON.stringify(payload), home: f.home });
  };
  assert.equal(byDesc('impl_issue_repo-5').status, 0);
  assert.equal(byDesc('harness_repo_t5_impl-r2').status, 0);
  for (const d of ['Fix the bug', 'ticket-repo-5-review', 'harness_claude-config_t5']) {
    const r = byDesc(d);
    assert.equal(r.status, 2, d);
    assert.match(r.stderr, COMMAND, d);
  }
  assert.equal(spawn(f, undefined, { tool_input: { name: 'impl_issue_repo-6', description: 'Fix the bug', prompt: 'y' } }).code, 0, 'name beats a prose description');
  assert.equal(spawn(f, undefined, { tool_input: { name: 'bad', description: 'impl_issue_repo-6', prompt: 'y' } }).code, 2, 'a present name is judged on its own, not rescued by description');
});

test('a transcript_path inside the subagents dir still finds the session', () => {
  const f = fixture();
  meta(f, 'a1', { name: 'impl_issue_repo-5' });
  const transcript_path = join(f.sessionDir, 'subagents', 'agent-a1.jsonl');
  assert.equal(spawn(f, 'Fix the bug', { agent_id: 'a1', transcript_path }).code, 2);
  assert.equal(spawn(f, 'recon_issue_repo-5', { agent_id: 'a1', transcript_path }).code, 0);
});

test('an agent_id or session_id that is not a plain id is never joined into a path', () => {
  const f = fixture();
  writeFileSync(join(f.sessionDir, 'evil.meta.json'), JSON.stringify({ name: 'impl_issue_repo-5' }));
  assert.equal(spawn(f, 'Fix the bug', { agent_id: 'x/../../evil' }).code, 0);
  title(f, 'director-harness');
  assert.equal(spawn(f, 'Fix the bug', { session_id: '../s1' }).code, 0, 'no title read through a traversal');
});

test('the guard fails open on a payload it cannot read, logging the error', () => {
  const f = fixture();
  const r = spawnHarness(guard, [], { input: '{not json', home: f.home });
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(f.home, '.claude', 'hook-errors.log'), 'utf8'), /agent-name-guard/);
});
