// telemetry/test/report-lib.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChecklist, taskWindows, summarize, renderMarkdown } from '../report-lib.mjs';

// Fixture exercises the three cold-review C3 defect classes: an UNCHECKED step
// carrying a stamp, a stamp inside a fenced code block, and a phase marker.
const CHECKLIST = [
  '# Wave X',
  '',
  '### Task 1: Parser',
  '',
  '- [x] **Step 1** <!-- done 2026-08-07T10:00:00-04:00 -->',
  '- [x] **Step 2** <!-- done 2026-08-07T10:30:00-04:00 -->',
  '- [ ] **Step 3 (not done)** <!-- done 2026-08-07T23:00:00-04:00 -->',
  '',
  '```js',
  "const TRAP = 'fixture text <!-- done 2026-08-09T00:00:00-04:00 -->';",
  '```',
  '',
  '<!-- COMPACT POINT — marker between phases -->',
  '',
  '### Task 2: Server',
  '',
  '- [x] **Step 1** <!-- done 2026-08-07T11:30:00-04:00 -->',
  '',
  '### Task 3: Unstamped',
  '',
  '- [ ] **Step 1**',
  '',
].join('\n');

const row = (ts, name, val, attrs = {}) => ({ v: 1, ts, sid: 's', kind: name.startsWith('claude_code.') && name.includes('usage') ? 'metric' : 'event', name, val, attrs });

const ROWS = [
  row('2026-08-07T13:45:00.000Z', 'claude_code.token.usage', 1000, { type: 'output', model: 'claude-sonnet-5', query_source: 'main' }),
  row('2026-08-07T13:50:00.000Z', 'claude_code.cost.usage', 0.25, { model: 'claude-sonnet-5', query_source: 'main' }),
  row('2026-08-07T15:00:00.000Z', 'claude_code.token.usage', 500, { type: 'input', 'agent.name': 'implementer', query_source: 'subagent' }),
  row('2026-08-07T15:10:00.000Z', 'claude_code.cost.usage', 0.1, { 'agent.name': 'implementer', query_source: 'subagent' }),
  { v: 1, ts: '2026-08-07T15:05:00.000Z', sid: 's', kind: 'event', name: 'skill_activated', val: 1, attrs: { 'skill.name': 'agent-factory', invocation_trigger: 'claude' } },
  { v: 1, ts: '2026-08-01T00:30:00.000Z', sid: 's', kind: 'event', name: 'claude_code.api_request', val: 1, attrs: {} },
];

test('parseChecklist: tick-gated, fence-blind, phase-tracking, skips unstamped', () => {
  const tasks = parseChecklist(CHECKLIST);
  assert.equal(tasks.length, 2); // Task 3 unstamped; no phantom from the fence
  assert.equal(tasks[0].name, 'Task 1: Parser');
  assert.equal(tasks[0].done.toISOString(), '2026-08-07T14:30:00.000Z'); // NOT the unchecked step's 23:00-04:00
  assert.equal(tasks[0].phase, 0);
  assert.equal(tasks[1].done.toISOString(), '2026-08-07T15:30:00.000Z');
  assert.equal(tasks[1].phase, 1); // after the COMPACT POINT marker
});

test('taskWindows chains prev-done to done; skips + warns on non-monotonic stamps', () => {
  const { windows, warnings } = taskWindows(parseChecklist(CHECKLIST), new Date('2026-08-07T13:00:00.000Z'));
  assert.equal(warnings.length, 0);
  assert.equal(windows[0].from.toISOString(), '2026-08-07T13:00:00.000Z');
  assert.equal(windows[0].to.toISOString(), '2026-08-07T14:30:00.000Z');
  assert.equal(windows[1].from.toISOString(), '2026-08-07T14:30:00.000Z');

  const inverted = taskWindows(
    [{ name: 'Task A', phase: 0, done: new Date('2026-08-07T16:00:00.000Z') }, { name: 'Task B', phase: 0, done: new Date('2026-08-07T14:00:00.000Z') }],
    new Date('2026-08-07T13:00:00.000Z'),
  );
  assert.equal(inverted.windows.length, 1);
  assert.equal(inverted.warnings.length, 1);
  assert.match(inverted.warnings[0], /Task B/);
});

test('summarize buckets per task/phase/agent/source plus skill table', () => {
  const { windows } = taskWindows(parseChecklist(CHECKLIST), new Date('2026-08-07T13:00:00.000Z'));
  const report = summarize(ROWS, windows);
  assert.equal(report.tasks[0].tokens.output, 1000);
  assert.equal(report.tasks[0].cost, 0.25);
  assert.equal(report.tasks[1].tokens.input, 500);
  assert.equal(report.phases['0'].cost, 0.25);
  assert.equal(report.phases['1'].cost, 0.1);
  assert.equal(report.agents.implementer.cost, 0.1);
  assert.equal(report.sources.main.cost, 0.25);
  assert.equal(report.sources.subagent.tokens.input, 500);
  assert.equal(report.skills['agent-factory'].count, 1);
  assert.equal(report.gaps.length, 0);
});

test('summarize gap classes: zero rows = no-data; events without cost = partial', () => {
  const noData = summarize(ROWS, [{ name: 'Task X', phase: 0, from: new Date('2026-07-01T00:00:00Z'), to: new Date('2026-07-01T01:00:00Z') }]);
  assert.equal(noData.gaps.length, 1);
  assert.match(noData.gaps[0], /Task X: no rows/);

  const partial = summarize(ROWS, [{ name: 'Task Y', phase: 0, from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-01T01:00:00Z') }]);
  assert.equal(partial.gaps.length, 1);
  assert.match(partial.gaps[0], /Task Y: session events present but zero cost rows/);
});

test('date-only stamp after same-day timestamp resolves monotonic instead of skipping', () => {
  const md = [
    '### Task 1: a', '- [x] **Step 1** <!-- done 2026-08-08T09:00:00Z -->',
    '### Task 2: b', '- [x] **Step 1** <!-- done 2026-08-08 -->',
  ].join('\n');
  const tasks = parseChecklist(md);
  assert.equal(tasks.length, 2);
  const { windows, warnings } = taskWindows(tasks, new Date('2026-08-08T05:00:00Z'));
  assert.equal(windows.length, 2);
  assert.equal(warnings.length, 0);
  assert.ok(windows[1].to > windows[1].from);
});

test('timestamp after same-day date-only stamp is not skipped (mirror case)', () => {
  const md = [
    '### Task 1: a', '- [x] **Step 1** <!-- done 2026-08-08 -->',
    '### Task 2: b', '- [x] **Step 1** <!-- done 2026-08-08T09:00:00Z -->',
  ].join('\n');
  const { windows, warnings } = taskWindows(parseChecklist(md), new Date('2026-08-08T05:00:00Z'));
  assert.equal(windows.length, 2);
  assert.equal(warnings.length, 0);
});

test('stale date-only stamp from an earlier day still skips with warning', () => {
  const md = [
    '### Task 1: a', '- [x] **Step 1** <!-- done 2026-08-08T09:00:00Z -->',
    '### Task 2: b', '- [x] **Step 1** <!-- done 2026-08-07 -->',
  ].join('\n');
  const { windows, warnings } = taskWindows(parseChecklist(md), new Date('2026-08-08T05:00:00Z'));
  assert.equal(windows.length, 1);
  assert.equal(warnings.length, 1);
});

test('renderMarkdown emits per-task, per-phase, per-agent, per-source, per-skill tables and gaps', () => {
  const { windows } = taskWindows(parseChecklist(CHECKLIST), new Date('2026-08-07T13:00:00.000Z'));
  const md = renderMarkdown(summarize(ROWS, windows));
  assert.match(md, /\| Task 1: Parser \|/);
  assert.match(md, /\| Phase 0 \|/);
  assert.match(md, /\| implementer \|/);
  assert.match(md, /\| subagent \|/);
  assert.match(md, /\| agent-factory \|/);
});
