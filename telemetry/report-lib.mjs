// telemetry/report-lib.mjs — buckets OTel NDJSON rows by time window (per-task cost: scripts/audit.mjs).
// T4 live adjudication 2026-08-08: type attr is camelCase (cacheRead/cacheCreation),
// NOT the docs' snake_case — verified against live probe rows in 2026-08.ndjson.
const TOKEN_TYPES = ['input', 'output', 'cacheRead', 'cacheCreation'];

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
  const buckets = windows.map((window) => ({ name: window.name, ...emptyBucket(), rowsAny: 0, events: 0, durationMin: Math.round((window.to - window.from) / 60000) }));
  const agents = {};
  const sources = {};
  const skills = {};
  let subagentRows = 0;
  for (const rowItem of rows) {
    const when = new Date(rowItem.ts);
    const index = windows.findIndex((w) => when > w.from && when <= w.to);
    if (index >= 0) {
      const bucket = buckets[index];
      bucket.rowsAny += 1;
      if (rowItem.kind === 'event') bucket.events += 1;
      addRow(bucket, rowItem);
    }
    // D1 live probe 2026-09-14: `agent.name` on the cost/token metric rows is ALWAYS
    // the literal "custom" (82/82 historical rows, plus both probe dispatches — a
    // built-in type and a userSettings type alike). The real type is redacted out of
    // the metrics stream; it survives only on `subagent_completed` events as
    // `agent_type`. Those events carry no cost, and `prompt.id` cannot rescue the join
    // (one parent turn covers every agent it fans out to), so per-agent totals are
    // run-shaped — runs/tokens/duration, never cost. See README "Per-agent attribution".
    if (rowItem.name === 'subagent_completed') {
      const type = rowItem.attrs.agent_type ?? 'unknown';
      const bucket = (agents[type] ??= { runs: 0, tokens: 0, toolUses: 0, durationMs: 0, models: {} });
      bucket.runs += 1;
      bucket.tokens += rowItem.attrs.total_tokens ?? 0;
      bucket.toolUses += rowItem.attrs.total_tool_uses ?? 0;
      bucket.durationMs += rowItem.attrs.duration_ms ?? 0;
      const model = rowItem.attrs.final_model ?? rowItem.attrs.model;
      if (model) bucket.models[model] = (bucket.models[model] ?? 0) + 1;
    }
    const source = rowItem.attrs.query_source;
    if (source) addRow((sources[source] ??= emptyBucket()), rowItem);
    if (source === 'subagent' || String(source ?? '').startsWith('agent:')) subagentRows += 1;
    if (rowItem.kind === 'event' && rowItem.name.endsWith(skillEventName)) {
      const skill = rowItem.attrs['skill.name'] ?? 'unknown';
      (skills[skill] ??= { count: 0, triggers: {} }).count += 1;
      const trigger = rowItem.attrs.invocation_trigger ?? 'unknown';
      skills[skill].triggers[trigger] = (skills[skill].triggers[trigger] ?? 0) + 1;
    }
  }
  // cold-review M4: two gap classes — a window with genuinely no
  // session traffic reports "no rows" (candidate gap), not a false cost warning.
  const gaps = [];
  for (const w of buckets) {
    if (w.rowsAny === 0) gaps.push(`${w.name}: no rows in window — receiver down, sessions predating env config, or unmetered work`);
    else if (w.events > 0 && w.cost === 0) gaps.push(`${w.name}: session events present but zero cost rows — metrics pipeline suspect`);
  }
  // D1: subagent traffic that produced no subagent_completed event is unattributable —
  // its metric rows say "custom" and nothing else on them recovers the agent type.
  if (subagentRows > 0 && Object.keys(agents).length === 0) gaps.push(`${subagentRows} subagent rows but no subagent_completed events — per-agent table unavailable (agent.name is redacted to "custom")`);
  return { windows: buckets, agents, sources, skills, gaps };
}

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(4));

function bucketTable(lines, title, header, entries) {
  lines.push('', `## ${title}`, '', `| ${header} | input | output | cacheRead | cacheCreation | cost USD |`, '|---|---|---|---|---|---|');
  for (const [name, bucket] of Object.entries(entries)) {
    lines.push(`| ${name} | ${TOKEN_TYPES.map((t) => fmt(bucket.tokens[t])).join(' | ')} | ${fmt(bucket.cost)} |`);
  }
}

export function renderMarkdown(report) {
  const lines = ['## Per-window', '', '| Window | input | output | cacheRead | cacheCreation | cost USD | duration min |', '|---|---|---|---|---|---|---|'];
  for (const w of report.windows) {
    lines.push(`| ${w.name} | ${TOKEN_TYPES.map((t) => fmt(w.tokens[t])).join(' | ')} | ${fmt(w.cost)} | ${w.durationMin} |`);
  }
  // Per-agent is deliberately NOT a bucketTable: no cost is attributable to an agent type (D1).
  lines.push('', '## Per-agent', '', '| Agent | runs | tokens | tool uses | duration sec | models |', '|---|---|---|---|---|---|');
  for (const [name, bucket] of Object.entries(report.agents)) {
    const models = Object.entries(bucket.models).map(([model, count]) => `${model}:${count}`).join(', ');
    lines.push(`| ${name} | ${bucket.runs} | ${bucket.tokens} | ${bucket.toolUses} | ${Math.round(bucket.durationMs / 1000)} | ${models} |`);
  }
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
