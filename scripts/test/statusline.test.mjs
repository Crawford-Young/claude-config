// node --test scripts/test/statusline.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillBar, formatTokens, gitInfo, historySample, render } from '../../statusline/statusline.mjs';

const SCRIPT = fileURLToPath(new URL('../../statusline/statusline.mjs', import.meta.url));
const FIX = fileURLToPath(new URL('../../statusline/tests/fixtures/', import.meta.url));
const fixture = (name) => readFileSync(join(FIX, name), 'utf8');
const json = (name) => JSON.parse(fixture(name));
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const bar = (pct) => {
  const n = Math.min(10, Math.ceil(pct / 10));
  return '▰'.repeat(n) + '▱'.repeat(10 - n);
};
const tmp = () => mkdtempSync(join(tmpdir(), 'statusline-'));

/** Fixture with cwd/current_dir repointed — location resolves from the real dir. */
const at = (name, dir) => {
  const s = json(name);
  s.cwd = dir;
  s.workspace.current_dir = dir;
  return s;
};

function runScript(input, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT], { input, env: { ...process.env, ...env }, encoding: 'utf8' });
  return { out: r.stdout, code: r.status };
}

/** A real repo on a feature branch (git only builds the fixture; render never spawns it). */
function gitRepo(root, name, branch) {
  const dir = join(root, name);
  mkdirSync(dir);
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
  git('init', '-q', '-b', branch);
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  return { dir, git };
}

test('bar arithmetic: ceiling cells, threshold colors', () => {
  assert.equal(plain(fillBar(0)), bar(0));
  assert.equal(plain(fillBar(1)), bar(1));
  assert.equal(plain(fillBar(75)), bar(75));
  assert.equal(plain(fillBar(100)), bar(100));
  assert.match(fillBar(40), /\x1b\[32m/);
  assert.match(fillBar(75), /\x1b\[33m/);
  assert.match(fillBar(92), /\x1b\[31m/);
});

test('token counts compact to k/M', () => {
  assert.equal(formatTokens(101889), '102k');
  assert.equal(formatTokens(1000000), '1M');
  assert.equal(formatTokens(1500000), '1.5M');
  assert.equal(formatTokens(999), '999');
});

test('full fixture: identity row, then ctx/cache/5h/7d row', () => {
  const root = tmp();
  try {
    mkdirSync(join(root, 'plain-folder'));
    const out = render(at('full.json', join(root, 'plain-folder')));
    const [row1, row2] = plain(out).split('\n');
    assert.equal(row1, 'plain-folder · Fable 5 · high · $3.13');
    assert.ok(row2.startsWith(`ctx ${bar(10)} 102k/1M 10% · cache warm 91% · 5h ${bar(22)} 22%→`), row2);
    assert.ok(row2.includes(`7d ${bar(4)} 4%→`));
    assert.ok(out.includes('\x1b[32mwarm 91%'));
    assert.ok(!row2.includes('miss:'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('high usage: red/yellow thresholds, cold cache with miss cause, fast tag', () => {
  const out = render(json('high-usage.json'));
  const p = plain(out);
  assert.ok(p.includes(`5h ${bar(92)} 92%`));
  assert.ok(p.includes(`7d ${bar(75)} 75%`));
  assert.ok(p.includes('cache cold 42% miss:eviction'));
  assert.ok(out.includes('\x1b[31mcold 42%'));
  assert.ok(p.split('\n')[0].includes(' · fast · '));
});

test('no rate_limits: no window bars', () => {
  const p = plain(render(json('no-rate-limits.json')));
  assert.ok(!p.includes('5h ') && !p.includes('7d '));
  assert.ok(p.split('\n')[1].startsWith('ctx '));
});

test('malformed or empty stdin renders the sentinel and exits 0', () => {
  assert.deepEqual(runScript(fixture('malformed.json'), { CLAUDE_USAGE_HISTORY_DIR: tmp() }), { out: '[statusline]', code: 0 });
  assert.deepEqual(runScript(''), { out: '[statusline]', code: 0 });
});

test('location: repo@branch in a checkout, short SHA when detached, folder name outside git', () => {
  const root = tmp();
  try {
    const { dir, git } = gitRepo(root, 'my-repo', 'feat/test-branch');
    mkdirSync(join(dir, 'sub'));
    assert.ok(plain(render(at('full.json', join(dir, 'sub')))).startsWith('my-repo@feat/test-branch · '));
    git('checkout', '-q', '--detach');
    assert.match(plain(render(at('full.json', dir))), /^my-repo@[0-9a-f]{7} · /);
    mkdirSync(join(root, 'plain'));
    assert.ok(plain(render(at('full.json', join(root, 'plain')))).startsWith('plain · '));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('gitInfo: a linked worktree names its owning repo', () => {
  const root = tmp();
  try {
    const { dir, git } = gitRepo(root, 'owner-repo', 'main');
    git('worktree', 'add', '-q', '-b', 'feat/x', join(root, 'wt-dir'));
    const g = gitInfo(join(root, 'wt-dir'));
    assert.equal(g.branch, 'feat/x');
    assert.equal(g.worktree, 'wt-dir');
    assert.equal(g.owner.toLowerCase(), dir.toLowerCase());
    assert.deepEqual({ ...gitInfo(dir), top: '' }, { top: '', branch: 'main', worktree: '', owner: '' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('history: one schema-complete sample, throttled per session', () => {
  const hist = tmp();
  const thr = tmp();
  const env = { CLAUDE_USAGE_HISTORY_DIR: hist, CLAUDE_USAGE_THROTTLE_DIR: thr };
  try {
    assert.equal(runScript(fixture('full.json'), env).code, 0);
    runScript(fixture('full.json'), env); // within 60 s → suppressed
    const now = new Date();
    const log = join(hist, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.jsonl`);
    const lines = readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    const s = JSON.parse(lines[0]);
    assert.equal(s.session_id, '4ebbd908-ff44-4647-a06b-2f807203d3b8');
    assert.equal(s.context_window_size, 1000000);
    assert.equal(s.five_hour_pct, 22);
    assert.equal(s.cache_read_tokens, 99099);
    assert.equal(s.cache_miss_cause, null);
    assert.ok(existsSync(join(thr, 'claude-usage-throttle-4ebbd908-ff44-4647-a06b-2f807203d3b8.txt')));
    // a 120 s-old throttle stamp allows the next sample
    writeFileSync(join(thr, 'claude-usage-throttle-4ebbd908-ff44-4647-a06b-2f807203d3b8.txt'), String(Math.floor(Date.now() / 1000) - 120));
    runScript(fixture('full.json'), env);
    assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 2);
  } finally {
    rmSync(hist, { recursive: true, force: true });
    rmSync(thr, { recursive: true, force: true });
  }
});

test('history sample: absent fields are null, never missing', () => {
  const s = historySample({ session_id: 'x' });
  assert.equal(Object.keys(s).length, 19);
  assert.equal(s.model_id, null);
  assert.equal(s.exceeds_200k, null);
});
