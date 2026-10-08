#!/usr/bin/env node
// audit.mjs — transcript-replay audit (#62). Rebuilds cost, context depth,
// per-agent-type cost, skill/doc invocation counts and hook activity from the
// transcripts Claude Code keeps on disk. Accounting lives in audit-lib.mjs.
//
//   node scripts/audit.mjs [--since YYYY-MM-DD] [--until YYYY-MM-DD]
//                          [--root <projects dir>] [--docs <prefix,…>] [--top N] [--json]
//
// Window: only what's on disk. Claude Code deletes transcripts older than
// settings.json `cleanupPeriodDays` (default 30).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCollector, readJsonl, renderMarkdown, walkTranscripts } from './audit-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function args(argv) {
  const o = { root: join(homedir(), '.claude', 'projects'), docs: 'code/docs/,claude-config/', top: 15 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (['--since', '--until', '--root', '--docs', '--top'].includes(a)) o[a.slice(2)] = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  for (const k of ['since', 'until']) if (o[k] && !/^\d{4}-\d{2}-\d{2}$/.test(o[k])) throw new Error(`--${k} wants YYYY-MM-DD`);
  return o;
}

const o = args(process.argv.slice(2));
const skillsDir = join(homedir(), '.claude', 'skills');
const c = createCollector({
  prices: JSON.parse(readFileSync(join(here, 'prices.json'), 'utf8')),
  since: o.since,
  until: o.until,
  docPrefixes: o.docs.split(',').filter(Boolean),
  // a skill is a directory with a SKILL.md (skills/synced is the platform's sync cache)
  installedSkills: existsSync(skillsDir) ? readdirSync(skillsDir).filter((n) => existsSync(join(skillsDir, n, 'SKILL.md'))) : [],
});

let files = 0;
for await (const { file, ctx } of walkTranscripts(o.root)) {
  files++;
  for await (const rec of readJsonl(file)) c.add(rec, ctx);
}
const report = c.report();
if (o.json) console.log(JSON.stringify({ files, ...report }, null, 2));
else console.log(`# Transcript audit — ${files} transcripts${o.since ? ` from ${o.since}` : ''}${o.until ? ` to ${o.until}` : ''}\n\n${renderMarkdown(report, { top: +o.top })}`);
