// telemetry/usage-report.mjs — CLI: node telemetry/usage-report.mjs --from <iso> --to <iso>
// Per-task cost comes from scripts/audit.mjs (#62); the checklist done-stamp join retired with #72.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { summarize, renderMarkdown } from './report-lib.mjs';

const DATA_DIR = process.env.OTEL_RECEIVER_DATA_DIR ?? path.join(os.homedir(), '.claude', 'otel');

function readArgs(argv) {
  const args = { from: undefined, to: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--from') args.from = new Date(argv[(i += 1)]);
    else if (argv[i] === '--to') args.to = new Date(argv[(i += 1)]);
  }
  return args;
}

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
if (!args.from || !args.to) {
  console.error('Usage: node telemetry/usage-report.mjs --from <iso> --to <iso>');
  process.exit(1);
}
const windows = [{ name: `${args.from.toISOString()} – ${args.to.toISOString()}`, from: args.from, to: args.to }];
console.log(renderMarkdown(summarize(loadRows(args.from, args.to), windows)));
