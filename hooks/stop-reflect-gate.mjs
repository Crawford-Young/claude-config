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
// Say. A turn end while a background Agent, Bash or PowerShell task launched since the
// reflect read and the merge is still running also passes (hasPendingBackground, #206): the
// launch has no <task-notification>, successful TaskStop or "stopped by the user" record yet,
// so "I'll pick up when the implementer reports" is a wait, not a finished reflect. A named
// teammate spawned in that window, or an agent or teammate sent a SendMessage there, is a wait
// too until it reports (a teammate message, hand-back or notification) after the spawn or
// send, or is stopped (#227). A session exit, resume or fork ends every wait from before
// it (#243). This reads the transcript's structure, not the wait phrasing.
// Anything else counts as finished and spends the block.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain } from '../scripts/lib.mjs';
import { block, claudeDir, readState, run, shellSkillReads, writeState } from './_hooklib.mjs';
import { ghCalls, scrub, UnreadableError } from './bash-guard.mjs';

const stateFile = join(claudeDir, 'stop-reflect-gate.json');
const MERGE_TOOLS = new Set(['Bash', 'PowerShell']);
const REFLECT_SKILL = /skills[\\/]reflect[\\/]SKILL\.md$/i;

/** Does this command run a real (not `--auto`-queued) `gh pr merge`? Read per
 *  call, so a block or substitution holding a queued and a real merge counts (#167).
 *  A command the guard blocks unread (nested too deep, an env -S ${VAR}
 *  command) is no merge: one such line must not silence the gate for the
 *  rest of the session. */
export function isMerge(command, tool = null) {
  try {
    return ghCalls(scrub(command || ''), null, tool).some(({ sub, action, args }) => sub === 'pr' && action === 'merge' && !args.some((a) => /^--auto(?:=|$)/.test(a)));
  } catch (err) {
    if (err instanceof UnreadableError) return false;
    throw err;
  }
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
      if (c?.type === 'tool_use' && MERGE_TOOLS.has(c.name) && isMerge(c.input?.command, c.name)) {
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

/** A message's text: string content, or its text blocks joined (tool results excluded), else null. */
function textOf(c) {
  if (typeof c === 'string') return c;
  return Array.isArray(c) ? c.filter((x) => x?.type === 'text' && typeof x.text === 'string').map((x) => x.text).join('\n') : null;
}

/** Text of a genuine human-typed user record (origin.kind "human", not isMeta), else null.
 *  Stop-hook feedback, peer messages and reminders are isMeta or carry another origin. */
function humanText(o) {
  if (o?.type !== 'user' || o.isMeta || o.origin?.kind !== 'human') return null;
  return textOf(o.message?.content);
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

const BG_TOOLS = new Set(['Agent', 'Bash', 'PowerShell']);
const WAIT_TOOLS = new Set([...BG_TOOLS, 'SendMessage', 'TaskStop']);
const WAIT_RECORD = /run_in_background|TaskStop|tool_result|"name":"(?:Agent|SendMessage)"|task-notification|teammate-message|agent-message|stopped by the user|"type":"cost-state"|SessionStart:(?:resume|fork)/;
// A notification runs to its closing tag, or to the line's end when a record truncates it.
const NOTIFICATION = /<task-notification>[\s\S]*?(?:<\/task-notification>|$)/g;
const NOTIFIED_ID = /<(?:task-id|tool-use-id)>([^<]+)</g;
const STOPPED_AGENT = /Agent ([\w-]+) was stopped by the user/g;
// The harness's user-stop text names one description, or several (48ca871b:165, 71d9f934:6).
const STOPPED_ONE = /^Background agent "([\s\S]*)" was stopped by the user\./;
const STOPPED_MANY = /^\d+ background agents were stopped by the user: "([\s\S]*)"\./;
const PROCESS_START = /^SessionStart:(?:resume|fork)$/;
const MESSAGE_FROM = /<(?:teammate-message teammate_id|agent-message from)="([^"]+)"/g;
const LAUNCHED_ID = /running in background with ID: (\w+)/;
const descKey = (d) => (typeof d === 'string' ? `desc:${d}` : null);

/** Descriptions a harness user-stop record names: the prompt of a task-notification queued_command attachment. A
 *  queue-operation enqueue can hold user-typed text, and the same words quoted anywhere else (a brief, a message, a
 *  tool result) name none. */
function stoppedDescriptions(o) {
  const a = o?.attachment;
  const text = o?.type === 'attachment' && a?.type === 'queued_command' && a.commandMode === 'task-notification' ? a.prompt : null;
  if (typeof text !== 'string') return [];
  const one = STOPPED_ONE.exec(text);
  return one ? [one[1]] : (STOPPED_MANY.exec(text)?.[1].split('", "') ?? []);
}

/** Does this record mark a process boundary? Claude Code writes an untimed cost-state record at exit or /clear
 *  (scripts/audit-lib.mjs); a /clear opens a new transcript, so here it marks an exit. A resumed or forked process
 *  starts with a SessionStart hook record (a fork's copied history holds no cost-state). Claude Code records
 *  hook_success only for hooks that exist, so resume and fork detection relies on a SessionStart hook being configured;
 *  session-start.mjs runs here with no matcher. */
const isProcessBoundary = (o) => o?.type === 'cost-state' || (o?.type === 'attachment' && PROCESS_START.test(o.attachment?.hookName ?? ''));

/** Is the director waiting on a background task or a teammate it started or resumed at or after `after` (epoch ms)?
 *  (#206, #227.) A wait is a non-error tool_result for:
 *  - a background launch: a run_in_background Agent, Bash or PowerShell call (true or "true"), or any toolUseResult
 *    with status async_launched. It resolves on any record naming it, earlier or later (#206).
 *  - a named-teammate spawn: toolUseResult status teammate_spawned, with or without run_in_background, keyed on its
 *    toolUseResult.name (the spawn may rename it) and agentId.
 *  - a SendMessage whose toolUseResult reached an agent: success with routing (a teammate's inbox), resumedAgentId
 *    (a finished background agent resumed) or pin (queued for a running one), keyed on input.to, resumedAgentId and
 *    pin.id. A cross-session peer's result has none of these, and a stopped agent's is success false.
 *  Only non-empty string ids key a wait.
 *  A spawn or SendMessage resolves only on a record timestamped at or after it, since a teammate idles after every
 *  turn and a resumed agent's first-pass notice is already in the transcript. Resolving records: a <task-notification>
 *  naming the tool-use id or task id, a <teammate-message teammate_id> or <agent-message from> user record (an idle
 *  notification or a plain message: a teammate may report with no idle after it, 98122171:392), a successful
 *  TaskStop of its task id, name or agentId, "Agent <id> was stopped by the user", or a harness user-stop record naming
 *  its description (stoppedDescriptions) timestamped at or after the launch, since descriptions repeat (#243): agents
 *  sharing a description resolve together on a stop made after both launches. A queue-operation remove carries its
 *  dequeue time, so it and untimed records resolve background launches by id only.
 *  A process boundary (isProcessBoundary) ends every wait before it: an exit or resume drops tasks and teammates with
 *  no record of it (#243). Waits before `after` are outside the gate window. */
export function hasPendingBackground(text, after = 0) {
  const calls = new Map();
  const agents = new Map(); // any key of a launched agent -> all its keys
  const waits = [];
  const heard = new Map(); // key -> newest resolving record time
  const hear = (key, at) => heard.set(key, Math.max(heard.get(key) ?? -Infinity, at));
  for (const l of text.split('\n')) {
    if (!WAIT_RECORD.test(l)) continue;
    let o = null;
    try {
      o = JSON.parse(l);
    } catch {} // an unparsable line's notification and stop text still count, untimed
    // The process that ran every earlier task and teammate is gone, and a dropped teammate leaves no record (#243).
    if (isProcessBoundary(o)) waits.length = 0;
    const t = Date.parse(o?.timestamp);
    const at = Number.isNaN(t) || o.operation === 'remove' ? -Infinity : t;
    for (const [n] of l.matchAll(NOTIFICATION)) for (const [, id] of n.matchAll(NOTIFIED_ID)) hear(id, at);
    for (const [, id] of l.matchAll(STOPPED_AGENT)) hear(id, at);
    for (const d of stoppedDescriptions(o)) hear(descKey(d), at);
    if (o?.type === 'user') for (const [, from] of (textOf(o.message?.content) ?? '').matchAll(MESSAGE_FROM)) hear(from, at);
    for (const c of Array.isArray(o?.message?.content) ? o.message.content : []) {
      if (c?.type === 'tool_use' && WAIT_TOOLS.has(c.name)) calls.set(c.id, c);
      if (c?.type !== 'tool_result' || c.is_error) continue;
      const call = calls.get(c.tool_use_id);
      const r = o.toolUseResult;
      if (call?.name === 'TaskStop' && typeof call.input?.task_id === 'string') hear(call.input.task_id, at);
      let keys = null;
      let since = t;
      // A named spawn is a teammate even with run_in_background set (3b14fba3:94/:96): it reports by teammate message, not notification.
      if (r?.status === 'teammate_spawned') {
        keys = [c.tool_use_id, r.name, r.agentId, descKey(call?.input?.description)];
      } else if ((BG_TOOLS.has(call?.name) && String(call.input?.run_in_background) === 'true') || r?.status === 'async_launched') {
        const named = typeof c.content === 'string' ? LAUNCHED_ID.exec(c.content)?.[1] : null;
        keys = [c.tool_use_id, r?.agentId, r?.backgroundTaskId, named, descKey(r?.description), descKey(call?.input?.description)];
        since = -Infinity;
      } else if (call?.name === 'SendMessage' && typeof call.input?.to === 'string' && r?.success === true && (r.routing || r.resumedAgentId || r.pin)) {
        keys = [call.input.to, r.resumedAgentId, r.pin?.id].flatMap((k) => agents.get(k) ?? [k]);
      }
      if (!keys) continue;
      keys = [...new Set(keys.filter((k) => typeof k === 'string' && k))];
      for (const k of keys) agents.set(k, keys);
      if (!Number.isNaN(t) && t >= after) waits.push({ keys, since, t });
    }
  }
  // A description is no id: another launch may share it, so its stop must come at or after this launch (#243).
  return waits.some(({ keys, since, t }) => !keys.some((k) => heard.has(k) && heard.get(k) >= (k.startsWith('desc:') ? t : since)));
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
    if (!reflectRan || !humanRepliedAfter(text, reflectAt) || asksUser(closingText) || hasPendingBackground(text, Math.max(reflectAt, mergeAt))) return;
    const cur = readState(stateFile);
    const asked = Array.isArray(cur.cont) ? cur.cont : [];
    if (asked.includes(id) || continuationAsked(text, Math.max(reflectAt, mergeAt))) return;
    writeState(stateFile, { ...cur, cont: [...asked, id].slice(-200) });
    block(
      `Reflect has run for the merged PR. Before ending: run the continuation skill now — Read ~/code/claude-config/skills/continuation/SKILL.md and ask its fresh-session-or-continue AskUserQuestion. If reflect's dialogue is still waiting on the user, finish that first and ask fresh-session-or-continue as reflect's last step. This fires once per merge.`,
    );
  });
}
