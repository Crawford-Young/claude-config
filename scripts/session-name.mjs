#!/usr/bin/env node
// session-name.mjs — the launch line for a unit's session (#175).
//
//   node session-name.mjs director <scope words…>  (slugified)
//   node session-name.mjs epic <repo> <N> [role]   (repo slugified, as worktree.mjs does)
//   node session-name.mjs ticket <repo> <N> [role] [--round K]
//                                                  (role: review | recon, an in-session subagent; --round K, K >= 2:
//                                                   a fresh dispatch on a name already used, since the harness dedupes to -2)
//   node session-name.mjs general <topic words…>   (slugified, first 4 words)
//
// Prints exactly one line, `claude -n <name>`; the name is built by lib's
// sessionName, so no doc or skill restates the format.

import { die, generalSessionName, isMain, log, parseArgs, sessionName, slugify } from './lib.mjs';

const USAGE = 'usage: session-name.mjs director <scope> | epic <repo> <N> [role] | ticket <repo> <N> [role] [--round K] | general <topic words…>';

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

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const { _: words, round, ...flags } = args;
  if (Object.keys(flags).length || round === true) die(USAGE); // only --round K
  let line;
  try {
    line = launchLine(words, round === undefined ? undefined : /^\d+$/.test(round) ? Number(round) : NaN);
  } catch (e) {
    die(`${e.message}\n${USAGE}`);
  }
  log(line);
}
