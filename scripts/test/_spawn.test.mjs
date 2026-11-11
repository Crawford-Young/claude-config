// node --test scripts/test/_spawn.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { clearGitConfigEnv, isolatedEnv, tempDir, withoutUserGitConfig } from './_spawn.mjs';

/** Git config injected through the environment, as a CI box or a cloud sandbox sets it (#373). */
const INJECTED = {
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'credential.interactive',
  GIT_CONFIG_VALUE_0: 'false',
  GIT_CONFIG_KEY_1: 'url.https://github.com/.insteadOf',
  GIT_CONFIG_VALUE_1: 'git@github.com:',
  GIT_CONFIG_GLOBAL: 'x',
  GIT_CONFIG_SYSTEM: 'y',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_PARAMETERS: "'core.x=1'",
};
/** A repo location set through the environment, as git sets it for a hook it runs. */
const REPO_ENV = { GIT_DIR: '/x/.git', GIT_WORK_TREE: '/x' };
const GIT_ENV = /^GIT_(?:CONFIG|DIR$|WORK_TREE$)/i;
const gitEnvKeys = (env) => Object.keys(env).filter((k) => GIT_ENV.test(k));

test('#373: clearGitConfigEnv drops every env var that injects git config or a repo location, and nothing else', () => {
  const env = { ...INJECTED, ...REPO_ENV, git_config_count: '1', GIT_DIRECTORY: 'kept', GIT_TERMINAL_PROMPT: '0', PATH: 'p' };
  assert.equal(clearGitConfigEnv(env), env, 'it clears in place');
  assert.deepEqual(env, { GIT_DIRECTORY: 'kept', GIT_TERMINAL_PROMPT: '0', PATH: 'p' });
});

test('#373: importing the helper clears an ambient git config env from the test process, so git and every child see none', () => {
  // The git read swaps out the machine's own global and system config after the import, so only
  // an env-injected (command-scope) key could still answer it.
  const empty = join(tempDir('gc-'), 'empty');
  writeFileSync(empty, '');
  const code = `import(${JSON.stringify(pathToFileURL(join(import.meta.dirname, '_spawn.mjs')).href)}).then(() => {
    const { spawnSync } = require('node:child_process');
    const env = Object.keys(process.env).filter((k) => ${GIT_ENV}.test(k));
    const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: process.env.EMPTY_GITCONFIG, GIT_CONFIG_NOSYSTEM: '1' };
    const git = spawnSync('git', ['config', '--get', 'credential.interactive'], { encoding: 'utf8', env: gitEnv });
    process.stderr.write('REPORT ' + JSON.stringify({ env, git: git.status }) + '\\n');
  });`;
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: { ...process.env, ...INJECTED, ...REPO_ENV, EMPTY_GITCONFIG: empty } });
  const report = JSON.parse(/^REPORT (.*)$/m.exec(r.stderr)?.[1] ?? 'null');
  assert.deepEqual(report, { env: [], git: 1 }, `no var left, and git finds no key (exit 1): ${r.stderr}`);
});

test('#373: isolatedEnv carries no ambient git config env, but a test may still pass one in', () => {
  const saved = { ...process.env };
  Object.assign(process.env, INJECTED);
  try {
    assert.deepEqual(gitEnvKeys(isolatedEnv(tempDir('h-'))), []);
    assert.equal(isolatedEnv(tempDir('h-'), { GIT_CONFIG_COUNT: '0' }).GIT_CONFIG_COUNT, '0');
  } finally {
    clearGitConfigEnv(process.env);
    Object.assign(process.env, saved);
  }
});

test('#373: withoutUserGitConfig hides the global and system config for its body, then clears the env again', () => {
  const home = tempDir('gh-');
  const repo = join(home, 'r');
  execFileSync('git', ['init', '-q', repo]);
  const scopes = () => [...new Set(execFileSync('git', ['-C', repo, 'config', '--list', '--show-scope'], { encoding: 'utf8' }).split('\n').filter(Boolean).map((l) => l.split('\t')[0]))];
  const inside = withoutUserGitConfig(() => ({ scopes: scopes(), keys: gitEnvKeys(process.env) }));
  assert.deepEqual(inside.scopes, ['local'], 'only the repo’s own config reaches git');
  assert.ok(inside.keys.length > 0, 'set while the body runs');
  assert.deepEqual(gitEnvKeys(process.env), [], 'cleared after');
  assert.throws(() => withoutUserGitConfig(() => { throw new Error('boom'); }), /boom/);
  assert.deepEqual(gitEnvKeys(process.env), [], 'cleared after a throw');
});

test('#373: a nested withoutUserGitConfig hands the outer call its own env back', () => {
  withoutUserGitConfig(() => {
    const outer = process.env.GIT_CONFIG_GLOBAL;
    withoutUserGitConfig(() => assert.notEqual(process.env.GIT_CONFIG_GLOBAL, undefined));
    assert.equal(process.env.GIT_CONFIG_GLOBAL, outer, 'outer GIT_CONFIG_GLOBAL restored');
    assert.equal(process.env.GIT_CONFIG_NOSYSTEM, '1', 'outer GIT_CONFIG_NOSYSTEM restored');
  });
  assert.deepEqual(gitEnvKeys(process.env), [], 'cleared after the outer call');
});
