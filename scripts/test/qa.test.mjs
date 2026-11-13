// node --test scripts/test/qa.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isolatedEnv, spawnHarness, tempDir } from './_spawn.mjs';
import { acquireSuiteLock, discoverGates, gateVerdict, holderState, lockDir, procStart, releaseOnExit } from '../qa.mjs';

const qaScript = join(dirname(fileURLToPath(import.meta.url)), '..', 'qa.mjs');

function repo(files) {
  const r = tempDir('qa-');
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(join(r, f, '..'), { recursive: true });
    writeFileSync(join(r, f), body);
  }
  return r;
}
const names = (r) => discoverGates(r).map((g) => g.name);

test('marker files give claude-config-style repos their gates', () => {
  const r = repo({
    'scripts/test/a.test.mjs': '',
    'scripts/verify-frontmatter.mjs': '',
    'scripts/harness-map.mjs': '',
  });
  const gates = discoverGates(r);
  assert.deepEqual(gates.map((g) => g.name), ['test', 'frontmatter', 'harness-map']);
  assert.equal(gates[0].cmd, 'node --test "scripts/test/*.test.mjs"');
  assert.equal(gates[1].cmd, 'node scripts/verify-frontmatter.mjs');
  assert.equal(gates[2].cmd, 'node scripts/harness-map.mjs check');
});

test('scripts/test without any *.test.mjs yields no test gate', () => {
  assert.deepEqual(names(repo({ 'scripts/test/_spawn.mjs': '' })), []);
});

test('justfile check and package.json still win over markers', () => {
  const markers = { 'scripts/test/a.test.mjs': '', 'scripts/harness-map.mjs': '' };
  assert.deepEqual(names(repo({ ...markers, justfile: 'check:\n  echo' })), ['check']);
  assert.deepEqual(names(repo({ ...markers, 'package.json': '{"scripts":{"test":"x"}}' })), ['test']);
  assert.equal(discoverGates(repo({ ...markers, 'package.json': '{"scripts":{"test":"x"}}' }))[0].cmd, 'pnpm test');
});

test('a Bun repo (bun.lock or bun.lockb) runs its scripts with bun run', () => {
  const pkg = '{"scripts":{"lint":"x","test":"y"}}';
  for (const lock of ['bun.lock', 'bun.lockb']) {
    const cmds = discoverGates(repo({ 'package.json': pkg, [lock]: '' })).map((g) => g.cmd);
    assert.deepEqual(cmds, ['bun run lint', 'bun run test']);
  }
});

test('a node --test gate with no "tests N" (N>=1) line fails even on exit 0', () => {
  const g = { name: 'test', cmd: 'node --test "scripts/test/*.test.mjs"' };
  assert.equal(gateVerdict(g, 0, 'ℹ tests 0\nℹ pass 0\n').ok, false);
  assert.match(gateVerdict(g, 0, 'ℹ tests 0\n').reason, /tests/);
  assert.equal(gateVerdict(g, 0, 'nothing here').ok, false);
  assert.equal(gateVerdict(g, 0, 'ℹ tests 12\nℹ pass 12\n').ok, true);
  assert.equal(gateVerdict(g, 1, 'ℹ tests 12\n').ok, false);
  // a passing test titled "tests 0 ..." must not be read as the summary line
  assert.equal(gateVerdict(g, 0, '✔ tests 0 edge cases (1ms)\nℹ tests 3\nℹ pass 3\n').ok, true);
  assert.equal(gateVerdict(g, 0, '# tests 4\n# pass 4\n').ok, true);
  assert.equal(gateVerdict({ name: 'lint', cmd: 'pnpm lint' }, 0, '').ok, true);
});

test('CLI --list prints the marker gates (main guard does not make the script a no-op)', () => {
  const r = spawnHarness(qaScript, [repo({ '.git': '', 'scripts/test/a.test.mjs': '', 'scripts/verify-frontmatter.mjs': '', 'scripts/harness-map.mjs': '' }), '--list']);
  assert.equal(r.status, 0);
  const out = `${r.stdout}${r.stderr}`;
  for (const n of ['test:', 'frontmatter:', 'harness-map:']) assert.ok(out.includes(n), out);
});

// ---- suite lock (#384) -------------------------------------------------------------

/** A pid that was real a moment ago and has exited. */
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;
const ownerOf = (dir) => JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8'));
/** A lock dir left behind by `owner`, as a crashed run leaves it. */
function staleLock(owner) {
  const dir = join(tempDir('qa-lock-'), 'lock');
  mkdirSync(dir);
  writeFileSync(join(dir, 'owner.json'), JSON.stringify({ repo: 'C:/gone', session: 'gone', since: 1, ...owner }));
  return dir;
}
/** A marker repo whose only gate appends `gate <epoch ms>` to $QA_ORDER_FILE and exits `code`. */
const orderRepo = (code = 0) =>
  repo({
    '.git': '',
    'scripts/verify-frontmatter.mjs': `import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.QA_ORDER_FILE, 'gate ' + Date.now() + '\\n');\nprocess.exit(${code});\n`,
  });

test('lockDir is ~/.claude/qa-lock unless CLAUDE_QA_LOCK_DIR names a private one', () => {
  const before = process.env.CLAUDE_QA_LOCK_DIR;
  try {
    delete process.env.CLAUDE_QA_LOCK_DIR;
    assert.equal(lockDir(), join(homedir(), '.claude', 'qa-lock'));
    process.env.CLAUDE_QA_LOCK_DIR = join('x', 'private');
    assert.equal(lockDir(), join('x', 'private'));
  } finally {
    if (before === undefined) delete process.env.CLAUDE_QA_LOCK_DIR;
    else process.env.CLAUDE_QA_LOCK_DIR = before;
  }
});

test('procStart reads a live process start token, stable across reads, and null for a dead pid', () => {
  const mine = procStart(process.pid);
  assert.ok(typeof mine === 'string' && mine.length > 0, String(mine));
  assert.equal(procStart(process.pid), mine);
  assert.equal(procStart(deadPid()), null);
});

test('holderState: a dead pid is dead, a live pid with another start time is reused, a matching one is alive', () => {
  assert.equal(holderState({ pid: deadPid(), start: '1' }), 'dead');
  assert.equal(holderState({ pid: process.pid, start: 'not-its-start' }), 'reused');
  assert.equal(holderState({ pid: process.pid, start: procStart(process.pid) }), 'alive');
  assert.equal(holderState({ pid: process.pid, start: null }), 'alive', 'an unknown start time cannot prove reuse');
});

test('acquireSuiteLock on a free lock holds it at once, records the holder and releases it', async () => {
  const dir = join(tempDir('qa-lock-'), 'lock');
  const lines = [];
  const lock = await acquireSuiteLock({ dir, repo: 'C:/r', session: 'impl_issue_x-1', log: (l) => lines.push(l) });
  const o = ownerOf(dir);
  assert.deepEqual([o.pid, o.start, o.repo, o.session], [process.pid, procStart(process.pid), 'C:/r', 'impl_issue_x-1']);
  assert.equal(lock.holder, null);
  assert.ok(lock.waitedMs < 5000, String(lock.waitedMs));
  assert.deepEqual(lines, []);
  await lock.release();
  assert.equal(existsSync(dir), false);
});

test('a lock whose holder pid is dead, or alive but reused, is taken over (#384)', async () => {
  for (const [owner, why] of [
    [{ pid: deadPid(), start: '1' }, 'dead'],
    [{ pid: process.pid, start: 'not-its-start' }, 'reused'],
  ]) {
    const dir = staleLock(owner);
    const lines = [];
    const lock = await acquireSuiteLock({ dir, repo: 'C:/r', session: 's', log: (l) => lines.push(l), pollMs: 20 });
    assert.equal(ownerOf(dir).start, procStart(process.pid), why);
    assert.equal(lines.filter((l) => l.includes(`took over from pid ${owner.pid}`) && l.includes(why)).length, 1, lines.join('\n'));
    await lock.release();
    assert.equal(existsSync(dir), false, why);
  }
});

test('an ownerless lock dir and a takeover mutex, both crash-left long ago, are broken', async () => {
  const dir = join(tempDir('qa-lock-'), 'lock');
  const old = new Date(Date.now() - 120_000);
  for (const d of [dir, `${dir}.takeover`]) {
    mkdirSync(d);
    utimesSync(d, old, old);
  }
  const lines = [];
  const lock = await acquireSuiteLock({ dir, repo: 'C:/r', session: 's', log: (l) => lines.push(l), pollMs: 20 });
  assert.equal(ownerOf(dir).pid, process.pid);
  assert.equal(existsSync(`${dir}.takeover`), false);
  assert.equal(lines.filter((l) => l.includes('took over from pid ?')).length, 1, lines.join('\n'));
  await lock.release();
});

test('release leaves a lock that is no longer its own', async () => {
  const dir = join(tempDir('qa-lock-'), 'lock');
  const lock = await acquireSuiteLock({ dir, repo: 'C:/r', session: 's', log: () => {} });
  writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid: 1, start: 'other', repo: 'C:/o', session: 'o', since: 2 }));
  await lock.release();
  assert.equal(ownerOf(dir).repo, 'C:/o');
});

test('acquiring and arming the exit release install no SIGINT/SIGTERM listener, so Ctrl+C keeps its default stop', async () => {
  const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  const dir = join(tempDir('qa-lock-'), 'lock');
  const lock = await acquireSuiteLock({ dir, repo: 'C:/r', session: 's', log: () => {} });
  const proc = new EventEmitter();
  releaseOnExit(lock, proc);
  assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], before);
  assert.deepEqual(proc.eventNames(), ['exit']);
  await lock.release();
});

test('a lock left by a killed holder is taken over', async () => {
  const dir = join(tempDir('qa-lock-'), 'lock');
  const code = `import(${JSON.stringify(pathToFileURL(qaScript).href)}).then(async (m) => {
    await m.acquireSuiteLock({ dir: ${JSON.stringify(dir)}, repo: 'C:/killed' });
    process.stdout.write('held\\n');
    setInterval(() => {}, 1000);
  });`;
  const holder = spawn(process.execPath, ['-e', code], { env: isolatedEnv(tempDir('qa-killed-home-')) });
  await new Promise((res, rej) => {
    holder.stdout.on('data', (d) => String(d).includes('held') && res());
    holder.on('close', () => rej(new Error('holder exited before holding')));
  });
  const closed = new Promise((res) => holder.on('close', res));
  holder.kill('SIGKILL');
  await closed;
  const lines = [];
  const lock = await acquireSuiteLock({ dir, repo: 'C:/r', session: 's', log: (l) => lines.push(l), pollMs: 20 });
  assert.equal(ownerOf(dir).pid, process.pid);
  assert.equal(lines.filter((l) => l.includes(`took over from pid ${holder.pid}`)).length, 1, lines.join('\n'));
  await lock.release();
});

test('the exit fallback releases a lock that main never released', async () => {
  const dir = join(tempDir('qa-lock-'), 'lock');
  const lock = await acquireSuiteLock({ dir, repo: 'C:/r', session: 's', log: () => {} });
  const proc = Object.assign(new EventEmitter(), { exit: () => {} });
  releaseOnExit(lock, proc);
  proc.emit('exit', 1);
  assert.equal(existsSync(dir), false);
});

test('procStart bounds the start-time spawn with a timeout, and a timed-out or failed read is null (the holder counts as alive)', () => {
  for (const platform of ['win32', 'darwin']) {
    let opts;
    const hung = (_cmd, _argv, o) => ((opts = o), { status: null, stdout: '', error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }) });
    assert.equal(procStart(process.pid, hung, platform), null, platform);
    assert.ok(Number.isFinite(opts.timeout) && opts.timeout > 0 && opts.timeout <= 30_000, `${platform}: ${opts.timeout}`);
    assert.equal(procStart(process.pid, () => ({ status: 0, stdout: ' 123\n' }), platform), '123', platform);
  }
  assert.equal(holderState({ pid: process.pid, start: 'x' }, () => null), 'alive');
});

test('CLI: a run queues behind a live holder, names it once, logs the wait and runs after the release (#384)', async () => {
  const dir = join(tempDir('qa-lock-'), 'lock');
  const holderHome = tempDir('qa-holder-home-');
  mkdirSync(join(holderHome, '.claude', 'sessions'), { recursive: true });
  writeFileSync(join(holderHome, '.claude', 'sessions', '4242.json'), JSON.stringify({ pid: 4242, name: 'impl_issue_demo-1' }));
  const HOLD_MS = 5000;
  const code = `import(${JSON.stringify(pathToFileURL(qaScript).href)}).then(async (m) => {
    const lock = await m.acquireSuiteLock({ dir: ${JSON.stringify(dir)}, repo: 'C:/holder-repo' });
    process.stdout.write('held\\n');
    setTimeout(async () => { const t = Date.now(); await lock.release(); process.stdout.write('released ' + t + '\\n'); }, ${HOLD_MS});
  });`;
  const holder = spawn(process.execPath, ['-e', code], { env: isolatedEnv(holderHome, { CLAUDE_PID: '4242' }) });
  let holderOut = '';
  let holderErr = '';
  holder.stderr.on('data', (d) => (holderErr += d));
  const done = new Promise((res) => holder.on('close', res));
  await new Promise((res, rej) => {
    holder.stdout.on('data', (d) => {
      holderOut += d;
      if (holderOut.includes('held')) res();
    });
    holder.on('close', () => rej(new Error(`holder exited before holding: ${holderErr}`)));
  });

  const home = tempDir('qa-waiter-home-');
  const order = join(tempDir('qa-order-'), 'order.txt');
  writeFileSync(order, '');
  const r = spawnHarness(qaScript, [orderRepo(0)], { home, env: { CLAUDE_QA_LOCK_DIR: dir, QA_ORDER_FILE: order } });
  await done;
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 0, out);
  const waits = out.split(/\r?\n/).filter((l) => l.startsWith('qa-lock: waiting on'));
  assert.equal(waits.length, 1, out);
  assert.match(waits[0], new RegExp(`pid ${holder.pid}, repo C:/holder-repo, session impl_issue_demo-1`));
  const released = Number(/released (\d+)/.exec(holderOut)?.[1]);
  const gateAt = Number(/gate (\d+)/.exec(readFileSync(order, 'utf8'))?.[1]);
  assert.ok(released > 0 && gateAt >= released, `gate ran at ${gateAt}, holder released at ${released}`);
  const logs = readdirSync(join(home, '.claude', 'qa-logs'));
  assert.equal(logs.length, 1, logs.join(','));
  const head = readFileSync(join(home, '.claude', 'qa-logs', logs[0]), 'utf8').split(/\r?\n/)[0];
  const waited = Number(/^qa-lock: waited (\d+\.\d) s/.exec(head)?.[1]);
  assert.ok(waited > 0, head);
  assert.equal(existsSync(dir), false, 'the waiter released the lock on exit');
});

test('CLI: a failing gate still releases the lock', () => {
  const dir = join(tempDir('qa-lock-'), 'lock');
  const order = join(tempDir('qa-order-'), 'order.txt');
  const r = spawnHarness(qaScript, [orderRepo(3)], { env: { CLAUDE_QA_LOCK_DIR: dir, QA_ORDER_FILE: order } });
  assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
  assert.match(readFileSync(order, 'utf8'), /^gate \d+/);
  assert.equal(existsSync(dir), false);
});

test('CLI --list takes no lock', () => {
  const dir = staleLock({ pid: process.pid, start: procStart(process.pid) });
  const r = spawnHarness(qaScript, [orderRepo(0), '--list'], { env: { CLAUDE_QA_LOCK_DIR: dir }, timeout: 20_000 });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.doesNotMatch(`${r.stdout}`, /qa-lock/);
});
