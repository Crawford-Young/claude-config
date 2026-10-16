#!/usr/bin/env node
// session-name.mjs — the launch line for a unit's session (#175), or the tree name of an
// in-session subagent (#272).
//
//   node session-name.mjs director <scope words…>  (slugified)
//   node session-name.mjs epic <repo> <N> [role]   (repo slugified, as worktree.mjs does)
//   node session-name.mjs ticket <repo> <N> [role] [--round K]
//                                                  (role: review | recon, an in-session subagent; --round K, K >= 2:
//                                                   a fresh dispatch on a name already used, since the harness dedupes to -2)
//   node session-name.mjs general <topic words…>   (slugified, first 4 words)
//   node session-name.mjs tree <dir> <repo> [--epic N] [--ticket N] [--worker impl|review|recon [--round K]]
//                                                  (dir and repo slugified; prints the bare name, for the Agent `name`)
//
// Prints exactly one line, `claude -n <name>` (a tree name bare); the name is built by
// lib's sessionName, so no doc or skill restates the format.

import { die, generalSessionName, isMain, log, parseArgs, sessionName, slugify } from './lib.mjs';

const USAGE =
  'usage: session-name.mjs director <scope> | epic <repo> <N> [role] | ticket <repo> <N> [role] [--round K] | general <topic words…> | tree <dir> <repo> [--epic N] [--ticket N] [--worker impl|review|recon [--round K]]';

/** The command that starts a session under `name`. */
export function launchCommand(name) {
  return `claude -n ${name}`;
}

/** Launch line for CLI words (`ticket claude-config 175`); throws on bad input. */
export function launchLine([type, ...rest], round) {
  if (type === 'general') return launchCommand(generalSessionName(rest.join(' ')));
  let args = rest;
  if (type === 'director') args = [slugify(rest.join(' '))];
  else if (rest.length) args = [slugify(rest[0]), ...rest.slice(1)];
  if (round !== undefined) args = [args[0], args[1], args[2], round];
  return launchCommand(sessionName(type, ...args));
}

/** Tree name for CLI words and flags (`harness claude-config`, { ticket: '264' }); throws on bad input. */
export function treeLine([dir, repo, ...extra], { round, ...opts }) {
  if (extra.length) throw new Error('a tree name takes <dir> <repo> and flags only');
  return sessionName('tree', slugify(dir), slugify(repo), { ...opts, ...(round !== undefined && { round }) });
}

const toRound = (round) => (round === undefined ? undefined : /^\d+$/.test(round) ? Number(round) : NaN);

if (isMain(import.meta.url)) {
  const { _: words, ...flags } = parseArgs(process.argv.slice(2));
  const allowed = words[0] === 'tree' ? ['epic', 'ticket', 'worker', 'round'] : ['round'];
  if (Object.entries(flags).some(([k, v]) => !allowed.includes(k) || v === true)) die(USAGE);
  let line;
  try {
    const round = toRound(flags.round);
    line = words[0] === 'tree' ? treeLine(words.slice(1), { ...flags, round }) : launchLine(words, round);
  } catch (e) {
    die(`${e.message}\n${USAGE}`);
  }
  log(line);
}
