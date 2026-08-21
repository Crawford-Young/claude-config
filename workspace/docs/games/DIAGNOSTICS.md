# Games Diagnostics — telemetry, probes, feel tuning

Reference doc (moved from the `games-diagnostics` skill, 2026-08-21). Load
when scoping Godot work that touches movement, physics, or game feel — probe
discipline and the tuning loop are wave-shape decisions, made before code.

## Debug probes

- Probe code lands as ONE purely-additive commit, removed by `git revert` — never hand-deletion (grep-zero proves marker removal, not structural revert). Mark blocks `DEBUG PROBE — remove before gates`; verify removal with `git diff <pre-probe-sha> HEAD -- <files>` expecting empty.
- A revert doesn't remove what the probe accreted in LATER commits (sidecar files, extractions) — residue check = marker grep PLUS `git status` read taken AFTER the deletion.
- `git revert` auto-messages carry no Co-Authored-By trailer — amend at creation, or drop the byte-net-zero pair pre-PR (verify branch diff hash identical).

## Measurement

- **Rates/derivatives: compute from position/state deltas over the span, never stride-sampled per-tick rows** — a stride sharing a factor with any buffering window phase-locks and reports a systematically wrong rate. Verify any measured number entering a diagnosis two independent ways.
- **Report the WORST case, never the mean, for floor/ceiling claims** — a mean can't violate a bound its tail violates. Every "stays above/below X" probe column carries min/max.

## Feel-gate tuning loop

Per round: ride → symptom split (one focused question if ambiguous) → probe-verified diagnosis → user pick → warm redo to the owning implementer → re-review. Two hard rules:

1. **No constant or geometry change ships without a probe-verified diagnosis** — levers coupled to layout/spacing terms can measure exactly zero net effect; probe the lever in isolation and the term you think is unrelated.
2. **Any fork encoding product feel (parity break, cap widening, geometry redesign) is a user pick** — and ride-BEFORE-review for those changes; log deferred review debt with its close condition.

- A tunable expressed as a FRACTION of a dimension but bounded by an ABSOLUTE quantity silently re-solves when the dimension changes — record the solve in its doc comment, re-solve in the same round the dimension moves.
- An invariant holding by arithmetic luck between two independently-tuned numbers isn't an invariant — write it as a structural clamp.
