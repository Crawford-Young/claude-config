// Shared spawn helper for tests that run harness scripts (hooks/, scripts/, statusline/).
// Every child gets a temp HOME/USERPROFILE and every ~/.claude path override pointed
// inside it, so a test can never write to (or read stale state from) the real ~/.claude.
// _hooklib's claudeDir comes from homedir() at import time, so isolation has to be in
// the child's env, not mutated in-process. scripts/test/source-hygiene.test.mjs fails a
// test file that spawns node on a script without this helper.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Env vars the harness reads that name a path, mapped to a location under the temp home. */
const PATH_OVERRIDES = {
  CLAUDE_WORKSPACE_ROOT: ['code'],
  CLAUDE_CONFIG_REPO: ['code', 'claude-config'],
  CLAUDE_CONFIG_DIR: ['.claude'],
  CLAUDE_SESSIONS_DIR: ['.claude', 'sessions'],
  CLAUDE_PROJECTS_DIR: ['.claude', 'projects'],
  CLAUDE_USAGE_HISTORY_DIR: ['.claude', 'usage-history'],
  CLAUDE_USAGE_THROTTLE_DIR: ['.claude', 'usage-throttle'],
  CLAUDE_SPEND_DIR: ['.claude', 'spend'],
  CLAUDE_ACTIVE_REPO_DIR: ['.claude', 'active-repo'],
  CLAUDE_BROWSER_GATE_STATE: ['.claude', 'browser-gate.json'],
  CLAUDE_PUSH_GATE_STATE: ['.claude', 'push-gate.json'],
  CLAUDE_INLINE_NUDGE_STATE: ['.claude', 'inline-edit-nudge.json'],
};
/** Live-session identity must not leak into a child; a test that needs it passes it in `env`. */
const SCRUBBED = ['CLAUDE_PID'];

export const OVERRIDE_NAMES = Object.keys(PATH_OVERRIDES);

/** Child env: process.env, then the isolated HOME and overrides, then the caller's `env`. */
export function isolatedEnv(home, extra = {}) {
  const env = { ...process.env };
  for (const k of SCRUBBED) delete env[k];
  env.HOME = home;
  env.USERPROFILE = home;
  for (const [k, parts] of Object.entries(PATH_OVERRIDES)) env[k] = join(home, ...parts);
  return { ...env, ...extra };
}

/**
 * spawnSync(node, [script, ...args]) with an isolated environment. `home` defaults to a
 * fresh temp dir (removed afterwards); `env` overrides win over the isolated defaults.
 * Other options (input, cwd, ...) pass through; encoding defaults to utf8.
 */
export function spawnHarness(script, args = [], { home, env, ...opts } = {}) {
  const own = home === undefined;
  const h = own ? mkdtempSync(join(tmpdir(), 'harness-home-')) : home;
  try {
    return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', ...opts, env: isolatedEnv(h, env) });
  } finally {
    if (own) rmSync(h, { recursive: true, force: true });
  }
}

/** Like execFileSync: returns stdout, throws (with status/stdout/stderr) on a non-zero exit. */
export function execHarness(script, args = [], opts = {}) {
  const r = spawnHarness(script, args, opts);
  if (r.error) throw r.error;
  if (r.status !== 0) {
    const e = new Error(`${script} exited ${r.status}: ${r.stderr}`);
    Object.assign(e, { status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr });
    throw e;
  }
  return r.stdout;
}
