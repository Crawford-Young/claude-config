// node --test scripts/test/_spawn.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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
const gitConfigKeys = (env) => Object.keys(env).filter((k) => /^GIT_CONFIG/i.test(k));

test('#373: clearGitConfigEnv drops every env var that injects git config, and nothing else', () => {
  const env = { ...INJECTED, git_config_count: '1', GIT_TERMINAL_PROMPT: '0', PATH: 'p' };
  assert.equal(clearGitConfigEnv(env), env, 'it clears in place');
  assert.deepEqual(env, { GIT_TERMINAL_PROMPT: '0', PATH: 'p' });
});

test('#373: importing the helper clears an ambient git config env from the test process, so git and every child see none', () => {
  const code = `import(${JSON.stringify(pathToFileURL(join(import.meta.dirname, '_spawn.mjs')).href)}).then(() => {
    const { spawnSync } = require('node:child_process');
    const git = spawnSync('git', ['config', '--get', 'credential.interactive'], { encoding: 'utf8' });
    process.stderr.write('REPORT ' + JSON.stringify({ env: Object.keys(process.env).filter((k) => /^GIT_CONFIG/i.test(k)), git: git.stdout.trim() }) + '\\n');
  });`;
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: { ...process.env, ...INJECTED, GIT_CONFIG_GLOBAL: join(tempDir('gc-'), 'none') } });
  const report = JSON.parse(/^REPORT (.*)$/m.exec(r.stderr)?.[1] ?? 'null');
  assert.deepEqual(report, { env: [], git: '' }, r.stderr);
});

test('#373: isolatedEnv carries no ambient git config env, but a test may still pass one in', () => {
  const saved = { ...process.env };
  Object.assign(process.env, INJECTED);
  try {
    assert.deepEqual(gitConfigKeys(isolatedEnv(tempDir('h-'))), []);
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
  const inside = withoutUserGitConfig(() => ({ scopes: scopes(), keys: gitConfigKeys(process.env) }));
  assert.deepEqual(inside.scopes, ['local'], 'only the repo’s own config reaches git');
  assert.ok(inside.keys.length > 0, 'set while the body runs');
  assert.deepEqual(gitConfigKeys(process.env), [], 'cleared after');
  assert.throws(() => withoutUserGitConfig(() => { throw new Error('boom'); }), /boom/);
  assert.deepEqual(gitConfigKeys(process.env), [], 'cleared after a throw');
});
