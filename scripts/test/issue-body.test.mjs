// node --test scripts/test/issue-body.test.mjs
// claude-config#388: bash-guard blocks a `gh issue edit --body/--body-file` that drops or
// rewords a line of the issue's live body. Never touches the network: deps.liveBody is injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnHarness, tempDir } from './_spawn.mjs';
import * as guard from '../../hooks/bash-guard.mjs';
import { bodyChange, issueBodyStateFile, literal } from '../../hooks/issue-body.mjs';

const LIVE = ['## Goal', 'Ship the guard.', '', '## Done when', '- [ ] first box', '- [ ] second box', '', '## Out of scope', 'Nothing else.'].join('\n');

// ---- the comparator -----------------------------------------------------------------

const change = (live, next) => bodyChange(live, next);

test('comparator: an identical body is no change', () => {
  assert.equal(change(LIVE, LIVE), null);
});

test('comparator: a reworded line is reported as the first live line lost', () => {
  const next = LIVE.replace('Ship the guard.', 'Ship the new guard.');
  assert.equal(change(LIVE, next).line, 'Ship the guard.');
});

test('comparator: a dropped line is reported', () => {
  const next = LIVE.replace('- [ ] second box\n', '');
  assert.equal(change(LIVE, next).line, '- [ ] second box');
});

test('comparator: the first of several lost lines is the one reported', () => {
  const next = LIVE.replace('Ship the guard.\n', '').replace('Nothing else.', 'Something else.');
  assert.equal(change(LIVE, next).line, 'Ship the guard.');
});

test('comparator: ticking a box passes, upper or lower case x', () => {
  assert.equal(change(LIVE, LIVE.replace('- [ ] first box', '- [x] first box')), null);
  assert.equal(change(LIVE, LIVE.replace('- [ ] second box', '- [X] second box')), null);
  assert.equal(change(LIVE, LIVE.replace(/- \[ \]/g, '- [x]')), null);
});

test('comparator: ticking with other bullets and indentation passes', () => {
  const live = '* [ ] star\n  - [ ] nested\n+ [ ] plus';
  assert.equal(change(live, '* [x] star\n  - [x] nested\n+ [x] plus'), null);
});

test('comparator: un-ticking a ticked box is a reword', () => {
  const live = '- [x] done already';
  assert.equal(change(live, '- [ ] done already').line, '- [x] done already');
});

test('comparator: ticking while rewording the text still blocks', () => {
  assert.equal(change(LIVE, LIVE.replace('- [ ] first box', '- [x] first box changed')).line, '- [ ] first box');
});

test('comparator: lines added in the middle and at the end pass', () => {
  assert.equal(change(LIVE, LIVE.replace('Ship the guard.', 'Ship the guard.\nAn extra sentence.')), null);
  assert.equal(change(LIVE, `${LIVE}\n\n## Addendum\nMore.`), null);
  assert.equal(change(LIVE, `Preamble line\n${LIVE}`), null);
});

test('comparator: blank-line changes and trailing whitespace are not rewording', () => {
  assert.equal(change(LIVE, LIVE.replace(/\n\n/g, '\n')), null);
  assert.equal(change(LIVE, `${LIVE.replace('Ship the guard.', 'Ship the guard.   ')}\n\n\n`), null);
});

test('comparator: CRLF in either body is normalised', () => {
  assert.equal(change(LIVE.replace(/\n/g, '\r\n'), LIVE), null);
  assert.equal(change(LIVE, LIVE.replace(/\n/g, '\r\n').replace('- [ ] first box', '- [x] first box')), null);
});

test('comparator: reordering is a reword', () => {
  const next = ['## Goal', '## Done when', 'Ship the guard.'].join('\n');
  assert.ok(change('## Goal\nShip the guard.\n## Done when', next));
});

test('comparator: re-indenting a line is a reword', () => {
  assert.equal(change('- item', '  - item').line, '- item');
});

test('comparator: an empty live body accepts any new body', () => {
  assert.equal(change('', 'anything\nat all'), null);
});

// ---- the rule: fixtures ----------------------------------------------------------------

const liveSync = (body) => () => body;

function tmp() {
  const dir = tempDir('ib-');
  return { dir, state: join(dir, 'issue-body.json') };
}

/** Run the guard rule on `cmd` with the live body `body` and no approval anywhere. */
function reason(cmd, body, { transcript = join(tmp().dir, 'none.jsonl'), state, cwd, deps } = {}) {
  const t = tmp();
  return guard.issueBodyReason(cmd, cwd ?? t.dir, transcript, state ?? t.state, undefined, null, { liveBody: liveSync(body), ...deps });
}

const asst = { type: 'assistant', uuid: 'as-0', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } };
let seq = 0;
const typedRec = (content, extra = {}) => ({
  type: 'user',
  uuid: `p-${++seq}`,
  timestamp: new Date().toISOString(),
  promptSource: 'typed',
  origin: { kind: 'human' },
  isMeta: false,
  isSidechain: false,
  message: { role: 'user', content },
  ...extra,
});
const answerRec = (answers) => ({ type: 'user', uuid: `a-${++seq}`, timestamp: new Date().toISOString(), toolUseResult: { questions: [], answers } });

/** A transcript holding `records` (oldest first) after an assistant turn. */
function transcriptOf(dir, ...records) {
  const path = join(dir, `t-${++seq}.jsonl`);
  writeFileSync(path, [asst, ...records].map((r) => `${JSON.stringify(r)}\n`).join(''));
  return path;
}

const ONE = 'Goal: ship it';
const REWORD = 'Goal: ship it differently';

// ---- body flag detection -----------------------------------------------------------------

test('each body flag spelling is detected: a rewording blocks', () => {
  const t = tmp();
  const file = join(t.dir, 'body.md');
  writeFileSync(file, REWORD);
  for (const cmd of [
    `gh issue edit 12 --body "${REWORD}"`,
    `gh issue edit 12 --body="${REWORD}"`,
    `gh issue edit 12 -b "${REWORD}"`,
    `gh issue edit 12 --body-file ${file}`,
    `gh issue edit 12 --body-file=${file}`,
    `gh issue edit 12 -F ${file}`,
  ]) {
    assert.ok(reason(cmd, ONE, { cwd: t.dir }), cmd);
  }
});

test('each body flag spelling passes when the body only ticks a box', () => {
  const t = tmp();
  const file = join(t.dir, 'ticked.md');
  writeFileSync(file, '- [x] one box');
  for (const cmd of [
    'gh issue edit 12 --body "- [x] one box"',
    'gh issue edit 12 --body="- [x] one box"',
    'gh issue edit 12 -b "- [x] one box"',
    `gh issue edit 12 --body-file ${file}`,
    `gh issue edit 12 --body-file=${file}`,
    `gh issue edit 12 -F ${file}`,
  ]) {
    assert.equal(reason(cmd, '- [ ] one box', { cwd: t.dir }), null, cmd);
  }
});

test('a body file is resolved against the payload cwd', () => {
  const t = tmp();
  writeFileSync(join(t.dir, 'rel.md'), '- [x] one box');
  assert.equal(reason('gh issue edit 12 --body-file rel.md', '- [ ] one box', { cwd: t.dir }), null);
  writeFileSync(join(t.dir, 'rel2.md'), REWORD);
  assert.ok(reason('gh issue edit 12 --body-file rel2.md', ONE, { cwd: t.dir }));
});

test('a dropped line blocks through a body file', () => {
  const t = tmp();
  writeFileSync(join(t.dir, 'b.md'), 'line one');
  assert.ok(reason('gh issue edit 12 --body-file b.md', 'line one\nline two', { cwd: t.dir }));
});

test('adding lines through a body file passes', () => {
  const t = tmp();
  writeFileSync(join(t.dir, 'b.md'), 'line one\nadded in the middle\nline two\nadded at the end');
  assert.equal(reason('gh issue edit 12 --body-file b.md', 'line one\nline two', { cwd: t.dir }), null);
});

test('the issue forms #N, a URL and -R are all read', () => {
  const seen = [];
  const deps = { liveBody: (a) => (seen.push(a), ONE) };
  const t = tmp();
  for (const cmd of [
    `gh issue edit 12 --body "${ONE}"`,
    `gh issue edit "#13" --body "${ONE}"`,
    `gh issue edit https://github.com/acme/widgets/issues/14 --body "${ONE}"`,
    `gh issue edit 15 -R acme/gadgets --body "${ONE}"`,
    `gh issue edit 16 --repo acme/gizmos --body "${ONE}"`,
  ]) {
    guard.issueBodyReason(cmd, t.dir, join(t.dir, 'none.jsonl'), t.state, undefined, null, deps);
  }
  assert.deepEqual(seen.map((a) => String(a.number)), ['12', '13', '14', '15', '16']);
  assert.equal(seen[2].repo, 'acme/widgets');
  assert.equal(seen[3].repo, 'acme/gadgets');
  assert.equal(seen[4].repo, 'acme/gizmos');
  assert.ok(!seen[0].repo);
});

test('the live body is fetched through the injected seam with the payload cwd', () => {
  const seen = [];
  const t = tmp();
  guard.issueBodyReason(`gh issue edit 12 --body "${ONE}"`, t.dir, join(t.dir, 'none.jsonl'), t.state, undefined, null, { liveBody: (a) => (seen.push(a), ONE) });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].cwd, t.dir);
});

test('a body edit inside bash -c is detected', () => {
  assert.ok(reason(`bash -c 'gh issue edit 12 --body "${REWORD}"'`, ONE));
  assert.ok(reason(`pwsh -Command "gh issue edit 12 --body '${REWORD}'"`, ONE));
  assert.equal(reason(`bash -c 'gh issue edit 12 --body "- [x] one box"'`, '- [ ] one box'), null);
});

test('a body edit after a prefix or in a chain is detected', () => {
  assert.ok(reason(`cd /tmp && gh issue edit 12 --body "${REWORD}"`, ONE));
  assert.ok(reason(`echo hi; gh issue edit 12 --body "${REWORD}"`, ONE));
});

test('#420: a body edit behind command / exec / builtin / env, with options, stacked, is detected', () => {
  for (const p of [
    'command',
    'command -p',
    'command --',
    'exec',
    'exec -a name',
    'exec -c',
    'exec -l',
    'builtin command',
    'env',
    'env -u NAME',
    'env -C dir',
    'env --',
    'env VAR=1',
    'env -i command exec',
    'command env FOO=1',
  ]) {
    assert.ok(reason(`${p} gh issue edit 12 --body "${REWORD}"`, ONE), p);
    assert.ok(reason(`${p} gh issue edit 12 --body-file n.md`, ONE), `${p} file`);
  }
  assert.ok(reason(`env -S 'gh issue edit 12 --body "${REWORD}"'`, ONE), 'env -S');
  assert.ok(reason(`env --split-string='gh issue edit 12 --body-file n.md'`, ONE), 'env --split-string');
  // A tick through the prefix still passes; a non-body edit never reads the live body.
  assert.equal(reason(`command gh issue edit 12 --body "- [x] one box"`, '- [ ] one box'), null);
  const t = tmp();
  const deps = { liveBody: () => assert.fail('the live body must not be fetched') };
  for (const cmd of ['command gh issue edit 12 --add-label bug', 'exec gh issue edit 12 --title t', 'command -v gh', 'command -V gh', 'type gh', 'echo command gh issue edit 12 --body x']) {
    assert.equal(guard.issueBodyReason(cmd, t.dir, join(t.dir, 'none.jsonl'), t.state, undefined, null, deps), null, cmd);
  }
});

// ---- what is untouched --------------------------------------------------------------------

test('non-body gh calls are untouched and never read the live body', () => {
  const deps = { liveBody: () => assert.fail('the live body must not be fetched') };
  const t = tmp();
  for (const cmd of [
    'gh issue edit 12 --add-label bug',
    'gh issue edit 12 --title "New title"',
    'gh issue edit 12 --remove-label in-progress --add-label done',
    'gh issue comment 12 --body "a correction"',
    'gh issue comment 12 --body-file notes.md',
    'gh issue view 12 --json body',
    'gh issue create --title t --body "b"',
    'gh pr edit 12 --body "new pr body"',
    'git status',
    'echo gh issue edit 12 --body x',
  ]) {
    assert.equal(guard.issueBodyReason(cmd, t.dir, join(t.dir, 'none.jsonl'), t.state, undefined, null, deps), null, cmd);
  }
});

// ---- unreadable bodies fail closed ---------------------------------------------------------

test('--body-file - (stdin) needs approval', () => {
  assert.ok(reason('gh issue edit 12 --body-file -', ONE));
});

test('an unreadable body file needs approval', () => {
  const t = tmp();
  assert.ok(reason('gh issue edit 12 --body-file does-not-exist.md', ONE, { cwd: t.dir }));
});

test('a body holding a shell substitution or variable is unreadable and needs approval', () => {
  for (const cmd of [`gh issue edit 12 --body "$(cat body.md)"`, 'gh issue edit 12 --body "`cat body.md`"', `gh issue edit 12 --body "$BODY"`, `gh issue edit 12 --body $BODY`]) {
    assert.ok(reason(cmd, ONE), cmd);
  }
});

test('a live body that cannot be read (null) needs approval', () => {
  assert.ok(reason(`gh issue edit 12 --body "${ONE}"`, null));
});

test('a throwing live-body reader fails closed', () => {
  const r = reason(`gh issue edit 12 --body "${ONE}"`, ONE, {
    deps: {
      liveBody: () => {
        throw new Error('boom');
      },
    },
  });
  assert.ok(r);
});

test('an unreadable body is allowed once the user approves, naming the issue', () => {
  const t = tmp();
  const tr = transcriptOf(t.dir, typedRec('rewrite #12'));
  assert.equal(guard.issueBodyReason('gh issue edit 12 --body-file -', t.dir, tr, t.state, undefined, null, { liveBody: liveSync(ONE) }), null);
});

// ---- the block message (box 3) ---------------------------------------------------------------

test('the block message names the issue and the lost line, and points at a comment', () => {
  const r = reason(`gh issue edit 12 --body "${REWORD}"`, ONE);
  assert.match(r, /#?12\b/);
  assert.ok(r.includes(ONE), 'names the first dropped or reworded live line');
  assert.match(r, /comment/i);
  assert.match(r, /gh issue comment/);
  assert.match(r, /approv/i);
});

test('the block message for an unreadable body says why and still points at a comment', () => {
  const r = reason('gh issue edit 12 --body-file -', ONE);
  assert.match(r, /12/);
  assert.match(r, /comment/i);
  assert.match(r, /read|stdin|unreadable/i);
});

// ---- approval: an AskUserQuestion answer -----------------------------------------------------

const edit = `gh issue edit 12 --body "${REWORD}"`;

function gate(t, tr, cmd = edit, toolUseId = undefined) {
  return guard.issueBodyReason(cmd, t.dir, tr, t.state, toolUseId, null, { liveBody: liveSync(ONE) });
}

test('an approving answer naming the issue allows exactly one rewrite, then blocks', () => {
  const t = tmp();
  const tr = transcriptOf(t.dir, answerRec({ 'Rewrite the body of #12?': 'Yes, rewrite #12' }));
  assert.equal(gate(t, tr), null);
  const again = gate(t, tr);
  assert.ok(again);
  assert.match(again, /spent|already/i);
});

test('an answer naming the issue by URL path approves', () => {
  const t = tmp();
  const tr = transcriptOf(t.dir, answerRec({ q: 'Rewrite https://github.com/acme/widgets/issues/12' }));
  // #419 D2: the URL names acme/widgets, so the edit's own repo (resolved from its dir) must be the same.
  assert.equal(guard.issueBodyReason(edit, t.dir, tr, t.state, undefined, null, { liveBody: liveSync(ONE), repoOf: () => 'acme/widgets' }), null);
});

test('an answer naming a different issue does not approve', () => {
  const t = tmp();
  const tr = transcriptOf(t.dir, answerRec({ 'Rewrite?': 'Yes, rewrite #13' }));
  assert.ok(gate(t, tr));
});

test('an answer naming #123 does not approve #12 (word-bounded)', () => {
  const t = tmp();
  const tr = transcriptOf(t.dir, answerRec({ 'Rewrite?': 'Yes, rewrite #123' }));
  assert.ok(gate(t, tr));
});

test('a refusing answer naming the issue blocks', () => {
  const t = tmp();
  const tr = transcriptOf(t.dir, answerRec({ 'Rewrite #12?': "Don't rewrite #12" }));
  assert.ok(gate(t, tr));
});

test('an answer without an act word does not approve a rewrite', () => {
  const t = tmp();
  const tr = transcriptOf(t.dir, answerRec({ 'Which issue?': '#12' }));
  assert.ok(gate(t, tr));
});

test('a push approval does not approve a body rewrite', () => {
  const t = tmp();
  const tr = transcriptOf(t.dir, answerRec({ 'Push?': 'Push + open PR' }));
  assert.ok(gate(t, tr));
});

test('no transcript at all blocks', () => {
  const t = tmp();
  assert.ok(gate(t, join(t.dir, 'missing.jsonl')));
});

test('a newer approval naming the issue is a fresh rewrite', () => {
  const t = tmp();
  const first = transcriptOf(t.dir, answerRec({ q: 'Yes, rewrite #12' }));
  assert.equal(gate(t, first), null);
  assert.ok(gate(t, first));
  const second = transcriptOf(t.dir, answerRec({ q: 'Yes, rewrite #12' }), answerRec({ q: 'Yes, rewrite #12 again' }));
  assert.equal(gate(t, second), null);
});

test('one approval does not cover two issues; each needs its own', () => {
  const t = tmp();
  const tr = transcriptOf(t.dir, answerRec({ q: 'Yes, rewrite #12' }));
  const other = `gh issue edit 13 --body "${REWORD}"`;
  assert.ok(gate(t, tr, other));
  assert.equal(gate(t, tr), null);
});

test('a command with two body edits needs two spends: blocked outright, nothing spent', () => {
  const t = tmp();
  const tr = transcriptOf(t.dir, answerRec({ q: 'Yes, rewrite #12 and #13' }));
  const both = `gh issue edit 12 --body "${REWORD}" && gh issue edit 13 --body "${REWORD}"`;
  assert.ok(gate(t, tr, both));
  assert.equal(gate(t, tr), null, 'the approval was not consumed by the refused command');
});

test('the spend is refunded when the rewrite call errors', () => {
  const t = tmp();
  const errored = { type: 'user', uuid: 'r-1', toolUseResult: { stdout: '' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_B1', is_error: true, content: 'failed' }] } };
  const tr = transcriptOf(t.dir, answerRec({ q: 'Yes, rewrite #12' }), errored);
  assert.equal(gate(t, tr, edit, 'toolu_B1'), null);
  assert.equal(gate(t, tr, edit, 'toolu_B2'), null, 'the errored call refunded its spend');
});

test('the body gate keeps its own state file, never the push gate one', () => {
  const t = tmp();
  const pushState = join(t.dir, 'push.json');
  // One answer approves both a push and a rewrite of #12; the push spends it in the push state.
  const tr = transcriptOf(t.dir, answerRec({ q: 'Yes, push and rewrite #12' }));
  assert.equal(guard.pushGateReason('git push', '/repo', tr, pushState), null, 'the push is approved');
  assert.match(guard.pushGateReason('git push', '/repo', tr, pushState) || '', /spent|already/i, 'the push approval is now spent');
  const pushBefore = readFileSync(pushState, 'utf8');
  // The spent push approval does not block the body rewrite, and the body spend lands only in its own file.
  assert.equal(gate(t, tr), null, 'a spent push approval is not a spent body approval');
  assert.equal(readFileSync(pushState, 'utf8'), pushBefore, 'the body spend never touches the push state file');
  assert.ok(existsSync(t.state) && readFileSync(t.state, 'utf8').includes('12'), 'the body spend is in the body state file');
  assert.match(gate(t, tr) || '', /spent|already/i, 'and spends once there');
});

// ---- approval: a typed prompt ----------------------------------------------------------------

test('a typed prompt naming the issue allows exactly one rewrite, then blocks', () => {
  for (const text of ['rewrite #12', 'ok, rewrite #12 please', 'yes update the spec #12', 'go ahead and reword #12']) {
    const t = tmp();
    const tr = transcriptOf(t.dir, typedRec(text));
    assert.equal(gate(t, tr), null, text);
    assert.match(gate(t, tr) || '', /spent|already/i, text);
  }
});

test('a typed prompt naming a different issue does not approve', () => {
  const t = tmp();
  assert.ok(gate(t, transcriptOf(t.dir, typedRec('rewrite #13'))));
});

test('a typed prompt without an act word does not approve', () => {
  const t = tmp();
  assert.ok(gate(t, transcriptOf(t.dir, typedRec('ok #12'))));
});

test('a typed question does not approve', () => {
  const t = tmp();
  assert.ok(gate(t, transcriptOf(t.dir, typedRec('should I rewrite #12?'))));
});

test('a typed prompt with words outside the small set does not approve', () => {
  const t = tmp();
  assert.ok(gate(t, transcriptOf(t.dir, typedRec('rewrite #12 and also delete the repository'))));
});

test('a typed prompt without the issue number does not approve', () => {
  const t = tmp();
  assert.ok(gate(t, transcriptOf(t.dir, typedRec('rewrite it'))));
});

test('a launch-shaped first prompt (no assistant turn before it) does not approve', () => {
  const t = tmp();
  const path = join(t.dir, 'launch.jsonl');
  writeFileSync(path, `${JSON.stringify(typedRec('rewrite #12'))}\n`);
  assert.ok(gate(t, path));
});

test('a typed prompt with a non-human source does not approve', () => {
  const t = tmp();
  const rec = typedRec('rewrite #12', { promptSource: 'system', isMeta: true, origin: { kind: 'peer' } });
  assert.ok(gate(t, transcriptOf(t.dir, rec)));
});

test('a refusing typed prompt blocks even after an older approving answer', () => {
  const t = tmp();
  const tr = transcriptOf(t.dir, answerRec({ q: 'Yes, rewrite #12' }), typedRec("no don't rewrite #12"));
  assert.ok(gate(t, tr));
});

// ---- the push gate is unchanged by the optional parameter ------------------------------------

test('latestApproval with no second argument still reads the push gate approval', () => {
  const t = tmp();
  const approved = transcriptOf(t.dir, answerRec({ 'Push?': 'Push + open PR' }));
  const got = guard.latestApproval(approved);
  assert.ok(got && typeof got.uuid === 'string', JSON.stringify(got));
  const refused = transcriptOf(t.dir, answerRec({ 'Push?': 'Review first' }));
  assert.ok(!guard.latestApproval(refused)?.uuid);
  const body = transcriptOf(t.dir, answerRec({ q: 'Yes, rewrite #12' }));
  assert.ok(!guard.latestApproval(body)?.uuid, 'a body answer is no push approval');
});

test('the push gate still approves a push from an answer', () => {
  const t = tmp();
  const tr = transcriptOf(t.dir, answerRec({ 'Push?': 'Push + open PR' }));
  assert.equal(guard.pushGateReason('git push', '/repo', tr, join(t.dir, 'push.json')), null);
});

// ---- state file location -----------------------------------------------------------------------

test('issueBodyStateFile follows CLAUDE_ISSUE_BODY_STATE, else lives under ~/.claude, apart from the push gate file', () => {
  const saved = process.env.CLAUDE_ISSUE_BODY_STATE;
  try {
    process.env.CLAUDE_ISSUE_BODY_STATE = '/tmp/x/issue-body.json';
    assert.equal(issueBodyStateFile(), '/tmp/x/issue-body.json');
    delete process.env.CLAUDE_ISSUE_BODY_STATE;
    const dflt = issueBodyStateFile();
    assert.match(dflt.replace(/\\/g, '/'), /\.claude\/issue-body-approvals\.json$/);
    assert.notEqual(dflt, guard.pushGateStateFile?.());
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_ISSUE_BODY_STATE;
    else process.env.CLAUDE_ISSUE_BODY_STATE = saved;
  }
});

// ---- fix round (#388): G items ---------------------------------------------------------------

const UNTICKED_ONE = '- [ ] one box';
const TICKED_ONE = '- [x] one box';

/** The guard on `cmd` (tool `tool`) with live body `live`, no approval anywhere; `deps` extends the seam. */
function ruled(cmd, live, { cwd, tool = null, deps } = {}) {
  const t = tmp();
  return guard.issueBodyReason(cmd, cwd ?? t.dir, join(t.dir, 'none.jsonl'), t.state, undefined, tool, { liveBody: liveSync(live), ...deps });
}

// G1: a --body-file is read when the hook fires, before earlier clauses of the same command run.
test('G1: a body file an earlier clause of the same command writes is unreadable and needs approval', () => {
  const t = tmp();
  // The file on disk right now is a harmless tick; what the earlier clause writes is unknown.
  writeFileSync(join(t.dir, 'b.md'), TICKED_ONE);
  for (const cmd of [
    'printf X > b.md && gh issue edit 12 --body-file b.md',
    "sed -i 's/one/two/' b.md && gh issue edit 12 -F b.md",
    "cat > b.md <<'EOF'\nrewritten\nEOF\ngh issue edit 12 --body-file b.md",
    "gh issue view 12 --json body --jq .body > b.md; sed -i 's/ \\] / x] /' b.md; gh issue edit 12 -F b.md",
    `node -e "require('fs').writeFileSync('b.md','X')" && gh issue edit 12 --body-file b.md`,
    'echo ready && gh issue edit 12 --body-file b.md',
  ]) {
    assert.ok(ruled(cmd, UNTICKED_ONE, { cwd: t.dir }), cmd);
  }
  assert.ok(ruled("Set-Content b.md 'X'; gh issue edit 12 -F b.md", UNTICKED_ONE, { cwd: t.dir, tool: 'PowerShell' }), 'PowerShell Set-Content');
});

test('G1: a lone body-file edit, location changes and a trailing redirect or tail/head still read the file; inline --body is unaffected', () => {
  const t = tmp();
  mkdirSync(join(t.dir, 'sub'));
  writeFileSync(join(t.dir, 'b.md'), TICKED_ONE);
  writeFileSync(join(t.dir, 'sub', 'b.md'), TICKED_ONE);
  const sub = join(t.dir, 'sub').replace(/\\/g, '/');
  // These read the file (a tick passes) ...
  for (const cmd of [
    'gh issue edit 12 --body-file b.md',
    `cd ${sub} && gh issue edit 12 --body-file b.md`,
    `pushd ${sub} && gh issue edit 12 -F b.md`,
    'gh issue edit 12 --body-file b.md 2>&1 | tail -3',
    'gh issue edit 12 --body-file b.md | head -5',
    'gh issue edit 12 --body-file b.md > out.txt',
    // ... and an inline --body is untouched by the clauses before it.
    'printf X > b.md && gh issue edit 12 --body "- [x] one box"',
  ]) {
    assert.equal(ruled(cmd, UNTICKED_ONE, { cwd: t.dir }), null, cmd);
  }
  assert.equal(ruled(`Set-Location ${sub}; gh issue edit 12 -F b.md`, UNTICKED_ONE, { cwd: t.dir, tool: 'PowerShell' }), null, 'Set-Location');
  // Each of the same, once a clause before the edit is not a location change, is unreadable.
  assert.ok(ruled(`cd ${sub} && printf X > b.md && gh issue edit 12 --body-file b.md`, UNTICKED_ONE, { cwd: t.dir }));
});

// ---- G2 / G3: the approval wording --------------------------------------------------------

/** Whether answer `value` approves the rewrite of #12 (a fresh state each time). */
function answerApproves(value) {
  const t = tmp();
  return gate(t, transcriptOf(t.dir, answerRec({ q: value }))) === null;
}
/** Whether the typed `text` approves the rewrite of #12 (a fresh state each time). */
function typedApproves(text) {
  const t = tmp();
  return gate(t, transcriptOf(t.dir, typedRec(text))) === null;
}

test('G2: an answer that names the issue only to exclude it does not approve', () => {
  for (const v of ['Rewrite #13, keep #12 as is', 'Rewrite #13; #12 stays', 'Rewrite #13. Leave #12.', 'Rewrite #13 but not #12', 'Rewrite #13: #12 is fine']) {
    assert.equal(answerApproves(v), false, v);
  }
});

test('G2: an act word before #N in the same clause approves, whatever sits between', () => {
  for (const v of ['Rewrite #12', 'Rewrite the body of #12', "Yes, rewrite #12's Done-when", 'Yes, rewrite #13 and #12']) {
    assert.equal(answerApproves(v), true, v);
  }
});

test('G3: fix/update/edit/change/correct/replace alone do not approve, typed or answered', () => {
  for (const text of ['go ahead and fix #12', 'update #12', 'edit #12', 'change #12', 'correct #12', 'replace #12']) {
    assert.equal(typedApproves(text), false, `typed: ${text}`);
  }
  for (const v of ['Fix #12', 'Fix PR #12', 'Update #12 tests first', 'Edit #12', 'Change #12', 'Correct #12', 'Replace #12']) {
    assert.equal(answerApproves(v), false, `answer: ${v}`);
  }
});

test('G3: rewrite/reword approve alone; the other act words approve beside body, spec or done-when, any case', () => {
  for (const text of ['rewrite #12', 'reword #12', 'fix the body #12', 'update the spec #12', 'update the done-when #12', 'EDIT THE BODY #12']) {
    assert.equal(typedApproves(text), true, `typed: ${text}`);
  }
  for (const v of ['Rewrite #12', 'Reword #12', 'Fix the body of #12', "Update #12's spec", 'Change the Done-when of #12', 'Replace the body of #12']) {
    assert.equal(answerApproves(v), true, `answer: ${v}`);
  }
});

// ---- G5: a group's closing paren -----------------------------------------------------------

test('G5: a ( … ) group closing paren is not part of a last-word body', () => {
  assert.ok(ruled('(gh issue edit 12 --body x)', 'x)'), 'a live "x)" is not rewritten away unseen');
  assert.equal(ruled(`(gh issue edit 12 --body '${TICKED_ONE}')`, UNTICKED_ONE), null, 'single-quoted tick');
  assert.equal(ruled(`(gh issue edit 12 --body "${TICKED_ONE}")`, UNTICKED_ONE), null, 'double-quoted tick');
  assert.equal(ruled('(gh issue edit 12 --body x)', 'x'), null, 'an unchanged bare body');
});

// ---- G6: an unquoted # starts a comment ---------------------------------------------------------

test('G6: an unquoted word beginning # ends the call, bash and PowerShell', () => {
  for (const tool of [null, 'PowerShell']) {
    // The trailing words are a comment: the body is "REWORDED", not the LIVE LINE after it.
    assert.ok(ruled('gh issue edit 12 --body "REWORDED" #12 --body "LIVE LINE"', 'LIVE LINE', { tool }), `${tool}: a body inside the comment`);
    const t = tmp();
    writeFileSync(join(t.dir, 't.md'), TICKED_ONE);
    // A comment is no target: this is one tick of one issue, not "rewrites 4 issue bodies".
    assert.equal(ruled('gh issue edit 12 -F t.md  # tick box one', UNTICKED_ONE, { cwd: t.dir, tool }), null, `${tool}: a comment after the call`);
    assert.equal(ruled('gh issue edit 12 -F t.md # tick box #13 and #14', UNTICKED_ONE, { cwd: t.dir, tool }), null, `${tool}: # words in a comment`);
  }
  // A quoted "#13" is still a target.
  const seen = [];
  ruled(`gh issue edit "#13" --body "${ONE}"`, ONE, { deps: { liveBody: (a) => (seen.push(String(a.number)), ONE) } });
  assert.deepEqual(seen, ['13']);
});

// ---- G7: GH_REPO ---------------------------------------------------------------------------------

test('G7: a GH_REPO anywhere in the payload makes the live body unreadable unless -R or a URL names the repo', () => {
  const tick = `--body "${TICKED_ONE}"`;
  for (const [cmd, tool] of [
    [`GH_REPO=o/r gh issue edit 12 ${tick}`, null],
    [`export GH_REPO=o/r; gh issue edit 12 ${tick}`, null],
    [`GH_REPO=o/r; gh issue edit 12 ${tick}`, null],
    [`$env:GH_REPO='o/r'; gh issue edit 12 ${tick}`, 'PowerShell'],
  ]) {
    const seen = [];
    const r = ruled(cmd, UNTICKED_ONE, { tool, deps: { liveBody: (a) => (seen.push(a), UNTICKED_ONE) } });
    assert.ok(r, `${cmd} needs approval`);
    assert.match(r, /GH_REPO|repo/i, cmd);
  }
  // -R, --repo, or an issue URL names the repo itself: the live body is read.
  for (const cmd of [`GH_REPO=o/r gh issue edit 12 -R o/r ${tick}`, `GH_REPO=o/r gh issue edit 12 --repo o/r ${tick}`, `GH_REPO=o/r gh issue edit https://github.com/o/r/issues/12 ${tick}`]) {
    assert.equal(ruled(cmd, UNTICKED_ONE), null, cmd);
  }
});

// ---- G8: PowerShell '' -------------------------------------------------------------------------------

test("G8: in PowerShell, '' inside a single-quoted word is one literal '", () => {
  assert.equal(ruled("gh issue edit 12 --body 'it''s fine'", "it's fine", { tool: 'PowerShell' }), null);
  assert.ok(ruled("gh issue edit 12 --body 'it''s fine'", 'its fine', { tool: 'PowerShell' }), 'it is not "its fine"');
  // In bash the same word is two adjacent strings: "its fine".
  assert.equal(ruled("gh issue edit 12 --body 'it''s fine'", 'its fine'), null);
});

// ---- G12: the "$(cat <<'EOF' …)" body -----------------------------------------------------------

test("G12: a quoted-delimiter heredoc inside \"$(cat <<'EOF' … EOF )\" is read as the body", () => {
  const live = ['## Done when', '- [ ] one box', '- [ ] two box'].join('\n');
  const ticked = ['## Done when', '- [x] one box', '- [ ] two box'].join('\n');
  const reworded = ['## Done when', '- [ ] one box', '- [ ] a different box'].join('\n');
  const wrap = (body) => `gh issue edit 12 --body "$(cat <<'EOF'\n${body}\nEOF\n)"`;
  assert.equal(ruled(wrap(ticked), live), null, 'a pure tick passes');
  assert.equal(ruled(wrap(`${live}\n- [ ] added box`), live), null, 'an added line passes');
  const r = ruled(wrap(reworded), live);
  assert.ok(r, 'a reworded line blocks');
  assert.ok(r.includes('- [ ] two box'), 'naming the line it loses');
  assert.ok(!/can't be checked/.test(r), 'as a rewording, not as unreadable');
});

test('G12: every other substitution stays unreadable and needs approval', () => {
  const body = '- [x] one box';
  for (const cmd of [
    `gh issue edit 12 --body "$(cat <<EOF\n${body}\nEOF\n)"`,
    `gh issue edit 12 --body "$(cat body.md)"`,
    `gh issue edit 12 --body "$(echo ${body})"`,
    `gh issue edit 12 --body "$(cat <<'EOF'\n$(whoami)\nEOF\n) extra"`,
  ]) {
    const r = ruled(cmd, UNTICKED_ONE);
    assert.ok(r, cmd);
  }
});

// ---- G16: narrow false blocks ------------------------------------------------------------------------

test('G16: ticking an ordered-list item passes', () => {
  assert.equal(change('1. [ ] a\n2. [ ] b', '1. [x] a\n2. [ ] b'), null);
  assert.equal(change('1. [ ] a', '1. [X] a'), null);
  assert.equal(change('  10. [ ] nested', '  10. [x] nested'), null);
  assert.equal(change('1. [x] a', '1. [ ] a').line, '1. [x] a', 'un-ticking is still a reword');
});

test('G16: recasing an already-ticked box passes, un-ticking and rewording do not', () => {
  assert.equal(change('- [X] done', '- [x] done'), null);
  assert.equal(change('- [x] done', '- [X] done'), null);
  assert.equal(change('1. [X] done', '1. [x] done'), null);
  assert.equal(change('- [X] done', '- [ ] done').line, '- [X] done');
  assert.equal(change('- [X] done', '- [x] done changed').line, '- [X] done');
});

// ---- review gaps: empty last-word body, spend ordering, trailing commands, end to end -------------

test('a body flag with no value word blocks (fail closed), however the empty body is spelled', () => {
  for (const [cmd, tool] of [
    ["gh issue edit 12 --body ''", null],
    ['gh issue edit 12 --body ""', null],
    ["gh issue edit 12 -b ''", null],
    ["gh issue edit 12 --body ''", 'PowerShell'],
    ['gh issue edit 12 --body', null],
  ]) {
    const t = tmp();
    const r = guard.issueBodyReason(cmd, t.dir, join(t.dir, 'none.jsonl'), t.state, undefined, tool, { liveBody: liveSync(ONE) });
    assert.ok(r, `${tool ?? 'Bash'}: ${cmd} must block`);
    assert.match(r, /12/);
    assert.match(r, /gh issue comment/, 'points at the comment remedy');
  }
});

test('an empty body, as the last word, is spent against an approval like any rewrite', () => {
  const t = tmp();
  const tr = transcriptOf(t.dir, answerRec({ q: 'Yes, rewrite #12' }));
  assert.equal(gate(t, tr, "gh issue edit 12 --body ''"), null, 'approved once');
  assert.match(gate(t, tr, "gh issue edit 12 --body ''") || '', /spent|already/i);
});

test('a body-file edit followed by a separate command passes when it only ticks a box', () => {
  const t = tmp();
  writeFileSync(join(t.dir, 'b.md'), TICKED_ONE);
  for (const tail of ['&& echo done', '; echo done', '|| true']) {
    assert.equal(ruled(`gh issue edit 12 --body-file b.md ${tail}`, UNTICKED_ONE, { cwd: t.dir }), null, tail);
  }
});

// The hook process end to end: bash-guard.mjs fed a PreToolUse payload on stdin.
const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks', 'bash-guard.mjs');
const LIVE_STUB = '## Goal\nShip it.\n\n## Done when\n- [ ] one\n- [ ] two\n';

function hookRun(command, { tool = 'Bash', transcript, home, id = 'toolu_e2e', env } = {}) {
  const h = home ?? tempDir('ib-home-');
  mkdirSync(join(h, '.claude'), { recursive: true });
  writeFileSync(join(h, '.claude', 'issue-body-stub.md'), LIVE_STUB);
  const cwd = tempDir('ib-cwd-');
  const payload = { tool_name: tool, tool_input: { command }, cwd, transcript_path: transcript ?? join(cwd, 'none.jsonl'), tool_use_id: id };
  const r = spawnHarness(HOOK, [], { home: h, input: JSON.stringify(payload), env });
  return { rc: r.status, err: r.stderr || '', home: h, state: join(h, '.claude', 'issue-body-approvals.json') };
}

test('hook process: a reworded --body exits 2 and a box tick exits 0, against the stubbed live body', () => {
  const reworded = '## Goal\nShip it now.\n\n## Done when\n- [ ] one\n- [ ] two';
  const ticked = '## Goal\nShip it.\n\n## Done when\n- [x] one\n- [ ] two';
  const bad = hookRun(`gh issue edit 12 --body "${reworded}"`);
  assert.equal(bad.rc, 2, bad.err);
  assert.match(bad.err, /Ship it\./);
  assert.equal(hookRun(`gh issue edit 12 --body "${ticked}"`).rc, 0);
  assert.equal(hookRun("gh issue edit 12 --body ''").rc, 2, 'an empty body blocks');
});

test('hook process: a command another rule blocks spends no body approval', () => {
  const t = tmp();
  const tr = transcriptOf(t.dir, answerRec({ q: 'Yes, rewrite #12' }));
  const reworded = '## Goal\nShip it now.\n\n## Done when\n- [ ] one\n- [ ] two';
  const first = hookRun(`gh issue edit 12 --body "${reworded}" && git push origin feat`, { transcript: tr, id: 'toolu_blocked' });
  assert.equal(first.rc, 2, 'the push gate blocks it (no push approval)');
  const spent = existsSync(first.state) ? readFileSync(first.state, 'utf8') : '';
  assert.ok(!spent.includes('issue-body #12'), `the #12 approval is still unspent, state: ${spent}`);
  const retry = hookRun(`gh issue edit 12 --body "${reworded}"`, { transcript: tr, home: first.home, id: 'toolu_retry' });
  assert.equal(retry.rc, 0, retry.err);
});

// ---- gh issue edit value flags the parser must know (#388 review) ----

const VALUE_FLAGS = ['--type bug', '--parent 99', '--add-blocked-by 13', '--remove-blocked-by 13', '--add-blocking 13', '--remove-blocking 13', '--add-sub-issue 13', '--remove-sub-issue 13'];

test('a value flag with an issue number does not hide the edited issue: a box tick passes', () => {
  for (const flag of VALUE_FLAGS) {
    for (const cmd of [`gh issue edit 12 ${flag} --body "- [x] one"`, `gh issue edit ${flag} 12 --body "- [x] one"`]) {
      assert.equal(reason(cmd, '- [ ] one'), null, cmd);
    }
  }
});

test('a value flag with an issue number does not count as a second rewritten issue', () => {
  for (const flag of VALUE_FLAGS) {
    const t = tmp();
    const tr = transcriptOf(t.dir, answerRec({ q: 'Yes, rewrite #12' }));
    const cmd = `gh issue edit 12 ${flag} --body "${REWORD}"`;
    assert.equal(gate(t, tr, cmd), null, cmd);
  }
});

test('a value flag with an issue number still blocks a rewording of the one issue', () => {
  for (const flag of VALUE_FLAGS) {
    const r = reason(`gh issue edit 12 ${flag} --body "${REWORD}"`, ONE);
    assert.ok(r, flag);
    assert.doesNotMatch(r, /can't read which issue/, flag);
  }
});

// ---- #419: rule 13 gaps (D1-D5) ----------------------------------------------------------------

// D1: gh api body writes
const API_BLOCKED = [
  'gh api repos/o/r/issues/12 -f body=x',
  'gh api -X PATCH repos/o/r/issues/12 -f body=x',
  'gh api --method PATCH repos/o/r/issues/12 -F body=x',
  'gh api /repos/o/r/issues/12 -X PATCH --field body=x',
  'gh api repos/o/r/issues/12 --raw-field body=x',
  'gh api -X PATCH repos/o/r/issues/12 -F body=@b.md',
  'gh api -X PATCH "repos/o/r/issues/12" -f body=x',
  'gh api -X PATCH repos/{owner}/{repo}/issues/12 -f body=x',
  'gh api -X PATCH repos/$OWNER/$REPO/issues/$N -f body=x',
  'gh api -X PATCH repos/o/r/issues/12 --input p.json',
];
const GQL_UPDATE = 'mutation { updateIssue(input:{id:"I",body:"x"}) { issue { id } } }';

test('(#419 D1) a gh api write of an issue body is blocked, naming gh api and the gh issue edit --body-file route', () => {
  for (const cmd of API_BLOCKED) {
    const r = ruled(cmd, ONE);
    assert.ok(r, cmd);
    assert.match(r, /gh api/, cmd);
    assert.match(r, /gh issue edit .*--body-file/, cmd);
  }
});

test('(#419 D1) a gh api graphql updateIssue body mutation is blocked; an unreadable query blocks as uncheckable', () => {
  const t = tmp();
  writeFileSync(join(t.dir, 'q.graphql'), GQL_UPDATE);
  for (const cmd of [
    `gh api graphql -f query='${GQL_UPDATE}'`,
    `gh api graphql -F query='${GQL_UPDATE}'`,
    'gh api graphql -f query=@q.graphql',
    'gh api graphql -f query=$Q',
    'gh api graphql -f query=@missing.graphql',
    'gh api graphql --input q.json',
  ]) {
    const r = ruled(cmd, ONE, { cwd: t.dir });
    assert.ok(r, cmd);
    assert.match(r, /gh api/, cmd);
  }
});

test('(#419 D1) must still pass: comments, GET, non-body PATCH, graphql reads and addComment', () => {
  const t = tmp();
  writeFileSync(join(t.dir, 'read.graphql'), '{ repository(owner:"o",name:"r"){ issue(number:1){ body } } }');
  for (const cmd of [
    'gh api repos/o/r/issues/12/comments -f body=x',
    'gh api repos/o/r/issues/12',
    'gh api -X GET repos/o/r/issues/12',
    'gh api -X PATCH repos/o/r/issues/12 -f state=closed',
    'gh api -X PATCH repos/o/r/issues/12 -f title=x',
    `gh api graphql -f query='{ repository(owner:"o",name:"r"){ issue(number:1){ body } } }'`,
    'gh api graphql -f query=@read.graphql',
    `gh api graphql -f query='mutation { addComment(input:{subjectId:"I",body:"x"}) { clientMutationId } }'`,
  ]) {
    assert.equal(ruled(cmd, ONE, { cwd: t.dir }), null, cmd);
  }
});

test('(#419 D1 fix) a graphql updateIssue body mutation sent to a full-URL endpoint is blocked like bare graphql', () => {
  for (const endpoint of ['graphql', '/graphql', 'https://api.github.com/graphql', 'https://ghe.example.com/api/graphql']) {
    const cmd = `gh api ${endpoint} -f query='${GQL_UPDATE}'`;
    const r = ruled(cmd, ONE);
    assert.ok(r, cmd);
    assert.match(r, /gh api/, cmd);
  }
});

test('(#419 D1 fix) must still pass: a graphql read query sent to a full-URL endpoint', () => {
  for (const endpoint of ['https://api.github.com/graphql', 'https://ghe.example.com/api/graphql']) {
    const cmd = `gh api ${endpoint} -f query='{ repository(owner:"o",name:"r"){ issue(number:1){ body } } }'`;
    assert.equal(ruled(cmd, ONE), null, cmd);
  }
});

// D2: approval scoped to its repo
const ELSE = 'C:/elsewhere/a';
const byDir = (map) => (d) => map(String(d).replace(/\\/g, '/'));
const withRepo = (t, cmd, tr, repoOf) => guard.issueBodyReason(cmd, t.dir, tr, t.state, undefined, null, { liveBody: liveSync(ONE), repoOf });
const REWRITE = `--body "${REWORD}"`;

test('(#419 D2) an approval naming another repo does not apply: blocked, both repos named, how to approve the other', () => {
  const t = tmp();
  const tr = transcriptOf(t.dir, typedRec('rewrite other/repo#12'));
  const r = withRepo(t, `gh issue edit 12 -R o/r ${REWRITE}`, tr, () => 'o/r');
  assert.ok(r);
  assert.match(r, /other\/repo/);
  assert.match(r, /o\/r/);
  assert.match(r, /rewrite o\/r#12/);
  const url = transcriptOf(t.dir, answerRec({ q: 'Rewrite https://github.com/other/repo/issues/12' }));
  const u = withRepo(t, `gh issue edit 12 -R o/r ${REWRITE}`, url, () => 'o/r');
  assert.ok(u, 'an issue URL names its repo too');
  assert.match(u, /other\/repo/);
});

test('(#419 D2) owner/repo#N approves #N in that repo, typed or answered, and is spent once under a per-repo key', () => {
  for (const make of [() => typedRec('rewrite other/repo#12'), () => answerRec({ q: 'Yes, rewrite other/repo#12' })]) {
    const t = tmp();
    const tr = transcriptOf(t.dir, make());
    const cmd = `gh issue edit 12 -R Other/Repo ${REWRITE}`;
    assert.equal(withRepo(t, cmd, tr, () => 'o/r'), null);
    assert.match(readFileSync(t.state, 'utf8'), /issue-body other\/repo#12/);
    assert.ok(withRepo(t, cmd, tr, () => 'o/r'), 'spent');
  }
});

test('(#419 D2) a bare approval applies only to the repo of the record cwd: another dir resolving elsewhere blocks, naming both', () => {
  const t = tmp();
  const tr = transcriptOf(t.dir, typedRec('rewrite #12', { cwd: ELSE }));
  const r = withRepo(t, `gh issue edit 12 ${REWRITE}`, tr, byDir((d) => (d === ELSE ? 'a/x' : 'b/y')));
  assert.ok(r);
  assert.match(r, /a\/x/);
  assert.match(r, /b\/y/);
  assert.match(r, /rewrite b\/y#12/);
});

test('(#419 D2) a bare approval in another dir of the same repo applies, repos compared case-insensitively', () => {
  const t = tmp();
  const tr = transcriptOf(t.dir, typedRec('rewrite #12', { cwd: ELSE }));
  assert.equal(withRepo(t, `gh issue edit 12 ${REWRITE}`, tr, byDir((d) => (d === ELSE ? 'A/X' : 'a/x'))), null);
});

test('(#419 D2) a repo that cannot be resolved on either side blocks as uncheckable', () => {
  for (const repoOf of [() => null, byDir((d) => (d === ELSE ? 'a/x' : null)), byDir((d) => (d === ELSE ? null : 'a/x')), () => { throw new Error('gh down'); }]) {
    const t = tmp();
    const tr = transcriptOf(t.dir, typedRec('rewrite #12', { cwd: ELSE }));
    assert.ok(withRepo(t, `gh issue edit 12 ${REWRITE}`, tr, repoOf));
  }
});

test('(#419 D2) must still pass: bare approval in the same dir needs no repo lookup; bare approval with -R of the cwd repo applies', () => {
  const t = tmp();
  const boom = () => {
    throw new Error('repoOf must not run: neither side names a repo and the dir is the record cwd');
  };
  assert.equal(withRepo(t, `gh issue edit 12 ${REWRITE}`, transcriptOf(t.dir, typedRec('rewrite #12', { cwd: t.dir })), boom), null);
  const u = tmp();
  assert.equal(withRepo(u, `gh issue edit 12 ${REWRITE}`, transcriptOf(u.dir, typedRec('rewrite #12')), boom), null, 'record without a cwd is the hook cwd');
  const v = tmp();
  assert.equal(withRepo(v, `gh issue edit 12 -R O/R ${REWRITE}`, transcriptOf(v.dir, typedRec('rewrite #12')), () => 'o/r'), null);
});

test('(#419 D2) the spend key is issue-body <lowercase owner/repo>#<N>', () => {
  const v = tmp();
  assert.equal(withRepo(v, `gh issue edit 12 -R O/R ${REWRITE}`, transcriptOf(v.dir, typedRec('rewrite #12')), () => 'o/r'), null);
  assert.match(readFileSync(v.state, 'utf8'), /issue-body o\/r#12/);
});

test('(#419 D2) a bare approval does not cover -R of a different repo than its own', () => {
  const t = tmp();
  const tr = transcriptOf(t.dir, typedRec('rewrite #12'));
  const r = withRepo(t, `gh issue edit 12 -R x/y ${REWRITE}`, tr, () => 'o/r');
  assert.ok(r);
  assert.match(r, /o\/r/);
  assert.match(r, /x\/y/);
});

test('(#419 D2) hook process: CLAUDE_ISSUE_BODY_REPO_STUB stands in for the repo gh resolves', () => {
  const ticked = '## Goal\nShip it.\n\n## Done when\n- [x] one\n- [ ] two';
  const reworded = '## Goal\nShip it now.\n\n## Done when\n- [ ] one\n- [ ] two';
  const env = { CLAUDE_ISSUE_BODY_REPO_STUB: 'o/r' };
  const run = (prompt, flags, id) => {
    const t = tmp();
    return hookRun(`gh issue edit 12 ${flags} --body "${reworded}"`, { transcript: transcriptOf(t.dir, typedRec(prompt)), env, id });
  };
  assert.equal(run('rewrite #12', '-R O/R', 'toolu_a').rc, 0, 'bare approval, -R is the stubbed repo');
  const other = run('rewrite #12', '-R x/y', 'toolu_b');
  assert.equal(other.rc, 2, 'bare approval, -R is another repo than the stub');
  assert.match(other.err, /x\/y/);
  assert.equal(run('rewrite other/repo#12', '-R o/r', 'toolu_c').rc, 2, 'approval names another repo');
  assert.equal(hookRun(`gh issue edit 12 --body "${ticked}"`, { env }).rc, 0, 'a tick needs no approval');
});

// D3: a box hidden in an HTML comment
test('(#419 D3) a Done-when box wrapped in an HTML comment is reported lost', () => {
  const live = '## Done when\n- [ ] one\n- [ ] two';
  assert.deepEqual(change(live, '## Done when\n- [ ] one\n<!--\n- [ ] two\n-->'), { line: '- [ ] two' }, 'multi-line');
  assert.deepEqual(change(live, '## Done when\n- [ ] one\n<!--\n- [x] two\n-->'), { line: '- [ ] two' }, 'ticked inside a comment');
  assert.deepEqual(change(live, '## Done when\n- [ ] one\n<!-- unclosed\n- [ ] two'), { line: '- [ ] two' }, 'an unclosed comment runs to the end');
  assert.deepEqual(change(live, '## Done when\n- [ ] one\n<!-- - [ ] two -->'), { line: '- [ ] two' }, 'one line');
  assert.deepEqual(change(live, '<!-- ## Done when\n- [ ] one -->\n- [ ] two'), { line: '## Done when' }, 'a comment opened on a heading line');
});

test('(#419 D3) must still pass: a live body already holding a comment, kept, with a box ticked', () => {
  const live = '<!-- note\nkeep this -->\n## Done when\n- [ ] one\n<!-- one-line note -->';
  assert.equal(change(live, live.replace('- [ ] one', '- [x] one')), null);
});

test('(#419 D3 fix) a <!-- inside an inline code span or fence does not open a comment: a real wrap of the boxes is still lost', () => {
  const span = 'Use `<!--` to open.';
  const live = `${span}\n## Done when\n- [ ] one\n- [ ] two`;
  assert.deepEqual(change(live, `${span}\n## Done when\n<!--\n- [ ] one\n- [ ] two\n-->`), { line: '- [ ] one' }, 'inline code span in live');
  const fenced = '```\n<!--\n```';
  const liveF = `${fenced}\n## Done when\n- [ ] one\n- [ ] two`;
  assert.deepEqual(change(liveF, `${fenced}\n## Done when\n<!--\n- [ ] one\n- [ ] two\n-->`), { line: '- [ ] one' }, 'fenced block in live');
});

test('(#419 D3 fix) must still pass: adding a line holding a code-span <!-- above every kept line', () => {
  const live = '## Done when\n- [ ] one\n- [ ] two';
  assert.equal(change(live, `Use \`<!--\` to open.\n${live}`), null, 'inline code span');
  assert.equal(change(live, `\`\`\`\n<!--\n\`\`\`\n${live}`), null, 'fenced block');
});

// D4: GH_HOST
test('(#419 D4) a GH_HOST in the command blocks as uncheckable unless the target names its host', () => {
  const tick = `--body "${TICKED_ONE}"`;
  for (const [cmd, tool] of [
    [`GH_HOST=ghe.example.com gh issue edit 12 ${tick}`, null],
    [`export GH_HOST=ghe.example.com; gh issue edit 12 ${tick}`, null],
    [`$env:GH_HOST='ghe.example.com'; gh issue edit 12 ${tick}`, 'PowerShell'],
    [`GH_HOST=ghe.example.com gh issue edit 12 -R o/r ${tick}`, null],
  ]) {
    const r = ruled(cmd, UNTICKED_ONE, { tool });
    assert.ok(r, cmd);
    assert.match(r, /GH_HOST/, cmd);
    assert.match(r, /host/i, cmd);
  }
  for (const cmd of [
    `GH_HOST=ghe.example.com gh issue edit 12 -R ghe.example.com/o/r ${tick}`,
    `GH_HOST=ghe.example.com gh issue edit https://ghe.example.com/o/r/issues/12 ${tick}`,
  ]) {
    assert.equal(ruled(cmd, UNTICKED_ONE), null, cmd);
  }
});

// D5: three false blocks
test('(#419 D5) a brace group around the edit still reads its body file', () => {
  const t = tmp();
  writeFileSync(join(t.dir, 'b.md'), `${UNTICKED_ONE}\n- [ ] added line`);
  assert.equal(ruled('{ gh issue edit 12 -F b.md; }', UNTICKED_ONE, { cwd: t.dir }), null);
});

test('(#419 D5) bash drops a double-quoted backslash-newline; PowerShell keeps it', () => {
  const raw = '"ab\\\nc"';
  assert.equal(literal(raw), 'abc');
  assert.equal(literal(raw, 'PowerShell'), 'ab\\\nc');
  assert.equal(ruled(`gh issue edit 12 --body ${raw}`, 'abc'), null, 'the body is abc');
});

const tmpName = () => `ib419-${process.pid}-${Date.now()}.md`;

test('(#419 D5) win32 Bash: a --body-file /tmp/... is read from the os.tmpdir() mount, PowerShell\'s is not', { skip: process.platform !== 'win32' }, () => {
  const name = tmpName();
  const file = join(tmpdir(), name);
  writeFileSync(file, TICKED_ONE);
  try {
    assert.equal(ruled(`gh issue edit 12 --body-file /tmp/${name}`, UNTICKED_ONE), null);
    assert.ok(ruled(`gh issue edit 12 --body-file /tmp/${name}`, UNTICKED_ONE, { tool: 'PowerShell' }), 'PowerShell /tmp is unchanged');
  } finally {
    rmSync(file, { force: true });
  }
});

test('(#419 D5) off win32 a --body-file /tmp/... stays /tmp', { skip: process.platform === 'win32' }, () => {
  const name = tmpName();
  writeFileSync(join('/tmp', name), TICKED_ONE);
  try {
    assert.equal(ruled(`gh issue edit 12 --body-file /tmp/${name}`, UNTICKED_ONE), null);
  } finally {
    rmSync(join('/tmp', name), { force: true });
  }
});
