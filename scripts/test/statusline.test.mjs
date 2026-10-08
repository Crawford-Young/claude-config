// node --test scripts/test/statusline.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillBar, formatTokens, gitInfo, historySample, localDay, render, spendLock } from '../../statusline/statusline.mjs';
import { readFrom, refresh } from '../../statusline/spend.mjs';
import { render as renderSubagents } from '../../statusline/subagent.mjs';
import { priceUsage } from '../../scripts/audit-lib.mjs';
import { record } from '../../hooks/active-repo.mjs';

const SCRIPT = fileURLToPath(new URL('../../statusline/statusline.mjs', import.meta.url));
const HOOK = fileURLToPath(new URL('../../hooks/active-repo.mjs', import.meta.url));
const SUBAGENT = fileURLToPath(new URL('../../statusline/subagent.mjs', import.meta.url));
const SPEND = fileURLToPath(new URL('../../statusline/spend.mjs', import.meta.url));
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
  CLAUDE_USAGE_HISTORY_DIR: join(tmpdir(), 'statusline-test-history'),
  CLAUDE_USAGE_THROTTLE_DIR: join(tmpdir(), 'statusline-test-history'),
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
    assert.equal(g.repo, 'owner-repo');
    assert.deepEqual({ ...gitInfo(dir), top: '' }, { top: '', branch: 'main', worktree: '', repo: 'owner-repo' });
    // a worktree of a bare repo names the repo, not the bare dir's parent
    execFileSync('git', ['clone', '-q', '--bare', dir, join(root, 'foo.git')], { stdio: 'ignore' });
    execFileSync('git', ['-C', join(root, 'foo.git'), 'worktree', 'add', '-q', '-b', 'feat/b', join(root, 'bare-wt')], { stdio: 'ignore' });
    assert.equal(gitInfo(join(root, 'bare-wt')).repo, 'foo');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('gitInfo: submodule worktree names the submodule; reftable HEAD stub shows no branch', () => {
  const root = tmp();
  try {
    // fs-shaped fixtures: a submodule's linked worktree, and a reftable repo's HEAD
    const mod = join(root, 'super', '.git', 'modules', 'sub');
    mkdirSync(join(mod, 'worktrees', 'subwt'), { recursive: true });
    writeFileSync(join(mod, 'worktrees', 'subwt', 'HEAD'), 'ref: refs/heads/f\n');
    writeFileSync(join(mod, 'worktrees', 'subwt', 'commondir'), '../..\n');
    mkdirSync(join(root, 'subwt'));
    writeFileSync(join(root, 'subwt', '.git'), `gitdir: ${join(mod, 'worktrees', 'subwt')}\n`);
    assert.deepEqual({ ...gitInfo(join(root, 'subwt')), top: '' }, { top: '', branch: 'f', worktree: 'subwt', repo: 'sub' });
    mkdirSync(join(root, 'rt', '.git'), { recursive: true });
    writeFileSync(join(root, 'rt', '.git', 'HEAD'), 'ref: refs/heads/.invalid\n');
    assert.equal(gitInfo(join(root, 'rt')).branch, '');
    assert.ok(plain(render(at('full.json', join(root, 'rt')), NOREG)).startsWith('rt · '));
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
      const out = render(json('no-rate-limits.json'), { ...NOREG, CLAUDE_SESSIONS_DIR: dir });
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
    assert.ok(render(json('no-rate-limits.json'), { ...NOREG, CLAUDE_SESSIONS_DIR: dir }).startsWith('\x1b[2m~Agent orchestration app…\x1b[0m · '));
    assert.ok(plain(render(json('no-rate-limits.json'), { ...NOREG, CLAUDE_SESSIONS_DIR: bare })).startsWith('~872d7dd5 · '));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  }
});

test('session name: control and bidi bytes are stripped', () => {
  const dir = registry({ name: '\x1b[31mevil\x07\u009b2J\u202ename\n', nameSource: 'user' });
  try {
    const row1 = render(json('no-rate-limits.json'), { ...NOREG, CLAUDE_SESSIONS_DIR: dir }).split('\n')[0];
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

test('spend: a failed refresh keeps the lock, so renders back off instead of respawning', () => {
  const root = tmp();
  const spend = join(root, 'spend');
  try {
    mkdirSync(spend);
    writeFileSync(spendLock(spend), String(Date.now()));
    const r = spawnSync(process.execPath, [SPEND], { env: { ...process.env, CLAUDE_SPEND_DIR: spend, CLAUDE_PROJECTS_DIR: join(root, 'missing') } });
    assert.equal(r.status, 0);
    assert.ok(existsSync(spendLock(spend)), 'lock released on failure');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('spend: a corrupt day cache counts as stale and kicks a refresh', async () => {
  const root = tmp();
  try {
    projects(root);
    const spend = join(root, 'spend');
    mkdirSync(spend);
    const day = join(spend, `day-${localDay(new Date())}.json`);
    writeFileSync(day, '{"usd":4');
    const env = { ...NOREG, CLAUDE_SPEND_DIR: spend, CLAUDE_PROJECTS_DIR: join(root, 'projects'), CLAUDE_SPEND_NO_REFRESH: '' };
    assert.ok(!plain(render(json('no-rate-limits.json'), env)).includes('day $'));
    const t0 = performance.now();
    while (existsSync(spendLock(spend)) || !readFileSync(day, 'utf8').endsWith('}')) {
      assert.ok(performance.now() - t0 < 10000, 'corrupt cache never rewritten');
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(plain(render(json('no-rate-limits.json'), { ...env, CLAUDE_SPEND_NO_REFRESH: '1' })).includes('day $'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('spend: chunked reads carry a line across chunk boundaries', () => {
  const dir = tmp();
  try {
    const f = join(dir, 'x.jsonl');
    const lines = ['{"a":"é😀"}', '{"b":2}', '{"c":"' + 'x'.repeat(40) + '"}'];
    writeFileSync(f, lines.join('\n') + '\n{"torn"');
    const got = [];
    const size = readFileSync(f).length;
    const offset = readFrom(f, 0, size, (l) => got.push(l), 7);
    assert.deepEqual(got, lines);
    assert.equal(offset, size - '{"torn"'.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('spend: a refresh keeps a later day\'s files (worker straddling midnight)', async () => {
  const root = tmp();
  try {
    projects(root);
    const spend = join(root, 'spend');
    mkdirSync(spend);
    writeFileSync(join(spend, 'day-2999-01-01.json'), '{}');
    await refresh({ root: join(root, 'projects'), dir: spend, prices: PRICES });
    assert.ok(existsSync(join(spend, 'day-2999-01-01.json')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('spend_limit renders when the payload carries it, dollars when present', () => {
  const s = json('full.json');
  s.rate_limits.spend_limit = { used_percentage: 42, resets_at: 1793548800, used_usd: 630.4, limit_usd: 1500 };
  const p = plain(render(s, NOREG)).split('\n')[1];
  assert.match(p, new RegExp(`spend ${bar(42)} 42% \\$630/\\$1500→[A-Z][a-z]{2} \\d{1,2}$`));
  delete s.rate_limits.spend_limit.used_usd;
  assert.match(plain(render(s, NOREG)).split('\n')[1], new RegExp(`spend ${bar(42)} 42%→`));
});

test('stdin with a BOM still renders; a session_id that is not a plain id writes no file', () => {
  const BOM = String.fromCharCode(0xfeff);
  assert.ok(runScript(BOM + fixture('no-rate-limits.json')).out.includes('ctx '));
  const sub = spawnSync(process.execPath, [SUBAGENT], { input: BOM + JSON.stringify({ tasks: [{ id: 'z', model: 'claude-haiku-4-5', label: 'l' }] }), encoding: 'utf8' });
  assert.ok(sub.stdout.includes('"id":"z"'));
  const hist = tmp();
  try {
    const s = { ...json('full.json'), session_id: '../../escaped' };
    runScript(JSON.stringify(s), { CLAUDE_USAGE_HISTORY_DIR: join(hist, 'h'), CLAUDE_USAGE_THROTTLE_DIR: join(hist, 'a', 'b') });
    assert.ok(!existsSync(join(hist, 'escaped.txt')) && !existsSync(join(hist, 'h')));
  } finally {
    rmSync(hist, { recursive: true, force: true });
  }
});

test('auto-title cut never splits a surrogate pair', () => {
  const dir = registry({ name: 'x'.repeat(22) + '😀😀😀', nameSource: 'auto' });
  try {
    const name = plain(render(json('no-rate-limits.json'), { ...NOREG, CLAUDE_SESSIONS_DIR: dir })).split(' · ')[0];
    assert.equal(name, '~' + 'x'.repeat(22) + '😀…');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- subagent rows ----------------------------------------------------------------

test('subagent: label · tier · effort · tokens · elapsed; red ! only for opus/fable at high+', () => {
  const now = 1_800_000_000_000;
  const base = { type: 'local_agent', status: 'running', description: 'review diff', label: 'review diff', startTime: now - 72_000 };
  const lines = renderSubagents(
    {
      columns: 120,
      tasks: [
        { ...base, id: 'a', model: 'claude-sonnet-5-5', tokenCount: 42_000 },
        { ...base, id: 'b', label: 'fix tests', model: 'claude-opus-5-5', effort: 'high', tokenCount: 180_000, startTime: now - 243_000 },
        { ...base, id: 'c', model: 'claude-opus-5-5', effort: 'low', tokenCount: 0 },
        { ...base, id: 'd', type: 'local_bash' }, // no model: keeps the default row
        { ...base, id: 'e', label: 'x\x1b[2Jy', model: 'claude-fable-5-1', effort: 32000 },
      ],
    },
    now,
  )
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.id), ['a', 'b', 'c', 'e']);
  const p = Object.fromEntries(lines.map((l) => [l.id, plain(l.content)]));
  assert.equal(p.a, 'review diff · sonnet · 42k · 1m12s');
  assert.equal(p.b, '! fix tests · opus · high · 180k · 4m03s');
  assert.equal(p.c, 'review diff · opus · low · 1m12s');
  assert.equal(p.e, 'x [2Jy · fable · 32k · 1m12s');
  assert.ok(lines[1].content.startsWith('\x1b[31m!\x1b[0m '));
});

test('subagent: malformed stdin prints nothing and exits 0', () => {
  const r = spawnSync(process.execPath, [SUBAGENT], { input: '{nope', encoding: 'utf8' });
  assert.deepEqual([r.stdout, r.status], ['', 0]);
  const ok = spawnSync(process.execPath, [SUBAGENT], { input: JSON.stringify({ tasks: [{ id: 'z', model: 'claude-haiku-4-5', label: 'l' }] }), encoding: 'utf8' });
  assert.equal(plain(JSON.parse(ok.stdout.trim()).content), 'l · haiku');
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
