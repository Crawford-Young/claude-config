#!/usr/bin/env node
// audit.mjs — transcript-replay audit (#62). Rebuilds cost, context depth,
// per-agent-type cost, skill/doc invocation counts and hook activity from the
// transcripts Claude Code keeps on disk, grouped by /rename session name (#73),
// plus time (#97): wall vs active, the model/tools/user/other split, agent and tool
// latency, retry cost. --session keeps only the windows renamed <name>.
// --idle-gap <min> (default 10) is the silence that counts as away, not active.
// Accounting: audit-lib.mjs.
//
//   node scripts/audit.mjs [--session <name>] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--idle-gap <min>]
//                          [--root <projects dir>] [--docs <prefix,…>] [--top N] [--json]
//
// Window: only what's on disk. Claude Code deletes transcripts older than
// settings.json `cleanupPeriodDays` (default 30).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCollector, readJsonl, renderMarkdown, sessionNames, walkTranscripts } from './audit-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function args(argv) {
  const o = { root: join(homedir(), '.claude', 'projects'), docs: 'code/docs/,claude-config/', top: 15 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (['--session', '--since', '--until', '--root', '--docs', '--top', '--idle-gap'].includes(a)) o[a.slice(2)] = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  for (const k of ['since', 'until']) if (o[k] && !/^\d{4}-\d{2}-\d{2}$/.test(o[k])) throw new Error(`--${k} wants YYYY-MM-DD`);
  if (o['idle-gap'] !== undefined && !(+o['idle-gap'] > 0)) throw new Error('--idle-gap wants minutes > 0');
  return o;
}

const o = args(process.argv.slice(2));
const skillsDir = join(homedir(), '.claude', 'skills');
const c = createCollector({
  prices: JSON.parse(readFileSync(join(here, 'prices.json'), 'utf8')),
  since: o.since,
  until: o.until,
  docPrefixes: o.docs.split(',').filter(Boolean),
  ...(o['idle-gap'] && { idleGapMin: +o['idle-gap'] }),
  // a skill is a directory with a SKILL.md (skills/synced is the platform's sync cache)
  installedSkills: existsSync(skillsDir) ? readdirSync(skillsDir).filter((n) => existsSync(join(skillsDir, n, 'SKILL.md'))) : [],
});

const names = o.session ? await sessionNames(o.root) : null;
let files = 0;
for await (const { file, ctx } of walkTranscripts(o.root)) {
  if (names && names.get(ctx.sessionId) !== o.session) continue;
  files++;
  for await (const rec of readJsonl(file)) c.add(rec, ctx);
}
if (names && !files) {
  console.error(`no session named ${o.session} — rename the unit's windows with /rename ${o.session}`);
  process.exit(1);
}
const report = c.report();
if (o.json) console.log(JSON.stringify({ files, ...report }, null, 2));
else console.log(`# Transcript audit — ${files} transcripts${o.session ? ` named ${o.session}` : ''}${o.since ? ` from ${o.since}` : ''}${o.until ? ` to ${o.until}` : ''}\n\n${renderMarkdown(report, { top: +o.top })}`);
