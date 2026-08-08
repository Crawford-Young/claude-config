// telemetry/usage-report.mjs — CLI: node telemetry/usage-report.mjs <checklist.md> [--from iso] [--to iso]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseChecklist, taskWindows, summarize, renderMarkdown } from './report-lib.mjs';

const DATA_DIR = process.env.OTEL_RECEIVER_DATA_DIR ?? path.join(os.homedir(), '.claude', 'otel');

function readArgs(argv) {
  const args = { checklist: undefined, from: undefined, to: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--from') args.from = new Date(argv[(i += 1)]);
    else if (argv[i] === '--to') args.to = new Date(argv[(i += 1)]);
    else args.checklist = argv[i];
  }
  return args;
}

// cold-review M6: named, warned fallback — a wave older than this loses pre-window
// spend unless --from is passed; the warning makes that loss visible.
const FIRST_WINDOW_FALLBACK_HOURS = 4;

const monthKey = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

function loadRows(from, to) {
  const rows = [];
  if (!fs.existsSync(DATA_DIR)) return rows;
  const files = fs.readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.ndjson'))
    .filter((f) => f.slice(0, 7) >= monthKey(from) && f.slice(0, 7) <= monthKey(to)) // month files intersecting range only
    .sort();
  for (const file of files) {
    for (const line of fs.readFileSync(path.join(DATA_DIR, file), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const rowItem = JSON.parse(line);
        const when = new Date(rowItem.ts);
        if (when >= from && when <= to) rows.push(rowItem);
      } catch { /* skip torn line */ }
    }
  }
  return rows;
}

const args = readArgs(process.argv.slice(2));
let windows;
let windowWarnings = [];
if (args.checklist) {
  const tasks = parseChecklist(fs.readFileSync(args.checklist, 'utf8'));
  if (tasks.length === 0) {
    console.error('No stamped tasks found in checklist.');
    process.exit(1);
  }
  let fallbackStart = args.from;
  if (!fallbackStart) {
    fallbackStart = new Date(tasks[0].done.getTime() - FIRST_WINDOW_FALLBACK_HOURS * 3600 * 1000);
    console.error(`note: first window starts ${FIRST_WINDOW_FALLBACK_HOURS}h before the first stamp (${fallbackStart.toISOString()}); pass --from to widen`);
  }
  ({ windows, warnings: windowWarnings } = taskWindows(tasks, fallbackStart));
} else if (args.from && args.to) {
  windows = [{ name: `range ${args.from.toISOString()} – ${args.to.toISOString()}`, phase: 0, from: args.from, to: args.to }];
} else {
  console.error('Usage: node telemetry/usage-report.mjs <checklist.md> [--from <iso>] | --from <iso> --to <iso>');
  process.exit(1);
}
for (const warning of windowWarnings) console.error(`warning: ${warning}`);
const rows = loadRows(windows[0].from, windows.at(-1).to);
console.log(renderMarkdown(summarize(rows, windows)));
