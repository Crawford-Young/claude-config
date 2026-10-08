#!/usr/bin/env node
// subagent.mjs — subagentStatusLine entry point (#77): one row per dispatch showing
// the model and effort it actually went out on, so a mis-routed dispatch is visible
// while it runs, not at the next audit.
// stdin: { columns, tasks: [{ id, label, description, model?, effort?, tokenCount,
// startTime, ... }] } (code.claude.com/docs/en/statusline § Subagent status lines,
// verified 2026-10). stdout: one {"id","content"} JSON line per row overridden.
// A task without a model gets no line and keeps the default row. Fails to silence.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { formatTokens } from './statusline.mjs';

const ESC = '\x1b';
const RST = `${ESC}[0m`;
const paint = (code, s) => `${ESC}[${code}m${s}${RST}`;
const SEP = ` ${paint(2, '·')} `;
const UNSAFE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;
const clean = (s) => String(s ?? '').replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim();

/** Price tier from a model id: claude-opus-5-5 → opus. */
export const tier = (model) => /opus|sonnet|haiku|fable/.exec(model)?.[0] || model.split('-')[0];

function elapsed(startMs, now) {
  if (typeof startMs !== 'number') return null;
  const s = Math.floor((now - startMs) / 1000);
  if (s < 0) return null;
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

/** label · tier · effort · tokens · elapsed. Effort shows only when set (absent
 *  means it inherits the session's). A red ! marks opus/fable at high effort or
 *  above: the expensive dispatch worth interrupting. */
export function row(t, now = Date.now()) {
  const model = typeof t?.model === 'string' ? t.model : '';
  if (!model) return null;
  const tr = tier(model);
  const pricey = tr === 'opus' || tr === 'fable';
  const hot = /^(high|xhigh|max)$/.test(String(t.effort ?? ''));
  const parts = [paint(1, clean(t.label || t.description || 'agent')), pricey ? paint(31, tr) : paint(36, tr)];
  if (t.effort !== undefined && t.effort !== null) {
    const e = typeof t.effort === 'number' ? formatTokens(t.effort) : clean(t.effort);
    parts.push(hot ? paint(31, e) : paint(33, e));
  }
  if (typeof t.tokenCount === 'number' && t.tokenCount > 0) parts.push(paint(2, formatTokens(t.tokenCount)));
  const el = elapsed(t.startTime, now);
  if (el) parts.push(paint(2, el));
  return { id: t.id, content: `${pricey && hot ? `${paint(31, '!')} ` : ''}${parts.join(SEP)}` };
}

export function render(input, now = Date.now()) {
  const lines = [];
  for (const t of Array.isArray(input?.tasks) ? input.tasks : []) {
    const r = typeof t?.id === 'string' ? row(t, now) : null;
    if (r) lines.push(JSON.stringify(r));
  }
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const out = render(JSON.parse(readFileSync(0, 'utf8')));
    if (out) process.stdout.write(`${out}\n`);
  } catch {
    /* default rows */
  }
}
