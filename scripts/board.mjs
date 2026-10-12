#!/usr/bin/env node
// board.mjs — issue status on the "All tickets" board (user project 7, claude-config#149).
//
//   node board.mjs start <ref>                              grab: in-progress label + In Progress
//   node board.mjs set <ref> <todo|in-progress|review|qa|done>
//   node board.mjs sweep [--apply]
//
// <ref> is <repo>#N, owner/repo#N or an issue URL; the owner defaults to Crawford-Young.
// start/set add the issue to the board (item-add is idempotent), set the Status, then
// read it back by item node id; a mismatch exits nonzero. `set done` refuses an OPEN
// issue, because the board's Auto-close workflow would close it.
//
// sweep: (1) always adds every open issue of a live repo (topic `board`) that has no item
// on the board — the board's Item-added workflow lands it in Todo. (2) prints
// `drift <ref> <current> -> <derived>` for every Issue item, any repo:
//   closed → Done (skipped in `prod`-topic repos: the QA pass is human)
//   open with an open closing PR → Review;  `in-progress` label → In Progress;  else Todo
// Items added in the same run are not drift-checked (no status until Item-added fires).
// --apply sets and reads back each drifted item. Exit nonzero only when gh fails.
//
// Review on PR open and Done on close are the board's own workflows; this script only
// repairs drift. Review is "Pull request linked to issue" (Edit → Status=Review → Save and
// turn on); it fires only on the link event, so after a reconfig re-link the PR (remove
// and re-add `Closes #N`) — a save replays nothing (claude-config#149). Reads avoid search and the project `items` index where they lag: repos
// come from `gh repo list` filtered locally, and a single item reads back by node id.
// BOARD_GH (a JSON argv prefix) replaces `gh` in tests.

import { spawnSync } from 'node:child_process';
import { die, isMain, log, parseArgs } from './lib.mjs';

// verified: 2026-10
const OWNER = 'Crawford-Young';
const PROJECT_NUMBER = '7';
const PROJECT_ID = 'PVT_kwHOCI55484BmvMX';
const STATUS_FIELD_ID = 'PVTSSF_lAHOCI55484BmvMXzhlW-U0';
export const STATUS = {
  todo: { name: 'Todo', id: 'f75ad846' },
  'in-progress': { name: 'In Progress', id: '47fc9ee4' },
  review: { name: 'Review', id: '00c726f9' },
  qa: { name: 'QA', id: 'dce02d7a' },
  done: { name: 'Done', id: '98236657' },
};
const KEY_BY_NAME = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [v.name, k]));
const USAGE = 'usage: board.mjs start <ref> | set <ref> <todo|in-progress|review|qa|done> | sweep [--apply]';

/** `<repo>#N`, `owner/repo#N` or an issue URL → { owner, repo, number }, else null. */
export function parseRef(ref) {
  const m =
    /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\/?$/.exec(ref) ??
    /^(?:([\w.-]+)\/)?([\w.-]+)#(\d+)$/.exec(ref);
  return m ? { owner: m[1] ?? OWNER, repo: m[2], number: Number(m[3]) } : null;
}

/** Status an issue should hold, or null when the sweep must leave it alone. Never Done while open. */
export function deriveStatus({ owner, repo, state, labels, openPr }, prodRepos) {
  if (state === 'CLOSED') return owner === OWNER && prodRepos.has(repo) ? null : STATUS.done.name;
  if (openPr) return STATUS.review.name;
  if (labels.includes('in-progress')) return STATUS['in-progress'].name;
  return STATUS.todo.name;
}

const show = ({ owner, repo, number }) => `${owner === OWNER ? '' : `${owner}/`}${repo}#${number}`;
const issueUrl = ({ owner, repo, number }) => `https://github.com/${owner}/${repo}/issues/${number}`;

function gh(args) {
  const [cmd, ...pre] = process.env.BOARD_GH ? JSON.parse(process.env.BOARD_GH) : ['gh'];
  const r = spawnSync(cmd, [...pre, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    die(`gh ${args.slice(0, 2).join(' ')} failed: ${(r.stderr || r.error?.message || '').trim()}`);
  }
  return r.stdout.trim();
}

function graphql(query, vars = {}) {
  const flags = Object.entries(vars).flatMap(([k, v]) => ['-f', `${k}=${v}`]);
  return JSON.parse(gh(['api', 'graphql', '-f', `query=${query}`, ...flags])).data;
}

function addItem(ref) {
  return gh(['project', 'item-add', PROJECT_NUMBER, '--owner', OWNER, '--url', issueUrl(ref), '--format', 'json', '--jq', '.id']);
}

/** item-edit to `key`, then read back by node id (the items connection lags fresh adds). */
function setItemStatus(itemId, key) {
  gh(['project', 'item-edit', '--id', itemId, '--project-id', PROJECT_ID, '--field-id', STATUS_FIELD_ID, '--single-select-option-id', STATUS[key].id]);
  const got = graphql(
    'query($id:ID!){node(id:$id){... on ProjectV2Item{fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}',
    { id: itemId },
  ).node?.fieldValueByName?.name;
  if (got !== STATUS[key].name) die(`read-back of ${itemId}: expected ${STATUS[key].name}, got ${got ?? 'none'}`);
}

function cmdSet(ref, key) {
  if (key === 'done' && gh(['issue', 'view', String(ref.number), '--repo', `${ref.owner}/${ref.repo}`, '--json', 'state', '--jq', '.state']) === 'OPEN') {
    die(`${show(ref)} is open; setting Done would close it (Auto-close). Close it first.`);
  }
  setItemStatus(addItem(ref), key);
  log(`Board: ${show(ref)} -> ${STATUS[key].name}`);
}

/** Live (topic `board`) and prod (topic `prod`) repo names, filtered locally: topic search lags. */
function repoTopics() {
  const repos = JSON.parse(gh(['repo', 'list', OWNER, '--limit', '200', '--no-archived', '--json', 'name,repositoryTopics']));
  const withTopic = (t) => repos.filter((r) => (r.repositoryTopics ?? []).some((x) => x.name === t)).map((r) => r.name);
  return { live: withTopic('board'), prod: new Set(withTopic('prod')) };
}

/** Open issues of `repos` with no item on the board: one aliased query per page round. */
function missingOpenIssues(repos) {
  const missing = [];
  let pending = repos.map((repo) => ({ repo, after: null }));
  while (pending.length) {
    const parts = pending.map(
      ({ repo, after }, i) =>
        `r${i}: repository(owner:${JSON.stringify(OWNER)}, name:${JSON.stringify(repo)}){issues(states:OPEN, first:100${after ? `, after:${JSON.stringify(after)}` : ''}){pageInfo{hasNextPage endCursor} nodes{number projectItems(first:50){nodes{project{id}}}}}}`,
    );
    const data = graphql(`query{${parts.join(' ')}}`);
    const next = [];
    pending.forEach(({ repo }, i) => {
      const { pageInfo, nodes } = data[`r${i}`].issues;
      for (const n of nodes) {
        if (!n.projectItems.nodes.some((p) => p.project?.id === PROJECT_ID)) missing.push({ owner: OWNER, repo, number: n.number });
      }
      if (pageInfo.hasNextPage) next.push({ repo, after: pageInfo.endCursor });
    });
    pending = next;
  }
  return missing;
}

const ITEMS_QUERY = `query($cursor:String){user(login:${JSON.stringify(OWNER)}){projectV2(number:${PROJECT_NUMBER}){items(first:100, after:$cursor){pageInfo{hasNextPage endCursor} nodes{id fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}} content{__typename ... on Issue{number state repository{name owner{login}} labels(first:30){nodes{name}} closedByPullRequestsReferences(first:10, includeClosedPrs:false){nodes{state}}}}}}}}}`;

/** Every Issue item on the board, normalized. includeClosedPrs:false still returns MERGED PRs, so filter OPEN. */
function boardIssues() {
  const out = [];
  let cursor = null;
  do {
    const { pageInfo, nodes } = graphql(ITEMS_QUERY, cursor ? { cursor } : {}).user.projectV2.items;
    for (const n of nodes) {
      const c = n.content;
      if (c?.__typename !== 'Issue') continue;
      out.push({
        itemId: n.id,
        current: n.fieldValueByName?.name ?? null,
        owner: c.repository.owner.login,
        repo: c.repository.name,
        number: c.number,
        state: c.state,
        labels: c.labels.nodes.map((l) => l.name),
        openPr: c.closedByPullRequestsReferences.nodes.some((p) => p.state === 'OPEN'),
      });
    }
    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (cursor);
  return out;
}

function cmdSweep(apply) {
  const { live, prod } = repoTopics();
  const missing = missingOpenIssues(live);
  // Items added now hold no status until the Item-added workflow lands them in Todo: not drift.
  const added = new Set();
  for (const ref of missing) {
    added.add(addItem(ref));
    log(`added ${show(ref)}`);
  }
  let drift = 0;
  for (const it of boardIssues()) {
    if (added.has(it.itemId)) continue;
    const want = deriveStatus(it, prod);
    if (want === null || want === it.current) continue;
    drift++;
    log(`drift ${show(it)} ${it.current ?? 'none'} -> ${want}`);
    if (apply) setItemStatus(it.itemId, KEY_BY_NAME[want]);
  }
  log(`board sweep: ${missing.length} added, ${drift} drift${drift && !apply ? ' (fix: node ~/code/claude-config/scripts/board.mjs sweep --apply)' : ''}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, rawRef, key] = args._;
  if (cmd === 'sweep') return cmdSweep(Boolean(args.apply));
  const ref = rawRef && parseRef(rawRef);
  if (!ref) die(USAGE);
  if (cmd === 'start') {
    gh(['issue', 'edit', String(ref.number), '--repo', `${ref.owner}/${ref.repo}`, '--add-label', 'in-progress']);
    return cmdSet(ref, 'in-progress');
  }
  if (cmd === 'set' && Object.hasOwn(STATUS, key)) return cmdSet(ref, key);
  die(USAGE);
}

if (isMain(import.meta.url)) main();
