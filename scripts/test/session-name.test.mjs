// node --test scripts/test/session-name.test.mjs — typed session names (#175):
// lib's sessionName/parseSessionName/sessionKey and the session-name.mjs CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { spawnHarness, tempDir } from './_spawn.mjs';
import { branchIssue, generalSessionName, isChosenName, issueNumber, parseSessionName, sessionKey, sessionName, slugify, worktreeTicketName } from '../lib.mjs';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'session-name.mjs');

test('sessionName builds each of the four types', () => {
  assert.equal(sessionName('director', 'harness'), 'director-harness');
  assert.equal(sessionName('director', 'strate-audit'), 'director-strate-audit');
  assert.equal(sessionName('epic', 'strate', 12), 'epic-strate-12');
  assert.equal(sessionName('ticket', 'claude-config', '62'), 'ticket-claude-config-62');
  assert.equal(sessionName('ticket', 'dog-eat-dog', 3), 'ticket-dog-eat-dog-3');
  assert.equal(sessionName('general', 'spend-review'), 'general-spend-review');
});

test('parseSessionName reads each typed name back, hyphenated repos included', () => {
  assert.deepEqual(parseSessionName('director-harness'), { type: 'director', scope: 'harness', name: 'director-harness', raw: 'director-harness' });
  assert.deepEqual(parseSessionName('director-strate-audit'), { type: 'director', scope: 'strate-audit', name: 'director-strate-audit', raw: 'director-strate-audit' });
  assert.deepEqual(parseSessionName('epic-dog-eat-dog-40'), { type: 'epic', repo: 'dog-eat-dog', issue: 40, legacy: false, name: 'epic-dog-eat-dog-40', raw: 'epic-dog-eat-dog-40' });
  assert.deepEqual(parseSessionName('ticket-claude-config-175'), { type: 'ticket', repo: 'claude-config', issue: 175, legacy: false, name: 'ticket-claude-config-175', raw: 'ticket-claude-config-175' });
  assert.deepEqual(parseSessionName('general-spend-review'), { type: 'general', topic: 'spend-review', name: 'general-spend-review', raw: 'general-spend-review' });
});

test('every built name round-trips through the parser', () => {
  const cases = [
    ['director', ['harness']],
    ['director', ['strate']],
    ['epic', ['claude-config', 9]],
    ['ticket', ['dog-eat-dog', 101]],
    ['ticket', ['repo2', 5]],
    ['general', ['typed-session-names']],
  ];
  for (const [type, args] of cases) {
    const name = sessionName(type, ...args);
    const p = parseSessionName(name);
    assert.equal(p.type, type, name);
    assert.equal(p.name, name, name);
    assert.equal(sessionName(p.type, ...(p.scope ? [p.scope] : p.topic ? [p.topic] : [p.repo, p.issue])), name);
  }
});

test('a legacy <repo>-<N> name parses as a ticket, marked legacy, with the typed name as its key', () => {
  assert.deepEqual(parseSessionName('claude-config-62'), { type: 'ticket', repo: 'claude-config', issue: 62, legacy: true, name: 'ticket-claude-config-62', raw: 'claude-config-62' });
  assert.deepEqual(parseSessionName('repo-5'), { type: 'ticket', repo: 'repo', issue: 5, legacy: true, name: 'ticket-repo-5', raw: 'repo-5' });
  assert.equal(sessionKey('repo-5'), sessionKey('ticket-repo-5'));
  assert.notEqual(sessionKey('epic-repo-5'), sessionKey('ticket-repo-5'), 'an epic and a ticket on one issue are different units');
});

test('missing, empty and unparseable names fall back to general with no topic, raw kept', () => {
  for (const raw of [undefined, null, '', '   ', 'code-4c', 'some-other-name', 'Agent orchestration app naming', 'ticket-repo', 'director-', 'repo-0']) {
    const p = parseSessionName(raw);
    assert.equal(p.type, 'general', String(raw));
    assert.equal(p.topic, null, String(raw));
    assert.equal(p.name, null, String(raw));
    assert.equal(p.raw, typeof raw === 'string' ? raw : '', String(raw));
  }
});

test('names parse case-insensitively, so a capitalised window joins its unit', () => {
  assert.equal(parseSessionName('Claude-Config-163').name, 'ticket-claude-config-163');
  assert.equal(sessionKey('Claude-Config-163'), sessionKey('claude-config-163'));
  assert.equal(sessionKey('Ticket-Claude-Config-163'), 'ticket-claude-config-163');
  assert.equal(parseSessionName('Director-Harness').scope, 'harness');
  assert.equal(parseSessionName('Repo-5').raw, 'Repo-5', 'raw keeps the input');
});

test('isChosenName: typed names whatever the source; legacy names only when user- or peer-set; the failsafe never', () => {
  for (const src of ['user', 'peer', 'auto', 'derived', undefined]) {
    assert.equal(isChosenName('ticket-claude-config-175', src), true, `typed ${src}`);
    assert.equal(isChosenName('director-harness', src), true, `director ${src}`);
    assert.equal(isChosenName('some-other-name', src), false, `failsafe ${src}`);
    assert.equal(isChosenName('', src), false);
  }
  for (const src of ['user', 'peer']) assert.equal(isChosenName('code-42', src), true, src);
  for (const src of ['auto', 'derived', undefined]) assert.equal(isChosenName('code-42', src), false, `legacy ${src}`);
});

test('sessionKey: the typed name for a parsed one, the raw name for a custom one, null for none', () => {
  assert.equal(sessionKey('claude-config-62'), 'ticket-claude-config-62');
  assert.equal(sessionKey('director-harness'), 'director-harness');
  assert.equal(sessionKey('some-other-name'), 'some-other-name');
  assert.equal(sessionKey(''), null);
  assert.equal(sessionKey(undefined), null);
});

test('sessionName throws on bad input instead of building an unparseable name', () => {
  assert.throws(() => sessionName('bogus', 'x'), /type/);
  for (const t of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.throws(() => sessionName(t, 'repo', 5), /type/, t);
  assert.throws(() => sessionName('director'), /scope/);
  assert.throws(() => sessionName('director', 'Has Spaces'), /scope/);
  assert.throws(() => sessionName('general', 'trailing-'), /topic/);
  assert.throws(() => sessionName('ticket', 'repo'), /issue/);
  assert.throws(() => sessionName('ticket', 'repo', 'x7'), /issue/);
  assert.throws(() => sessionName('ticket', 'repo', 0), /issue/);
  assert.throws(() => sessionName('epic', 'My_Repo', 7), /repo/);
  assert.throws(() => sessionName('ticket', 'repo', 7, 'review', 2, 'extra'), /arguments/);
});

test('issueNumber normalizes leading zeros and rejects 0, and sessionName agrees', () => {
  assert.equal(issueNumber('0175'), '175');
  assert.equal(issueNumber(7), '7');
  for (const bad of ['0', '000', '', 'x7', -3, 1.5, undefined]) assert.equal(issueNumber(bad), null, String(bad));
  assert.equal(sessionName('ticket', 'claude-config', '0175'), 'ticket-claude-config-175');
  assert.throws(() => sessionName('ticket', 'claude-config', '000'), /issue/);
});

test('generalSessionName: one builder, slugified and capped at 4 words', () => {
  assert.equal(generalSessionName('One two-three four five'), 'general-one-two-three-four');
  assert.throws(() => generalSessionName('!!!'), /topic/);
});

test('slugify lowercases, joins words with hyphens and caps the word count', () => {
  assert.equal(slugify('Fix the Statusline!'), 'fix-the-statusline');
  assert.equal(slugify('one two three four five', 4), 'one-two-three-four');
  assert.equal(slugify('  --  '), '');
});

test('CLI prints exactly one launch line per type', () => {
  const run = (...a) => spawnHarness(cli, a);
  const cases = [
    [['director', 'harness'], 'claude -n director-harness'],
    [['epic', 'strate', '12'], 'claude -n epic-strate-12'],
    [['ticket', 'claude-config', '175'], 'claude -n ticket-claude-config-175'],
    [['general', 'Review', 'the', 'spend', 'audit', 'numbers'], 'claude -n general-review-the-spend-audit'],
  ];
  for (const [args, line] of cases) {
    const r = run(...args);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `${line}\n`);
  }
});

test('CLI slugifies repo and director scope the way worktree.mjs does', () => {
  assert.equal(spawnHarness(cli, ['ticket', 'Crawford-Young.github.io', '5']).stdout, 'claude -n ticket-crawford-young-github-io-5\n');
  assert.equal(spawnHarness(cli, ['director', 'Strate', 'Audit']).stdout, 'claude -n director-strate-audit\n');
  assert.equal(spawnHarness(cli, ['ticket', 'claude-config', '0175']).stdout, 'claude -n ticket-claude-config-175\n', 'leading zeros normalize as worktree.mjs does');
  assert.notEqual(spawnHarness(cli, ['ticket', 'claude-config', '0']).status, 0);
});

test('CLI dies with usage and a nonzero exit on bad input', () => {
  for (const args of [[], ['bogus', 'x'], ['constructor', 'repo', '5'], ['toString', 'x'], ['__proto__', 'x'], ['ticket', '...', '5'], ['ticket', 'repo'], ['ticket', 'repo', 'abc'], ['general'], ['general', '!!!']]) {
    const r = spawnHarness(cli, args);
    assert.notEqual(r.status, 0, args.join(' '));
    assert.equal(r.stdout, '', args.join(' '));
    assert.match(r.stderr, /usage: session-name\.mjs/, args.join(' '));
  }
});

test('ticket and epic names take an optional review|recon role; the bare form stays the implementer', () => {
  assert.equal(sessionName('ticket', 'claude-config', 233, 'review'), 'ticket-claude-config-233-review');
  assert.equal(sessionName('epic', 'strate', '012', 'recon'), 'epic-strate-12-recon');
  assert.equal(sessionName('ticket', 'claude-config', 233), 'ticket-claude-config-233');
  assert.throws(() => sessionName('ticket', 'repo', 5, 'implementer'), /role/);
  assert.throws(() => sessionName('ticket', 'repo', 5, 'Review'), /role/);
  assert.throws(() => sessionName('director', 'harness', 'review'), /arguments/);
  assert.throws(() => sessionName('ticket', 'repo', 5, 'review', 2, 'x'), /arguments/);
});

test('parseSessionName returns the role and keys a role-suffixed name to its ticket', () => {
  assert.deepEqual(parseSessionName('ticket-claude-config-233-review'), { type: 'ticket', repo: 'claude-config', issue: 233, legacy: false, role: 'review', name: 'ticket-claude-config-233', raw: 'ticket-claude-config-233-review' });
  assert.deepEqual(parseSessionName('Epic-dog-eat-dog-40-RECON'), { type: 'epic', repo: 'dog-eat-dog', issue: 40, legacy: false, role: 'recon', name: 'epic-dog-eat-dog-40', raw: 'Epic-dog-eat-dog-40-RECON' });
  assert.equal(sessionKey('ticket-repo-5-review'), sessionKey('ticket-repo-5'));
  assert.equal(sessionKey('ticket-repo-5-review'), sessionKey('repo-5'), 'a legacy window of the ticket joins too');
  assert.notEqual(sessionKey('epic-repo-5-review'), sessionKey('ticket-repo-5'));
  assert.equal(parseSessionName('ticket-repo-5').role, undefined);
});

test('a role-suffixed name never parses as a legacy ticket of another repo, and unknown roles stay unparsed', () => {
  assert.equal(parseSessionName('ticket-repo-5-review-3').repo, 'repo', 'the trailing number is the harness dedupe, not an issue');
  for (const raw of ['ticket-repo-5-implementer', 'ticket-repo-5-review-', 'ticket-repo-review', 'repo-5-review', 'review-214b', 'unit-226-review']) {
    assert.equal(parseSessionName(raw).name, null, raw);
  }
  assert.equal(parseSessionName('unit-226').repo, 'unit', 'legacy reading unchanged');
});

test('CLI takes the role as an optional extra argument', () => {
  assert.equal(spawnHarness(cli, ['ticket', 'claude-config', '233', 'review']).stdout, 'claude -n ticket-claude-config-233-review\n');
  assert.equal(spawnHarness(cli, ['epic', 'strate', '9', 'recon']).stdout, 'claude -n epic-strate-9-recon\n');
  for (const args of [['ticket', 'repo', '5', 'bogus'], ['ticket', 'repo', '5', 'review', 'x']]) {
    const r = spawnHarness(cli, args);
    assert.notEqual(r.status, 0, args.join(' '));
    assert.match(r.stderr, /usage: session-name\.mjs/, args.join(' '));
  }
});

test('a fresh dispatch on a named ticket/role takes a -r<K> round (K >= 2) after the role', () => {
  assert.equal(sessionName('ticket', 'claude-config', 233, undefined, 2), 'ticket-claude-config-233-r2');
  assert.equal(sessionName('ticket', 'claude-config', 233, 'review', 3), 'ticket-claude-config-233-review-r3');
  assert.equal(sessionName('epic', 'strate', 9, 'recon', 12), 'epic-strate-9-recon-r12');
  for (const bad of [1, 0, -2, 1.5, 'x']) assert.throws(() => sessionName('ticket', 'repo', 5, undefined, bad), /round/, String(bad));
  assert.throws(() => sessionName('ticket', 'repo', 5, 'review', 2, 'x'), /arguments/);
});

test('parseSessionName joins a round name to its ticket and keeps the role and round', () => {
  assert.deepEqual(parseSessionName('ticket-claude-config-233-r2'), { type: 'ticket', repo: 'claude-config', issue: 233, legacy: false, round: 2, name: 'ticket-claude-config-233', raw: 'ticket-claude-config-233-r2' });
  const p = parseSessionName('Ticket-Claude-Config-233-REVIEW-R3');
  assert.deepEqual([p.repo, p.issue, p.role, p.round, p.name], ['claude-config', 233, 'review', 3, 'ticket-claude-config-233']);
  assert.equal(sessionKey('ticket-repo-5-recon-r2'), sessionKey('repo-5'));
  for (const raw of ['ticket-repo-5-r1', 'ticket-repo-5-r0', 'ticket-repo-5-r', 'ticket-repo-5-r2-review']) assert.equal(parseSessionName(raw).name, null, raw);
});

test("the harness's own -N dedupe suffix parses back to the same ticket, never another repo and issue", () => {
  const p = parseSessionName('ticket-claude-config-233-2');
  assert.deepEqual([p.type, p.repo, p.issue, p.dedupe, p.name], ['ticket', 'claude-config', 233, 2, 'ticket-claude-config-233']);
  assert.equal(sessionKey('ticket-claude-config-233-review-2'), 'ticket-claude-config-233');
  assert.equal(parseSessionName('ticket-claude-config-233-review-2').role, 'review');
  assert.equal(parseSessionName('ticket-claude-config-233-r2-2').round, 2);
  assert.equal(parseSessionName('epic-strate-9-14').repo, 'strate');
  assert.equal(parseSessionName('ticket-repo-5').dedupe, undefined);
  assert.equal(parseSessionName('ticket-repo-5-1').repo, 'repo-5', 'the harness starts dedupe at 2, so -1 is an issue number');
});

test('CLI emits a round with --round', () => {
  assert.equal(spawnHarness(cli, ['ticket', 'claude-config', '235', '--round', '2']).stdout, 'claude -n ticket-claude-config-235-r2\n');
  assert.equal(spawnHarness(cli, ['ticket', 'claude-config', '235', 'review', '--round', '3']).stdout, 'claude -n ticket-claude-config-235-review-r3\n');
  for (const args of [['ticket', 'repo', '5', '--round', '1'], ['ticket', 'repo', '5', '--round'], ['ticket', 'repo', '5', '--bogus', '2'], ['director', 'x', '--round', '2']]) {
    const r = spawnHarness(cli, args);
    assert.notEqual(r.status, 0, args.join(' '));
    assert.match(r.stderr, /usage: session-name\.mjs/, args.join(' '));
  }
});

test('a harness-deduped role name (seen live: ticket-claude-config-214-review-2) keeps its repo, issue and role', () => {
  const p = parseSessionName('ticket-claude-config-214-review-2');
  assert.deepEqual([p.type, p.repo, p.issue, p.role, p.dedupe, p.name], ['ticket', 'claude-config', 214, 'review', 2, 'ticket-claude-config-214']);
  assert.equal(sessionKey('ticket-claude-config-214-review-2'), sessionKey('ticket-claude-config-214-review'));
});

// ---- tree names (#272): <dir>_<repo>[_e<N>][_t<N>][_<worker>[-r<K>]] -------------

const AGENT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/; // the Agent tool's name rule, tested 2026-10-16

test('sessionName builds a tree name level by level, `_` between levels', () => {
  assert.equal(sessionName('tree', 'harness', 'claude-config'), 'harness_claude-config');
  assert.equal(sessionName('tree', 'harness', 'claude-config', { epic: 176 }), 'harness_claude-config_e176');
  assert.equal(sessionName('tree', 'harness', 'claude-config', { epic: '176', ticket: 264 }), 'harness_claude-config_e176_t264');
  assert.equal(sessionName('tree', 'harness', 'claude-config', { ticket: '0264', worker: 'impl' }), 'harness_claude-config_t264_impl');
  assert.equal(sessionName('tree', 'harness', 'claude-config', { ticket: 264, worker: 'review', round: 2 }), 'harness_claude-config_t264_review-r2');
  assert.equal(sessionName('tree', 'strate-audit', 'dog-eat-dog', { worker: 'recon' }), 'strate-audit_dog-eat-dog_recon');
});

test('sessionName throws on a tree name that would not parse back or fit the Agent tool', () => {
  assert.throws(() => sessionName('tree', 'Harness', 'repo'), /scope/);
  assert.throws(() => sessionName('tree', 'harness'), /repo/);
  assert.throws(() => sessionName('tree', 'harness', 'my_repo'), /repo/);
  assert.throws(() => sessionName('tree', 'harness', 'repo', { epic: 0 }), /epic/);
  assert.throws(() => sessionName('tree', 'harness', 'repo', { ticket: 'x7' }), /ticket/);
  assert.throws(() => sessionName('tree', 'harness', 'repo', { worker: 'implementer' }), /worker/);
  assert.throws(() => sessionName('tree', 'harness', 'repo', { ticket: 5, round: 2 }), /round needs a worker/, 'a round marks a worker re-dispatch');
  for (const bad of [1, 0, 1.5, 'x']) assert.throws(() => sessionName('tree', 'harness', 'repo', { worker: 'impl', round: bad }), /round/, String(bad));
  assert.throws(() => sessionName('tree', 'harness', 'repo', { tciket: 5 }), /option/);
  assert.throws(() => sessionName('tree', 'harness', 'repo', {}, 'extra'), /arguments/);
  assert.throws(() => sessionName('tree', 'a'.repeat(40), 'b'.repeat(30)), /64/);
});

test('parseSessionName reads a tree name: its type, repo, issue, worker role, round and ticket key', () => {
  assert.deepEqual(parseSessionName('harness_claude-config'), { type: 'repo', tree: true, repo: 'claude-config', legacy: false, name: 'harness_claude-config', raw: 'harness_claude-config' });
  assert.deepEqual(parseSessionName('harness_claude-config_e176'), { type: 'epic', tree: true, repo: 'claude-config', issue: 176, legacy: false, name: 'epic-claude-config-176', raw: 'harness_claude-config_e176' });
  assert.deepEqual(parseSessionName('harness_claude-config_e176_t264'), { type: 'ticket', tree: true, repo: 'claude-config', issue: 264, legacy: false, name: 'ticket-claude-config-264', raw: 'harness_claude-config_e176_t264' });
  assert.deepEqual(parseSessionName('harness_claude-config_t264_review-r2'), { type: 'ticket', tree: true, repo: 'claude-config', issue: 264, role: 'review', round: 2, legacy: false, name: 'ticket-claude-config-264', raw: 'harness_claude-config_t264_review-r2' });
  const repoWorker = parseSessionName('harness_claude-config_impl');
  assert.deepEqual([repoWorker.type, repoWorker.role, repoWorker.name], ['repo', 'impl', 'harness_claude-config']);
  const epicWorker = parseSessionName('harness_claude-config_e176_recon');
  assert.deepEqual([epicWorker.type, epicWorker.issue, epicWorker.role, epicWorker.name], ['epic', 176, 'recon', 'epic-claude-config-176']);
});

test('a tree name joins its ticket or epic with the typed and legacy forms, whatever its dir', () => {
  assert.equal(sessionKey('harness_claude-config_t264_review-r2'), sessionKey('ticket-claude-config-264'));
  assert.equal(sessionKey('harness_claude-config_e176_t264'), sessionKey('claude-config-264'));
  assert.equal(sessionKey('other_claude-config_t264_impl'), sessionKey('harness_claude-config_t264'));
  assert.equal(sessionKey('harness_claude-config_e176'), sessionKey('epic-claude-config-176'));
  assert.notEqual(sessionKey('harness_claude-config_e5'), sessionKey('harness_claude-config_t5'), 'an epic and a ticket on one issue are different units');
  assert.equal(sessionKey('Harness_Claude-Config_T264'), 'ticket-claude-config-264', 'case-folded');
  for (const src of ['user', 'peer', 'auto', undefined]) assert.equal(isChosenName('harness_claude-config_t264', src), true, String(src));
});

test('a name outside the tree grammar never parses as one', () => {
  for (const raw of ['harness', 'harness_', '_claude-config', 'harness__claude-config', 'harness_claude-config_', 'harness.claude-config', 'harness_claude-config_t264_e176', 'harness_claude-config_t0', 'harness_claude-config_e01', 'harness_claude-config_t264_implementer', 'harness_claude-config_t264_review-r1', 'harness_claude-config_t264-r2', 'harness_claude-config_t264_impl_recon', 'harness_claude_config', 'harness_claude-config_t264_impl-2']) {
    assert.equal(parseSessionName(raw).name, null, raw);
  }
});

test('every built tree name parses back to its unit and worker and fits the Agent tool', () => {
  const cases = [
    [{}, 'repo', 'harness_dog-eat-dog'],
    [{ epic: 9 }, 'epic', 'epic-dog-eat-dog-9'],
    [{ epic: 9, ticket: 10 }, 'ticket', 'ticket-dog-eat-dog-10'],
    [{ ticket: 10, worker: 'impl' }, 'ticket', 'ticket-dog-eat-dog-10'],
    [{ epic: 9, ticket: 10, worker: 'review', round: 12 }, 'ticket', 'ticket-dog-eat-dog-10'],
    [{ worker: 'recon' }, 'repo', 'harness_dog-eat-dog'],
  ];
  for (const [opts, type, key] of cases) {
    const name = sessionName('tree', 'harness', 'dog-eat-dog', opts);
    assert.match(name, AGENT_NAME_RE, name);
    const p = parseSessionName(name);
    assert.deepEqual([p.tree, p.type, p.repo, p.name, p.role, p.round], [true, type, 'dog-eat-dog', key, opts.worker, opts.round], name);
  }
});

test('CLI prints a bare tree name for an Agent dispatch', () => {
  const run = (...a) => spawnHarness(cli, a);
  assert.equal(run('tree', 'harness', 'claude-config').stdout, 'harness_claude-config\n');
  assert.equal(run('tree', 'Harness', 'Claude-Config', '--epic', '176').stdout, 'harness_claude-config_e176\n', 'dir and repo slugified');
  assert.equal(run('tree', 'harness', 'claude-config', '--epic', '176', '--ticket', '264').stdout, 'harness_claude-config_e176_t264\n');
  assert.equal(run('tree', 'harness', 'claude-config', '--ticket', '264', '--worker', 'review', '--round', '2').stdout, 'harness_claude-config_t264_review-r2\n');
  for (const args of [['tree', 'harness'], ['tree', 'harness', 'repo', 'extra'], ['tree', 'harness', 'repo', '--worker', 'bogus'], ['tree', 'harness', 'repo', '--round', '2'], ['tree', 'harness', 'repo', '--ticket'], ['tree', 'harness', 'repo', '--bogus', '1'], ['ticket', 'repo', '5', '--epic', '3']]) {
    const r = run(...args);
    assert.notEqual(r.status, 0, args.join(' '));
    assert.equal(r.stdout, '', args.join(' '));
    assert.match(r.stderr, /usage: session-name\.mjs/, args.join(' '));
  }
  assert.match(run('tree', 'harness', 'repo', '--ticket', '5', '--round', '2').stderr, /round needs a worker \(--worker/);
});

// ---- branchIssue / worktreeTicketName (#344) ----

test('branchIssue reads the number a slug or branch leads with, after at most one prefix segment', () => {
  assert.equal(branchIssue('72-foo'), '72');
  assert.equal(branchIssue('feat/72-foo'), '72');
  assert.equal(branchIssue('fix/72-foo'), '72');
  assert.equal(branchIssue('chore/072-foo'), '72');
  assert.equal(branchIssue('007-foo'), '7');
});

test('branchIssue is null with no leading number, a zero number, or a two-segment prefix', () => {
  for (const s of ['0-foo', 'feat/0-foo', 'feat/foo', 'foo-72', 'feat/foo-72', 'a/b/72-x', 'release/2026-10', 'hotfix/1-2-patch', '72', 'feat/72', '', null, undefined]) {
    assert.equal(branchIssue(s), null, String(s));
  }
});

/** A temp repo `<root>/<name>` with one commit; returns its path. */
function tempRepo(name) {
  const repo = join(tempDir('wtn-'), name);
  mkdirSync(repo);
  git(repo, 'init', '-b', 'main');
  git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init');
  return repo;
}
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });

test('worktreeTicketName names a linked worktree on a numbered branch after the main checkout folder', () => {
  const repo = tempRepo('My_App');
  const wt = join(dirname(repo), 'wt-12');
  git(repo, 'worktree', 'add', '-b', 'chore/12-x', wt);
  assert.equal(worktreeTicketName(wt), 'ticket-my-app-12');
});

test('worktreeTicketName is null for the main checkout, an unnumbered branch, and a non-repo dir', () => {
  const repo = tempRepo('app');
  assert.equal(worktreeTicketName(repo), null);
  const wt = join(dirname(repo), 'wt-nonum');
  git(repo, 'worktree', 'add', '-b', 'feat/no-number', wt);
  assert.equal(worktreeTicketName(wt), null);
  assert.equal(worktreeTicketName(tempDir('plain-')), null);
});

test('worktreeTicketName follows a branch switch inside the worktree', () => {
  const repo = tempRepo('app');
  const wt = join(dirname(repo), 'wt-sw');
  git(repo, 'worktree', 'add', '-b', 'feat/77-a', wt);
  assert.equal(worktreeTicketName(wt), 'ticket-app-77');
  git(wt, 'switch', '-c', 'scratch');
  assert.equal(worktreeTicketName(wt), null);
});
