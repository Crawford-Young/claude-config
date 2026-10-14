#!/usr/bin/env node
// stop-reflect-gate.mjs — Stop hook. Prompts (never forces) reflect when an
// issue's PR has just merged.
//
// Trigger (issue #72, checklists retired): the session's transcript holds a
// successful `gh pr merge` Bash or PowerShell call, parsed by bash-guard's
// command parser (so `gh -R x pr merge` counts and quoted text does not);
// `--auto` only queues a merge and is skipped. PRs carry `Closes #N`, so a
// merge closes the issue. The first Stop after it blocks with the reminder and
// adds the call's tool_use id to the handled set in
// ~/.claude/stop-reflect-gate.json (newest 200), so the gate fires ONCE per
// merge, even across parallel sessions: the old checklist gate re-fired at every turn end and cost
// three workstreams ~13 declines apiece (issue row 63). "A phase closed" is the
// reflect skill's other trigger; no mechanical signal marks it, so it stays
// prose. Every failure path (no transcript, unreadable state) passes.
//
// A merge that precedes a reflect SKILL.md read (or reflect Skill call, or a
// user-typed /reflect) is marked handled without blocking: reflect already ran
// for it. A merge AFTER a reflect always gets its reminder, even within the hour
// (#140): the old 60-min "that is reflect's own landing PR" heuristic also hid a
// real next wave. The cost is one extra reminder on reflect's own landing PR,
// which the reminder text lets the model dismiss in a line.
//
// Second gate (issue #122): once reflect has run for the merge (its read came
// after the merge, or after the previous merge with no continuation ask in
// between: then this merge is reflect's own landing PR), the turn may not end until an
// AskUserQuestion offering fresh-session-or-continue (an option labelled fresh session,
// or clear in the older wording, plus one labelled continue: the labels skills/continuation/SKILL.md
// names, #178) was asked after that read and the merge. The tool call is
// matched, not a marker word: the continuation skill mandates the call. One
// block per merge, tracked under `cont` in the same state file. It waits for a
// genuine human reply after the reflect read (humanRepliedAfter): before that,
// reflect is paused on its dialogue and the single block would be spent there (#140).
// A reply is a typed message or an AskUserQuestion answer. A later typed pause (commit
// approval, say) also passes when the turn's closing text (the Stop payload's
// last_assistant_message, else the transcript's last assistant text) asks the user
// (asksUser, #199): a line outside ``` or ~~~ fences ending in a question mark, or a
// closing action item starting Approve / Decide / Pick / Choose / Confirm / Tell me /
// Say. Anything else counts as finished, so a background wait ("I'll pick up when
// the implementer reports") still spends the block.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain } from '../scripts/lib.mjs';
import { block, claudeDir, readState, run, shellSkillReads, writeState } from './_hooklib.mjs';
import { ghCalls, scrub } from './bash-guard.mjs';

const stateFile = join(claudeDir, 'stop-reflect-gate.json');
const MERGE_TOOLS = new Set(['Bash', 'PowerShell']);
const REFLECT_SKILL = /skills[\\/]reflect[\\/]SKILL\.md$/i;

/** Does this command run a real (not `--auto`-queued) `gh pr merge`? Read per
 *  call, so a block or substitution holding a queued and a real merge counts (#167). */
export function isMerge(command) {
  return ghCalls(scrub(command || ''), null).some(({ sub, action, args }) => sub === 'pr' && action === 'merge' && !args.some((a) => /^--auto(?:=|$)/.test(a)));
}

/** {id, at, prevAt} of the newest `gh pr merge` call whose result is not an error, else null; `at` is epoch ms or null,
 *  `prevAt` the same for the merge before it (null when there is none). */
export function newestMerge(text) {
  const merges = new Map();
  const times = new Map();
  for (const l of text.split('\n')) {
    if (!l.includes('merge') && !l.includes('tool_result')) continue;
    let o;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    for (const c of Array.isArray(o?.message?.content) ? o.message.content : []) {
      if (c?.type === 'tool_use' && MERGE_TOOLS.has(c.name) && isMerge(c.input?.command)) {
        merges.set(c.id, false);
        const t = Date.parse(o?.timestamp);
        times.set(c.id, Number.isNaN(t) ? null : t);
      }
      if (c?.type === 'tool_result' && merges.has(c.tool_use_id)) merges.set(c.tool_use_id, !c.is_error);
    }
  }
  const ok = [...merges].filter(([, good]) => good).map(([id]) => id);
  const id = ok.pop();
  return id ? { id, at: times.get(id), prevAt: times.get(ok.pop()) ?? null } : null;
}

/** tool_use id of the newest successful `gh pr merge` call, else null. */
export function lastMerge(text) {
  return newestMerge(text)?.id ?? null;
}

/** Text of a genuine human-typed user record (origin.kind "human", not isMeta), else null.
 *  Stop-hook feedback, peer messages and reminders are isMeta or carry another origin. */
function humanText(o) {
  if (o?.type !== 'user' || o.isMeta || o.origin?.kind !== 'human') return null;
  const c = o.message?.content;
  if (typeof c === 'string') return c;
  return Array.isArray(c) ? c.filter((x) => x?.type === 'text' && typeof x.text === 'string').map((x) => x.text).join('\n') : null;
}

// A typed skill command is `<command-message>reflect</command-message>\n<command-name>/reflect</command-name>`
// (optionally followed by <command-args>); (?![\w-]) keeps /reflect-gather out.
const TYPED_REFLECT = /^\s*\/reflect(?![\w-])|<command-name>\/reflect<\/command-name>/;

/** An AskUserQuestion answer: a tool_result user record carrying toolUseResult.answers (no origin). */
const isAnswer = (o) => o?.type === 'user' && !o.isMeta && Boolean(o.toolUseResult?.answers);

/** Is there a genuine human reply (a typed message, see humanText, or an AskUserQuestion answer) timestamped after `after` (epoch ms)? */
export function humanRepliedAfter(text, after) {
  for (const l of text.split('\n')) {
    if (!l.includes('"user"')) continue;
    let o;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    const t = Date.parse(o?.timestamp);
    if (!Number.isNaN(t) && t > after && (humanText(o) !== null || isAnswer(o))) return true;
  }
  return false;
}

/** Text of the newest assistant turn if its last non-thinking block is text, else null (it ended on a tool call). */
export function lastAssistantText(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"assistant"')) continue;
    let o;
    try {
      o = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (o?.type !== 'assistant') continue;
    const last = (Array.isArray(o.message?.content) ? o.message.content : []).filter((c) => c?.type !== 'thinking').pop();
    if (!last) continue;
    return last.type === 'text' && typeof last.text === 'string' ? last.text : null;
  }
  return null;
}

/** A line ending in a question mark, past any closing markdown or quotes. */
const QUESTION_LINE = /\?[\s*_)`'"\]]*$/;
/** A markdown heading, or a line that is only bold text (`**Your action items**`). */
const HEADING = /^\s{0,3}(?:#{1,6}\s|\*\*[^*]+\*\*:?\s*$)/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
/** The house-style approval asks: `- Approve the commit, push and PR …`, `- **Approve commit + push + PR:** …`,
 *  `- [ ] Approve …`, `- Say "ridden" and I'll …`. "Pick up #12" is a task, not a choice. */
const ASK_ITEM = /^(?:\[[ x]\]\s*)?(?:approve|decide|pick(?!\s+up\b)|choose|confirm|tell me|say)\b/i;

/** Does this turn-ending message wait on the user? True when a line outside ``` or ~~~ fences ends in a question
 *  mark, or a list item in the closing section (after the last heading, else the last paragraph) starts with an
 *  ask verb (Approve, Decide, Pick, Choose, Confirm, Tell me, Say) (#199). */
export function asksUser(message) {
  if (typeof message !== 'string') return false;
  let fenced = false;
  const lines = message.trimEnd().split('\n').filter((l) => {
    if (!/^\s*(?:```|~~~)/.test(l)) return !fenced;
    fenced = !fenced;
    return false;
  });
  if (lines.some((l) => QUESTION_LINE.test(l))) return true;
  // A bold-only last line ("**Thanks.**") closes the message; it heads nothing.
  const heading = lines.findLastIndex((l, i) => HEADING.test(l) && i < lines.length - 1);
  const closing = heading >= 0 ? lines.slice(heading + 1) : lines.slice(lines.findLastIndex((l) => !l.trim()) + 1);
  return closing.some((l) => ASK_ITEM.test(LIST_ITEM.exec(l)?.[1].replace(/^[*_]+/, '') ?? ''));
}

/** Epoch ms of the newest reflect SKILL.md Read, shell read (cat / Get-Content), reflect Skill call, or user-typed /reflect, else null. */
export function lastReflectAt(text) {
  let at = null;
  for (const l of text.split('\n')) {
    if (!l.toLowerCase().includes('reflect')) continue;
    let o;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    const typed = TYPED_REFLECT.test(humanText(o) ?? '');
    const hit = typed || (Array.isArray(o?.message?.content) ? o.message.content : []).some(
      (c) =>
        c?.type === 'tool_use' &&
        ((c.name === 'Read' && REFLECT_SKILL.test(c.input?.file_path || '')) ||
          (c.name === 'Skill' && c.input?.skill === 'reflect') ||
          (MERGE_TOOLS.has(c.name) && shellSkillReads(scrub(c.input?.command)).some((n) => n.toLowerCase() === 'reflect'))),
    );
    const t = Date.parse(o?.timestamp);
    if (hit && !Number.isNaN(t)) at = Math.max(at ?? 0, t);
  }
  return at;
}

const FRESH_OPTION = /\bfresh (?:session|window)\b|^\/?clear\b/i;
const CONTINUE_OPTION = /^continu/i;

/** Is this AskUserQuestion question the continuation ask's shape: one option labelled
 *  fresh session (or, the older wording, clear) and another labelled continue? Loose words
 *  are not enough: "File a fresh debt issue, or continue without one?" is a reflect ask (#178). */
export function isContinuationQuestion(q) {
  const labels = (Array.isArray(q?.options) ? q.options : []).map((x) => x?.label).filter((x) => typeof x === 'string').map((x) => x.replace(/^[\s*_]+/, ''));
  return labels.some((f, i) => FRESH_OPTION.test(f) && labels.some((c, j) => j !== i && CONTINUE_OPTION.test(c)));
}

/** Was the continuation ask (isContinuationQuestion) asked after `after` and before `before` (epoch ms)? */
export function continuationAsked(text, after, before = Infinity) {
  for (const l of text.split('\n')) {
    if (!l.includes('AskUserQuestion')) continue;
    let o;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    const t = Date.parse(o?.timestamp);
    if (Number.isNaN(t) || t <= after || t >= before) continue;
    for (const c of Array.isArray(o?.message?.content) ? o.message.content : []) {
      if (c?.type !== 'tool_use' || c.name !== 'AskUserQuestion') continue;
      if ((Array.isArray(c.input?.questions) ? c.input.questions : []).some(isContinuationQuestion)) return true;
    }
  }
  return false;
}

if (isMain(import.meta.url)) main();

function main() {
  run('stop-reflect-gate', (payload) => {
    if (payload?.stop_hook_active || !payload?.transcript_path) return;
    let text;
    try {
      text = readFileSync(payload.transcript_path, 'utf8');
    } catch {
      return; // unreadable transcript — never wedge a stop
    }
    const merge = newestMerge(text);
    if (!merge) return;
    const { id } = merge;
    const state = readState(stateFile);
    const handled = Array.isArray(state.ids) ? state.ids : [];
    const reflectAt = lastReflectAt(text);
    const mergeAt = merge.at ?? Date.now();
    const reflectedAfterMerge = reflectAt !== null && reflectAt > mergeAt;
    // Reflect's own landing PR merges after a read that followed the previous merge, with no continuation ask
    // between them: an ask there closed that reflect, so this merge is a later, unreflected wave (#199).
    const landingPR = reflectAt !== null && merge.prevAt !== null && reflectAt > merge.prevAt && !continuationAsked(text, reflectAt, mergeAt);
    const reflectRan = reflectedAfterMerge || landingPR;
    if (!handled.includes(id)) {
      writeState(stateFile, { ...state, ids: [...handled, id].slice(-200) });
      if (!reflectedAfterMerge) {
        block(
          `A PR merged this session. Before ending: prompt the user to run reflect now — Read ~/code/claude-config/skills/reflect/SKILL.md — or to explicitly skip it. This fires once per merge. If the user has already declined, say that and end the turn; do not run reflect on a wave this session did not execute. If this merge is reflect's own landing PR, say so and end the turn.`,
        );
        return;
      }
    }

    // Second gate: reflect ran for this merge, but no fresh-session-or-continue ask followed it.
    // No human reply since the read, or a turn ending in an ask (asksUser), means reflect is paused on the user:
    // pass without spending the block. The Stop payload carries the closing text; older payloads lack it, or send it blank.
    const m = payload.last_assistant_message;
    const closingText = typeof m === 'string' && m.trim() ? m : lastAssistantText(text);
    if (!reflectRan || !humanRepliedAfter(text, reflectAt) || asksUser(closingText)) return;
    const cur = readState(stateFile);
    const asked = Array.isArray(cur.cont) ? cur.cont : [];
    if (asked.includes(id) || continuationAsked(text, Math.max(reflectAt, mergeAt))) return;
    writeState(stateFile, { ...cur, cont: [...asked, id].slice(-200) });
    block(
      `Reflect has run for the merged PR. Before ending: run the continuation skill now — Read ~/code/claude-config/skills/continuation/SKILL.md and ask its fresh-session-or-continue AskUserQuestion. If reflect's dialogue is still waiting on the user, finish that first and ask fresh-session-or-continue as reflect's last step. This fires once per merge.`,
    );
  });
}
