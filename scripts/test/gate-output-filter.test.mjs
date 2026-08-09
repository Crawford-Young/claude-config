import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = resolve(HERE, '..', '..', 'hooks', 'gate-output-filter.ps1');

// The hook runs under Windows PowerShell 5.1 in production (settings.json wiring),
// so the test spawns the same engine — not pwsh 7. That engine exists only on
// Windows; CI's ubuntu runner has no PS 5.1 to spawn, so the suite skips itself there.
const winTest = process.platform === 'win32' ? test : test.skip;

function runHook(payload) {
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr };
}

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });

winTest('gate command with EXIT echo is rewritten to log-file + grep filter', () => {
  const { status, stdout } = runHook(bash('pnpm run typecheck; echo EXIT:$?'));
  assert.equal(status, 0);
  assert.notEqual(stdout, '', 'expected updatedInput JSON on stdout');
  const out = JSON.parse(stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  const cmd = out.hookSpecificOutput.updatedInput.command;
  assert.match(cmd, /claude-gate-logs/);
  assert.match(cmd, /echo EXIT:/);
  assert.match(cmd, /FULL_LOG:/);
  // Log path must be POSIX-slash only: raw $env:TEMP backslashes make git-bash
  // mkdir a literal 'C:\...'-named directory in cwd (T1 C7).
  const logPath = cmd.match(/FULL_LOG:(\S+)/)[1];
  assert.ok(!logPath.includes('\\'), `log path carries backslashes: ${logPath}`);
});

winTest('non-gate command passes through untouched (empty stdout)', () => {
  const { status, stdout } = runHook(bash('git status'));
  assert.equal(status, 0);
  assert.equal(stdout, '');
});

winTest('gate command with redirection is left alone', () => {
  const { status, stdout } = runHook(bash('pnpm run test > out.txt; echo EXIT:$?'));
  assert.equal(status, 0);
  assert.equal(stdout, '');
});

winTest('gate command without EXIT echo is left alone', () => {
  const { status, stdout } = runHook(bash('pnpm run lint'));
  assert.equal(status, 0);
  assert.equal(stdout, '');
});

winTest('null command fails open (empty stdout, exit 0)', () => {
  const { status, stdout } = runHook({ tool_name: 'Bash', tool_input: {} });
  assert.equal(status, 0);
  assert.equal(stdout, '');
});
