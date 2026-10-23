// Shared spawn helper for tests that run harness scripts (hooks/, scripts/, statusline/).
// Every child gets a temp HOME/USERPROFILE and every ~/.claude path override pointed
// inside it, so a test can never write to (or read stale state from) the real ~/.claude.
// _hooklib's claudeDir comes from homedir() at import time, so isolation has to be in
// the child's env, not mutated in-process. scripts/test/source-hygiene.test.mjs fails a
// test file that spawns node on a script without this helper.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { after } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

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
};
/** Live-session identity must not leak into a child; a test that needs it passes it in `env`. */
const SCRUBBED = ['CLAUDE_PID'];

const made = new Set();
/** Async rm with retries: Node 24's rmSync throws EPERM at once on a dir a live child still holds (#172). */
const removeDir = (dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
// Registered at import, so it runs once as the importing test file finishes, pass or fail.
after(() => Promise.all([...made].map(removeDir)));

/** A fresh temp dir under `parent`, removed when the test file finishes. */
export function tempDir(prefix, parent = tmpdir()) {
  const dir = mkdtempSync(join(parent, prefix));
  made.add(dir);
  return dir;
}

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
 * fresh temp dir (removed when the test file finishes); `env` overrides win over the isolated defaults.
 * Other options (input, cwd, ...) pass through; encoding defaults to utf8.
 */
export function spawnHarness(script, args = [], { home, env, ...opts } = {}) {
  const h = home ?? tempDir('harness-home-');
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', ...opts, env: isolatedEnv(h, env) });
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

/** A race child's stderr marker: it reached the start line before the start instant. */
const ON_TIME = 'race:on-time';

/**
 * A real multi-process race: `n` node children, each in the isolated env of `home`, import
 * `module`, busy-wait to one shared start instant, then run `body` with the module bound as
 * `m`. Imports finish before the start line, so the bodies overlap. → their stdouts; rejects
 * when a child exits non-zero, or when fewer than 2 children reached the start line before
 * it passed (a loaded runner raced nothing, so a pass would prove nothing).
 */
export async function raceHarness(n, module, body, { home, env, leadMs = 2500 } = {}) {
  const start = Date.now() + leadMs;
  const code = `import(${JSON.stringify(pathToFileURL(module).href)}).then((m) => { process.stderr.write(Date.now() < ${start} ? '${ON_TIME}' : ''); while (Date.now() < ${start}); ${body}\n});`;
  const one = () =>
    new Promise((resolve, reject) => {
      const c = spawn(process.execPath, ['-e', code], { env: isolatedEnv(home, env) });
      let out = '';
      let err = '';
      c.stdout.on('data', (d) => (out += d));
      c.stderr.on('data', (d) => (err += d));
      c.on('error', reject);
      c.on('close', (status) => (status === 0 ? resolve({ out, onTime: err.includes(ON_TIME) }) : reject(new Error(`race child exited ${status}: ${err}`))));
    });
  const children = await Promise.all(Array.from({ length: n }, one));
  const onTime = children.filter((c) => c.onTime).length;
  if (onTime < 2) throw new Error(`raceHarness: ${onTime} of ${n} children reached the start line in time, so nothing raced; raise leadMs`);
  return children.map((c) => c.out);
}
