#!/usr/bin/env node
// spend.mjs — today's spend (local day) across every transcript, main and subagent,
// priced at API rates with scripts/prices.json via audit-lib's priceUsage (#77).
// Spawned detached by statusline.mjs when its cache is stale. A render never waits
// on this, and never reads a transcript itself.
//
// Incremental: each transcript's byte offset and per-request prices persist in
// day-<YYYY-MM-DD>.state.json, so a refresh reads only the bytes appended since
// the last one. The render reads only the small day-<YYYY-MM-DD>.json.
//
// Dedupe follows audit-lib's transcript facts: one API response is several
// assistant records sharing a requestId (streaming partials grow output_tokens),
// so the max-output record per requestId is kept. A resumed session replays
// records into a new file, so the dedupe also runs across files.

import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { priceUsage, walkTranscripts } from '../scripts/audit-lib.mjs';
import { localDay, spendDir, spendLock } from './statusline.mjs';

const CHUNK = 1 << 20;

/** Complete lines appended to file since offset → { lines, offset }. A torn last
 *  line stays unread until its newline lands. */
function readFrom(file, offset, size) {
  const fd = openSync(file, 'r');
  try {
    const parts = [];
    for (let pos = offset; pos < size; ) {
      const buf = Buffer.alloc(Math.min(CHUNK, size - pos));
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      parts.push(buf.subarray(0, n));
      pos += n;
    }
    const all = Buffer.concat(parts);
    const end = all.lastIndexOf(0x0a);
    if (end < 0) return { lines: [], offset };
    return { lines: all.subarray(0, end).toString('utf8').split('\n'), offset: offset + end + 1 };
  } finally {
    closeSync(fd);
  }
}

/**
 * Recompute today's total. → { day, usd, unpriced, files }.
 * state.files[file] = { offset, size, mtimeMs, reqs: { requestId: [usd, outputTokens] } }
 */
export async function refresh({ root, dir, prices, now = new Date() }) {
  const day = localDay(now);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const stateFile = join(dir, `day-${day}.state.json`);
  let state = { files: {} };
  try {
    state = JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    /* first refresh today */
  }
  const files = {};
  let unpriced = 0;
  for await (const { file } of walkTranscripts(root)) {
    let st;
    try {
      st = statSync(file);
    } catch {
      continue;
    }
    if (st.mtimeMs < midnight) continue;
    let entry = state.files[file];
    if (!entry || st.size < entry.offset) entry = { offset: 0, reqs: {} }; // new or rewritten
    if (st.size > entry.offset) {
      const { lines, offset } = readFrom(file, entry.offset, st.size);
      for (const line of lines) {
        if (!line.includes('"usage"')) continue;
        let rec;
        try {
          rec = JSON.parse(line);
        } catch {
          continue;
        }
        if (rec?.type !== 'assistant') continue;
        const u = rec.message?.usage;
        const model = rec.message?.model;
        if (!u || !model || model === '<synthetic>') continue;
        if (!(Date.parse(rec.timestamp) >= midnight)) continue;
        const key = rec.requestId || rec.message?.id || rec.uuid;
        const out = u.output_tokens || 0;
        if (entry.reqs[key] && entry.reqs[key][1] >= out) continue;
        const { usd } = priceUsage(u, model, prices);
        if (usd === null) {
          entry.unpriced = (entry.unpriced || 0) + 1;
          continue;
        }
        entry.reqs[key] = [usd, out];
      }
      entry.offset = offset;
    }
    files[file] = { ...entry, size: st.size, mtimeMs: st.mtimeMs };
    unpriced += entry.unpriced || 0;
  }
  const best = new Map();
  for (const { reqs } of Object.values(files)) {
    for (const [k, v] of Object.entries(reqs)) if (!best.has(k) || best.get(k)[1] < v[1]) best.set(k, v);
  }
  let usd = 0;
  for (const [cost] of best.values()) usd += cost;
  mkdirSync(dir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ files }));
  writeFileSync(join(dir, `day-${day}.json`), JSON.stringify({ day, usd, unpriced, ts: now.getTime() }));
  for (const f of readdirSync(dir)) {
    if (/^day-\d{4}-\d{2}-\d{2}\./.test(f) && !f.startsWith(`day-${day}.`)) rmSync(join(dir, f), { force: true });
  }
  return { day, usd, unpriced, files: Object.keys(files).length };
}

async function main() {
  const dir = spendDir();
  try {
    const prices = JSON.parse(readFileSync(new URL('../scripts/prices.json', import.meta.url), 'utf8'));
    const root = process.env.CLAUDE_PROJECTS_DIR || join(homedir(), '.claude', 'projects');
    await refresh({ root, dir, prices });
  } finally {
    rmSync(spendLock(dir), { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => process.exit(0));
