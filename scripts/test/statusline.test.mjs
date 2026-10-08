// node --test scripts/test/statusline.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillBar, formatTokens, gitInfo, historySample, localDay, render, spendLock } from '../../statusline/statusline.mjs';
import { refresh } from '../../statusline/spend.mjs';
import { priceUsage } from '../../scripts/audit-lib.mjs';
import { record } from '../../hooks/active-repo.mjs';

const SCRIPT = fileURLToPath(new URL('../../statusline/statusline.mjs', import.meta.url));
const HOOK = fileURLToPath(new URL('../../hooks/active-repo.mjs', import.meta.url));
const FIX = fileURLToPath(new URL('../../statusline/tests/fixtures/', import.meta.url));
const fixture = (name) => readFileSync(join(FIX, name), 'utf8');
const json = (name) => JSON.parse(fixture(name));
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const bar = (pct) => {
  const n = Math.min(10, Math.ceil(pct / 10));
  return '▰'.repeat(n) + '▱'.repeat(10 - n);
};
const tmp = () => mkdtempSync(join(tmpdir(), 'statusline-'));

/** Fixture with cwd/current_dir repointed — location resolves from the real dir.
 *  session_name is dropped so the row leads with the location. */
const at = (name, dir) => {
  const s = json(name);
  s.cwd = dir;
  s.workspace.current_dir = dir;
  delete s.session_name;
  return s;
};
// render() reads the real registry by default; tests point it at an empty dir
const NOREG = {
  CLAUDE_SESSIONS_DIR: join(tmpdir(), 'statusline-no-registry'),
  CLAUDE_ACTIVE_REPO_DIR: join(tmpdir(), 'statusline-no-active-repo'),
  CLAUDE_SPEND_DIR: join(tmpdir(), 'statusline-no-spend'),
  CLAUDE_SPEND_NO_REFRESH: '1',
};
const SID = '4ebbd908-ff44-4647-a06b-2f807203d3b8';

function runScript(input, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT], { input, env: { ...process.env, ...NOREG, ...env }, encoding: 'utf8' });
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
    const out = render(at('full.json', join(root, 'plain-folder')), NOREG);
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
  const out = render(json('high-usage.json'), NOREG);
  const p = plain(out);
  assert.ok(p.includes(`5h ${bar(92)} 92%`));
  assert.ok(p.includes(`7d ${bar(75)} 75%`));
  assert.ok(p.includes('cache cold 42% miss:eviction'));
  assert.ok(out.includes('\x1b[31mcold 42%'));
  assert.ok(p.split('\n')[0].includes(' · fast · '));
});

test('no rate_limits: no window bars', () => {
  const p = plain(render(json('no-rate-limits.json'), NOREG));
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
    assert.ok(plain(render(at('full.json', join(dir, 'sub')), NOREG)).startsWith('my-repo@feat/test-branch · '));
    git('checkout', '-q', '--detach');
    assert.match(plain(render(at('full.json', dir), NOREG)), /^my-repo@[0-9a-f]{7} · /);
    mkdirSync(join(root, 'plain'));
    assert.ok(plain(render(at('full.json', join(root, 'plain')), NOREG)).startsWith('plain · '));
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

test('active repo: the hook records the edited checkout; the row names its owning repo + wt', () => {
  const root = tmp();
  const active = join(root, 'active');
  try {
    const { dir, git } = gitRepo(root, 'owner-repo', 'main');
    git('worktree', 'add', '-q', '-b', 'feat/77-x', join(root, 'owner-repo-77-x'));
    mkdirSync(join(root, 'launch'));
    const payload = { session_id: SID, tool_name: 'Write', tool_input: { file_path: join(root, 'owner-repo-77-x', 'new', 'file.mjs') } };
    // the file's directory does not exist yet: the hook resolves upward
    mkdirSync(join(root, 'owner-repo-77-x', 'new'));
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), env: { ...process.env, CLAUDE_ACTIVE_REPO_DIR: active }, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    const env = { ...NOREG, CLAUDE_ACTIVE_REPO_DIR: active };
    const row1 = render(at('no-rate-limits.json', join(root, 'launch')), env).split('\n')[0];
    assert.ok(row1.startsWith('owner-repo@feat/77-x \x1b[2mwt\x1b[0m · '), JSON.stringify(row1));
    // the primary checkout on main: yellow, no wt marker
    record({ ...payload, tool_input: { file_path: join(dir, 'a.txt') } }, active);
    const main = render(at('no-rate-limits.json', join(root, 'launch')), env).split('\n')[0];
    assert.ok(main.startsWith('\x1b[33mowner-repo@main\x1b[0m · '), JSON.stringify(main));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('active repo: no write outside git, for a bad session id, or without a path', () => {
  const root = tmp();
  try {
    mkdirSync(join(root, 'plain'));
    assert.equal(record({ session_id: SID, tool_input: { file_path: join(root, 'plain', 'x') } }, join(root, 'a')), null);
    assert.equal(record({ session_id: '../evil', tool_input: { file_path: SCRIPT } }, join(root, 'a')), null);
    assert.equal(record({ session_id: SID, tool_input: {} }, join(root, 'a')), null);
    assert.ok(!existsSync(join(root, 'a')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('active repo: records older than a week are pruned on a new session\'s first write', () => {
  const root = tmp();
  const active = join(root, 'a');
  try {
    mkdirSync(active);
    writeFileSync(join(active, 'old.json'), '{}');
    const old = (Date.now() - 8 * 24 * 3600 * 1000) / 1000;
    utimesSync(join(active, 'old.json'), old, old);
    record({ session_id: SID, tool_input: { file_path: SCRIPT } }, active);
    assert.ok(!existsSync(join(active, 'old.json')));
    assert.ok(existsSync(join(active, `${SID}.json`)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A registry dir holding one session file plus an unrelated and a torn one. */
function registry(entry) {
  const dir = tmp();
  writeFileSync(join(dir, '111.json'), '{"sessionId":"' + SID); // torn write, names this session
  writeFileSync(join(dir, '222.json'), JSON.stringify({ sessionId: 'other', name: 'not-me', nameSource: 'user' }));
  writeFileSync(join(dir, '333.json'), JSON.stringify({ pid: 333, sessionId: SID, ...entry }));
  writeFileSync(join(dir, '333.abc.key'), 'x');
  return dir;
}

test('session name: a chosen name leads row 1 in bold', () => {
  for (const nameSource of ['user', 'peer']) {
    const dir = registry({ name: 'claude-config-77', nameSource });
    try {
      const out = render(json('no-rate-limits.json'), { CLAUDE_SESSIONS_DIR: dir });
      assert.ok(out.startsWith('\x1b[1mclaude-config-77\x1b[0m · '), JSON.stringify(out));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('session name: an auto title is dim, ~-marked and cut to 24', () => {
  const dir = registry({ name: 'Agent orchestration app naming', nameSource: 'auto' });
  const bare = registry({ name: '872d7dd5' }); // spare bg session: no nameSource
  try {
    assert.ok(render(json('no-rate-limits.json'), { CLAUDE_SESSIONS_DIR: dir }).startsWith('\x1b[2m~Agent orchestration app…\x1b[0m · '));
    assert.ok(plain(render(json('no-rate-limits.json'), { CLAUDE_SESSIONS_DIR: bare })).startsWith('~872d7dd5 · '));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  }
});

test('session name: control and bidi bytes are stripped', () => {
  const dir = registry({ name: '\x1b[31mevil\x07\u009b2J‮name\n', nameSource: 'user' });
  try {
    const row1 = render(json('no-rate-limits.json'), { CLAUDE_SESSIONS_DIR: dir }).split('\n')[0];
    assert.ok(row1.startsWith('\x1b[1m[31mevil2Jname\x1b[0m · '), JSON.stringify(row1));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('session name: no registry entry falls back to the payload title as auto', () => {
  assert.ok(plain(render(json('no-rate-limits.json'), NOREG)).startsWith('~Start harness-evolution… · '));
  const s = json('no-rate-limits.json');
  delete s.session_name;
  assert.ok(!plain(render(s, NOREG)).startsWith('~'));
});

// ---- day spend ------------------------------------------------------------------

const PRICES = JSON.parse(readFileSync(new URL('../../scripts/prices.json', import.meta.url), 'utf8'));
const U = (out) => ({ input_tokens: 1000, output_tokens: out, cache_read_input_tokens: 50000, cache_creation_input_tokens: 2000 });
const asst = (requestId, out, { model = 'claude-opus-5-5', ts = new Date().toISOString() } = {}) =>
  JSON.stringify({ type: 'assistant', requestId, timestamp: ts, message: { model, usage: U(out) } }) + '\n';
const cost = (out, model = 'claude-opus-5-5') => priceUsage(U(out), model, PRICES).usd;

/** projects/<proj>/<sid>.jsonl plus one subagent transcript. */
function projects(root) {
  const proj = join(root, 'projects', 'C--code');
  mkdirSync(join(proj, 'sess-a', 'subagents'), { recursive: true });
  const yesterday = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  writeFileSync(
    join(proj, 'sess-a.jsonl'),
    asst('r1', 10) + asst('r1', 50) + // streaming partials: one request, max output wins
      asst('r0', 99, { ts: yesterday }) + // before local midnight
      asst('r2', 5, { model: '<synthetic>' }) +
      asst('r3', 5, { model: 'claude-unknown-9' }) + // unpriced, counted not folded in
      '{"type":"user","message":{"content":"hi"}}\n',
  );
  writeFileSync(join(proj, 'sess-a', 'subagents', 'agent-x1.jsonl'), asst('r4', 20, { model: 'claude-sonnet-5-5' }));
  writeFileSync(join(proj, 'sess-b.jsonl'), asst('r1', 50)); // resume replay of r1
  return proj;
}

test('spend: today\'s requests priced once each, across files and subagents', async () => {
  const root = tmp();
  try {
    const proj = projects(root);
    const old = join(proj, 'old.jsonl');
    writeFileSync(old, asst('r9', 10));
    const t = (Date.now() - 48 * 3600 * 1000) / 1000;
    utimesSync(old, t, t); // untouched today: never read
    const r = await refresh({ root: join(root, 'projects'), dir: join(root, 'spend'), prices: PRICES });
    const want = cost(50) + cost(20, 'claude-sonnet-5-5');
    assert.ok(Math.abs(r.usd - want) < 1e-9, `${r.usd} vs ${want}`);
    assert.equal(r.unpriced, 1);
    assert.equal(r.files, 3);
    const cache = JSON.parse(readFileSync(join(root, 'spend', `day-${localDay(new Date())}.json`), 'utf8'));
    assert.ok(Math.abs(cache.usd - want) < 1e-9);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('spend: a refresh reads only appended bytes; a torn line waits for its newline', async () => {
  const root = tmp();
  try {
    const proj = projects(root);
    const opts = { root: join(root, 'projects'), dir: join(root, 'spend'), prices: PRICES };
    const base = (await refresh(opts)).usd;
    const line = asst('r5', 30);
    appendFileSync(join(proj, 'sess-b.jsonl'), line.slice(0, 40)); // torn
    assert.ok(Math.abs((await refresh(opts)).usd - base) < 1e-9);
    appendFileSync(join(proj, 'sess-b.jsonl'), line.slice(40));
    assert.ok(Math.abs((await refresh(opts)).usd - (base + cost(30))) < 1e-9);
    // an earlier day's files are pruned
    writeFileSync(join(root, 'spend', 'day-2000-01-01.json'), '{}');
    await refresh(opts);
    assert.ok(!existsSync(join(root, 'spend', 'day-2000-01-01.json')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('spend: row 1 shows day $X from the cache, nothing before the first refresh', () => {
  const dir = tmp();
  const env = { ...NOREG, CLAUDE_SPEND_DIR: dir };
  try {
    assert.ok(!plain(render(json('no-rate-limits.json'), env)).includes('day $'));
    const write = (usd) => writeFileSync(join(dir, `day-${localDay(new Date())}.json`), JSON.stringify({ usd, ts: Date.now() }));
    write(4.5);
    assert.ok(plain(render(json('no-rate-limits.json'), env)).split('\n')[0].endsWith(' · $3.13 · day $4.50'));
    write(48.4);
    assert.ok(plain(render(json('no-rate-limits.json'), env)).split('\n')[0].endsWith(' · day $48'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('spend: a stale cache spawns the detached worker, which fills it and drops the lock', async () => {
  const root = tmp();
  try {
    projects(root);
    const spend = join(root, 'spend');
    const env = { CLAUDE_SPEND_DIR: spend, CLAUDE_PROJECTS_DIR: join(root, 'projects') };
    const t0 = performance.now();
    assert.equal(runScript(fixture('no-rate-limits.json'), { ...env, CLAUDE_SPEND_NO_REFRESH: '' }).code, 0);
    const day = join(spend, `day-${localDay(new Date())}.json`);
    while (!existsSync(day) || existsSync(spendLock(spend))) {
      assert.ok(performance.now() - t0 < 10000, 'worker never finished');
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(Math.abs(JSON.parse(readFileSync(day, 'utf8')).usd - (cost(50) + cost(20, 'claude-sonnet-5-5'))) < 1e-9);
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
