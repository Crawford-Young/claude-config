---
name: games-diagnostics
description: Use for Godot telemetry, debug probes, and feel-tuning rounds — probe lifecycle and removal, rate and derivative measurement from tick data, and the feel-gate tuning loop.
---

# Games Diagnostics

Relocated from `~/code/games/CLAUDE.md` on 2026-07-28.

## Telemetry & debug probes

- **The probe pair violates the trailer rule by construction:** `git revert` auto-generates its commit message with NO `Co-Authored-By` trailer. Either amend the revert message at creation to add the trailer, or plan to drop the byte-net-zero pair via rebase pre-PR (verify the branch diff hash identical pre/post: `git diff origin/main..HEAD | git hash-object --stdin`). Caught at whole-branch review — the last rewritable window. (what-is-dark phase-3a M1, 2026-07-25.)
- **Temporary probe code lands as ONE purely-additive commit and is removed by `git revert`, never hand-deletion.** Hand-removal of a probe passed grep-zero (probe markers), full GUT, and a clean headless launch — and still left a structural residue (a variable extraction the probe diff introduced) that only a byte-diff against the pre-probe commit caught. Grep-zero proves marker removal, not structural revert; revert is byte-exact by construction. Mark every probe block `DEBUG PROBE — remove before gates` regardless, and verify removal with `git diff <pre-probe-sha> HEAD -- <files>` expecting empty. (what-is-dark momentum-lab, 2026-07-24.)
- **Rates/derivatives from tick telemetry: compute from position/state deltas over the measured span, never from stride-sampled per-tick delta rows.** A sampling stride sharing a factor with any buffering window (input drain, interpolation) phase-locks onto one step of the split and reports a systematically wrong rate — stride-2 prints over a 2-tick yaw drain reported −57°/s where truth was −118.8°/s, convicting a phantom engine bug. (what-is-dark momentum-lab R13, 2026-07-24.)

## Feel-gate tuning loop

**Feel-gate tuning loop** (evaluation/tuning waves; proven over 15 rounds, momentum-lab 2026-07): each round runs ride → symptom split (one focused question if the complaint is ambiguous) → probe-verified diagnosis → user pick → warm redo to the owning implementer chain → re-review. Two hard rules inside the loop: (1) **no constant or geometry change ships without a probe-verified diagnosis first** — three separate rounds found the physics authentic and the real defect elsewhere (layout, scale, turn-window law); an unverified "fix" would have masked each; (2) **any fork encoding a product-feel judgment (parity break, cap widening, geometry redesign) is a user pick, never an orchestrator walk-rule** — games instance of the universal value-judgment rule, and ride-BEFORE-review is the right order for those changes (review a value the user may reject and the round is wasted; log the review debt explicitly with its close condition instead).
