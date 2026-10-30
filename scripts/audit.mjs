#!/usr/bin/env node
// audit.mjs — transcript-replay audit (#62). Rebuilds cost, context depth,
// per-agent-type cost, skill/doc invocation counts and hook activity from the
// transcripts Claude Code keeps on disk, grouped by charge (#73; the name minus its
// role, lib's chargeKey, #360), plus time (#97): wall vs active, the model/tools/user/other
// split, agent and tool latency, retry cost. --session <name> keeps only what is charged
// to <name>'s charge key, every name form alike (impl_issue_x-5, ticket-x-5, x-5 and a
// tree name join): a file splits at each custom title (#115), and its subagents follow
// the window they ran in, except a named one, which goes by its own meta.json name, else
// a description that parses to a non-bare agent name (#272, #318).
// --idle-gap <min> (default 10) is the silence that counts as away, not active.
// Agent spend is also split per type × model × effort (#113). --stamps reads no
// transcripts: it lists each `verified: YYYY-MM` stamp in the CLAUDE.md chain, workspace/docs/,
// agents/ and skills/ of --repo (default this checkout) that names a model older than its
// line's newest in prices.json, and exits 1 if there is one (a normal run warns too).
// Accounting: audit-lib.mjs.
//
//   node scripts/audit.mjs [--session <name>] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--idle-gap <min>]
//                          [--root <projects dir>] [--docs <prefix,…>] [--top N] [--json]
//   node scripts/audit.mjs --stamps [--repo <claude-config dir>]
//
// Window: only what's on disk. Claude Code deletes transcripts older than
// settings.json `cleanupPeriodDays` (default 30).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkStamps, createCollector, renderMarkdown, stampLine, transcriptWindows } from './audit-lib.mjs';
import { chargeKey } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function args(argv) {
  const o = { root: join(homedir(), '.claude', 'projects'), repo: join(here, '..'), docs: 'code/docs/,claude-config/', top: 15 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json' || a === '--stamps') o[a.slice(2)] = true;
    else if (['--session', '--since', '--until', '--root', '--docs', '--top', '--idle-gap', '--repo'].includes(a)) o[a.slice(2)] = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  for (const k of ['since', 'until']) if (o[k] && !/^\d{4}-\d{2}-\d{2}$/.test(o[k])) throw new Error(`--${k} wants YYYY-MM-DD`);
  if (o['idle-gap'] !== undefined && !(+o['idle-gap'] > 0)) throw new Error('--idle-gap wants minutes > 0');
  return o;
}

const o = args(process.argv.slice(2));
const prices = JSON.parse(readFileSync(join(here, 'prices.json'), 'utf8'));
const staleStamps = checkStamps(o.repo, prices);
if (o.stamps) {
  for (const s of staleStamps) console.log(stampLine(s));
  if (!staleStamps.length) console.log('no stale model stamps');
  process.exit(staleStamps.length ? 1 : 0);
}
const wanted = o.session && chargeKey(o.session);
const skillsDir = join(homedir(), '.claude', 'skills');
const c = createCollector({
  prices,
  since: o.since,
  until: o.until,
  docPrefixes: o.docs.split(',').filter(Boolean),
  ...(o['idle-gap'] && { idleGapMin: +o['idle-gap'] }),
  // a skill is a directory with a SKILL.md (skills/synced is the platform's sync cache)
  installedSkills: existsSync(skillsDir) ? readdirSync(skillsDir).filter((n) => existsSync(join(skillsDir, n, 'SKILL.md'))) : [],
});

let files = 0;
const live = new Set(); // sessionIds with a kept window
for await (const { windows, records } of transcriptWindows(o.root)) {
  const kept = o.session ? windows.filter((w) => wanted && (chargeKey(w.agent?.name) ?? chargeKey(w.name)) === wanted) : windows;
  const { sessionId, agent } = windows[0];
  if (kept.length) {
    files++;
    if (!agent) live.add(sessionId);
  } else if (!live.has(sessionId)) continue;
  // the file's other windows still feed its timeline, so idle time matches the whole-root run;
  // cost-state totals the whole file: a slice of it has nothing to stand beside
  const whole = kept.length === windows.length;
  const feed = new Map(windows.map((w) => [w.window, kept.includes(w) ? w : { ...w, timeOnly: true }]));
  for await (const { rec, ctx } of records) if (whole || rec?.type !== 'cost-state') c.add(rec, feed.get(ctx.window));
}
if (o.session && !files) {
  console.error(`nothing charged to ${wanted} (from ${o.session}) — name each agent <role>_<kind>_<target>: node ~/code/claude-config/scripts/session-name.mjs <role> <kind> <target…>`);
  process.exit(1);
}
const report = { ...c.report(), staleStamps };
if (o.json) console.log(JSON.stringify({ files, ...report }, null, 2));
else console.log(`# Transcript audit — ${files} transcripts${o.session ? ` charged to ${wanted}` : ''}${o.since ? ` from ${o.since}` : ''}${o.until ? ` to ${o.until}` : ''}\n\n${renderMarkdown(report, { top: +o.top })}`);
