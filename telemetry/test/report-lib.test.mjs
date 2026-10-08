// telemetry/test/report-lib.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize, renderMarkdown } from '../report-lib.mjs';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'usage-report.mjs');

// Two adjacent windows over the ROWS below (the CLI passes one --from/--to range).
const WINDOWS = [
  { name: 'A', from: new Date('2026-08-07T13:00:00.000Z'), to: new Date('2026-08-07T14:30:00.000Z') },
  { name: 'B', from: new Date('2026-08-07T14:30:00.000Z'), to: new Date('2026-08-07T15:30:00.000Z') },
];

const row = (ts, name, val, attrs = {}) => ({ v: 1, ts, sid: 's', kind: name.startsWith('claude_code.') && name.includes('usage') ? 'metric' : 'event', name, val, attrs });

const ROWS = [
  row('2026-08-07T13:45:00.000Z', 'claude_code.token.usage', 1000, { type: 'output', model: 'claude-sonnet-5', query_source: 'main' }),
  row('2026-08-07T13:50:00.000Z', 'claude_code.cost.usage', 0.25, { model: 'claude-sonnet-5', query_source: 'main' }),
  // D1 live probe 2026-09-14: metric rows carry 'agent.name': 'custom' and nothing else —
  // the real type never reaches the metrics stream. These two rows encode that redaction
  // on purpose; the agent type below comes from the subagent_completed event, as on the wire.
  row('2026-08-07T15:00:00.000Z', 'claude_code.token.usage', 500, { type: 'input', 'agent.name': 'custom', query_source: 'subagent' }),
  row('2026-08-07T15:10:00.000Z', 'claude_code.cost.usage', 0.1, { 'agent.name': 'custom', query_source: 'subagent' }),
  { v: 1, ts: '2026-08-07T15:15:00.000Z', sid: 's', kind: 'event', name: 'subagent_completed', val: 1, attrs: { agent_type: 'implementer', 'agent.source': 'userSettings', is_built_in: false, total_tokens: 500, total_tool_uses: 3, duration_ms: 90_000, model: 'claude-sonnet-5', final_model: 'claude-sonnet-5' } },
  { v: 1, ts: '2026-08-07T15:05:00.000Z', sid: 's', kind: 'event', name: 'skill_activated', val: 1, attrs: { 'skill.name': 'agent-factory', invocation_trigger: 'claude' } },
  { v: 1, ts: '2026-08-01T00:30:00.000Z', sid: 's', kind: 'event', name: 'claude_code.api_request', val: 1, attrs: {} },
];

test('summarize buckets per window/agent/source plus skill table', () => {
  const report = summarize(ROWS, WINDOWS);
  assert.equal(report.windows[0].tokens.output, 1000);
  assert.equal(report.windows[0].cost, 0.25);
  assert.equal(report.windows[1].tokens.input, 500);
  assert.equal(report.phases, undefined); // phases came from checklist COMPACT POINTs (retired, #72)
  assert.equal(report.agents.implementer.runs, 1);
  assert.equal(report.agents.implementer.tokens, 500);
  assert.equal(report.agents.implementer.toolUses, 3);
  assert.equal(report.agents.implementer.durationMs, 90_000);
  assert.deepEqual(report.agents.implementer.models, { 'claude-sonnet-5': 1 });
  assert.equal(report.agents.custom, undefined); // D1: the redacted label is never a bucket
  assert.equal(report.sources.main.cost, 0.25);
  assert.equal(report.sources.subagent.tokens.input, 500);
  assert.equal(report.skills['agent-factory'].count, 1);
  assert.equal(report.gaps.length, 0);
});

test('summarize gap classes: zero rows = no-data; events without cost = partial', () => {
  const noData = summarize(ROWS, [{ name: 'Task X', from: new Date('2026-07-01T00:00:00Z'), to: new Date('2026-07-01T01:00:00Z') }]);
  assert.equal(noData.gaps.length, 1);
  assert.match(noData.gaps[0], /Task X: no rows/);

  const partial = summarize(ROWS, [{ name: 'Task Y', from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-01T01:00:00Z') }]);
  assert.equal(partial.gaps.length, 1);
  assert.match(partial.gaps[0], /Task Y: session events present but zero cost rows/);
});

test('summarize gap class: subagent rows with no subagent_completed event are unattributable', () => {
  const orphaned = ROWS.filter((r) => r.name !== 'subagent_completed');
  const report = summarize(orphaned, WINDOWS);
  assert.deepEqual(report.agents, {});
  assert.equal(report.gaps.length, 1);
  assert.match(report.gaps[0], /2 subagent rows but no subagent_completed events/);
});

test('renderMarkdown emits per-window, per-agent, per-source, per-skill tables and gaps', () => {
  const md = renderMarkdown(summarize(ROWS, WINDOWS));
  assert.match(md, /## Per-window[\s\S]*\| A \|/);
  assert.doesNotMatch(md, /Per-task|Per-phase/);
  assert.match(md, /\| implementer \| 1 \| 500 \| 3 \| 90 \| claude-sonnet-5:1 \|/);
  assert.match(md, /\| subagent \|/);
  assert.match(md, /\| agent-factory \|/);
});

test('usage-report CLI takes a --from/--to range only; a positional checklist is a usage error', () => {
  const env = { ...process.env, OTEL_RECEIVER_DATA_DIR: mkdtempSync(join(tmpdir(), 'otel-')) };
  const out = execFileSync(process.execPath, [cli, '--from', '2026-08-07T00:00:00Z', '--to', '2026-08-08T00:00:00Z'], { env, encoding: 'utf8' });
  assert.match(out, /## Per-window/);
  assert.throws(
    () => execFileSync(process.execPath, [cli, 'wave.md'], { env, encoding: 'utf8', stdio: 'pipe' }),
    (e) => e.status === 1 && /Usage: .*--from <iso> --to <iso>/.test(e.stderr) && !/checklist/.test(e.stderr),
  );
});
