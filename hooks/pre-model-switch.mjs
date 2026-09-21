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

import { BILLED_MODEL, block, consumeClearance, logBilled, run } from './_hooklib.mjs';

function logLine(verdict, from, to) {
  logBilled(`${verdict} switch from=${from || '?'} to=${to || '(omitted)'}`);
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

    const ok = consumeClearance();
    logLine(ok ? 'ALLOW' : 'BLOCK', from, to);
    if (!ok) {
      block(
        `Switching this session to "${to}" is usage-billed and needs per-run user clearance: ask the user to reply with "FABLE OK" (grants one billed act for 30 minutes), then re-run /model.`,
      );
    }
  },
  { failClosed: true },
);
