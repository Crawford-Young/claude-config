// node --test scripts/test/land.test.mjs — the claude-config commit lane
// against a temp repo standing in for the main checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'land.mjs');

function sh(cwd, cmd, cmdArgs, input) {
  return execFileSync(cmd, cmdArgs, { cwd, encoding: 'utf8', input });
}

test('start lands only the named path in an ephemeral worktree', () => {
  const root = mkdtempSync(join(tmpdir(), 'land-'));
  const origin = join(root, 'origin.git');
  mkdirSync(origin);
  sh(root, 'git', ['init', '--bare', origin]);
  const cfg = join(root, 'claude-config');
  sh(root, 'git', ['clone', origin, cfg]);
  sh(cfg, 'git', ['config', 'user.email', 't@t']);
  sh(cfg, 'git', ['config', 'user.name', 't']);
  writeFileSync(join(cfg, 'mine.md'), 'v1\n');
  writeFileSync(join(cfg, 'theirs.md'), 'v1\n');
  sh(cfg, 'git', ['add', 'mine.md', 'theirs.md']);
  sh(cfg, 'git', ['commit', '-m', 'init']);
  sh(cfg, 'git', ['branch', '-M', 'main']);
  sh(cfg, 'git', ['push', '-u', 'origin', 'main']);

  // live edits from "two sessions": ours (mine.md) and a concurrent one (theirs.md)
  appendFileSync(join(cfg, 'mine.md'), 'my change\n');
  appendFileSync(join(cfg, 'theirs.md'), 'foreign in-flight edit\n');

  const env = { ...process.env, CLAUDE_WORKSPACE_ROOT: root, CLAUDE_CONFIG_REPO: cfg };
  const out = execFileSync(process.execPath, [script, 'start', 'demo', '-m', 'chore: mine only', '--', 'mine.md'], {
    encoding: 'utf8',
    env,
  });
  assert.match(out, /mine\.md/);
  assert.doesNotMatch(out, /theirs\.md/, 'the concurrent session\'s edit must not be swept in');

  const wt = join(root, '.worktrees', 'claude-config-demo');
  const show = sh(wt, 'git', ['show', '--stat', 'HEAD']);
  assert.match(show, /mine\.md/);
  assert.doesNotMatch(show, /theirs\.md/);

  // finish removes the worktree
  execFileSync(process.execPath, [script, 'finish', 'demo'], { encoding: 'utf8', env });
  assert.ok(!existsSync(wt));
});

test('start refuses when the main checkout is off main', () => {
  const root = mkdtempSync(join(tmpdir(), 'land-'));
  const origin = join(root, 'origin.git');
  mkdirSync(origin);
  sh(root, 'git', ['init', '--bare', origin]);
  const cfg = join(root, 'claude-config');
  sh(root, 'git', ['clone', origin, cfg]);
  sh(cfg, 'git', ['config', 'user.email', 't@t']);
  sh(cfg, 'git', ['config', 'user.name', 't']);
  writeFileSync(join(cfg, 'a.md'), 'x\n');
  sh(cfg, 'git', ['add', 'a.md']);
  sh(cfg, 'git', ['commit', '-m', 'init']);
  sh(cfg, 'git', ['branch', '-M', 'main']);
  sh(cfg, 'git', ['push', '-u', 'origin', 'main']);
  sh(cfg, 'git', ['checkout', '-b', 'stray']);

  const env = { ...process.env, CLAUDE_WORKSPACE_ROOT: root, CLAUDE_CONFIG_REPO: cfg };
  assert.throws(() =>
    execFileSync(process.execPath, [script, 'start', 'x', '-m', 'm', '--', 'a.md'], { encoding: 'utf8', env }),
  );
});
