// G72 eval-set library: registry loading/validation/selection.
// Registry: evals/evals.json. Runner: telemetry/eval.mjs.
import fs from 'node:fs';

const CLASSES = ['skill-routing', 'agent-routing', 'rule-adherence', 'model-sufficiency'];
const GRADERS = ['trace-regex', 'string-match', 'llm-judge', 'mined'];
const CONTROL_REQUIRED = new Set(['skill-routing', 'rule-adherence']);

export function loadRegistry(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function validateRegistry(registry) {
  const errors = [];
  const seen = new Set();
  for (const e of registry.evals ?? []) {
    const at = `eval ${e.id ?? '<no id>'}`;
    if (!e.id) errors.push(`${at}: missing id`);
    if (seen.has(e.id)) errors.push(`${at}: duplicate id`);
    seen.add(e.id);
    if (!CLASSES.includes(e.class)) errors.push(`${at}: unknown class ${e.class}`);
    if (!['active', 'retired'].includes(e.status)) errors.push(`${at}: bad status`);
    if (!GRADERS.includes(e.grader)) errors.push(`${at}: unknown grader ${e.grader}`);
    if (!Array.isArray(e.tags) || e.tags.length === 0) errors.push(`${at}: tags required`);
    if (!e.source) errors.push(`${at}: source required`);
    if (!e.added) errors.push(`${at}: added date required`);
    if (e.class === 'model-sufficiency') {
      if (e.prompt || e.grader !== 'mined') errors.push(`${at}: model-sufficiency is mined-only`);
      if (!e.claim) errors.push(`${at}: claim required`);
    } else {
      if (e.grader === 'mined') errors.push(`${at}: mined grader is model-sufficiency-only`);
      if (!e.prompt) errors.push(`${at}: prompt required`);
      if (!e.expected) errors.push(`${at}: expected required`);
      if (!e.cwd) errors.push(`${at}: cwd required`);
      if (CONTROL_REQUIRED.has(e.class) && !(e.negative_control?.prompt && e.negative_control?.expected)) {
        errors.push(`${at}: negative_control required for ${e.class}`);
      }
      for (const p of [e.expected, e.negative_control?.expected].filter(Boolean)) {
        try {
          new RegExp(p);
        } catch {
          errors.push(`${at}: invalid regex ${p}`);
        }
      }
    }
  }
  return errors;
}

export function parseTranscript(jsonlText) {
  const lines = String(jsonlText ?? '').split('\n').filter((l) => l.trim());
  const trace = [];
  let finalText = '';
  let parsedAny = false;
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    parsedAny = true;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (item.type === 'tool_use') {
        if (item.name === 'Bash') trace.push(`Bash:${item.input?.command ?? ''}`);
        else if (item.name === 'Skill') trace.push(`Skill:${item.input?.skill ?? ''}`);
        else if (item.name === 'Read') trace.push(`Read:${item.input?.file_path ?? ''}`);
        else if (item.name === 'Grep') trace.push(`Grep:${item.input?.pattern ?? ''}`);
        else if (item.name === 'Glob') trace.push(`Glob:${item.input?.pattern ?? ''}`);
        else trace.push(`Tool:${item.name}`);
      } else if (item.type === 'text' && entry.type === 'assistant') {
        finalText = item.text;
      }
    }
  }
  if (!parsedAny) return null;
  return { trace: trace.join('\n'), finalText };
}

export function gradeEval(evalDef, parsed, isControl = false) {
  if (!parsed) return { verdict: 'NEEDS_ATTENTION', detail: 'transcript unparseable or missing' };
  // A3 guard: an empty tool trace on a PROBE leg means a headless permission-mode
  // block is possible — never grade it as a routing FAIL. Control legs expect
  // ABSENCE, so a zero-tool answer is legitimate and grades normally
  // (live run 2026-08-09-xcs8: control answered from knowledge, 0 tool calls).
  if (!isControl && evalDef.grader === 'trace-regex' && parsed.trace === '') {
    return { verdict: 'NEEDS_ATTENTION', detail: 'trace empty — headless permission-mode block suspected (A3)' };
  }
  const pattern = isControl ? evalDef.negative_control?.expected : evalDef.expected;
  if (!pattern) return { verdict: 'NEEDS_ATTENTION', detail: 'no expected pattern for this leg' };
  // NO regex flags: under 'm' the ^…$ tempered negative-control patterns re-anchor
  // per line and pass even when the forbidden token appears (cold review C1/C2).
  const re = new RegExp(pattern);
  const subject = evalDef.grader === 'string-match' ? parsed.finalText : parsed.trace;
  const hit = re.test(subject);
  return {
    verdict: hit ? 'PASS' : 'FAIL',
    detail: `${isControl ? 'control' : 'probe'} /${pattern}/ ${hit ? 'matched' : 'did not match'} ${evalDef.grader === 'string-match' ? 'finalText' : 'trace'}`,
  };
}

export function renderRunReport({ runId, cliVersion, model, sessionCount, results }) {
  const lines = [
    `# Eval run ${runId}`,
    '',
    `- CLI: ${cliVersion}`,
    `- Model: ${model}`,
    `- Cost: ${sessionCount} session(s)`,
    '',
    '| eval | probe | control | detail |',
    '|---|---|---|---|',
  ];
  for (const r of results) {
    const mark = (v) => (v === 'NEEDS_ATTENTION' ? `⚠ ${v}` : v);
    lines.push(`| ${r.id} | ${mark(r.verdict)} | ${r.control ? mark(r.control.verdict) : 'n/a'} | ${r.detail}${r.control ? '; ' + r.control.detail : ''} |`);
  }
  return lines.join('\n') + '\n';
}

const ROW_REQUIRED = ['type', 'model', 'grade', 'class', 'wave', 'date'];

export function parseGradeRows(mdText) {
  const rows = [];
  let skipped = 0;
  for (const m of String(mdText ?? '').matchAll(/^- row: (.+)$/gm)) {
    const row = {};
    for (const pair of m[1].trim().split(/\s+/)) {
      const i = pair.indexOf('=');
      if (i > 0) row[pair.slice(0, i)] = pair.slice(i + 1);
    }
    if (ROW_REQUIRED.every((k) => row[k] !== undefined)) {
      row.grade = Number(row.grade);
      if (row.redos !== undefined) row.redos = Number(row.redos);
      rows.push(row);
    } else {
      skipped++;
    }
  }
  return { rows, skipped };
}

export function aggregateRows(rows) {
  const agg = new Map();
  for (const r of rows) {
    const key = `${r.type}|${r.model}|${r.class}`;
    if (!agg.has(key)) agg.set(key, { n: 0, gradeSum: 0, gatesPass: 0, gatesTotal: 0 });
    const g = agg.get(key);
    g.n++;
    g.gradeSum += r.grade;
    if (r.gates === 'pass' || r.gates === 'fail') {
      g.gatesTotal++;
      if (r.gates === 'pass') g.gatesPass++;
    }
  }
  for (const g of agg.values()) {
    g.meanGrade = g.gradeSum / g.n;
    g.gatesPassRate = g.gatesTotal ? g.gatesPass / g.gatesTotal : null;
    delete g.gradeSum;
    delete g.gatesPass;
    delete g.gatesTotal;
  }
  return agg;
}

export function renderMineReport({ agg, fileCount, skipped }) {
  const lines = [
    '# Mined agent-log aggregates',
    '',
    `Scanned ${fileCount} log file(s); ${skipped} malformed row(s) skipped.`,
    '',
    '| type\\|model\\|class | n | mean grade | gates pass rate | provenance |',
    '|---|---|---|---|---|',
  ];
  for (const [key, g] of [...agg.entries()].sort()) {
    lines.push(`| ${key.replaceAll('|', '\\|')} | ${g.n} | ${g.meanGrade.toFixed(2)} | ${g.gatesPassRate === null ? 'n/a' : g.gatesPassRate.toFixed(2)} | (mined, n=${g.n}) |`);
  }
  return lines.join('\n') + '\n';
}

export function renderCombinedReport({ runs, agg }) {
  // Latest run wins per eval id: runs are given oldest-first.
  const latest = new Map();
  for (const run of runs) {
    for (const r of run.results ?? []) latest.set(r.id, { ...r, runId: run.runId });
  }
  const lines = [
    '# Eval combined report',
    '',
    '## Probed (latest verdict per eval)',
    '',
    '| eval | probe | control | provenance |',
    '|---|---|---|---|',
  ];
  for (const [id, r] of [...latest.entries()].sort()) {
    lines.push(`| ${id} | ${r.verdict} | ${r.control ? r.control.verdict : 'n/a'} | (probed, run ${r.runId}) |`);
  }
  lines.push('', '## Mined (agent-log grade rows)', '');
  lines.push('| type\\|model\\|class | n | mean grade | gates pass rate | provenance |');
  lines.push('|---|---|---|---|---|');
  for (const [key, g] of [...agg.entries()].sort()) {
    lines.push(`| ${key.replaceAll('|', '\\|')} | ${g.n} | ${g.meanGrade.toFixed(2)} | ${g.gatesPassRate === null ? 'n/a' : g.gatesPassRate.toFixed(2)} | (mined, n=${g.n}) |`);
  }
  return lines.join('\n') + '\n';
}

export function selectEvals(registry, { ids, classes, tags, all, runnable } = {}) {
  return (registry.evals ?? []).filter((e) => {
    if (e.status !== 'active') return false;
    if (runnable && e.grader === 'mined') return false;
    if (all) return true;
    if (ids?.length) return ids.includes(e.id);
    if (classes?.length) return classes.includes(e.class);
    if (tags?.length) return e.tags.some((t) => tags.includes(t));
    return false;
  });
}
