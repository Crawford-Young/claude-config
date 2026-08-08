// telemetry/report-lib.mjs — joins checklist tick stamps with OTel NDJSON rows.
const TASK_HEADING = /^###\s+(Task .+?)\s*$/;
const TICK_LINE = /^\s*-\s*\[x\]/i; // cold-review C3: only ticked steps donate stamps
const STAMP = /<!--\s*done\s+([0-9T:.+\-]+Z?)\s*-->\s*$/; // EOL-anchored — prose quoting a stamp mid-line never counts
const FENCE = /^\s*(?:```|~~~)/;
const PHASE_MARKER = /^<!--\s*COMPACT POINT/;
// T4 live adjudication 2026-08-08: type attr is camelCase (cacheRead/cacheCreation),
// NOT the docs' snake_case — verified against live probe rows in 2026-08.ndjson.
const TOKEN_TYPES = ['input', 'output', 'cacheRead', 'cacheCreation'];

export function parseChecklist(markdown) {
  const tasks = [];
  let current;
  let inFence = false;
  let phase = 0;
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue; // cold-review C3: code fixtures quote stamps
    if (PHASE_MARKER.test(line)) {
      phase += 1;
      continue;
    }
    const heading = line.match(TASK_HEADING);
    if (heading) {
      current = { name: heading[1], phase, done: undefined };
      tasks.push(current);
      continue;
    }
    if (!current || !TICK_LINE.test(line)) continue;
    const stamp = line.match(STAMP);
    if (!stamp) continue;
    const when = new Date(stamp[1]);
    if (!Number.isNaN(when.getTime()) && (!current.done || when > current.done)) current.done = when;
  }
  return tasks.filter((task) => task.done !== undefined);
}

export function taskWindows(tasks, fallbackStart) {
  const windows = [];
  const warnings = [];
  let from = fallbackStart;
  for (const task of tasks) {
    if (task.done <= from) {
      // cold-review C3: an inverted window can never match a row; skip loudly instead
      warnings.push(`${task.name}: non-monotonic stamp ${task.done.toISOString()} <= window start ${from.toISOString()} — task skipped`);
      continue;
    }
    windows.push({ name: task.name, phase: task.phase, from, to: task.done });
    from = task.done;
  }
  return { windows, warnings };
}

function emptyBucket() {
  return { tokens: Object.fromEntries(TOKEN_TYPES.map((t) => [t, 0])), cost: 0 };
}

function addRow(bucket, rowItem) {
  if (rowItem.name === 'claude_code.token.usage') {
    const type = TOKEN_TYPES.includes(rowItem.attrs.type) ? rowItem.attrs.type : 'input';
    bucket.tokens[type] += rowItem.val;
  } else if (rowItem.name === 'claude_code.cost.usage') {
    bucket.cost += rowItem.val;
  }
}

export function summarize(rows, windows, skillEventName = 'skill_activated') {
  const tasks = windows.map((window) => ({ name: window.name, phase: window.phase, ...emptyBucket(), rowsAny: 0, events: 0, durationMin: Math.round((window.to - window.from) / 60000) }));
  const phases = {};
  const agents = {};
  const sources = {};
  const skills = {};
  for (const rowItem of rows) {
    const when = new Date(rowItem.ts);
    const index = windows.findIndex((w) => when > w.from && when <= w.to);
    if (index >= 0) {
      const task = tasks[index];
      task.rowsAny += 1;
      if (rowItem.kind === 'event') task.events += 1;
      addRow(task, rowItem);
      addRow((phases[String(task.phase)] ??= emptyBucket()), rowItem);
    }
    const agent = rowItem.attrs['agent.name'];
    if (agent) addRow((agents[agent] ??= emptyBucket()), rowItem);
    const source = rowItem.attrs.query_source;
    if (source) addRow((sources[source] ??= emptyBucket()), rowItem);
    if (rowItem.kind === 'event' && rowItem.name.endsWith(skillEventName)) {
      const skill = rowItem.attrs['skill.name'] ?? 'unknown';
      (skills[skill] ??= { count: 0, triggers: {} }).count += 1;
      const trigger = rowItem.attrs.invocation_trigger ?? 'unknown';
      skills[skill].triggers[trigger] = (skills[skill].triggers[trigger] ?? 0) + 1;
    }
  }
  // cold-review M4: two gap classes — a doc-only task window with genuinely no
  // session traffic reports "no rows" (candidate gap), not a false cost warning.
  const gaps = [];
  for (const task of tasks) {
    if (task.rowsAny === 0) gaps.push(`${task.name}: no rows in window — receiver down, sessions predating env config, or unmetered work`);
    else if (task.events > 0 && task.cost === 0) gaps.push(`${task.name}: session events present but zero cost rows — metrics pipeline suspect`);
  }
  return { tasks, phases, agents, sources, skills, gaps };
}

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(4));

function bucketTable(lines, title, header, entries) {
  lines.push('', `## ${title}`, '', `| ${header} | input | output | cacheRead | cacheCreation | cost USD |`, '|---|---|---|---|---|---|');
  for (const [name, bucket] of Object.entries(entries)) {
    lines.push(`| ${name} | ${TOKEN_TYPES.map((t) => fmt(bucket.tokens[t])).join(' | ')} | ${fmt(bucket.cost)} |`);
  }
}

export function renderMarkdown(report) {
  const lines = ['## Per-task', '', '| Task | input | output | cacheRead | cacheCreation | cost USD | duration min |', '|---|---|---|---|---|---|---|'];
  for (const task of report.tasks) {
    lines.push(`| ${task.name} | ${TOKEN_TYPES.map((t) => fmt(task.tokens[t])).join(' | ')} | ${fmt(task.cost)} | ${task.durationMin} |`);
  }
  bucketTable(lines, 'Per-phase', 'Phase', Object.fromEntries(Object.entries(report.phases).map(([k, v]) => [`Phase ${k}`, v])));
  bucketTable(lines, 'Per-agent', 'Agent', report.agents);
  bucketTable(lines, 'Per-source', 'query_source', report.sources);
  lines.push('', '## Per-skill', '', '| Skill | fires | triggers |', '|---|---|---|');
  for (const [name, entry] of Object.entries(report.skills)) {
    const triggers = Object.entries(entry.triggers).map(([k, v]) => `${k}:${v}`).join(', ');
    lines.push(`| ${name} | ${entry.count} | ${triggers} |`);
  }
  if (report.gaps.length > 0) {
    lines.push('', '## Gap warnings', '', ...report.gaps.map((gap) => `- ⚠ ${gap}`));
  }
  return lines.join('\n');
}
