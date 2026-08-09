#!/usr/bin/env node
// G72 eval runner: run (headless probe sessions), mine (agent-log grade rows),
// report (combined provenance-stamped view). See telemetry/README.md.
//
// Live sessions bill — `run` requires --yes AND per-run user clearance
// (root CLAUDE.md Live-LLM clearance rule). mine/report are free and local.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  loadRegistry, validateRegistry, selectEvals, parseTranscript, gradeEval, renderRunReport,
  parseGradeRows, aggregateRows, renderMineReport, renderCombinedReport,
} from './eval-lib.mjs';

const HOME = os.homedir();
const REGISTRY = path.join(import.meta.dirname, '..', 'evals', 'evals.json');
const RUNS_DIR = path.join(HOME, 'code', 'docs', 'harness-evolution', 'evals', 'runs');
const SESSION_TIMEOUT_MS = 300000;

function resolveCwd(cwd) {
  return cwd.replace(/^~/, HOME);
}

function projectSlug(cwd) {
  // Claude Code project dir slug: path with every non-alphanumeric char as '-'.
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

function parseArgs(argv) {
  const args = { ids: [], tags: [], classes: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--id') args.ids.push(argv[++i]);
    else if (a === '--tag') args.tags.push(argv[++i]);
    else if (a === '--class') args.classes.push(argv[++i]);
    else if (a === '--all') args.all = true;
    else if (a === '--yes') args.yes = true;
    else if (a === '--max-sessions') args.maxSessions = Number(argv[++i]);
    else if (a === '--logs') args.logs = argv[++i];
    else { console.error(`Unknown arg: ${a}`); process.exit(1); }
  }
  return args;
}

function listTranscripts(dir) {
  try {
    return new Set(fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')));
  } catch {
    return new Set();
  }
}

function runProbeSession(prompt, cwd) {
  const projDir = path.join(HOME, '.claude', 'projects', projectSlug(cwd));
  const before = listTranscripts(projDir);
  const res = spawnSync('claude', ['-p', prompt, '--output-format', 'json'], {
    cwd, timeout: SESSION_TIMEOUT_MS, encoding: 'utf8', shell: false,
  });
  if (res.error || res.status !== 0) {
    return { error: `session failed: ${res.error?.message ?? `exit ${res.status}`}${res.stderr ? ` — ${res.stderr.slice(0, 300)}` : ''}` };
  }
  let out;
  try {
    out = JSON.parse(res.stdout);
  } catch {
    return { error: 'stdout not JSON' };
  }
  // A1: result JSON carries session_id; fallback = new .jsonl in project dir.
  let transcriptPath = null;
  if (out.session_id && fs.existsSync(path.join(projDir, `${out.session_id}.jsonl`))) {
    transcriptPath = path.join(projDir, `${out.session_id}.jsonl`);
  } else {
    const fresh = [...listTranscripts(projDir)].filter((f) => !before.has(f));
    if (fresh.length === 1) transcriptPath = path.join(projDir, fresh[0]);
  }
  if (!transcriptPath) return { error: 'transcript unlocatable (A1 fallback also failed)', result: out };
  return { transcriptPath, result: out };
}

function gradeLeg(evalDef, prompt, isControl) {
  const spawned = runProbeSession(prompt, resolveCwd(evalDef.cwd));
  if (spawned.error) return { verdict: 'NEEDS_ATTENTION', detail: spawned.error };
  const parsed = parseTranscript(fs.readFileSync(spawned.transcriptPath, 'utf8'));
  const graded = gradeEval(evalDef, parsed, isControl); // A3 empty-trace guard lives in gradeEval (probe legs only)
  graded.model = spawned.result?.modelUsage ? Object.keys(spawned.result.modelUsage).join('+') : (spawned.result?.model ?? 'unknown');
  return graded;
}

function cmdRun(args) {
  if (process.env.ANTHROPIC_API_KEY) {
    console.error('ABORT: ANTHROPIC_API_KEY set — probes would bill the key lane (harness-editing trap). Unset first.');
    process.exit(1);
  }
  const registry = loadRegistry(REGISTRY);
  const errs = validateRegistry(registry);
  if (errs.length) { console.error('Registry invalid:\n' + errs.join('\n')); process.exit(1); }
  const selected = selectEvals(registry, { ...args, runnable: true });
  if (!selected.length) { console.error('No runnable evals selected.'); process.exit(1); }
  const sessionCount = selected.reduce((n, e) => n + (e.negative_control ? 2 : 1), 0);
  const cap = args.maxSessions ?? 12;
  console.log(`Selected: ${selected.map((e) => e.id).join(', ')}`);
  console.log(`Cost: ${sessionCount} headless session(s), cap ${cap}.`);
  if (sessionCount > cap) { console.error('ABORT: selection exceeds --max-sessions cap.'); process.exit(1); }
  if (!args.yes) {
    console.log('Dry preview only. Re-run with --yes AFTER user clearance to spawn sessions.');
    return;
  }
  const cliVersion = spawnSync('claude', ['--version'], { encoding: 'utf8', shell: false }).stdout?.trim() ?? 'unknown';
  const results = [];
  for (const e of selected) {
    console.log(`probe ${e.id}...`);
    const probe = gradeLeg(e, e.prompt, false);
    let control = null;
    if (e.negative_control) {
      console.log(`control ${e.id}...`);
      control = gradeLeg(e, e.negative_control.prompt, true);
    }
    results.push({ id: e.id, verdict: probe.verdict, detail: probe.detail, model: probe.model, control });
  }
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10);
  const runId = `run-${stamp}-${now.getTime().toString(36).slice(-4)}`;
  const md = renderRunReport({
    runId, cliVersion, model: results.find((r) => r.model)?.model ?? 'unknown', sessionCount, results,
  });
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const outPath = path.join(RUNS_DIR, `${stamp}-${runId}.md`);
  fs.writeFileSync(outPath, md);
  // JSON sidecar feeds `report` — structured verdicts, no MD re-parsing.
  fs.writeFileSync(outPath.replace(/\.md$/, '.json'), JSON.stringify({ runId, cliVersion, sessionCount, results }, null, 2));
  console.log(md);
  console.log(`Report: ${outPath}`);
  if (results.some((r) => r.verdict !== 'PASS' || (r.control && r.control.verdict !== 'PASS'))) process.exitCode = 1;
}

function discoverLogFiles(root) {
  // Agent-log dirs live at BOTH docs/*/agent-logs and docs/*/*/agent-logs
  // (domain projects nest one level deeper — cold review M4). Includes done/.
  const files = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'agent-logs') {
          for (const f of fs.readdirSync(full, { recursive: true })) {
            if (String(f).endsWith('.md')) files.push(path.join(full, String(f)));
          }
        } else if (depth < 2 && ent.name !== 'node_modules' && !ent.name.startsWith('.')) {
          walk(full, depth + 1);
        }
      }
    }
  };
  walk(root, 0);
  return files;
}

function cmdMine(args) {
  const root = args.logs ? resolveCwd(args.logs) : path.join(HOME, 'code', 'docs');
  const files = discoverLogFiles(root);
  const rows = [];
  let skipped = 0;
  for (const f of files) {
    const parsed = parseGradeRows(fs.readFileSync(f, 'utf8'));
    rows.push(...parsed.rows);
    skipped += parsed.skipped;
  }
  const md = renderMineReport({ agg: aggregateRows(rows), fileCount: files.length, skipped });
  console.log(md);
  console.log(`Rows: ${rows.length} from ${files.length} file(s) under ${root}`);
}

function cmdReport(args) {
  let runs = [];
  try {
    runs = fs.readdirSync(RUNS_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort() // filenames start with yyyy-mm-dd — lexicographic = chronological
      .map((f) => JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf8')));
  } catch { /* no runs dir yet — mined-only report */ }
  const root = args.logs ? resolveCwd(args.logs) : path.join(HOME, 'code', 'docs');
  const rows = discoverLogFiles(root).flatMap((f) => parseGradeRows(fs.readFileSync(f, 'utf8')).rows);
  console.log(renderCombinedReport({ runs, agg: aggregateRows(rows) }));
}

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
if (cmd === 'run') cmdRun(args);
else if (cmd === 'mine') cmdMine(args);
else if (cmd === 'report') cmdReport(args);
else {
  console.error('Usage: node telemetry/eval.mjs <run|mine|report> [--id X] [--tag Y] [--class Z] [--all] [--max-sessions N] [--yes] [--logs <root>]');
  process.exit(cmd ? 1 : 0);
}
