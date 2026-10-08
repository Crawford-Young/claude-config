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

const CHUNK = 4 << 20;
const MAX_RUN_MS = 60_000; // a hung worker (network drive) exits before its lock goes stale twice

/**
 * Feed each complete line appended since offset to onLine, a chunk at a time so
 * memory stays bounded however far behind the offset is. A torn last line stays
 * unread until its newline lands. → the new offset.
 */
export function readFrom(file, offset, size, onLine, chunk = CHUNK) {
  const fd = openSync(file, 'r');
  try {
    let carry = Buffer.alloc(0);
    let pos = offset;
    while (pos < size) {
      const buf = Buffer.alloc(Math.min(chunk, size - pos));
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      pos += n;
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
      const end = data.lastIndexOf(0x0a);
      if (end < 0) {
        carry = data;
        continue;
      }
      for (const line of data.subarray(0, end).toString('utf8').split('\n')) onLine(line);
      carry = data.subarray(end + 1);
    }
    return pos - carry.length;
  } finally {
    closeSync(fd);
  }
}

/**
 * Recompute today's total. → { day, usd, unpriced, files }.
 * state.files[file] = { offset, size, mtimeMs, reqs: { requestId: [usd|null, outputTokens] } }
 * (usd null = a model prices.json does not know: counted, never folded in as $0)
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
      entry.offset = readFrom(file, entry.offset, st.size, (line) => {
        if (!line.includes('"usage"')) return;
        let rec;
        try {
          rec = JSON.parse(line);
        } catch {
          return;
        }
        if (rec?.type !== 'assistant') return;
        const u = rec.message?.usage;
        const model = rec.message?.model;
        if (!u || !model || model === '<synthetic>') return;
        if (!(Date.parse(rec.timestamp) >= midnight)) return;
        const key = rec.requestId || rec.message?.id || rec.uuid;
        const out = u.output_tokens || 0;
        if (entry.reqs[key] && entry.reqs[key][1] >= out) return;
        entry.reqs[key] = [priceUsage(u, model, prices).usd, out];
      });
    }
    files[file] = { ...entry, size: st.size, mtimeMs: st.mtimeMs };
  }
  const best = new Map();
  for (const { reqs } of Object.values(files)) {
    for (const [k, v] of Object.entries(reqs)) if (!best.has(k) || best.get(k)[1] < v[1]) best.set(k, v);
  }
  let usd = 0;
  let unpriced = 0;
  for (const [cost] of best.values()) {
    if (cost === null) unpriced++;
    else usd += cost;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ files }));
  writeFileSync(join(dir, `day-${day}.json`), JSON.stringify({ day, usd, unpriced, ts: now.getTime() }));
  // only earlier days: a worker straddling midnight must not delete the new day's files
  for (const f of readdirSync(dir)) {
    const m = /^day-(\d{4}-\d{2}-\d{2})\./.exec(f);
    if (m && m[1] < day) rmSync(join(dir, f), { force: true });
  }
  return { day, usd, unpriced, files: Object.keys(files).length };
}

/** On success the lock is released. On failure it stays, so its 120 s staleness
 *  window is the retry backoff, rather than every render spawning a doomed worker. */
async function main() {
  setTimeout(() => process.exit(0), MAX_RUN_MS).unref();
  const dir = spendDir();
  const prices = JSON.parse(readFileSync(new URL('../scripts/prices.json', import.meta.url), 'utf8'));
  const root = process.env.CLAUDE_PROJECTS_DIR || join(homedir(), '.claude', 'projects');
  await refresh({ root, dir, prices });
  rmSync(spendLock(dir), { force: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => process.exit(0));
