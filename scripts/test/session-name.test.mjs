// node --test scripts/test/session-name.test.mjs — agent names by role + charge (#360):
// lib's agentName/parseAgentName/chargeKey/isChosenName, the legacy forms, and the session-name.mjs CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { spawnHarness, tempDir } from './_spawn.mjs';
import * as lib from '../lib.mjs';
import { agentName, branchIssue, CHARGE_KINDS, chargeKey, isChosenName, issueNumber, parseAgentName, slugify, TOPIC_WORDS, worktreeChargeKey } from '../lib.mjs';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'session-name.mjs');
const AGENT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/; // the Agent tool's `name` schema, CC 2.1.314

// ---- the grammar: <role>_<kind>_<target> ----------------------------------------

test('CHARGE_KINDS lists the five kinds, and the old session-name exports are gone', () => {
  assert.deepEqual(CHARGE_KINDS, ['repo', 'epic', 'issue', 'pr', 'topic']);
  for (const gone of ['sessionName', 'parseSessionName', 'sessionKey', 'generalSessionName', 'worktreeTicketName', 'worktreeAgentName']) assert.equal(lib[gone], undefined, gone);
  assert.equal(TOPIC_WORDS, 4);
});

test('agentName builds <role>_<kind>_<target> for every kind', () => {
  assert.equal(agentName('impl', 'issue', 'strate', 16), 'impl_issue_strate-16');
  assert.equal(agentName('lead', 'repo', 'strate'), 'lead_repo_strate');
  assert.equal(agentName('researcher', 'topic', 'pricing'), 'researcher_topic_pricing');
  assert.equal(agentName('manager', 'epic', 'strate', '105'), 'manager_epic_strate-105');
  assert.equal(agentName('review', 'pr', 'strate', 31), 'review_pr_strate-31');
  assert.equal(agentName('review-2', 'issue', 'claude-config', '0360'), 'review-2_issue_claude-config-360', 'leading zeros drop, as issueNumber does');
});

test('agentName throws on a bad role, kind, repo, topic, number, arity or length', () => {
  assert.throws(() => agentName('Impl', 'issue', 'strate', 16), /role/);
  assert.throws(() => agentName('my_role', 'repo', 'strate'), /role/);
  assert.throws(() => agentName('', 'repo', 'strate'), /role/);
  assert.throws(() => agentName('impl', 'ticket', 'strate', 16), /kind/);
  for (const k of ['constructor', 'toString', '__proto__']) assert.throws(() => agentName('impl', k, 'strate'), /kind/, k);
  assert.throws(() => agentName('impl', 'issue', 'My_Repo', 16), /repo/);
  assert.throws(() => agentName('impl', 'repo', 'a-'), /repo/);
  assert.throws(() => agentName('impl', 'topic', 'has spaces'), /topic/);
  for (const bad of [0, '0', 'x7', -3, 1.5, undefined]) assert.throws(() => agentName('impl', 'issue', 'strate', bad), /number/, String(bad));
  assert.throws(() => agentName('impl', 'repo', 'strate', 5), /arguments for a repo charge/);
  assert.throws(() => agentName('impl', 'issue', 'strate', 5, 6), /arguments for an issue charge/);
  assert.throws(() => agentName('impl', 'epic', 'strate'), /arguments for an epic charge/);
  assert.throws(() => agentName('impl', 'pr', 'strate'), /arguments for a pr charge/);
  assert.throws(() => agentName('impl', 'topic'), /arguments for a topic charge/);
  assert.throws(() => agentName('r'.repeat(40), 'repo', 'b'.repeat(20)), /64/);
});

test('parseAgentName reads the new grammar: role, charge, key, form and raw', () => {
  assert.deepEqual(parseAgentName('manager_epic_strate-105'), { role: 'manager', charge: { kind: 'epic', repo: 'strate', number: 105 }, key: 'epic_strate-105', form: 'agent', raw: 'manager_epic_strate-105' });
  assert.deepEqual(parseAgentName('lead_repo_strate'), { role: 'lead', charge: { kind: 'repo', repo: 'strate' }, key: 'repo_strate', form: 'agent', raw: 'lead_repo_strate' });
  assert.deepEqual(parseAgentName('researcher_topic_pricing'), { role: 'researcher', charge: { kind: 'topic', topic: 'pricing' }, key: 'topic_pricing', form: 'agent', raw: 'researcher_topic_pricing' });
  assert.deepEqual(parseAgentName('review_pr_strate-31').charge, { kind: 'pr', repo: 'strate', number: 31 });
  assert.equal(parseAgentName('impl_issue_claude-config-360').key, 'issue_claude-config-360');
});

test('the LAST -<digits> of an issue/epic/pr target is the number, so the repo slug is greedy', () => {
  assert.deepEqual(parseAgentName('impl_issue_repo-5-2').charge, { kind: 'issue', repo: 'repo-5', number: 2 });
  assert.deepEqual(parseAgentName('impl_epic_dog-eat-dog-40').charge, { kind: 'epic', repo: 'dog-eat-dog', number: 40 });
  for (const raw of ['impl_issue_strate', 'impl_issue_strate-0', 'impl_issue_strate-05', 'impl_pr_-5', 'impl_repo_strate-', 'impl_topic_a--b', 'impl_bogus_strate', '_issue_strate-5', 'impl__strate', 'impl_issue_strate-5_x', 'impl.issue.strate-5']) {
    assert.equal(parseAgentName(raw), null, raw);
  }
});

test('every built name round-trips through the parser and fits the Agent tool', () => {
  const cases = [
    [['impl', 'issue', 'strate', 16], { kind: 'issue', repo: 'strate', number: 16 }],
    [['lead', 'repo', 'claude-config'], { kind: 'repo', repo: 'claude-config' }],
    [['researcher', 'topic', 'llm-pricing'], { kind: 'topic', topic: 'llm-pricing' }],
    [['manager', 'epic', 'repo2', 9], { kind: 'epic', repo: 'repo2', number: 9 }],
    [['review-2', 'pr', 'a-1', 3], { kind: 'pr', repo: 'a-1', number: 3 }],
  ];
  for (const [args, charge] of cases) {
    const name = agentName(...args);
    assert.match(name, AGENT_NAME_RE, name);
    const p = parseAgentName(name);
    assert.deepEqual([p.role, p.charge, p.form], [args[0], charge, 'agent'], name);
    assert.equal(p.key, name.slice(name.indexOf('_') + 1), 'the key is the name minus its role');
  }
});

test('parseAgentName trims and case-folds, keeping raw as given; null for missing, empty or unparseable', () => {
  const p = parseAgentName('  Impl_Issue_Claude-Config-360 ');
  assert.deepEqual([p.role, p.key, p.raw], ['impl', 'issue_claude-config-360', '  Impl_Issue_Claude-Config-360 ']);
  for (const raw of [undefined, null, 42, '', '   ', 'code-4c', 'some-other-name', 'Agent orchestration app naming', 'ticket-repo', 'director-', 'repo-0', 'harness']) {
    assert.equal(parseAgentName(raw), null, String(raw));
  }
});

// ---- legacy forms ---------------------------------------------------------------

test('legacy typed names map to the same charge shape, with the suffix role', () => {
  assert.deepEqual(parseAgentName('ticket-claude-config-175'), { role: null, charge: { kind: 'issue', repo: 'claude-config', number: 175 }, key: 'issue_claude-config-175', form: 'typed', raw: 'ticket-claude-config-175' });
  assert.deepEqual(parseAgentName('epic-dog-eat-dog-40-recon'), { role: 'recon', charge: { kind: 'epic', repo: 'dog-eat-dog', number: 40 }, key: 'epic_dog-eat-dog-40', form: 'typed', raw: 'epic-dog-eat-dog-40-recon' });
  assert.deepEqual(parseAgentName('director-strate-audit'), { role: 'director', charge: { kind: 'topic', topic: 'strate-audit' }, key: 'topic_strate-audit', form: 'typed', raw: 'director-strate-audit' });
  assert.deepEqual(parseAgentName('general-spend-review'), { role: null, charge: { kind: 'topic', topic: 'spend-review' }, key: 'topic_spend-review', form: 'typed', raw: 'general-spend-review' });
  const p = parseAgentName('ticket-claude-config-214-review-r3-2');
  assert.deepEqual([p.role, p.key], ['review', 'issue_claude-config-214'], 'round and dedupe suffixes drop');
  assert.equal(parseAgentName('ticket-repo-5-2').key, 'issue_repo-5', "a lazy repo: -2 is the harness's dedupe");
  assert.equal(parseAgentName('ticket-repo-5-1').key, 'issue_repo-5-1', 'dedupe starts at 2, so -1 is an issue number');
  for (const raw of ['ticket-repo-5-implementer', 'ticket-repo-5-review-', 'ticket-repo-5-r1', 'ticket-repo-5-r2-review', 'repo-5-review']) assert.equal(parseAgentName(raw), null, raw);
});

test('legacy tree names key to their ticket, else epic, else repo, with the worker as role', () => {
  assert.deepEqual(parseAgentName('what-is-dark_what-is-dark_t23_review-r3'), { role: 'review', charge: { kind: 'issue', repo: 'what-is-dark', number: 23 }, key: 'issue_what-is-dark-23', form: 'tree', raw: 'what-is-dark_what-is-dark_t23_review-r3' });
  assert.deepEqual(parseAgentName('gmail-cleanup_inbox_e202306_t2_impl'), { role: 'impl', charge: { kind: 'issue', repo: 'inbox', number: 2 }, key: 'issue_inbox-2', form: 'tree', raw: 'gmail-cleanup_inbox_e202306_t2_impl' });
  assert.deepEqual(parseAgentName('harness_claude-config_t360'), { role: null, charge: { kind: 'issue', repo: 'claude-config', number: 360 }, key: 'issue_claude-config-360', form: 'tree', raw: 'harness_claude-config_t360' });
  assert.equal(parseAgentName('harness_claude-config_e176').key, 'epic_claude-config-176');
  assert.deepEqual(parseAgentName('harness_claude-config_recon').charge, { kind: 'repo', repo: 'claude-config' });
  for (const raw of ['harness_', '_claude-config', 'harness__claude-config', 'harness_claude-config_t264_e176', 'harness_claude-config_t0', 'harness_claude-config_t264_implementer', 'harness_claude-config_t264_impl_recon', 'harness_claude-config_t264_review-r1']) {
    assert.equal(parseAgentName(raw), null, raw);
  }
});

test('the new grammar wins over a tree reading of the same name', () => {
  assert.deepEqual([parseAgentName('x_repo_impl').form, parseAgentName('x_repo_impl').key], ['agent', 'repo_impl']);
  assert.equal(parseAgentName('x_issue_t5').form, 'tree', 'not an issue target, so it falls through to the tree form');
});

test('a charge key on its own, <kind>_<target>, parses as that charge with no role, form charge', () => {
  assert.deepEqual(parseAgentName('issue_x-5'), { role: null, charge: { kind: 'issue', repo: 'x', number: 5 }, key: 'issue_x-5', form: 'charge', raw: 'issue_x-5' });
  assert.deepEqual(parseAgentName('repo_strate').charge, { kind: 'repo', repo: 'strate' });
  assert.deepEqual(parseAgentName('Topic_Harness').charge, { kind: 'topic', topic: 'harness' });
  assert.deepEqual(parseAgentName('epic_dog-eat-dog-40').charge, { kind: 'epic', repo: 'dog-eat-dog', number: 40 });
  for (const raw of ['issue_x', 'pr_x-0', 'bogus_x-5']) assert.notEqual(parseAgentName(raw)?.form, 'charge', raw);
  for (const name of ['impl_issue_x-5', 'ticket-x-5', 'issue_x-5']) assert.equal(chargeKey(name), 'issue_x-5', name);
  assert.equal(chargeKey(chargeKey('harness_claude-config_t360')), 'issue_claude-config-360', 'a key round-trips through chargeKey');
  for (const src of ['auto', undefined]) assert.equal(isChosenName('issue_x-5', src), true, 'a charge form is not bare');
});

test('a bare <slug>-<N> is an issue of its slug, form bare', () => {
  assert.deepEqual(parseAgentName('claude-config-62'), { role: null, charge: { kind: 'issue', repo: 'claude-config', number: 62 }, key: 'issue_claude-config-62', form: 'bare', raw: 'claude-config-62' });
});

test('every form of one charge shares its key', () => {
  const key = 'issue_claude-config-264';
  for (const name of ['impl_issue_claude-config-264', 'review-2_issue_claude-config-264', 'ticket-claude-config-264', 'ticket-claude-config-264-review-2', 'harness_claude-config_e176_t264_impl', 'claude-config-264', 'Ticket-Claude-Config-264']) {
    assert.equal(chargeKey(name), key, name);
  }
  assert.notEqual(chargeKey('epic-repo-5'), chargeKey('ticket-repo-5'), 'an epic and an issue on one number are different charges');
  assert.notEqual(chargeKey('review_pr_repo-5'), chargeKey('impl_issue_repo-5'), 'a PR and an issue are different charges');
});

test('chargeKey: the parsed key, else the trimmed title, else null', () => {
  assert.equal(chargeKey('director-harness'), 'topic_harness');
  assert.equal(chargeKey('  some-other-name '), 'some-other-name');
  assert.equal(chargeKey(''), null);
  assert.equal(chargeKey('   '), null);
  assert.equal(chargeKey(undefined), null);
});

test('isChosenName: any parsed non-bare form whatever the source; a bare one only when user- or peer-set; the failsafe never', () => {
  for (const src of ['user', 'peer', 'auto', 'derived', undefined]) {
    for (const name of ['impl_issue_claude-config-360', 'ticket-claude-config-175', 'director-harness', 'harness_claude-config_t264']) assert.equal(isChosenName(name, src), true, `${name} ${src}`);
    assert.equal(isChosenName('some-other-name', src), false, `failsafe ${src}`);
    assert.equal(isChosenName('', src), false);
    assert.equal(isChosenName(undefined, src), false);
  }
  for (const src of ['user', 'peer']) assert.equal(isChosenName('code-42', src), true, src);
  for (const src of ['auto', 'derived', undefined]) assert.equal(isChosenName('code-42', src), false, `bare ${src}`);
});

// ---- kept helpers ---------------------------------------------------------------

test('issueNumber normalizes leading zeros and rejects 0', () => {
  assert.equal(issueNumber('0175'), '175');
  assert.equal(issueNumber(7), '7');
  for (const bad of ['0', '000', '', 'x7', -3, 1.5, undefined]) assert.equal(issueNumber(bad), null, String(bad));
});

test('slugify lowercases, joins words with hyphens and caps the word count', () => {
  assert.equal(slugify('Fix the Statusline!'), 'fix-the-statusline');
  assert.equal(slugify('one two three four five', 4), 'one-two-three-four');
  assert.equal(slugify('  --  '), '');
});

// ---- CLI ------------------------------------------------------------------------

test('CLI prints exactly the bare name for each kind', () => {
  const cases = [
    [['impl', 'issue', 'claude-config', '360'], 'impl_issue_claude-config-360'],
    [['manager', 'epic', 'strate', '105'], 'manager_epic_strate-105'],
    [['review', 'pr', 'strate', '31'], 'review_pr_strate-31'],
    [['lead', 'repo', 'strate'], 'lead_repo_strate'],
    [['researcher', 'topic', 'Review', 'the', 'spend', 'audit', 'numbers'], 'researcher_topic_review-the-spend-audit'],
  ];
  for (const [args, name] of cases) {
    const r = spawnHarness(cli, args);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `${name}\n`);
  }
});

test('CLI slugifies role and repo, and normalizes the number', () => {
  assert.equal(spawnHarness(cli, ['Review 2', 'issue', 'Crawford-Young.github.io', '05']).stdout, 'review-2_issue_crawford-young-github-io-5\n');
  assert.equal(spawnHarness(cli, ['Lead', 'repo', 'My_App']).stdout, 'lead_repo_my-app\n');
});

test('CLI dies with usage and a nonzero exit on bad input, flags included', () => {
  for (const args of [[], ['impl'], ['impl', 'issue'], ['impl', 'bogus', 'x'], ['impl', 'ticket', 'repo', '5'], ['impl', 'issue', 'repo'], ['impl', 'issue', 'repo', '0'], ['impl', 'issue', 'repo', '5', '6'], ['impl', 'repo', 'a', 'b'], ['impl', 'topic', '!!!'], ['!!!', 'repo', 'x'], ['impl', 'issue', 'repo', '5', '--round', '2'], ['tree', 'harness', 'repo']]) {
    const r = spawnHarness(cli, args);
    assert.notEqual(r.status, 0, args.join(' '));
    assert.equal(r.stdout, '', args.join(' '));
    assert.match(r.stderr, /usage: session-name\.mjs <role> <kind> <target/, args.join(' '));
  }
});

// ---- branchIssue / worktreeChargeKey (#344) -------------------------------------

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

test('worktreeChargeKey keys a linked worktree on a numbered branch issue_<repo>-<N>, role-less, repo from the main checkout folder', () => {
  const repo = tempRepo('My_App');
  const wt = join(dirname(repo), 'wt-12');
  git(repo, 'worktree', 'add', '-b', 'chore/12-x', wt);
  assert.equal(worktreeChargeKey(wt), 'issue_my-app-12');
});

test('worktreeChargeKey is null for the main checkout, an unnumbered branch, and a non-repo dir', () => {
  const repo = tempRepo('app');
  assert.equal(worktreeChargeKey(repo), null);
  const wt = join(dirname(repo), 'wt-nonum');
  git(repo, 'worktree', 'add', '-b', 'feat/no-number', wt);
  assert.equal(worktreeChargeKey(wt), null);
  assert.equal(worktreeChargeKey(tempDir('plain-')), null);
});

test('worktreeChargeKey follows a branch switch inside the worktree', () => {
  const repo = tempRepo('app');
  const wt = join(dirname(repo), 'wt-sw');
  git(repo, 'worktree', 'add', '-b', 'feat/77-a', wt);
  assert.equal(worktreeChargeKey(wt), 'issue_app-77');
  git(wt, 'switch', '-c', 'scratch');
  assert.equal(worktreeChargeKey(wt), null);
});
