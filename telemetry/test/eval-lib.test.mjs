import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  validateRegistry, selectEvals, parseTranscript, gradeEval, renderRunReport,
  parseGradeRows, aggregateRows, renderMineReport, renderCombinedReport,
} from '../eval-lib.mjs';

const good = {
  evals: [
    {
      id: 'sr-example', class: 'skill-routing', status: 'active', cwd: '~/code',
      prompt: 'p', negative_control: { prompt: 'np', expected: '^((?!Skill:git-recovery-ops)[\\s\\S])*$' },
      expected: 'Skill:git-recovery-ops', grader: 'trace-regex', tags: ['git-recovery-ops'],
      source: 'G72', added: '2026-08-09',
    },
    {
      id: 'ms-example', class: 'model-sufficiency', status: 'active',
      claim: 'sonnet suffices for scoped implementer tasks', grader: 'mined',
      tags: ['implementer'], source: 'G72', added: '2026-08-09',
    },
  ],
};

test('valid registry passes', () => {
  assert.deepEqual(validateRegistry(good), []);
});

test('unknown class rejected', () => {
  const bad = structuredClone(good);
  bad.evals[0].class = 'vibes';
  assert.ok(validateRegistry(bad).some((e) => e.includes('class')));
});

test('duplicate ids rejected', () => {
  const bad = structuredClone(good);
  bad.evals[1].id = 'sr-example';
  assert.ok(validateRegistry(bad).some((e) => e.includes('duplicate')));
});

test('skill-routing requires negative_control', () => {
  const bad = structuredClone(good);
  delete bad.evals[0].negative_control;
  assert.ok(validateRegistry(bad).some((e) => e.includes('negative_control')));
});

test('rule-adherence requires negative_control', () => {
  const bad = structuredClone(good);
  bad.evals[0].class = 'rule-adherence';
  delete bad.evals[0].negative_control;
  assert.ok(validateRegistry(bad).some((e) => e.includes('negative_control')));
});

test('model-sufficiency must be mined-only (no prompt, grader mined)', () => {
  const bad = structuredClone(good);
  bad.evals[1].prompt = 'should not exist';
  assert.ok(validateRegistry(bad).some((e) => e.includes('mined')));
});

test('selectEvals: --all returns active only', () => {
  const reg = structuredClone(good);
  reg.evals[0].status = 'retired';
  assert.deepEqual(selectEvals(reg, { all: true }).map((e) => e.id), ['ms-example']);
});

test('selectEvals: tag filter intersects', () => {
  assert.deepEqual(selectEvals(good, { tags: ['implementer'] }).map((e) => e.id), ['ms-example']);
});

test('selectEvals: id filter exact', () => {
  assert.deepEqual(selectEvals(good, { ids: ['sr-example'] }).map((e) => e.id), ['sr-example']);
});

test('selectEvals: runnable excludes mined-grader evals', () => {
  assert.deepEqual(selectEvals(good, { all: true, runnable: true }).map((e) => e.id), ['sr-example']);
});

test('invalid regex in expected rejected', () => {
  const bad = structuredClone(good);
  bad.evals[0].expected = '([unclosed';
  assert.ok(validateRegistry(bad).some((e) => e.includes('regex')));
});

test('mined grader outside model-sufficiency rejected', () => {
  const bad = structuredClone(good);
  bad.evals[0].grader = 'mined';
  assert.ok(validateRegistry(bad).some((e) => e.includes('mined')));
});

const fixture = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/transcript-sample.jsonl'), 'utf8');

test('parseTranscript extracts ordered tool trace', () => {
  const { trace } = parseTranscript(fixture);
  const lines = trace.split('\n');
  assert.equal(lines[0], 'Skill:git-recovery-ops');
  assert.equal(lines[1], 'Grep:dataDir');
  assert.match(lines[2], /^Read:/);
  assert.match(lines[3], /^Bash:node --test/);
});

test('parseTranscript captures final assistant text', () => {
  const { finalText } = parseTranscript(fixture);
  assert.match(finalText, /git-recovery-ops sequence/);
});

test('parseTranscript on garbage -> null (NEEDS_ATTENTION upstream)', () => {
  assert.equal(parseTranscript('not json at all'), null);
});

test('gradeEval trace-regex PASS/FAIL', () => {
  const e = { grader: 'trace-regex', expected: 'Skill:git-recovery-ops' };
  assert.equal(gradeEval(e, { trace: 'Read:x\nSkill:git-recovery-ops', finalText: '' }).verdict, 'PASS');
  assert.equal(gradeEval(e, { trace: 'Read:x', finalText: '' }).verdict, 'FAIL');
});

test('gradeEval string-match grades finalText', () => {
  const e = { grader: 'string-match', expected: '(?<!web-)\\brecon\\b' };
  assert.equal(gradeEval(e, { trace: '', finalText: 'Dispatch recon on sonnet.' }).verdict, 'PASS');
  assert.equal(gradeEval(e, { trace: '', finalText: 'Use web-recon.' }).verdict, 'FAIL');
});

test('gradeEval control uses negative_control.expected', () => {
  const e = {
    grader: 'trace-regex', expected: 'Skill:continuation',
    negative_control: { expected: '^((?!Skill:continuation)[\\s\\S])*$' },
  };
  assert.equal(gradeEval(e, { trace: 'Read:x', finalText: '' }, true).verdict, 'PASS');
  assert.equal(gradeEval(e, { trace: 'Skill:continuation', finalText: '' }, true).verdict, 'FAIL');
});

test('gradeEval tempered control catches token on any line (no m flag)', () => {
  const e = {
    grader: 'trace-regex', expected: 'Skill:continuation',
    negative_control: { expected: '^((?!Skill:continuation)[\\s\\S])*$' },
  };
  assert.equal(gradeEval(e, { trace: 'Read:x\nSkill:continuation\nBash:ls', finalText: '' }, true).verdict, 'FAIL');
});

test('gradeEval order check: Read before Grep fails grep-before-read pattern', () => {
  const e = { grader: 'trace-regex', expected: '^(?:(?!Read:)[\\s\\S])*?(?:Grep|Glob|Bash:[^\\n]*grep)' };
  assert.equal(gradeEval(e, { trace: 'Grep:otel\nRead:x', finalText: '' }).verdict, 'PASS');
  assert.equal(gradeEval(e, { trace: 'Read:x\nGrep:otel', finalText: '' }).verdict, 'FAIL');
});

test('gradeEval null transcript -> NEEDS_ATTENTION', () => {
  assert.equal(gradeEval({ grader: 'trace-regex', expected: 'x' }, null).verdict, 'NEEDS_ATTENTION');
});

test('gradeEval A3: empty trace on trace-regex PROBE leg -> NEEDS_ATTENTION', () => {
  const e = { grader: 'trace-regex', expected: 'Skill:git-recovery-ops' };
  assert.equal(gradeEval(e, { trace: '', finalText: 'answer' }).verdict, 'NEEDS_ATTENTION');
});

test('gradeEval A3: empty trace on CONTROL leg grades normally (live run 2026-08-09-xcs8)', () => {
  const e = {
    grader: 'trace-regex', expected: 'Skill:git-recovery-ops',
    negative_control: { expected: '^((?!Skill:git-recovery-ops)[\\s\\S])*$' },
  };
  assert.equal(gradeEval(e, { trace: '', finalText: 'answer' }, true).verdict, 'PASS');
});

const compliantLog = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/agent-log-compliant.md'), 'utf8');
const legacyLog = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/agent-log-legacy.md'), 'utf8');

test('parseGradeRows: compliant log parses valid rows, counts malformed as skipped', () => {
  const { rows, skipped } = parseGradeRows(compliantLog);
  assert.equal(rows.length, 2);
  assert.equal(skipped, 1);
  assert.deepEqual(rows[0], {
    type: 'reviewer', model: 'opus', grade: 4, class: 'review',
    gates: 'na', redos: 1, wave: 'example', date: '2026-08-09',
  });
  assert.equal(rows[1].model, 'sonnet');
});

test('parseGradeRows: legacy prose-only log -> {rows: [], skipped: 0}, no throw', () => {
  assert.deepEqual(parseGradeRows(legacyLog), { rows: [], skipped: 0 });
});

test('aggregateRows groups by type|model|class with mean grade + gates pass rate', () => {
  const { rows } = parseGradeRows(compliantLog);
  const extra = { type: 'implementer', model: 'sonnet', grade: 3, class: 'implementation', gates: 'pass', redos: 1, wave: 'w2', date: '2026-08-09' };
  const agg = aggregateRows([...rows, extra]);
  const impl = agg.get('implementer|sonnet|implementation');
  assert.equal(impl.n, 2);
  assert.equal(impl.meanGrade, 4);
  assert.equal(impl.gatesPassRate, 1);
  assert.equal(agg.get('reviewer|opus|review').n, 1);
});

test('renderMineReport stamps every line with mined provenance', () => {
  const { rows } = parseGradeRows(compliantLog);
  const md = renderMineReport({ agg: aggregateRows(rows), fileCount: 2, skipped: 1 });
  assert.match(md, /\(mined, n=1\)/);
  assert.match(md, /implementer\\\|sonnet\\\|implementation/);
  assert.match(md, /skipped/i);
});

test('renderCombinedReport: latest verdict per eval id, provenance stamps on both halves', () => {
  const runs = [
    { runId: 'run-old', results: [{ id: 'sr-x', verdict: 'FAIL', control: null }] },
    { runId: 'run-new', results: [{ id: 'sr-x', verdict: 'PASS', control: { verdict: 'PASS' } }, { id: 'ar-y', verdict: 'PASS', control: null }] },
  ];
  const { rows } = parseGradeRows(compliantLog);
  const md = renderCombinedReport({ runs, agg: aggregateRows(rows) });
  assert.match(md, /sr-x.*PASS.*\(probed, run run-new\)/);
  assert.doesNotMatch(md, /sr-x.*FAIL/);
  assert.match(md, /ar-y.*\(probed, run run-new\)/);
  assert.match(md, /\(mined, n=1\)/);
});

test('renderRunReport: runId, version, per-eval rows, controls, NEEDS_ATTENTION, cost', () => {
  const md = renderRunReport({
    runId: 'run-20260809-a1',
    cliVersion: '2.1.225 (Claude Code)',
    model: 'claude-fable-5',
    sessionCount: 3,
    results: [
      { id: 'sr-git-recovery-worktree', verdict: 'PASS', detail: 'probe matched', control: { verdict: 'PASS', detail: 'control matched' } },
      { id: 'ar-recon-local-facts', verdict: 'NEEDS_ATTENTION', detail: 'transcript unlocatable', control: null },
    ],
  });
  assert.match(md, /run-20260809-a1/);
  assert.match(md, /2\.1\.225/);
  assert.match(md, /sr-git-recovery-worktree.*PASS.*PASS/);
  assert.match(md, /ar-recon-local-facts.*NEEDS_ATTENTION/);
  assert.match(md, /⚠/);
  assert.match(md, /3 session/);
});
