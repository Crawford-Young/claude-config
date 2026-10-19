// node --test scripts/test/stop-reflect-gate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execHarness, tempDir } from './_spawn.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asksUser, continuationAsked, hasPendingBackground, humanRepliedAfter, isMerge, lastAssistantText, lastMerge, lastReflectAt, newestMerge } from '../../hooks/stop-reflect-gate.mjs';

const hook = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks', 'stop-reflect-gate.mjs');

const call = (id, command, name = 'Bash') => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: { command } }] } });
const result = (id, is_error = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error, content: 'x' }] } });

/** A transcript file holding `records`, one JSON object per line. */
function transcript(...records) {
  const p = join(tempDir('gate-tx-'), 't.jsonl');
  writeFileSync(p, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return p;
}

function runHook(payload, home) {
  try {
    execHarness(hook, [], {
      input: JSON.stringify(payload),
      home,
    });
    return { code: 0 };
  } catch (e) {
    return { code: e.status, stderr: e.stderr };
  }
}

test('lastMerge: the newest successful gh pr merge call, else null', () => {
  const lines = [call('a', 'gh pr merge 5 --rebase'), result('a'), call('b', 'git status'), result('b')].map((r) => JSON.stringify(r));
  assert.equal(lastMerge(lines.join('\n')), 'a');
  assert.equal(lastMerge([call('c', 'gh pr merge 6'), result('c', true)].map((r) => JSON.stringify(r)).join('\n')), null);
  assert.equal(lastMerge([call('d', 'gh pr view 6')].map((r) => JSON.stringify(r)).join('\n')), null);
});

test('reminds once per merged PR, then stays quiet', () => {
  const home = tempDir('gate-home-');
  const transcript_path = transcript(call('m1', 'gh pr merge 72 --rebase'), result('m1'));

  const first = runHook({ transcript_path }, home);
  assert.equal(first.code, 2, 'first stop after the merge blocks with the reminder');
  assert.match(first.stderr, /prompt the user/i);
  assert.match(first.stderr, /Read ~\/code\/claude-config\/skills\/reflect\/SKILL\.md/);

  assert.equal(runHook({ transcript_path, stop_hook_active: true }, home).code, 0, 'the retry passes');
  assert.equal(runHook({ transcript_path }, home).code, 0, 'a later turn end on the same merge passes');
});

const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const reflectRead = (id, min, path = 'C:\\Users\\u\\code\\claude-config\\skills\\reflect\\SKILL.md') => ({
  type: 'assistant',
  timestamp: ago(min),
  message: { content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: path } }] },
});

test('lastReflectAt: the newest reflect SKILL.md read or reflect Skill call, else null', () => {
  const at = lastReflectAt(
    [
      reflectRead('r1', 90),
      reflectRead('r2', 5, '~/code/claude-config/skills/reflect/SKILL.md'),
      { type: 'assistant', timestamp: ago(1), message: { content: [{ type: 'tool_use', id: 'o', name: 'Read', input: { file_path: 'skills/qa/SKILL.md' } }] } },
    ]
      .map((r) => JSON.stringify(r))
      .join('\n'),
  );
  assert.ok(Math.abs(at - (Date.now() - 5 * 60_000)) < 5_000, 'newest reflect read wins; other skills do not count');
  const skill = { type: 'assistant', timestamp: ago(3), message: { content: [{ type: 'tool_use', id: 's', name: 'Skill', input: { skill: 'reflect' } }] } };
  assert.ok(lastReflectAt(JSON.stringify(skill)));
  assert.equal(lastReflectAt(JSON.stringify(call('a', 'gh pr merge 5'))), null);
});

test('lastReflectAt: a Bash cat or PowerShell Get-Content of reflect SKILL.md counts; mentions and Edit/Write do not', () => {
  const tx = (...r) => r.map((x) => JSON.stringify({ type: 'assistant', timestamp: ago(4), message: { content: [x] } })).join('\n');
  const use = (name, input) => ({ type: 'tool_use', id: 'u', name, input });
  assert.ok(lastReflectAt(tx(use('Bash', { command: 'cat ~/code/claude-config/skills/reflect/SKILL.md' }))), 'Bash cat');
  assert.ok(lastReflectAt(tx(use('PowerShell', { command: 'Get-Content C:\\Users\\u\\code\\claude-config\\skills\\reflect\\SKILL.md' }))), 'PowerShell');
  assert.ok(lastReflectAt(tx(use('Bash', { command: 'cat skills/INDEX.md skills/reflect/SKILL.md' }))), 'relative path');
  assert.equal(lastReflectAt(tx(use('Bash', { command: 'echo reflect on the skills' }))), null, 'a mention is not a read');
  assert.equal(lastReflectAt(tx(use('Bash', { command: 'cat skills/qa/SKILL.md # reflect' }))), null, 'another skill is not reflect');
  assert.equal(lastReflectAt(tx(use('Edit', { file_path: 'skills/reflect/SKILL.md', old_string: 'a', new_string: 'b' }))), null, 'Edit is not a read');
  assert.equal(lastReflectAt(tx(use('Write', { file_path: 'skills/reflect/SKILL.md', content: 'x' }))), null, 'Write is not a read');
});

test('a wave merged within 60 min of a reflect read still gets its own reminder (no time heuristic)', () => {
  const home = tempDir('gate-home-');
  const transcript_path = transcript(reflectRead('r', 10), ...mergeAt('m94', 5));
  const first = runHook({ transcript_path }, home);
  assert.equal(first.code, 2, "a merge shortly after a reflect is not assumed to be reflect's landing PR");
  assert.match(first.stderr, /prompt the user to run reflect/i);
  assert.equal(runHook({ transcript_path }, home).code, 0, 'once per merge');
});

const human = (min, content = 'ok') => ({ type: 'user', origin: { kind: 'human' }, timestamp: ago(min), message: { content } });

test('lastReflectAt: a user-typed /reflect counts; meta records and other text do not', () => {
  const tx = (r) => JSON.stringify(r);
  const typed = '<command-message>reflect</command-message>\n<command-name>/reflect</command-name>';
  assert.ok(lastReflectAt(tx(human(4, typed))), 'the real message-first record');
  assert.ok(lastReflectAt(tx(human(4, `${typed}\n<command-args>claude-config-140</command-args>`))), 'with args');
  assert.ok(lastReflectAt(tx(human(4, '/reflect'))), 'a bare leading /reflect');
  assert.ok(lastReflectAt(tx(human(4, [{ type: 'text', text: typed }]))), 'text-block content');
  assert.equal(lastReflectAt(tx(human(4, '<command-message>reflect-gather</command-message>\n<command-name>/reflect-gather</command-name>'))), null, 'a longer command name');
  assert.equal(lastReflectAt(tx(human(4, '/reflect-gather'))), null, 'a bare longer command name');
  assert.equal(lastReflectAt(tx({ ...human(4, typed), isMeta: true })), null, 'a meta record is not the user typing');
  assert.equal(lastReflectAt(tx({ ...human(4, typed), origin: { kind: 'peer' } })), null, 'a peer message is not the user typing');
  assert.equal(lastReflectAt(tx(human(4, 'please /reflect later'))), null, 'a mention mid-sentence');
  assert.equal(lastReflectAt(tx(human(4, '/reflection'))), null, 'another command');
});

test('humanRepliedAfter: only a genuine human user record after the cutoff', () => {
  const cut = Date.now() - 10 * 60_000;
  const h = (r) => humanRepliedAfter(JSON.stringify(r), cut);
  assert.equal(h(human(5)), true);
  assert.equal(h(human(15)), false, 'before the cutoff');
  assert.equal(h({ ...human(5), isMeta: true }), false, 'hook feedback or reminder');
  assert.equal(h({ ...human(5), origin: { kind: 'peer' } }), false, 'peer message');
  assert.equal(h(at(5, result('t'))), false, 'a tool result is not a reply');
  assert.equal(h({ ...at(5, result('q')), toolUseResult: { answers: { 'apply edit?': 'Yes' } } }), true, 'an AskUserQuestion answer is');
  assert.equal(h({ ...at(5, result('q')), toolUseResult: { stdout: 'x' } }), false, 'other tool results with a toolUseResult are not');
  assert.equal(h({ ...at(15, result('q')), toolUseResult: { answers: { a: 'b' } } }), false, 'an answer before the cutoff');
});

test('quiet with no merge, a failed merge, or no transcript', () => {
  const home = tempDir('gate-home-');
  assert.equal(runHook({ transcript_path: transcript(call('x', 'git push'), result('x')) }, home).code, 0);
  assert.equal(runHook({ transcript_path: transcript(call('y', 'gh pr merge 1'), result('y', true)) }, home).code, 0);
  assert.equal(runHook({}, home).code, 0);
});

test('lastMerge: PowerShell merges and gh -R forms count; --auto only queues', () => {
  const tx = (...r) => r.map((x) => JSON.stringify(x)).join('\n');
  assert.equal(lastMerge(tx(call('p', 'gh pr merge 5 --rebase', 'PowerShell'), result('p'))), 'p');
  assert.equal(lastMerge(tx(call('r', 'gh -R owner/repo pr merge 12 --rebase'), result('r'))), 'r');
  assert.equal(lastMerge(tx(call('s', 'gh pr -R owner/repo merge 12'), result('s'))), 's');
  assert.equal(lastMerge(tx(call('q', 'gh pr merge 5 --auto --rebase'), result('q'))), null);
  assert.equal(lastMerge(tx(call('v', 'gh -R owner/repo pr view 12'), result('v'))), null);
  assert.equal(lastMerge(tx(call('e', 'echo "gh pr merge 5"'), result('e'))), null);
});

test('#167: a command nested too deep to read is no merge, and the merges around it still count', () => {
  const deep = '{ '.repeat(200) + 'gh pr merge 1; ' + '} '.repeat(200);
  assert.equal(isMerge(deep), false);
  const tx = (...r) => r.map((x) => JSON.stringify(x)).join('\n');
  assert.equal(lastMerge(tx(call('a', 'gh pr merge 2'), result('a'), call('d', deep), result('d'))), 'a');
  assert.equal(lastMerge(tx(call('d', deep), result('d'), call('b', 'gh pr merge 3'), result('b'))), 'b');
});

test('#167: --auto is read per merge call, so a block, substitution or shell string holding a queued and a real merge counts', () => {
  const tx = (...r) => r.map((x) => JSON.stringify(x)).join('\n');
  for (const c of ['if ($x) { gh pr merge 1 --auto --squash; gh pr merge 2 }', 'echo $(gh pr merge 1 --auto --squash; gh pr merge 2)', 'bash -c "gh pr merge 1 --auto --squash; gh pr merge 2"', 'gh pr merge 1 --auto; gh pr merge 2']) {
    assert.equal(lastMerge(tx(call('m', c), result('m'))), 'm', c);
  }
  for (const c of ['if ($x) { gh pr merge 1 --auto }', 'gh pr merge 1 --auto=true']) {
    assert.equal(lastMerge(tx(call('n', c), result('n'))), null, c);
  }
  // A merge in a PowerShell condition's block runs.
  assert.equal(isMerge('if (echo x) { gh pr merge 5 }'), true);
  // Another command's --auto queues nothing.
  assert.equal(lastMerge(tx(call('o', 'gh pr merge 1 --rebase && echo --auto'), result('o'))), 'o');
});

test('parallel sessions each get their own reminder once, with no ping-pong', () => {
  const home = tempDir('gate-home-');
  const a = transcript(call('ma', 'gh pr merge 1 --rebase'), result('ma'));
  const b = transcript(call('mb', 'gh pr merge 2 --rebase'), result('mb'));
  assert.equal(runHook({ transcript_path: a }, home).code, 2);
  assert.equal(runHook({ transcript_path: b }, home).code, 2);
  assert.equal(runHook({ transcript_path: a }, home).code, 0, 'session A stays quiet after B fired');
  assert.equal(runHook({ transcript_path: b }, home).code, 0, 'session B stays quiet after A ran again');
});

test('lastReflectAt: heredoc bodies and commit messages naming the path are not reads; mixed case is', () => {
  const tx = (command) => JSON.stringify({ type: 'assistant', timestamp: ago(4), message: { content: [{ type: 'tool_use', id: 'u', name: 'Bash', input: { command } }] } });
  assert.equal(lastReflectAt(tx("cat > n.md <<'EOF'\nsee skills/reflect/SKILL.md\nEOF")), null, 'heredoc body');
  assert.equal(lastReflectAt(tx('git commit -m "edit skills/reflect/SKILL.md"')), null, 'commit message');
  assert.ok(lastReflectAt(tx('cat skills/Reflect/skill.md')), 'mixed case');
});

// ---- second gate: continuation ask after reflect (issue #122) ----
const at = (min, rec) => ({ ...rec, timestamp: ago(min) });
const mergeAt = (id, min) => [at(min, call(id, 'gh pr merge 9 --rebase')), at(min, result(id))];
const ask = (min, input) => ({
  type: 'assistant',
  timestamp: ago(min),
  message: { content: [{ type: 'tool_use', id: `q${min}`, name: 'AskUserQuestion', input }] },
});
const clearQ = { questions: [{ question: 'Clear or continue in this session?', options: [{ label: '/clear' }, { label: 'Continue' }] }] };
const optionsOnly = { questions: [{ question: 'Next step?', options: [{ label: 'Clear context' }, { label: 'Continue here', description: 'keep going' }] }] };
const freshQ = { questions: [{ question: 'What next?', options: [{ label: 'End here (Recommended)' }, { label: 'Fresh session' }, { label: 'Continue' }] }] };
const unrelated = { questions: [{ question: 'Which branch name?', options: [{ label: 'a' }, { label: 'b' }] }] };
const debtQ = { questions: [{ question: 'File a fresh debt issue, or continue without one?', options: [{ label: 'File a fresh debt issue' }, { label: 'Continue without one' }] }] };
const wordsOnly = { questions: [{ question: 'Fresh session or continue?', options: [{ label: 'Yes' }, { label: 'No', description: 'clear it and continue later' }] }] };
const labelled = (...labels) => ({ questions: [{ question: 'Next?', options: labels.map((label) => ({ label })) }] });
/** continuationAsked over a transcript holding one ask `min` minutes ago, with a 20-min cutoff. */
const asked = (min, input) => continuationAsked(JSON.stringify(ask(min, input)), Date.now() - 20 * 60_000);

test('continuationAsked: an option labelled fresh session (or clear) plus one labelled continue, after the cutoff only', () => {
  assert.equal(asked(5, freshQ), true, 'the fresh-session-or-continue labels');
  assert.equal(asked(5, clearQ), true, 'the older clear label');
  assert.equal(asked(5, optionsOnly), true, 'clear and continue leading longer labels');
  assert.equal(asked(5, labelled(' **Fresh session**', ' Continue')), true, 'padded or bold labels');
  assert.equal(asked(5, unrelated), false, 'unrelated ask');
  assert.equal(asked(30, freshQ), false, 'asked before the cutoff');
});

test('continuationAsked: a reflect-dialogue ask holding both words is not the continuation ask (#178)', () => {
  assert.equal(asked(5, debtQ), false, 'fresh debt issue / continue without one');
  assert.equal(asked(5, wordsOnly), false, 'the words in question text and descriptions, not the labels');
  assert.equal(asked(5, labelled('Continue in a fresh session')), false, 'one option cannot be both');
});

test('continuationAsked accepts the option labels skills/continuation/SKILL.md names, so a wording change there fails here', () => {
  const skill = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'continuation', 'SKILL.md'), 'utf8');
  const m = skill.match(/AskUserQuestion whose options are labelled `([^`]+)` and `([^`]+)`/);
  assert.ok(m, 'the continuation skill names its option labels');
  assert.equal(asked(5, labelled(m[1], m[2])), true, `labels ${m[1]} / ${m[2]}`);
});

test('after reflect read post-merge: blocks once for the continuation ask, then stays quiet', () => {
  const home = tempDir('gate-home-');
  const transcript_path = transcript(...mergeAt('c1', 30), reflectRead('r', 10), human(8));
  const first = runHook({ transcript_path }, home);
  assert.equal(first.code, 2);
  assert.match(first.stderr, /continuation\/SKILL\.md/);
  assert.match(first.stderr, /fresh-session-or-continue/);
  assert.doesNotMatch(first.stderr, /clear-or-continue|\/clear/);
  assert.equal(runHook({ transcript_path }, home).code, 0, 'one block per merge');
});

test('mid-reflect dialogue pause (no human reply since the read): passes without spending the one block', () => {
  const home = tempDir('gate-home-');
  const paused = transcript(...mergeAt('c2', 30), reflectRead('r', 10));
  assert.equal(runHook({ transcript_path: paused }, home).code, 0, 'reflect is waiting on the user');
  const state = () => JSON.parse(readFileSync(join(home, '.claude', 'stop-reflect-gate.json'), 'utf8'));
  assert.equal(state().cont, undefined, 'nothing recorded');
  const meta = transcript(...mergeAt('c2', 30), reflectRead('r', 10), { ...human(8), isMeta: true });
  assert.equal(runHook({ transcript_path: meta }, home).code, 0, 'hook feedback is not a reply');
  const replied = transcript(...mergeAt('c2', 30), reflectRead('r', 10), human(8));
  assert.equal(runHook({ transcript_path: replied }, home).code, 2, 'the user replied: the block is still available');
});

const answerRes = (min, id) => ({ ...at(min, result(id)), toolUseResult: { answers: { 'Apply?': 'Yes' } } });

test('reflect landing PR: after merge, read and a human reply, the next merge gets the reminder, then the continuation gate', () => {
  const home = tempDir('gate-home-');
  const transcript_path = transcript(...mergeAt('l1', 90), reflectRead('r', 80), human(70), ...mergeAt('l2', 20));
  const first = runHook({ transcript_path }, home);
  assert.equal(first.code, 2);
  assert.match(first.stderr, /If this merge is reflect's own landing PR, say so and end the turn/);
  const second = runHook({ transcript_path }, home);
  assert.equal(second.code, 2, 'the continuation ask is still enforced for the landing merge');
  assert.match(second.stderr, /continuation\/SKILL\.md/);
  assert.equal(runHook({ transcript_path }, home).code, 0, 'one block per merge');
});

test('an AskUserQuestion answer is the human reply that opens the continuation gate', () => {
  const home = tempDir('gate-home-');
  const transcript_path = transcript(...mergeAt('a1', 30), reflectRead('r', 20), ask(15, unrelated), answerRes(14, 'q15'));
  const r = runHook({ transcript_path }, home);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /continuation\/SKILL\.md/);
});

test('a user-typed /reflect after the merge opens the continuation gate once the user replies', () => {
  const home = tempDir('gate-home-');
  const transcript_path = transcript(...mergeAt('c2b', 30), human(10, '<command-message>reflect</command-message>\n<command-name>/reflect</command-name>'), human(6, 'looks good'));
  const r = runHook({ transcript_path }, home);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /continuation/);
});

test('a fresh-session-or-continue ask after reflect satisfies the gate (old clear wording too)', () => {
  for (const input of [freshQ, clearQ, optionsOnly]) {
    const home = tempDir('gate-home-');
    const transcript_path = transcript(...mergeAt('c3', 30), reflectRead('r', 10), human(8), ask(2, input));
    assert.equal(runHook({ transcript_path }, home).code, 0);
  }
});

test('an unrelated ask, a reflect debt ask, or a clear-or-continue ask before the reflect read, still blocks', () => {
  const h1 = tempDir('gate-home-');
  assert.equal(runHook({ transcript_path: transcript(...mergeAt('c4', 30), reflectRead('r', 10), human(8), ask(2, unrelated)) }, h1).code, 2);
  const h3 = tempDir('gate-home-');
  assert.equal(runHook({ transcript_path: transcript(...mergeAt('c4b', 30), reflectRead('r', 10), human(8), ask(2, debtQ)) }, h3).code, 2, 'the #178 debt ask');
  const h2 = tempDir('gate-home-');
  assert.equal(runHook({ transcript_path: transcript(...mergeAt('c5', 30), ask(20, clearQ), reflectRead('r', 10), human(8)) }, h2).code, 2);
});

test('no reflect read: only the reflect reminder applies, and the continuation gate stays quiet after it', () => {
  const home = tempDir('gate-home-');
  const transcript_path = transcript(...mergeAt('c6', 30));
  const first = runHook({ transcript_path }, home);
  assert.equal(first.code, 2);
  assert.match(first.stderr, /reflect now/);
  assert.equal(runHook({ transcript_path }, home).code, 0);
});

test('old state files without cont still work, and cont keeps the reminder ids', () => {
  const home = tempDir('gate-home-');
  const transcript_path = transcript(...mergeAt('c7', 30), reflectRead('r', 10), human(8));
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'stop-reflect-gate.json'), JSON.stringify({ ids: ['c7'] }));
  assert.equal(runHook({ transcript_path }, home).code, 2, 'reminder already handled, continuation gate fires');
  const state = JSON.parse(readFileSync(join(home, '.claude', 'stop-reflect-gate.json'), 'utf8'));
  assert.deepEqual(state, { ids: ['c7'], cont: ['c7'] });
});

test('stop_hook_active passes even when the second-gate conditions are met', () => {
  const home = tempDir('gate-home-');
  const transcript_path = transcript(...mergeAt('c1b', 30), reflectRead('r', 10), human(8));
  assert.equal(runHook({ transcript_path, stop_hook_active: true }, home).code, 0);
  assert.equal(runHook({ transcript_path }, home).code, 2, 'the passed retry recorded nothing');
});

// ---- later typed pauses partway through reflect (#199) ----
/** Exit codes of the Stops at each prefix length in `stops`, replaying `records` against one state dir. */
function stopCodes(records, stops) {
  const home = tempDir('gate-home-');
  const p = join(tempDir('gate-tx-'), 't.jsonl');
  return stops.map((n) => {
    writeFileSync(p, `${records.slice(0, n).map((r) => JSON.stringify(r)).join('\n')}\n`);
    return runHook({ transcript_path: p }, home).code;
  });
}

// A turn-ending text record, the real shape (one content block per record, stop_reason end_turn):
// ~/.claude/projects/C--Users-young-code/ab5c4ba3-489b-471e-9a3c-d2ba55d272d0.jsonl:247.
const say = (min, text) => ({
  type: 'assistant',
  timestamp: ago(min),
  message: { type: 'message', role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn' },
});
const thinking = (min) => ({ type: 'assistant', timestamp: ago(min), message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'x' }], stop_reason: 'tool_use' } });
// Tails of real reflect pauses (ab5c4ba3:247, 945f43a3-03fc-4d62-b94d-f754f4a62c9d.jsonl:304) and a real finished reflect
// (79e0cf9f-58cd-4c54-8e0a-1b17daefbd5d.jsonl:728), all in ~/.claude/projects/C--Users-young-code/.
const pauseActions =
  '- **Why it waits:** `land.mjs` is #183\'s file, so I\'d file an issue rather than change it.\n\nWhat did you see that I missed?\n\n## Your action items\n- Pick the fix for the `chore/` vs `fix/` mismatch, or drop it.\n- Add anything you noticed that this reflect missed.';
const pauseCall = '## 3. What should become a rule?\n- **Python is absent.** Candidate memory.\n\nWhat did you see that I missed?\n\n## Your call\n- Which of the 3 candidates do I land? And is there anything to add?';
const finished =
  'New issues #110–#113 stay standalone, per your call. Reflect produced no new rule.\n\n### Your action items\n- Run `/clear` before the next wave.\n- Optional, not a doc change: update your local Godot install from 4.7.1 to 4.7.2.';

// Verbatim tails of real typed approval pauses, closing on an imperative action item with no question mark:
// ced8aa71-bf39-4e5f-b566-a3f70c012442.jsonl:449 (reply "yes") and aab7de31-c77e-4fa5-bc9a-e7465784d07e.jsonl:284.
const approveAction =
  "**Follow-ups (not in this change):**\n- Both Claude Code bugs (the unwritten subagent output and the Sonnet 5.5 cache-read price) are drafted as feedback; you can review and send them with `/feedback`.\n- A per-model price check against `cost-state`'s own token counts would catch real price drift. It would need a Sonnet 5.5 exception until Claude Code fixes its price.\n\n## Your action\n- Approve the commit, push and PR for `fix/116-cost-state-scope` (Closes #116).";
const approveBold =
  "### Your action items\n- **Review:** look over the README and cards and tell me anything to change.\n- **Approve commit + push + PR:** after that I'll merge, run the update Action and watch it go green, then switch to `main` and run the Claude export once to confirm it pushes.\n- **Delete the old secret:** say yes and I'll remove the now-unused `STATS_TOKEN` secret after merge.";
// A finished turn whose only question sits inside a fenced continuation prompt: 403dea44-fe62-4ff3-9875-cd13098ad02f.jsonl:666 (excerpt).
const fencedQuestion =
  "```\n===== CONTINUATION START =====\nUnresolved (ask with AskUserQuestion before code):\n- director scope values: repo name, `workspace`, `harness`?\n- whether the statusline shows the type\n===== CONTINUATION END =====\n```\n\n## Your action items\n- Type `/rename claude-config-175`, then `/clear`, then paste the block above.";

test('asksUser: a question line outside code fences, or a closing imperative action item', () => {
  assert.equal(asksUser(pauseActions), true, 'a question followed by an action-items list');
  assert.equal(asksUser(pauseCall), true, 'a question as the last line');
  assert.equal(asksUser('Commit it on a chore branch? **'), true, 'trailing markdown after the mark');
  assert.equal(asksUser(finished), false, 'a finished reflect');
  assert.equal(asksUser('Is `a?b` a path; no.'), false, 'a mid-line question mark');
  assert.equal(asksUser(fencedQuestion), false, 'a question inside a ``` fence');
  assert.equal(asksUser(approveAction), true, 'Approve under the final heading');
  assert.equal(asksUser(approveBold), true, 'a bold **Approve …:** item');
  for (const verb of ['Decide', 'Pick', 'Choose', 'Confirm', 'Tell me']) assert.equal(asksUser(`Done.\n\n## Your call\n- ${verb} which one lands.`), true, verb);
  assert.equal(asksUser('Ready.\n\n- Approve the push.'), true, 'a trailing list with no heading');
  // The house closer "Nothing else is needed from you." (1aedc125:1581) does not cancel an ask beside it.
  assert.equal(asksUser('## Your action items\n- Approve the commit, push and PR for `fix/x` (Closes #1).\n- Nothing else is needed from you.'), true, 'ask + Nothing else');
  assert.equal(asksUser('## Your action items\n- None right now.'), false, 'a lone None');
  assert.equal(asksUser('## Your action items\n- Nothing right now. When CI is green, I\'ll ask you to approve the merge.'), false, 'Nothing');
  // 8458d694-…jsonl:120, verbatim.
  assert.equal(asksUser('## Your action items\n- Say "ridden" and I\'ll analyze all four captures together. Or tell me to relaunch if the ride didn\'t cover A-10 ×1, A-15 ×3 and BR-15 ×2.'), true, 'Say');
  assert.equal(asksUser('## Your action items\n- [ ] Approve the push.'), true, 'a checkbox item');
  assert.equal(asksUser('## Your action items\n- Pick up #12 in a fresh session.'), false, 'Pick up is not Pick');
  assert.equal(asksUser('Ready.\n\n- Approve the push.\n'), true, 'no heading, trailing newline');
  assert.equal(asksUser('## Your action items\n- Approve the push.\n\n**Thanks.**'), true, 'a bold-only last line is not a heading');
  assert.equal(asksUser('~~~\nreally?\n~~~\n\nDone.'), false, 'a question inside a ~~~ fence');
  assert.equal(asksUser('## Proposals\n- Decide on X.\n\n## Your action items\n- Run `/clear`.'), false, 'only the final section counts');
  assert.equal(asksUser('## Your action items\n- Delete the remote branch `feat/x`.'), false, 'other imperatives are not asks');
  assert.equal(asksUser(undefined), false, 'no text');
});

test('lastAssistantText: the newest assistant turn, if it ends in text', () => {
  const tx = (...r) => r.map((x) => JSON.stringify(x)).join('\n');
  assert.equal(lastAssistantText(tx(say(9, pauseCall), human(8), say(5, finished))), finished, 'only the newest turn counts');
  assert.equal(lastAssistantText(tx(say(9, pauseCall), thinking(8), call('b', 'git status'))), null, 'the turn went on to a tool call');
  assert.equal(lastAssistantText(tx(say(9, pauseCall), thinking(8), { ...human(7), isMeta: true })), pauseCall, 'thinking and meta records after it do not count');
  assert.equal(lastAssistantText(''), null, 'no assistant turn');
});

test('the Stop payload last_assistant_message is preferred over the transcript scan', () => {
  const tx = () => transcript(...mergeAt('p1', 30), reflectRead('r', 20), human(15, 'land it'), say(10, finished));
  const h1 = tempDir('gate-home-');
  assert.equal(runHook({ transcript_path: tx(), last_assistant_message: approveAction }, h1).code, 0, 'the payload asks: hold');
  const h2 = tempDir('gate-home-');
  const asking = transcript(...mergeAt('p2', 30), reflectRead('r', 20), human(15, 'land it'), say(10, pauseCall));
  assert.equal(runHook({ transcript_path: asking, last_assistant_message: finished }, h2).code, 2, 'the payload is finished: block');
  const h3 = tempDir('gate-home-');
  assert.equal(runHook({ transcript_path: asking }, h3).code, 0, 'absent: the transcript scan decides');
  for (const blank of ['', '  ']) {
    const h = tempDir('gate-home-');
    assert.equal(runHook({ transcript_path: asking, last_assistant_message: blank }, h).code, 0, `blank ${JSON.stringify(blank)}: the transcript scan decides`);
  }
});

test('records with a null content block are skipped, not thrown on', () => {
  const nul = (rec) => ({ ...rec, message: { ...rec.message, content: [null, ...rec.message.content] } });
  const merge = [nul(at(30, call('n1', 'gh pr merge 9 --rebase'))), nul(at(30, result('n1')))];
  const text = [...merge, nul(reflectRead('r', 20)), nul(ask(10, freshQ))].map((r) => JSON.stringify(r)).join('\n');
  assert.equal(newestMerge(text)?.id, 'n1');
  assert.ok(lastReflectAt(text));
  assert.equal(continuationAsked(text, Date.now() - 25 * 60_000), true);
});

test('scenario 3: a later commit-approval pause does not spend the continuation block (#199)', () => {
  // The #140 review's scenario 3 (merge, read, pause, reply, commit-approval pause, landing merge), with each stop's
  // turn-ending text added: the approval pauses are the real approveAction and approveBold tails. Old main gave
  // [2,2,0,0,2,2] (block spent at the first pause), #140 gave [2,0,2,0,2,2] (spent at the approval pause).
  // Expected: no pause spends it; the landing merge gets its reminder, then the block.
  const records = [
    ...mergeAt('s1', 90),
    human(85, 'yes run reflect'),
    reflectRead('r', 84),
    say(83, pauseActions),
    human(80, 'add rule X'),
    say(78, approveAction),
    human(70, 'yes'),
    say(68, approveBold),
    human(65, 'yes'),
    ...mergeAt('s2', 60),
    say(59, 'Landed as PR #201.'),
    say(58, "This merge is reflect's own landing PR."),
  ];
  // Stops: S1 merge, S2 first pause, S3 commit-approval pause, S4 push-approval pause, S5 landing merge, S6 landing PR noted.
  assert.deepEqual(stopCodes(records, [2, 5, 7, 9, 13, 14]), [2, 0, 0, 0, 2, 2]);
});

test('a reflect that finished with no question still gets the continuation block', () => {
  const home = tempDir('gate-home-');
  const transcript_path = transcript(...mergeAt('f1', 30), reflectRead('r', 20), say(19, pauseCall), human(15, 'land 1 and 3'), say(10, finished));
  const r = runHook({ transcript_path }, home);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /continuation\/SKILL\.md/);
});

test('scenario 6: an unreflected wave B after a reflect that finished with the continuation ask gets no continuation block (#199)', () => {
  // The #140 review's scenario 6: wave A merges, reflect runs, the continuation ask is answered Continue, then wave B
  // merges and the user skips reflect. The read came after A's merge (prevAt), but the answered ask closed that reflect,
  // so B is not its landing PR. #140 gave [2,2,0]; old main gave [2,0,0].
  // Ask and answer mirror ~/.claude/projects/C--Users-young-code/4e1e54dd-c768-4d79-963d-aaec663a9c28.jsonl:350-351.
  const nextQ = {
    question: 'Reflect on #175 is done. What next: a fresh session (/exit, run the launch line, paste) or continue here?',
    header: 'Next',
    multiSelect: false,
    options: [
      { label: 'Fresh session (Recommended)', description: 'I print the launch line and a continuation prompt for the next unit.' },
      { label: 'Continue', description: 'Stay in this window.' },
    ],
  };
  const records = [
    ...mergeAt('a1', 300),
    human(295, 'yes'),
    reflectRead('r', 294),
    say(293, pauseCall),
    human(290, 'land 1 and 3'),
    ask(285, { questions: [nextQ] }),
    { ...at(284, result('q285')), toolUseResult: { questions: [nextQ], answers: { [nextQ.question]: 'Continue' }, annotations: {} } },
    human(200, 'start wave B'),
    ...mergeAt('b1', 60),
    say(59, 'Merged PR #12 for wave B.'),
    human(50, 'skip reflect'),
    say(49, 'Skipping reflect for wave B.'),
  ];
  // Stops: S1 wave B merged, S2 after the user skips reflect, S3 a later turn end.
  assert.deepEqual(stopCodes(records, [12, 14, 14]), [2, 0, 0]);
});

test("reflect's landing PR merged after the continuation ask: the reminder fires, the continuation block stays quiet", () => {
  // The real case scenario 6's tightening changes: ~/.claude/projects/C--Users-young-code/945f43a3-03fc-4d62-b94d-f754f4a62c9d.jsonl
  // :283 reflect read, :308 reply, :390-391 one ask holding the landing approval and clear-or-continue (answered Clear),
  // :429 landing merge, :472 the turn-ending text (its closing two lines, verbatim). 9bfff229-2313-48bf-a219-a26b37f8fcb6.jsonl:310-387 has the same shape.
  // The continuation ask was already answered, so asking again is noise. #140 gave [2,2].
  const landQ = { question: 'Land the reflect edits?', header: 'Land edits', multiSelect: false, options: [{ label: 'Commit, push, PR and merge both' }, { label: 'Hold' }] };
  const nextQ = { question: 'After landing: clear or continue?', header: 'Next', multiSelect: false, options: [{ label: 'Clear', description: 'I emit a continuation prompt for the next unit.' }, { label: 'Continue', description: 'Keep working in this window.' }] };
  const records = [
    ...mergeAt('w1', 60),
    reflectRead('r', 50),
    say(49, pauseCall),
    human(48, 'up to you'),
    ask(47, { questions: [landQ, nextQ] }),
    { ...at(46, result('q47')), toolUseResult: { questions: [landQ, nextQ], answers: { [landQ.question]: 'Commit, push, PR and merge both', [nextQ.question]: 'Clear' }, annotations: {} } },
    ...mergeAt('l146', 44),
    say(43, '## Your call\n- Type `/rename dog-eat-dog-11`, then `/clear` and paste the block.'),
  ];
  // Stops: S1 after the landing merge (reminder), S2 the next turn end.
  assert.deepEqual(stopCodes(records, [10, 10]), [2, 0]);
});

test('a previous wave clear-or-continue ask does not satisfy the next wave merge', () => {
  const home = tempDir('gate-home-');
  const transcript_path = transcript(...mergeAt('w1', 70), reflectRead('r', 50), ask(45, clearQ), ...mergeAt('w2', 20));
  assert.equal(runHook({ transcript_path }, home).code, 2, 'the ask predates the newest merge');
});

test('#167 review 2: a merge is read under the tool that ran it', () => {
  const c = 'find . -exec echo {} \\; gh pr merge 5';
  // PowerShell splits at an escaped \;, so the merge runs; in Bash it is find's args.
  assert.equal(isMerge(c, 'PowerShell'), true);
  assert.equal(isMerge(c, 'Bash'), false);
  const tx = (...r) => r.map((x) => JSON.stringify(x)).join('\n');
  assert.equal(lastMerge(tx(call('p', c, 'PowerShell'), result('p'))), 'p');
  assert.equal(lastMerge(tx(call('b', c), result('b'))), null);
});

// ---- background-wait pauses (#206) ----
// Minimal record shapes, trimmed from ~/.claude/projects/C--Users-young-code/: the Agent launch (4e1e54dd-c768-4d79-963d-aaec663a9c28.jsonl
// :176 call, :178 result), a background Bash launch (68e3139e-c87e-4d79-a371-7f52dd768090.jsonl:543-544) and the completion
// task-notification (68e3139e:602 queue-operation enqueue; 4e1e54dd has the same text as an attachment).
const bgAgent = (min, id) => ({
  type: 'assistant',
  timestamp: ago(min),
  message: { content: [{ type: 'tool_use', id, name: 'Agent', input: { description: 'implementer', subagent_type: 'implementer', run_in_background: true } }] },
});
// The launch result carries the call's description too (26ff1fb8-8aa0-4876-8beb-1add1b901f3e.jsonl:231).
const bgAgentLaunched = (min, id, agentId, description = 'implementer') => ({
  type: 'user',
  timestamp: ago(min),
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: `Async agent launched successfully.\nagentId: ${agentId}` }] }] },
  toolUseResult: { isAsync: true, status: 'async_launched', agentId, description },
});
const bgBash = (min, id) => ({
  type: 'assistant',
  timestamp: ago(min),
  message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'gh run watch 1', run_in_background: true } }] },
});
const bgBashLaunched = (min, id, taskId) => ({
  type: 'user',
  timestamp: ago(min),
  message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: false, content: `Command running in background with ID: ${taskId}. Output is being written to: x.output.` }] },
  toolUseResult: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: taskId },
});
const notified = (min, id, taskId, op = 'enqueue') => ({
  type: 'queue-operation',
  operation: op,
  timestamp: ago(min),
  content: `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>completed</status>\n</task-notification>`,
});
const lines = (...r) => r.map((x) => JSON.stringify(x)).join('\n');
// Verbatim turn-ending waits: 68e3139e:456, 68e3139e:678, 4e1e54dd:234.
const waitProbe = "The probe manifest is ready, and its `main.rs` waits for the #14 API. I'll pick up when the implementer reports.";
const waitAction = "The #15 implementer is running and its probe is scaffolded. I'll verify and probe once it reports.\n\n## Your action items\n- Run `/rename strate-15`.";
const waitLand =
  "The land.mjs implementer is still running. You'll get its result when it hands back, and I'll check its gates before anything is committed.\n\n## Your action items\n- Nothing yet. Once the implementer's gates pass, I'll ask for approval to commit and land the land.mjs change and the docs rule-history line.";

test('hasPendingBackground: a launched background Agent or Bash task with no task-notification is pending', () => {
  assert.equal(hasPendingBackground(lines(bgAgent(9, 'a1'), bgAgentLaunched(9, 'a1', 'ag1'))), true, 'agent launched');
  assert.equal(hasPendingBackground(lines(bgBash(9, 'b1'), bgBashLaunched(9, 'b1', 'bt1'))), true, 'bash launched');
  assert.equal(hasPendingBackground(lines(bgBash(9, 'b1'))), false, 'a call with no launch result is not yet a launch');
  assert.equal(hasPendingBackground(lines(call('b2', 'ls'), result('b2'))), false, 'a foreground call');
  assert.equal(hasPendingBackground(''), false, 'no records');
});

test('hasPendingBackground: a completed background agent or task is not pending (enqueue or remove record)', () => {
  assert.equal(hasPendingBackground(lines(bgAgent(9, 'a1'), bgAgentLaunched(9, 'a1', 'ag1'), notified(5, 'a1', 'ag1'))), false);
  assert.equal(hasPendingBackground(lines(bgBash(9, 'b1'), bgBashLaunched(9, 'b1', 'bt1'), notified(5, 'b1', 'bt1', 'remove'))), false);
  assert.equal(hasPendingBackground(lines(bgAgent(9, 'a1'), bgAgentLaunched(9, 'a1', 'ag1'), notified(5, 'a1', 'ag1'), bgAgent(4, 'a2'), bgAgentLaunched(4, 'a2', 'ag2'))), true, 'a second launch is still pending');
  assert.equal(hasPendingBackground(lines(bgAgent(9, 'a1'), bgAgentLaunched(9, 'a1', 'ag1'), notified(5, 'other', 'ag9'))), true, 'another task finishing does not count');
});

test('a background-wait turn end after reflect does not spend the continuation block (#206)', () => {
  const base = [...mergeAt('w1', 60), reflectRead('r', 50), say(49, pauseCall), human(48, 'go ahead')];
  for (const [name, wait] of [['68e3139e:456', waitProbe], ['68e3139e:678', waitAction], ['4e1e54dd:234', waitLand]]) {
    const records = [...base, bgAgent(46, 'a1'), bgAgentLaunched(46, 'a1', 'ag1'), say(40, wait)];
    assert.deepEqual(stopCodes(records, [records.length]), [0], name);
  }
});

test('a finished reflect or a turn end after the background agent completed still gets the block (#206)', () => {
  const base = [...mergeAt('w1', 60), reflectRead('r', 50), say(49, pauseCall), human(48, 'go ahead')];
  const done = [...base, bgAgent(46, 'a1'), bgAgentLaunched(46, 'a1', 'ag1'), notified(44, 'a1', 'ag1'), say(40, finished)];
  assert.deepEqual(stopCodes(done, [done.length]), [2], 'agent completed');
  const none = [...base, say(40, finished)];
  assert.deepEqual(stopCodes(none, [none.length]), [2], 'no background work');
});

// TaskStop call and result, 369ac623-8116-4f35-ba19-602cb32de9bc.jsonl:584-585.
const taskStop = (min, id, taskId) => ({
  type: 'assistant',
  timestamp: ago(min),
  message: { content: [{ type: 'tool_use', id, name: 'TaskStop', input: { task_id: taskId } }] },
});
const taskStopped = (min, id, taskId, is_error = false) => ({
  type: 'user',
  timestamp: ago(min),
  message: { content: [{ type: 'tool_result', tool_use_id: id, is_error, content: JSON.stringify({ message: `Successfully stopped task: ${taskId} (x)`, task_id: taskId, task_type: 'local_bash' }) }] },
  toolUseResult: { message: `Successfully stopped task: ${taskId} (x)`, task_id: taskId, task_type: 'local_bash' },
});
// The later SendMessage result for a user-stopped agent, 48ca871b-3656-4626-9fb8-820a9327aa96.jsonl:196.
const agentStoppedByUser = (min, id, agentId) => ({
  type: 'user',
  timestamp: ago(min),
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: JSON.stringify({ success: false, message: `Agent ${agentId} was stopped by the user and won't be resumed.` }) }] }] },
  toolUseResult: { success: false, message: `Agent ${agentId} was stopped by the user and won't be resumed.` },
});

test('#206 review: a stopped task resolves its launch (TaskStop by backgroundTaskId or agentId, or a user-stopped agent)', () => {
  const bash = [bgBash(9, 'b1'), bgBashLaunched(9, 'b1', 'bt1')];
  const agent = [bgAgent(9, 'a1'), bgAgentLaunched(9, 'a1', 'ag1')];
  assert.equal(hasPendingBackground(lines(...bash, taskStop(5, 's1', 'bt1'), taskStopped(5, 's1', 'bt1'))), false, 'TaskStop of a Bash task');
  assert.equal(hasPendingBackground(lines(...agent, taskStop(5, 's1', 'ag1'), taskStopped(5, 's1', 'ag1'))), false, 'TaskStop of an agent');
  assert.equal(hasPendingBackground(lines(...bash, taskStop(5, 's1', 'bt1'), taskStopped(5, 's1', 'bt1', true))), true, 'a failed TaskStop stops nothing');
  assert.equal(hasPendingBackground(lines(...bash, taskStop(5, 's1', 'other'), taskStopped(5, 's1', 'other'))), true, 'another task stopped');
  assert.equal(hasPendingBackground(lines(...agent, agentStoppedByUser(5, 'm1', 'ag1'))), false, 'agent stopped by the user');
  assert.equal(hasPendingBackground(lines(...agent, agentStoppedByUser(5, 'm1', 'ag9'))), true, 'another agent stopped by the user');
});

test('#206 review: run_in_background arrives as the string "true" too (48ca871b:153)', () => {
  const call = { ...bgBash(9, 'b1') };
  call.message = { content: [{ ...call.message.content[0], input: { command: 'x', run_in_background: 'true' } }] };
  assert.equal(hasPendingBackground(lines(call, bgBashLaunched(9, 'b1', 'bt1'))), true);
});

test('#206 review: only launches after the cutoff count', () => {
  const text = lines(bgAgent(90, 'a1'), bgAgentLaunched(90, 'a1', 'ag1'));
  assert.equal(hasPendingBackground(text, Date.now() - 60 * 60_000), false, 'launched before the cutoff');
  assert.equal(hasPendingBackground(text, Date.now() - 100 * 60_000), true, 'launched after the cutoff');
});

test('#206 review: a dev server launched long before the merge does not suppress the block (369ac623:489, merge :1127, stops :1164/:1173)', () => {
  // The Tauri dev server (:488-489) ran from before the merge to the end of the session; main blocked at the end.
  const records = [bgBash(90, 'b1'), bgBashLaunched(90, 'b1', 'bt1'), ...mergeAt('w1', 60), reflectRead('r', 50), say(49, pauseCall), human(48, 'go ahead'), say(40, finished)];
  assert.deepEqual(stopCodes(records, [records.length]), [2]);
});

// ---- SendMessage resumes (#227), trimmed from ~/.claude/projects/C--Users-young-code/ ----
// With agent teams off (#272) a named spawn is a plain subagent: a background one launches async_launched and reports
// by task-notification or hand-back, and a SendMessage by name resumes it (teams-off probe 654fabeb, 2026-10-16).
// A background agent's hand-back, 369ac623-8116-4f35-ba19-602cb32de9bc.jsonl:957.
const handBack = (min, agentId) => ({
  type: 'user',
  timestamp: ago(min),
  message: { role: 'user', content: `Another Claude session sent a message:\n<agent-message from="${agentId}">\n[Subagent hand-back] The report follows:\n  RESULT: done.\n</agent-message>` },
});
// SendMessage call and result shapes: a resumed background agent (369ac623:960/:961; the teams-off probe's
// 654fabeb result has the same keys), a message queued for a running agent
// (48ca871b-3656-4626-9fb8-820a9327aa96.jsonl:349) and a cross-session peer (2fb2ab05:51).
const send = (min, id, to) => ({
  type: 'assistant',
  timestamp: ago(min),
  message: { content: [{ type: 'tool_use', id, name: 'SendMessage', input: { to, summary: 'Fix round', message: 'Fix round: see the review.' } }] },
});
const sent = (min, id, toolUseResult) => ({
  type: 'user',
  timestamp: ago(min),
  message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: [{ type: 'text', text: JSON.stringify(toolUseResult) }] }] },
  toolUseResult,
});
const resumed = (to) => ({ success: true, message: `Resuming agent ${to.slice(0, 7)}`, resumedAgentId: to, pin: { id: to, name: to, ref: '0e901b' } });
const queued = (to) => ({ success: true, message: `Message queued for delivery to ${to} at its next tool round.`, pin: { id: to, name: to, ref: 'b6791c' } });
const peer = { success: true, message: '"Ack review" → uds:\\\\.\\pipe\\LOCAL\\cc-msg-0cd7; in that session\'s inbox, not yet read by its Claude', msg_id: 'm2', display: 'Ack review' };
// The harness's own record of a user-stopped background agent names only its description, as a queued_command
// attachment with commandMode task-notification (48ca871b:176). Its queue-operation enqueue (48ca871b:165) can also hold
// user-typed text, so the 'enqueue' form here is that typed paste, which resolves nothing.
// Stopping several at once names them all in one record (71d9f934-085d-472e-be01-3dc63da72917.jsonl:6/:23/:24).
const userStop = (min, text, form) => {
  if (form === 'attachment') return { type: 'attachment', timestamp: ago(min), attachment: { type: 'queued_command', prompt: text, commandMode: 'task-notification', timestamp: ago(min) } };
  return { type: 'queue-operation', operation: form, timestamp: ago(min), content: text };
};
const stoppedByDescription = (min, description, form) => userStop(min, `Background agent "${description}" was stopped by the user.`, form);
const stoppedMany = (min, descriptions, form) =>
  userStop(min, `${descriptions.length} background agents were stopped by the user: ${descriptions.map((d) => `"${d}"`).join(', ')}.`, form);
// A verbatim turn-ending wait on a warm redo (369ac623:973).
const waitRedo = "That completion notice is from the agent's first pass, which I've already read. The warm redo is running now, and I'll verify its result when it reports.\n\n### Your action items\n- None right now.";
const agentRun = (min, id, agentId, description) => [bgAgent(min, id), bgAgentLaunched(min, id, agentId, description)];

test('#227 round 1: a SendMessage also waits on the resumed or pinned agent id, whatever name it was sent to', () => {
  const agent = [bgAgent(30, 'a1'), bgAgentLaunched(30, 'a1', 'ag1'), notified(20, 'a1', 'ag1')];
  const byName = [...agent, send(19, 's1', 'bg-1'), sent(19, 's1', { ...resumed('ag1') })];
  assert.equal(hasPendingBackground(lines(...byName)), true, 'resumed');
  assert.equal(hasPendingBackground(lines(...byName, notified(5, 'a1', 'ag1'))), false, 'resumedAgentId notified after the resume');
  const pinned = [bgAgent(30, 'a1'), bgAgentLaunched(30, 'a1', 'ag1'), send(19, 's1', 'bg-1'), sent(19, 's1', queued('ag1'))];
  assert.equal(hasPendingBackground(lines(...pinned, handBack(5, 'ag1'))), false, 'pin.id handed back after the send');
});

test('#227 round 1: only non-empty string ids key a wait, so an empty id does not hide the one the result text names', () => {
  const launched = { ...bgBashLaunched(9, 'b1', 'bt1'), toolUseResult: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: '' } };
  assert.equal(hasPendingBackground(lines(bgBash(9, 'b1'), launched)), true, 'launched');
  assert.equal(hasPendingBackground(lines(bgBash(9, 'b1'), launched, taskStop(5, 's1', 'bt1'), taskStopped(5, 's1', 'bt1'))), false, 'TaskStop of the named id');
  const odd = { ...bgAgentLaunched(9, 'a1', 'ag1'), toolUseResult: { status: 'async_launched', agentId: 42, description: 'implementer' } };
  assert.equal(hasPendingBackground(lines(bgAgent(9, 'a1'), odd, notified(5, 'a1', 'x'))), false, 'a numeric agentId is ignored, the tool-use id still resolves');
});

test('#227: a SendMessage resume of a background agent is pending until a notification or hand-back after it (369ac623:937-973)', () => {
  // The first pass completes (:956), the director resumes it (:960-961), then the harness dequeues the old notification
  // after the resume (:962 remove) and re-records it under its first timestamp (:963 attachment).
  const redo = [bgAgent(30, 'a1'), bgAgentLaunched(30, 'a1', 'ag1'), notified(20, 'a1', 'ag1'), send(19, 's1', 'ag1'), sent(19, 's1', resumed('ag1'))];
  const stale = [notified(18.9, 'a1', 'ag1', 'remove'), { ...notified(20, 'a1', 'ag1'), type: 'attachment', operation: undefined }];
  assert.equal(hasPendingBackground(lines(...redo, ...stale)), true, 'the first pass notice does not resolve the redo');
  assert.equal(hasPendingBackground(lines(...redo, ...stale, notified(5, 'a1', 'ag1'))), false, 'notified after the resume');
  assert.equal(hasPendingBackground(lines(...redo, ...stale, handBack(5, 'ag1'))), false, 'handed back after the resume');
  assert.equal(hasPendingBackground(lines(...redo, ...stale, handBack(5, 'ag9'))), true, "another agent's hand-back");
  const running = [bgAgent(30, 'a1'), bgAgentLaunched(30, 'a1', 'ag1'), send(19, 's1', 'ag1'), sent(19, 's1', queued('ag1'))];
  assert.equal(hasPendingBackground(lines(...running)), true, 'a message queued for a running agent');
  assert.equal(hasPendingBackground(lines(...running, notified(5, 'a1', 'ag1'))), false, 'which then completes');
});

test('#227: a cross-session peer message or a refused SendMessage is no wait', () => {
  assert.equal(hasPendingBackground(lines(send(9, 's1', 'strate-30'), sent(9, 's1', peer))), false, 'peer');
  assert.equal(hasPendingBackground(lines(send(9, 's1', 'ag1'), agentStoppedByUser(9, 's1', 'ag1'))), false, 'stopped agent refuses the resume');
  const failed = { ...sent(9, 's1', resumed('ag1')), message: { content: [{ type: 'tool_result', tool_use_id: 's1', is_error: true, content: 'x' }] } };
  assert.equal(hasPendingBackground(lines(send(9, 's1', 'ag1'), failed)), false, 'an error result');
});

test('#227: only launches and SendMessages after the cutoff count', () => {
  const text = lines(...agentRun(90, 'a1', 'ag1'));
  assert.equal(hasPendingBackground(text, Date.now() - 60 * 60_000), false, 'launched before the cutoff');
  assert.equal(hasPendingBackground(text, Date.now() - 100 * 60_000), true, 'launched after the cutoff');
  const resent = lines(...agentRun(90, 'a1', 'ag1'), notified(80, 'a1', 'ag1'), send(30, 's1', 'ag1'), sent(30, 's1', resumed('ag1')));
  assert.equal(hasPendingBackground(resent, Date.now() - 60 * 60_000), true, 'resumed after the cutoff');
});

test('#227 comment: a user-stopped background agent resolves by its launch description (48ca871b:165/:175/:176, 26ff1fb8:231)', () => {
  const agent = [bgAgent(9, 'a1'), bgAgentLaunched(9, 'a1', 'ag1', 'Implement strate#17 app shell')];
  assert.equal(hasPendingBackground(lines(...agent, stoppedByDescription(5, 'Implement strate#17 app shell', 'attachment'))), false);
  assert.equal(hasPendingBackground(lines(...agent, stoppedByDescription(5, 'Implement strate#18 canvas', 'attachment'))), true, 'another description');
  const quoted = [bgAgent(9, 'a1'), bgAgentLaunched(9, 'a1', 'ag1', 'Fix "quoted" \\ names')];
  assert.equal(hasPendingBackground(lines(...quoted, stoppedByDescription(5, 'Fix "quoted" \\ names', 'attachment'))), false, 'quotes and backslashes');
});

test('#227: a running or warm-redo agent after reflect does not spend the continuation block; the turn end after it reports does', () => {
  const base = [...mergeAt('w1', 60), reflectRead('r', 50), say(49, pauseCall), human(48, 'go ahead')];
  const running = [...base, ...agentRun(46, 'a2', 'ag2', 'Review #206 diff')];
  assert.deepEqual(stopCodes([...running, say(40, waitProbe)], [running.length + 1]), [0], 'agent running');
  const back = [...running, notified(42, 'a2', 'ag2'), say(40, finished)];
  assert.deepEqual(stopCodes(back, [back.length]), [2], 'agent reported');
  const redo = [...base, bgAgent(46, 'a1'), bgAgentLaunched(46, 'a1', 'ag1'), notified(44, 'a1', 'ag1'), send(43, 's1', 'ag1'), sent(43, 's1', resumed('ag1')), say(42, waitRedo)];
  assert.deepEqual(stopCodes(redo, [redo.length]), [0], 'warm redo running (369ac623:973)');
});

// ---- description stops and process exits (#243) ----
test('#243: a description stop resolves only a launch made at or before it', () => {
  const agent = (min) => agentRun(min, 'a1', 'ag1', 'Review #243 diff');
  assert.equal(hasPendingBackground(lines(stoppedByDescription(9, 'Review #243 diff', 'attachment'), ...agent(5))), true, 'an earlier agent with the same description');
  assert.equal(hasPendingBackground(lines(...agent(9), stoppedByDescription(5, 'Review #243 diff', 'attachment'))), false, 'stopped after the launch');
});

test('#243: a user-typed queue-operation enqueue of the stop text does not resolve; the real attachment does', () => {
  const agent = [bgAgent(9, 'a1'), bgAgentLaunched(9, 'a1', 'ag1', 'Review #243 diff')];
  assert.equal(hasPendingBackground(lines(...agent, stoppedByDescription(5, 'Review #243 diff', 'enqueue'))), true, 'typed enqueue');
  assert.equal(hasPendingBackground(lines(...agent, stoppedByDescription(5, 'Review #243 diff', 'attachment'))), false, 'attachment');
  assert.equal(hasPendingBackground(lines(...agent, stoppedMany(5, ['Review #243 diff'], 'enqueue'))), true, 'typed multi-stop enqueue');
});

test('#243: stop text quoted in a brief, a message or a tool result does not resolve a description key', () => {
  const quote = 'Background agent "Implement strate#17 app shell" was stopped by the user.';
  const agent = [bgAgent(9, 'a1'), bgAgentLaunched(9, 'a1', 'ag1', 'Implement strate#17 app shell')];
  const quoted = [
    ['typed brief', human(5, `Prior context: the log reads ${quote}`)],
    ['agent message', { type: 'user', timestamp: ago(5), message: { role: 'user', content: `<agent-message from="review-1">\nFinding: ${quote}\n</agent-message>` } }],
    ['tool result', { type: 'user', timestamp: ago(5), message: { content: [{ type: 'tool_result', tool_use_id: 'g1', content: `48ca871b:165 ${quote}` }] } }],
    ['SendMessage call', { ...send(5, 's1', 'review-1'), message: { content: [{ type: 'tool_use', id: 's1', name: 'SendMessage', input: { to: 'review-1', message: quote } }] } }],
  ];
  for (const [name, rec] of quoted) assert.equal(hasPendingBackground(lines(...agent, rec)), true, name);
});

test('#243: the harness record of several user stops resolves every description it names (71d9f934:6/:24)', () => {
  const units = [...agentRun(9, 'a1', 'ag1', 'Implement #199 reflect later pause'), ...agentRun(9, 'a2', 'ag2', 'Fix #190 review findings')];
  assert.equal(hasPendingBackground(lines(...units, stoppedMany(5, ['Implement #199 reflect later pause', 'Fix #190 review findings'], 'attachment'))), false);
  assert.equal(hasPendingBackground(lines(...units, stoppedMany(5, ['Implement #199 reflect later pause', 'Review #171 diff'], 'attachment'))), true, 'one agent not named');
});

// Claude Code writes an untimed cost-state record at exit or /clear (79e0cf9f-58cd-4c54-8e0a-1b17daefbd5d.jsonl:730); a
// /clear opens a new transcript, so in the one the gate reads it marks an exit, which kills its tasks.
// A resumed or forked process starts with a SessionStart hook record (79e0cf9f:734 resume;
// dd0f76cc-fb28-44b2-aab7-3a1427bcc1ce.jsonl:142 fork, whose copied history holds no cost-state).
const exited = { type: 'cost-state', sessionId: 's1', totalCostUSD: 15.37, totalDuration: 2953144 };
const sessionStart = (min, source) => ({
  type: 'attachment',
  timestamp: ago(min),
  attachment: { type: 'hook_success', hookName: `SessionStart:${source}`, hookEvent: 'SessionStart', content: 'Skills: Read the path.', exitCode: 0 },
});

test('#243: a process exit, or a resumed or forked start, ends every wait from before it', () => {
  const unit = agentRun(9, 'a1', 'ag1');
  assert.equal(hasPendingBackground(lines(...unit, exited)), false, 'exit');
  assert.equal(hasPendingBackground(lines(...unit, sessionStart(5, 'resume'))), false, 'resume with no exit record');
  assert.equal(hasPendingBackground(lines(...unit, sessionStart(5, 'fork'))), false, 'fork');
  assert.equal(hasPendingBackground(lines(...unit, sessionStart(5, 'compact'))), true, 'a compaction keeps the process');
  const resent = [...unit, notified(8, 'a1', 'ag1'), send(7, 's1', 'ag1'), sent(7, 's1', resumed('ag1'))];
  assert.equal(hasPendingBackground(lines(...resent, exited)), false, 'a SendMessage wait');
  assert.equal(hasPendingBackground(lines(...unit, exited, sessionStart(5, 'resume'), ...agentRun(4, 'a2', 'ag2'))), true, 'a launch after the resume');
  const quoted = { type: 'user', timestamp: ago(5), message: { content: [{ type: 'tool_result', tool_use_id: 'g1', content: '{"type":"cost-state"} SessionStart:resume' }] } };
  assert.equal(hasPendingBackground(lines(...unit, quoted)), true, 'the record names quoted in a tool result');
});

test('#243: an agent dropped by a session exit does not suppress the continuation block for the rest of the session', () => {
  const base = [...mergeAt('w1', 60), reflectRead('r', 50), say(49, pauseCall), human(48, 'go ahead')];
  const waiting = [...base, ...agentRun(46, 'a1', 'ag1', 'Review #206 diff'), say(45, waitProbe)];
  const afterResume = [...waiting, exited, sessionStart(30, 'resume'), human(29, 'where were we?'), say(28, finished)];
  assert.deepEqual(stopCodes(afterResume, [waiting.length, afterResume.length]), [0, 2]);
});

test('#249: a command the guard blocks unread is no merge, and the merges around it still count', () => {
  const unread = "C=echo env -S '${C} x'";
  assert.equal(isMerge(unread), false);
  const tx = (...r) => r.map((x) => JSON.stringify(x)).join('\n');
  assert.equal(lastMerge(tx(call('a', 'gh pr merge 2'), result('a'), call('u', unread), result('u'))), 'a');
});
