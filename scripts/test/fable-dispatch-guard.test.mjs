import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const GRANT = resolve(HERE, '..', '..', 'hooks', 'fable-clearance-grant.ps1');
const GUARD = resolve(HERE, '..', '..', 'hooks', 'agent-model-guard.ps1');

// The hooks run under Windows PowerShell 5.1 in production (settings.json wiring),
// so the tests spawn the same engine. That engine exists only on Windows; CI's
// ubuntu runner has no PS 5.1 to spawn, so the suite skips itself there.
const winTest = process.platform === 'win32' ? test : test.skip;

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'fable-guard-'));
  return {
    dir,
    clearance: join(dir, 'clearance.json'),
    ledger: join(dir, 'ledger.log'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function runHook(hook, payload, env) {
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', hook], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr };
}

const nowEpoch = () => Math.floor(Date.now() / 1000);

function writeMarker(path, { uses_left = 1, ageSeconds = 0 } = {}) {
  writeFileSync(
    path,
    JSON.stringify({
      granted_at: new Date().toISOString(),
      granted_epoch: nowEpoch() - ageSeconds,
      uses_left,
      prompt_head: 'test marker',
    }),
  );
}

winTest('grant hook writes a single-use marker when the prompt carries the token', () => {
  const s = sandbox();
  try {
    const { status, stdout } = runHook(
      GRANT,
      { hook_event_name: 'UserPromptSubmit', prompt: 'run the fable diagnostic - FABLE OK' },
      { FABLE_CLEARANCE_PATH: s.clearance },
    );
    assert.equal(status, 0);
    assert.ok(existsSync(s.clearance), 'expected a marker file');
    const marker = JSON.parse(readFileSync(s.clearance, 'utf8'));
    assert.equal(marker.uses_left, 1);
    assert.ok(Math.abs(marker.granted_epoch - nowEpoch()) < 120, 'granted_epoch should be now');
    assert.match(stdout, /fable clearance granted/);
  } finally {
    s.cleanup();
  }
});

winTest('grant hook is a no-op when the prompt has no token', () => {
  const s = sandbox();
  try {
    const { status, stdout } = runHook(
      GRANT,
      { hook_event_name: 'UserPromptSubmit', prompt: 'dispatch a recon agent please' },
      { FABLE_CLEARANCE_PATH: s.clearance },
    );
    assert.equal(status, 0);
    assert.equal(stdout, '');
    assert.equal(existsSync(s.clearance), false, 'no marker should be written');
  } finally {
    s.cleanup();
  }
});

// Spec case 9's second clause: an ordinary prompt must not disturb a live
// clearance. A hook that truncated the marker on every prompt passes the
// "no marker created" test above (cold review M5).
winTest('grant hook leaves an existing marker byte-identical when there is no token', () => {
  const s = sandbox();
  try {
    writeMarker(s.clearance);
    const before = readFileSync(s.clearance, 'utf8');
    const { status } = runHook(
      GRANT,
      { hook_event_name: 'UserPromptSubmit', prompt: 'just a normal message' },
      { FABLE_CLEARANCE_PATH: s.clearance },
    );
    assert.equal(status, 0);
    assert.equal(readFileSync(s.clearance, 'utf8'), before, 'existing marker must be untouched');
  } finally {
    s.cleanup();
  }
});

winTest('grant hook does not fire on a lowercase near-miss', () => {
  const s = sandbox();
  try {
    // The status assert is what makes this test red before the hook exists —
    // "no marker" alone is vacuously true on a missing script (cold review M4b).
    const { status } = runHook(
      GRANT,
      { hook_event_name: 'UserPromptSubmit', prompt: 'is fable ok for this task?' },
      { FABLE_CLEARANCE_PATH: s.clearance },
    );
    assert.equal(status, 0);
    assert.equal(existsSync(s.clearance), false, 'token match is case-sensitive');
  } finally {
    s.cleanup();
  }
});

const agent = (tool_input) => ({ tool_name: 'Agent', tool_input });

function runGuard(s, tool_input) {
  return runHook(GUARD, agent(tool_input), {
    FABLE_CLEARANCE_PATH: s.clearance,
    FABLE_LEDGER_PATH: s.ledger,
  });
}

winTest('explicit fable dispatch with no clearance is blocked and logged', () => {
  const s = sandbox();
  try {
    const { status, stderr } = runGuard(s, {
      subagent_type: 'recon',
      model: 'claude-fable-5',
      prompt: 'diagnose the failing gate',
    });
    assert.equal(status, 2);
    assert.match(stderr, /clearance/i);
    assert.match(stderr, /FABLE OK/);
    assert.match(readFileSync(s.ledger, 'utf8'), /BLOCK\s+type=recon\s+model=claude-fable-5/);
  } finally {
    s.cleanup();
  }
});

winTest('fable dispatch with a fresh marker is allowed, consumes the use, and logs ALLOW', () => {
  const s = sandbox();
  try {
    writeMarker(s.clearance);
    const { status } = runGuard(s, { subagent_type: 'recon', model: 'fable', prompt: 'diagnose' });
    assert.equal(status, 0);
    assert.equal(JSON.parse(readFileSync(s.clearance, 'utf8')).uses_left, 0);
    assert.match(readFileSync(s.ledger, 'utf8'), /ALLOW\s+type=recon\s+model=fable/);
  } finally {
    s.cleanup();
  }
});

winTest('a marker older than 30 minutes is stale', () => {
  const s = sandbox();
  try {
    writeMarker(s.clearance, { ageSeconds: 1860 });
    const { status } = runGuard(s, { subagent_type: 'reviewer', model: 'claude-fable-5[1m]', prompt: 'x' });
    assert.equal(status, 2);
  } finally {
    s.cleanup();
  }
});

winTest('an already-consumed marker does not allow a second dispatch', () => {
  const s = sandbox();
  try {
    writeMarker(s.clearance, { uses_left: 0 });
    const { status } = runGuard(s, { subagent_type: 'recon', model: 'fable', prompt: 'x' });
    assert.equal(status, 2);
  } finally {
    s.cleanup();
  }
});

winTest('a non-fable model passes through with no ledger line', () => {
  const s = sandbox();
  try {
    const { status } = runGuard(s, { subagent_type: 'implementer', model: 'sonnet', prompt: 'x' });
    assert.equal(status, 0);
    assert.equal(existsSync(s.ledger), false, 'non-fable dispatches are not logged');
  } finally {
    s.cleanup();
  }
});

winTest('regression: model omitted on a type with no frontmatter model is still blocked', () => {
  const s = sandbox();
  try {
    const { status, stderr } = runGuard(s, { subagent_type: 'general-purpose', prompt: 'x' });
    assert.equal(status, 2);
    assert.match(stderr, /issue #3\/G4/);
  } finally {
    s.cleanup();
  }
});

winTest('regression: model omitted on a type WITH a frontmatter model passes', () => {
  const s = sandbox();
  try {
    const { status } = runGuard(s, { subagent_type: 'recon', prompt: 'x' });
    assert.equal(status, 0);
  } finally {
    s.cleanup();
  }
});

// Cold review C1: a marker that will not parse must read as "no clearance",
// not as "guard offline". The naive single-try version exits 0 here — the
// dispatch runs AND no ledger line is written, losing the audit trail in
// exactly the state where something is already wrong.
winTest('a corrupt marker blocks and still writes a ledger line', () => {
  const s = sandbox();
  try {
    writeFileSync(s.clearance, '{ this is not json');
    const { status } = runGuard(s, { subagent_type: 'recon', model: 'fable', prompt: 'x' });
    assert.equal(status, 2);
    assert.match(readFileSync(s.ledger, 'utf8'), /BLOCK\s+type=recon\s+model=fable/);
  } finally {
    s.cleanup();
  }
});
