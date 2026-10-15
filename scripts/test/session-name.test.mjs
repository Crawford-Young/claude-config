// node --test scripts/test/session-name.test.mjs — typed session names (#175):
// lib's sessionName/parseSessionName/sessionKey and the session-name.mjs CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnHarness } from './_spawn.mjs';
import { generalSessionName, isChosenName, issueNumber, parseSessionName, sessionKey, sessionName, slugify } from '../lib.mjs';

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
  assert.throws(() => sessionName('ticket', 'repo', 7, 'review', 'extra'), /arguments/);
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
  assert.throws(() => sessionName('ticket', 'repo', 5, 'review', 'x'), /arguments/);
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
  assert.equal(parseSessionName('ticket-repo-5-review-3').repo, 'repo-5-review', 'the trailing number is still the issue');
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
