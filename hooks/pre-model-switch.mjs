#!/usr/bin/env node
// pre-model-switch.mjs — PreModelSwitch gate (H61). Wire with no matcher.
//
// PreModelSwitch runs before Claude Code applies a requested model switch and
// blocks it on exit 2. Under posture C the session default is Opus and Fable is
// opted into per wave with `/model`, so the switch itself is the moment the
// usage-billed decision is made — it needs the same per-run user clearance a
// fable *dispatch* needs (agent-model-guard.mjs), and it consumes the same
// single-use marker, so one "FABLE OK" authorises one billed act, not two.
//
// Only a switch *to* a billed model is gated. Switching away from fable is
// always allowed and never spends clearance.
//
// Fail-closed, like the other guards: a gate that crashed has checked nothing,
// and a silent allow there is invisible where a block is not. The cost of the
// false positive is a blocked `/model` with the reason on stderr; the cost of
// the false negative is an unclearanced usage-billed session.

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { appendTrimmed, block, claudeDir, run } from './_hooklib.mjs';

const markerFile = join(claudeDir, 'fable-clearance.json');
const dispatchLog = join(claudeDir, 'fable-dispatch.log');
const CLEARANCE_MS = 30 * 60 * 1000;

// Kept in step with agent-model-guard.mjs by hand: the two gates must agree on
// what "usage-billed" means, and neither may import the other (each is a hook
// entry point that runs on import).
const BILLED_MODEL = /fable|mythos/;

function logLine(verdict, from, to) {
  try {
    appendTrimmed(dispatchLog, `${new Date().toISOString()} ${verdict} switch from=${from || '?'} to=${to || '(omitted)'}`);
  } catch {
    // audit trail is best-effort — logging never throws into the gate
  }
}

run(
  'pre-model-switch',
  (payload) => {
    const from = payload?.from_model || '';
    const to = payload?.to_model || '';

    if (!to) {
      // Nothing to match on. The switch is not itself billed, and the model it
      // lands on is recorded as unknown by post-model-switch.mjs, which makes
      // agent-model-guard.mjs refuse forks until the model is known again —
      // so this is auditable rather than gated.
      logLine('UNKNOWN', from, to);
      return;
    }

    if (!BILLED_MODEL.test(to.toLowerCase())) return;

    let ok = false;
    try {
      if (existsSync(markerFile)) {
        const marker = JSON.parse(readFileSync(markerFile, 'utf8'));
        ok = Date.now() - Date.parse(marker.granted) < CLEARANCE_MS;
        unlinkSync(markerFile); // single use, consumed either way
      }
    } catch {
      ok = false;
    }

    logLine(ok ? 'ALLOW' : 'BLOCK', from, to);
    if (!ok) {
      block(
        `Switching this session to "${to}" is usage-billed and needs per-run user clearance: ask the user to reply with "FABLE OK" (grants one billed act for 30 minutes), then re-run /model.`,
      );
    }
  },
  { failClosed: true },
);
