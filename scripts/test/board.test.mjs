// node --test scripts/test/board.test.mjs — gh is stubbed via BOARD_GH; never the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnHarness, tempDir } from './_spawn.mjs';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveStatus, parseRef, STATUS } from '../board.mjs';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
const board = join(scripts, 'board.mjs');

// ---- pure rules ----

test('parseRef reads repo#N, owner/repo#N and issue URLs; owner defaults to Crawford-Young', () => {
  assert.deepEqual(parseRef('claude-config#149'), { owner: 'Crawford-Young', repo: 'claude-config', number: 149 });
  assert.deepEqual(parseRef('acme/widgets#7'), { owner: 'acme', repo: 'widgets', number: 7 });
  assert.deepEqual(parseRef('https://github.com/acme/widgets/issues/12'), { owner: 'acme', repo: 'widgets', number: 12 });
  for (const bad of ['', 'claude-config', '#4', 'repo#x', 'https://github.com/a/b/pull/3', 'a/b/c#1']) {
    assert.equal(parseRef(bad), null, bad);
  }
});

const issue = (o = {}) => ({ owner: 'Crawford-Young', repo: 'app', state: 'OPEN', labels: [], openPr: false, ...o });

test('deriveStatus: closed → Done, open closing PR → Review, in-progress label → In Progress, else Todo', () => {
  const prod = new Set();
  assert.equal(deriveStatus(issue({ state: 'CLOSED', labels: ['in-progress'] }), prod), 'Done');
  assert.equal(deriveStatus(issue({ openPr: true, labels: ['in-progress'] }), prod), 'Review');
  assert.equal(deriveStatus(issue({ labels: ['bug', 'in-progress'] }), prod), 'In Progress');
  assert.equal(deriveStatus(issue({ labels: ['bug'] }), prod), 'Todo');
});

test('deriveStatus leaves closed issues in prod repos alone (the QA pass is human)', () => {
  assert.equal(deriveStatus(issue({ state: 'CLOSED' }), new Set(['app'])), null);
  // prod only names the owner's own repos
  assert.equal(deriveStatus(issue({ state: 'CLOSED', owner: 'acme' }), new Set(['app'])), 'Done');
});

test('deriveStatus never yields Done for an open issue (Auto-close would close it)', () => {
  for (const openPr of [true, false]) {
    for (const labels of [[], ['in-progress']]) {
      for (const prod of [new Set(), new Set(['app'])]) {
        assert.notEqual(deriveStatus(issue({ openPr, labels }), prod), 'Done');
      }
    }
  }
});

test('STATUS carries the five board options with their ids', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, [v.name, v.id]])),
    {
      todo: ['Todo', 'f75ad846'],
      'in-progress': ['In Progress', '47fc9ee4'],
      review: ['Review', '00c726f9'],
      qa: ['QA', 'dce02d7a'],
      done: ['Done', '98236657'],
    },
  );
});

// ---- CLI against a stubbed gh ----

/**
 * A node script standing in for `gh`. It logs every argv (one JSON line each) and answers from
 * the fixture: repo list, issue view/edit, item-add, item-edit (remembered for the read-back),
 * and graphql pages by kind, served in call order.
 */
function ghStub(fx) {
  const dir = tempDir('board-gh-');
  const files = { fx: join(dir, 'fx.json'), log: join(dir, 'calls.jsonl'), state: join(dir, 'state.json') };
  writeFileSync(files.fx, JSON.stringify(fx));
  writeFileSync(files.state, JSON.stringify({ pages: {}, option: null }));
  const script = join(dir, 'gh.mjs');
  writeFileSync(
    script,
    `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const F = ${JSON.stringify(files)};
const a = process.argv.slice(2);
appendFileSync(F.log, JSON.stringify(a) + '\\n');
const fx = JSON.parse(readFileSync(F.fx, 'utf8'));
const st = JSON.parse(readFileSync(F.state, 'utf8'));
const save = () => writeFileSync(F.state, JSON.stringify(st));
const out = (v) => process.stdout.write(typeof v === 'string' ? v + '\\n' : JSON.stringify(v));
if (fx.hang) await new Promise((r) => setTimeout(r, 3000));
if (fx.fail) { process.stderr.write('gh: auth required\\n'); process.exit(1); }
const page = (kind) => { const i = st.pages[kind] ?? 0; st.pages[kind] = i + 1; save(); return fx[kind][i]; };
if (a[0] === 'repo' && a[1] === 'list') out(fx.repos);
else if (a[0] === 'issue' && a[1] === 'view') out(fx.issueState);
else if (a[0] === 'issue' && a[1] === 'edit') out('');
else if (a[0] === 'project' && a[1] === 'item-add') out(fx.addIds?.[a[a.indexOf('--url') + 1]] ?? fx.itemId ?? 'PVTI_new');
else if (a[0] === 'project' && a[1] === 'item-edit') { st.option = a[a.indexOf('--single-select-option-id') + 1]; save(); }
else if (a[0] === 'api') {
  const q = a.find((x) => x.startsWith('query=')) ?? '';
  if (q.includes('node(id')) {
    const name = fx.readback ?? (fx.options[st.option] ?? null);
    out({ data: { node: { fieldValueByName: name ? { name } : null } } });
  } else if (q.includes('projectV2(number')) out(page('boardPages'));
  else if (q.includes('issues(states')) out(page('issuePages'));
  else process.exit(2);
} else process.exit(2);
`,
  );
  return {
    env: { BOARD_GH: JSON.stringify([process.execPath, script]) },
    calls: () => (existsSync(files.log) ? readFileSync(files.log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
  };
}

const OPTIONS = Object.fromEntries(Object.values(STATUS).map((s) => [s.id, s.name]));
const runBoard = (args, stub) => spawnHarness(board, args, { env: stub.env });
const verb = (calls, a, b) => calls.filter((c) => c[0] === a && c[1] === b);

test('start labels the issue, adds it, sets In Progress, reads back and prints the move', () => {
  const stub = ghStub({ options: OPTIONS, itemId: 'PVTI_149' });
  const r = runBoard(['start', 'claude-config#149'], stub);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Board: claude-config#149 -> In Progress$/m);
  const calls = stub.calls();
  assert.deepEqual(verb(calls, 'issue', 'edit')[0], ['issue', 'edit', '149', '--repo', 'Crawford-Young/claude-config', '--add-label', 'in-progress']);
  const add = verb(calls, 'project', 'item-add')[0];
  assert.ok(add.includes('https://github.com/Crawford-Young/claude-config/issues/149'), add.join(' '));
  const edit = verb(calls, 'project', 'item-edit')[0];
  assert.equal(edit[edit.indexOf('--id') + 1], 'PVTI_149');
  assert.equal(edit[edit.indexOf('--single-select-option-id') + 1], STATUS['in-progress'].id);
  assert.ok(calls.some((c) => c[0] === 'api' && c.some((x) => x.includes('node(id'))), 'read back by node id');
});

test('a read-back that disagrees exits nonzero', () => {
  const stub = ghStub({ options: OPTIONS, readback: 'Todo' });
  const r = runBoard(['set', 'claude-config#149', 'review'], stub);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Todo/);
});

test('set done refuses an OPEN issue and mutates nothing', () => {
  const stub = ghStub({ options: OPTIONS, issueState: 'OPEN' });
  const r = runBoard(['set', 'strate#3', 'done'], stub);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /open/i);
  const calls = stub.calls();
  assert.equal(verb(calls, 'project', 'item-add').length, 0);
  assert.equal(verb(calls, 'project', 'item-edit').length, 0);
});

test('set done on a CLOSED issue goes through', () => {
  const stub = ghStub({ options: OPTIONS, issueState: 'CLOSED' });
  const r = runBoard(['set', 'https://github.com/Crawford-Young/strate/issues/3', 'done'], stub);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Board: strate#3 -> Done$/m);
});

test('unknown status or ref is a usage error with no gh calls', () => {
  const stub = ghStub({ options: OPTIONS });
  assert.notEqual(runBoard(['set', 'strate#3', 'shipped'], stub).status, 0);
  assert.notEqual(runBoard(['start', 'strate'], stub).status, 0);
  assert.notEqual(runBoard([], stub).status, 0);
  assert.deepEqual(stub.calls(), []);
});

// Sweep fixture: two live repos (one prod), one non-live repo; board holds a mix.
const REPOS = [
  { name: 'app', repositoryTopics: [{ name: 'board' }] },
  { name: 'shop', repositoryTopics: [{ name: 'board' }, { name: 'prod' }] },
  { name: 'old', repositoryTopics: [] },
];
const openIssue = (n, repo, onBoard) => ({
  number: n,
  projectItems: { nodes: onBoard ? [{ project: { id: 'PVT_kwHOCI55484BmvMX' } }] : [{ project: { id: 'PVT_other' } }] },
});
const ISSUE_PAGES = [
  {
    data: {
      r0: { issues: { pageInfo: { hasNextPage: true, endCursor: 'a1' }, nodes: [openIssue(1, 'app', true), openIssue(2, 'app', false)] } },
      r1: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [openIssue(5, 'shop', true)] } },
    },
  },
  { data: { r0: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [openIssue(3, 'app', false)] } } } },
];
const item = (id, status, content) => ({ id, fieldValueByName: status ? { name: status } : null, content });
const iss = (repo, number, state, { labels = [], prs = [], owner = 'Crawford-Young' } = {}) => ({
  __typename: 'Issue',
  number,
  state,
  repository: { name: repo, owner: { login: owner } },
  labels: { nodes: labels.map((name) => ({ name })) },
  closedByPullRequestsReferences: { nodes: prs.map((state) => ({ state })) },
});
const BOARD_PAGES = [
  {
    data: {
      user: {
        projectV2: {
          items: {
            pageInfo: { hasNextPage: true, endCursor: 'b1' },
            nodes: [
              item('I1', 'Todo', iss('app', 1, 'OPEN')), // in sync
              item('I4', 'Todo', iss('app', 4, 'OPEN', { labels: ['in-progress'] })), // drift → In Progress
              item('I6', 'Todo', iss('app', 6, 'OPEN', { labels: ['in-progress'], prs: ['MERGED', 'OPEN'] })), // drift → Review
              item('IX', 'Todo', { __typename: 'DraftIssue' }), // skipped
            ],
          },
        },
      },
    },
  },
  {
    data: {
      user: {
        projectV2: {
          items: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              item('I7', 'In Progress', iss('app', 7, 'CLOSED', { prs: ['MERGED'] })), // drift → Done
              item('I8', 'QA', iss('shop', 8, 'CLOSED')), // prod closed: left alone
              item('I9', null, iss('notes', 9, 'OPEN', { owner: 'acme' })), // null status → Todo
              item('I10', 'Review', iss('app', 10, 'OPEN', { labels: ['in-progress'], prs: ['MERGED'] })), // merged PR ≠ open → In Progress
              item('IP', 'Todo', { __typename: 'PullRequest' }), // skipped
            ],
          },
        },
      },
    },
  },
];
const sweepFx = (extra = {}) => ({ options: OPTIONS, repos: REPOS, issuePages: ISSUE_PAGES, boardPages: BOARD_PAGES, ...extra });
const DRIFT = [
  'drift app#4 Todo -> In Progress',
  'drift app#6 Todo -> Review',
  'drift app#7 In Progress -> Done',
  'drift acme/notes#9 none -> Todo',
  'drift app#10 Review -> In Progress',
];

test('sweep adds open live-repo issues missing from the board, across pages, even without --apply', () => {
  const stub = ghStub(sweepFx());
  const r = runBoard(['sweep'], stub);
  assert.equal(r.status, 0, r.stderr);
  const added = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('added '));
  assert.deepEqual(added, ['added app#2', 'added app#3']);
  const urls = verb(stub.calls(), 'project', 'item-add').map((c) => c[c.indexOf('--url') + 1]);
  assert.deepEqual(urls, ['https://github.com/Crawford-Young/app/issues/2', 'https://github.com/Crawford-Young/app/issues/3']);
  // only live repos are read, and the second page asks only for the repo that had more
  const issueQueries = stub.calls().filter((c) => c[0] === 'api' && c.some((x) => x.includes('issues(states')));
  assert.equal(issueQueries.length, 2);
  const [q1, q2] = issueQueries.map((c) => c.find((x) => x.startsWith('query=')));
  assert.match(q1, /"app"/);
  assert.match(q1, /"shop"/);
  assert.doesNotMatch(q1, /"old"/);
  assert.doesNotMatch(q2, /"shop"/);
  assert.match(q2, /"a1"/);
});

test('sweep reports drift (null status included, non-Issues and prod-closed skipped) and mutates no status', () => {
  const stub = ghStub(sweepFx());
  const r = runBoard(['sweep'], stub);
  assert.equal(r.status, 0, r.stderr);
  const drift = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('drift '));
  assert.deepEqual(drift, DRIFT);
  assert.equal(verb(stub.calls(), 'project', 'item-edit').length, 0);
});

test('sweep --apply sets each drifted item and reads it back', () => {
  const stub = ghStub(sweepFx());
  const r = runBoard(['sweep', '--apply'], stub);
  assert.equal(r.status, 0, r.stderr);
  const edits = verb(stub.calls(), 'project', 'item-edit').map((c) => [c[c.indexOf('--id') + 1], OPTIONS[c[c.indexOf('--single-select-option-id') + 1]]]);
  assert.deepEqual(edits, [
    ['I4', 'In Progress'],
    ['I6', 'Review'],
    ['I7', 'Done'],
    ['I9', 'Todo'],
    ['I10', 'In Progress'],
  ]);
  const readbacks = stub.calls().filter((c) => c[0] === 'api' && c.some((x) => x.includes('node(id')));
  assert.equal(readbacks.length, 5);
});

test('sweep leaves items it added this run out of drift: their status is null until Item-added fires', () => {
  const page = structuredClone(BOARD_PAGES[1]);
  page.data.user.projectV2.items.nodes.push(item('I2', null, iss('app', 2, 'OPEN')));
  const stub = ghStub(sweepFx({ boardPages: [BOARD_PAGES[0], page], addIds: { 'https://github.com/Crawford-Young/app/issues/2': 'I2' } }));
  const r = runBoard(['sweep', '--apply'], stub);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^added app#2$/m);
  assert.doesNotMatch(r.stdout, /^drift app#2 /m);
  const edited = verb(stub.calls(), 'project', 'item-edit').map((c) => c[c.indexOf('--id') + 1]);
  assert.ok(!edited.includes('I2'), edited.join(' '));
});

test('sweep exits nonzero when gh fails', () => {
  const r = runBoard(['sweep'], ghStub({ fail: true }));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /auth required/);
});

test('cleanup.mjs runs the board sweep and a failure only warns on one line', () => {
  const cleanup = join(scripts, 'cleanup.mjs');
  const ok = spawnHarness(cleanup, [], { env: ghStub(sweepFx()).env });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^added app#2$/m);
  assert.match(ok.stdout, /^drift app#4 Todo -> In Progress$/m);

  const bad = spawnHarness(cleanup, [], { env: ghStub({ fail: true }).env });
  assert.equal(bad.status, 0, bad.stderr);
  const warn = bad.stdout.split(/\r?\n/).filter((l) => /board sweep/i.test(l));
  assert.equal(warn.length, 1, bad.stdout);
  assert.match(warn[0], /auth required/);
  assert.equal(bad.stderr.trim(), '');
});

test('a hung board sweep times out into the same one-line warning', () => {
  const r = spawnHarness(join(scripts, 'cleanup.mjs'), [], { env: { ...ghStub({ hang: true }).env, BOARD_SWEEP_TIMEOUT_MS: '500' } });
  assert.equal(r.status, 0, r.stderr);
  const warn = r.stdout.split(/\r?\n/).filter((l) => /board sweep/i.test(l));
  assert.equal(warn.length, 1, r.stdout);
  assert.match(warn[0], /non-fatal.*timed out/);
});

// --kill-port shares the same flag guard; it is not run here because a real port kill is not test-safe.
test('cleanup with a flag (--remove-worktree) does not sweep the board', () => {
  const stub = ghStub(sweepFx());
  const dir = tempDir('board-wt-');
  spawnHarness(join(scripts, 'cleanup.mjs'), ['--remove-worktree', join(dir, 'no-such-worktree')], { env: stub.env });
  assert.deepEqual(stub.calls(), []);
});
