#!/usr/bin/env node
// session-name.mjs — prints an agent's name, <role>_<kind>_<target> (#360). The grammar
// lives in lib.mjs's header, the one place it is documented; lib's agentName builds it.
//
//   node session-name.mjs <role> repo <repo>
//   node session-name.mjs <role> epic|issue|pr <repo> <N>
//   node session-name.mjs <role> topic <words…>     (slugified, first 4 words)
//
// Role and repo are slugified, as worktree.mjs does. Prints exactly one line, the bare
// name, for an Agent `name` (else `description`) or `claude --bg -n`. A re-dispatch on
// a used name picks a new role label (`review-2`).

import { agentName, die, isMain, log, parseArgs, slugify, TOPIC_WORDS } from './lib.mjs';

const USAGE = 'usage: session-name.mjs <role> <kind> <target…>: <role> repo <repo> | <role> epic|issue|pr <repo> <N> | <role> topic <words…>';

/** The agent name for CLI words (`impl issue claude-config 360`); throws on bad input. */
export function nameFromWords([role, kind, ...target]) {
  if (kind === 'topic') return agentName(slugify(role), kind, slugify(target.join(' '), TOPIC_WORDS));
  return agentName(slugify(role), kind, ...(target.length ? [slugify(target[0]), ...target.slice(1)] : []));
}

if (isMain(import.meta.url)) {
  const { _: words, ...flags } = parseArgs(process.argv.slice(2));
  if (Object.keys(flags).length) die(USAGE);
  let name;
  try {
    name = nameFromWords(words);
  } catch (e) {
    die(`${e.message}\n${USAGE}`);
  }
  log(name);
}
