// node --test scripts/test/stop-reflect-gate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execHarness } from './_spawn.mjs';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { awaitingUser, continuationAsked, humanRepliedAfter, lastMerge, lastReflectAt } from '../../hooks/stop-reflect-gate.mjs';

const hook = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks', 'stop-reflect-gate.mjs');

const call = (id, command, name = 'Bash') => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: { command } }] } });
const result = (id, is_error = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error, content: 'x' }] } });

/** A transcript file holding `records`, one JSON object per line. */
function transcript(...records) {
  const p = join(mkdtempSync(join(tmpdir(), 'gate-tx-')), 't.jsonl');
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
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
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
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
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
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
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

test('parallel sessions each get their own reminder once, with no ping-pong', () => {
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
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
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
  const transcript_path = transcript(...mergeAt('c1', 30), reflectRead('r', 10), human(8));
  const first = runHook({ transcript_path }, home);
  assert.equal(first.code, 2);
  assert.match(first.stderr, /continuation\/SKILL\.md/);
  assert.match(first.stderr, /fresh-session-or-continue/);
  assert.doesNotMatch(first.stderr, /clear-or-continue|\/clear/);
  assert.equal(runHook({ transcript_path }, home).code, 0, 'one block per merge');
});

test('mid-reflect dialogue pause (no human reply since the read): passes without spending the one block', () => {
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
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
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
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
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
  const transcript_path = transcript(...mergeAt('a1', 30), reflectRead('r', 20), ask(15, unrelated), answerRes(14, 'q15'));
  const r = runHook({ transcript_path }, home);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /continuation\/SKILL\.md/);
});

test('a user-typed /reflect after the merge opens the continuation gate once the user replies', () => {
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
  const transcript_path = transcript(...mergeAt('c2b', 30), human(10, '<command-message>reflect</command-message>\n<command-name>/reflect</command-name>'), human(6, 'looks good'));
  const r = runHook({ transcript_path }, home);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /continuation/);
});

test('a fresh-session-or-continue ask after reflect satisfies the gate (old clear wording too)', () => {
  for (const input of [freshQ, clearQ, optionsOnly]) {
    const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
    const transcript_path = transcript(...mergeAt('c3', 30), reflectRead('r', 10), human(8), ask(2, input));
    assert.equal(runHook({ transcript_path }, home).code, 0);
  }
});

test('an unrelated ask, a reflect debt ask, or a clear-or-continue ask before the reflect read, still blocks', () => {
  const h1 = mkdtempSync(join(tmpdir(), 'gate-home-'));
  assert.equal(runHook({ transcript_path: transcript(...mergeAt('c4', 30), reflectRead('r', 10), human(8), ask(2, unrelated)) }, h1).code, 2);
  const h3 = mkdtempSync(join(tmpdir(), 'gate-home-'));
  assert.equal(runHook({ transcript_path: transcript(...mergeAt('c4b', 30), reflectRead('r', 10), human(8), ask(2, debtQ)) }, h3).code, 2, 'the #178 debt ask');
  const h2 = mkdtempSync(join(tmpdir(), 'gate-home-'));
  assert.equal(runHook({ transcript_path: transcript(...mergeAt('c5', 30), ask(20, clearQ), reflectRead('r', 10), human(8)) }, h2).code, 2);
});

test('no reflect read: only the reflect reminder applies, and the continuation gate stays quiet after it', () => {
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
  const transcript_path = transcript(...mergeAt('c6', 30));
  const first = runHook({ transcript_path }, home);
  assert.equal(first.code, 2);
  assert.match(first.stderr, /reflect now/);
  assert.equal(runHook({ transcript_path }, home).code, 0);
});

test('old state files without cont still work, and cont keeps the reminder ids', () => {
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
  const transcript_path = transcript(...mergeAt('c7', 30), reflectRead('r', 10), human(8));
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'stop-reflect-gate.json'), JSON.stringify({ ids: ['c7'] }));
  assert.equal(runHook({ transcript_path }, home).code, 2, 'reminder already handled, continuation gate fires');
  const state = JSON.parse(readFileSync(join(home, '.claude', 'stop-reflect-gate.json'), 'utf8'));
  assert.deepEqual(state, { ids: ['c7'], cont: ['c7'] });
});

test('stop_hook_active passes even when the second-gate conditions are met', () => {
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
  const transcript_path = transcript(...mergeAt('c1b', 30), reflectRead('r', 10), human(8));
  assert.equal(runHook({ transcript_path, stop_hook_active: true }, home).code, 0);
  assert.equal(runHook({ transcript_path }, home).code, 2, 'the passed retry recorded nothing');
});

// ---- later typed pauses partway through reflect (#199) ----
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

test('awaitingUser: the last assistant turn ends in text holding a question', () => {
  const tx = (...r) => r.map((x) => JSON.stringify(x)).join('\n');
  assert.equal(awaitingUser(tx(say(5, pauseActions))), true, 'a question followed by an action-items list');
  assert.equal(awaitingUser(tx(say(5, pauseCall))), true, 'a question as the last line');
  assert.equal(awaitingUser(tx(say(5, 'Commit it on a chore branch? **'))), true, 'trailing markdown after the mark');
  assert.equal(awaitingUser(tx(say(5, finished))), false, 'a finished reflect');
  assert.equal(awaitingUser(tx(say(9, pauseCall), human(8), say(5, finished))), false, 'only the newest turn counts');
  assert.equal(awaitingUser(tx(say(9, pauseCall), thinking(8), call('b', 'git status'))), false, 'the turn went on to a tool call');
  assert.equal(awaitingUser(tx(say(9, pauseCall), thinking(8), { ...human(7), isMeta: true })), true, 'thinking and meta records after it do not count');
  assert.equal(awaitingUser(tx(say(5, 'Is `a?b` a path; no.'))), false, 'a mid-line question mark');
  assert.equal(awaitingUser(''), false, 'no assistant turn');
});

test('scenario 3: a later commit-approval pause does not spend the continuation block (#199)', () => {
  // The #140 review's scenario 3 (merge, read, pause, reply, commit-approval pause, landing merge), with each stop's
  // turn-ending text added. Old main gave [2,2,0,0,2,2] (block spent at the first pause), #140 gave [2,0,2,0,2,2]
  // (spent at the approval pause). Expected: neither pause spends it; the landing merge gets its reminder, then the block.
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
  const records = [
    ...mergeAt('s1', 90),
    human(85, 'yes run reflect'),
    reflectRead('r', 84),
    say(83, pauseActions),
    human(80, 'add rule X'),
    say(78, 'Added the rule to `skills/reflect/SKILL.md`.\n\nCommit it as `docs(reflect): add rule X` on a chore branch?'),
    human(70, 'approved'),
    say(68, 'Committed as abc1234 on `chore/reflect-rule-x`.\n\nPush it and open the landing PR?'),
    human(65, 'yes'),
    ...mergeAt('s2', 60),
    say(59, 'Landed as PR #201.'),
    say(58, "This merge is reflect's own landing PR."),
  ];
  const p = join(mkdtempSync(join(tmpdir(), 'gate-tx-')), 't.jsonl');
  const stopAt = (n) => {
    writeFileSync(p, `${records.slice(0, n).map((r) => JSON.stringify(r)).join('\n')}\n`);
    return runHook({ transcript_path: p }, home).code;
  };
  // Stops: S1 merge, S2 first pause, S3 commit-approval pause, S4 push-approval pause, S5 landing merge, S6 landing PR noted.
  assert.deepEqual([2, 5, 7, 9, 13, 14].map(stopAt), [2, 0, 0, 0, 2, 2]);
});

test('a reflect that finished with no question still gets the continuation block', () => {
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
  const transcript_path = transcript(...mergeAt('f1', 30), reflectRead('r', 20), say(19, pauseCall), human(15, 'land 1 and 3'), say(10, finished));
  const r = runHook({ transcript_path }, home);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /continuation\/SKILL\.md/);
});

test('a previous wave clear-or-continue ask does not satisfy the next wave merge', () => {
  const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
  const transcript_path = transcript(...mergeAt('w1', 70), reflectRead('r', 50), ask(45, clearQ), ...mergeAt('w2', 20));
  assert.equal(runHook({ transcript_path }, home).code, 2, 'the ask predates the newest merge');
});
