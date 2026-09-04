// node --test scripts/test/permission-denied.test.mjs — PermissionDenied hook (A8).
// Spawned like _hooklib.test.mjs: real hook process, stdin bytes in, log file out —
// this is a logger, so the thing worth proving is the file on disk, not a return value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const hooksDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks');
const permissionDenied = join(hooksDir, 'permission-denied.mjs');

/** A throwaway HOME so nothing here touches the real ~/.claude/permission-denials.log. */
function home() {
  const h = mkdtempSync(join(tmpdir(), 'permdenied-'));
  mkdirSync(join(h, '.claude'), { recursive: true });
  return h;
}

function runHook(input, h) {
  const env = { ...process.env, HOME: h, USERPROFILE: h };
  try {
    const stdout = execFileSync(process.execPath, [permissionDenied], { input, encoding: 'utf8', env });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

const logPath = (h) => join(h, '.claude', 'permission-denials.log');

// The real, un-redirected log path — used only to prove the redirect actually
// took effect, not to make assertions that would be flaky against real state.
const realLogPath = join(homedir(), '.claude', 'permission-denials.log');

test('the HOME/USERPROFILE redirect actually lands the log in the temp dir, not the real one', () => {
  const h = home();
  const realBefore = existsSync(realLogPath) ? statSync(realLogPath).size : null;

  const payload = JSON.stringify({
    session_id: 'sess-1',
    tool_name: 'Bash',
    denial_reason: 'blocked by hard_deny rule',
    classifier_verdict: 'deny',
    tool_input: { command: 'rm -rf /' },
  });
  const r = runHook(payload, h);

  assert.equal(r.code, 0, 'PermissionDenied cannot block; the hook must always exit 0');
  assert.ok(existsSync(logPath(h)), 'redirected log must exist under the temp HOME');

  const realAfter = existsSync(realLogPath) ? statSync(realLogPath).size : null;
  assert.equal(realAfter, realBefore, 'the real ~/.claude/permission-denials.log must be untouched by this test');
});

test('logs the diagnosable fields: tool_name, denial_reason, classifier_verdict, session', () => {
  const h = home();
  const payload = JSON.stringify({
    session_id: 'sess-42',
    tool_name: 'Bash',
    denial_reason: 'blocked by hard_deny rule',
    classifier_verdict: 'deny',
    tool_input: { command: 'echo hi' },
  });
  runHook(payload, h);

  const line = readFileSync(logPath(h), 'utf8').trim();
  assert.match(line, /session="sess-42"/);
  assert.match(line, /tool="Bash"/);
  assert.match(line, /reason="blocked by hard_deny rule"/);
  assert.match(line, /verdict="deny"/);
});

test('a missing classifier_verdict (auto-mode denial with no classifier) still logs cleanly', () => {
  const h = home();
  const payload = JSON.stringify({
    session_id: 'sess-7',
    tool_name: 'Write',
    denial_reason: 'auto mode denied without a classifier verdict',
  });
  const r = runHook(payload, h);

  assert.equal(r.code, 0);
  const line = readFileSync(logPath(h), 'utf8').trim();
  assert.match(line, /verdict=\?/);
  assert.match(line, /tool="Write"/);
});

test('large tool_input is truncated in the logged line, and the truncation is visible', () => {
  const h = home();
  const bigCommand = 'x'.repeat(2000);
  const payload = JSON.stringify({
    session_id: 'sess-99',
    tool_name: 'Bash',
    denial_reason: 'blocked',
    classifier_verdict: 'deny',
    tool_input: { command: bigCommand },
  });
  runHook(payload, h);

  const line = readFileSync(logPath(h), 'utf8').trim();
  assert.ok(!line.includes(bigCommand), 'the full 2000-char command must not appear verbatim');
  assert.match(line, /truncated \d+ chars/, 'the line must say it truncated, not silently drop data');
  assert.ok(line.length < bigCommand.length, 'the logged line must be materially shorter than the raw input');
});

test('a denial with embedded newlines in denial_reason and a string tool_input still writes exactly one line', () => {
  const h = home();
  const payload = JSON.stringify({
    session_id: 's1',
    tool_name: 'Bash',
    denial_reason: 'blocked because\nthe rule says no',
    classifier_verdict: 'deny',
    tool_input: 'echo one\necho two',
  });
  runHook(payload, h);

  const raw = readFileSync(logPath(h), 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, `one denial must write exactly one line, got ${lines.length}: ${JSON.stringify(raw)}`);
  assert.ok(!/[^\\]\n/.test(lines[0]), 'no raw newline may survive inside the single line');
  assert.match(lines[0], /session="s1"/);
  assert.match(lines[0], /reason="blocked because\\nthe rule says no"/);
  assert.match(lines[0], /input="echo one\\necho two"/);
});

test('the log self-trims: a pre-existing oversized log is capped back under 512KB', () => {
  const h = home();
  writeFileSync(logPath(h), `${'x'.repeat(60)}\n`.repeat(20_000));
  assert.ok(statSync(logPath(h)).size > 512 * 1024, 'precondition: log starts over the cap');

  const payload = JSON.stringify({ session_id: 'sess-trim', tool_name: 'Bash', denial_reason: 'blocked', classifier_verdict: 'deny' });
  runHook(payload, h);

  assert.ok(statSync(logPath(h)).size < 512 * 1024, 'log must be trimmed back under the cap');
  const lines = readFileSync(logPath(h), 'utf8').split('\n').filter(Boolean);
  assert.match(lines.at(-1), /session="sess-trim"/, 'the newest line survives the trim');
});
