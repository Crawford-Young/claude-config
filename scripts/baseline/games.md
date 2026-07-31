# CLAUDE.md — Games Domain Standards

**Inherits:** `~/code/CLAUDE.md` (universal rules). Adds the Godot stack; overrides only where explicitly stated. Applies to every project under `~/code/games/`.

> **Situational skills:** `plan-premises` (games plan-time checks — load before writing a games plan) · `games-diagnostics` (telemetry, probes, feel-gate tuning loop).

---

## Stack (key decisions)

| Concern | Tool |
|---|---|
| Engine | Godot 4.x |
| Language | GDScript |
| Testing | GUT (Godot Unit Test) — addon-based, runs headlessly |
| VCS | git + Git LFS for binary assets |
| Task runner | Justfile — required in every repo (universal rule) |
| Error monitoring | Sentry — shipped builds only |
| Commits | Conventional Commits — enforced by commitlint |

---

## Project Layout

```
project.godot      # engine project file — the equivalent of package.json
scenes/             # .tscn scene files — composition, node trees
scripts/            # .gd script files — logic attached to nodes
assets/             # sprites, audio, models — routed through Git LFS
tests/              # GUT test suites
addons/gut/         # the GUT testing framework itself
```

---

## Version Control

- `.gitignore` excludes `.godot/` — local import/shader cache, regenerated on open.
- `export_presets.cfg` can carry signing secrets — gitignore it, or scrub before sharing.
- `*.import` files are generated per-asset metadata — never hand-edit; they regenerate on reimport.
- `.gitattributes` routes binary assets through LFS: `*.png *.jpg *.wav *.ogg *.glb *.blend filter=lfs diff=lfs merge=lfs -text`.
- `.tscn` and `.tres` are **plain text** — diff and review them as code (unlike `.blend` and other binary formats).

---

## Architecture Principles

- **One responsibility per scene** — a scene doing two unrelated jobs can be neither reused nor tested in isolation.
- **Logic in plain `RefCounted`/`Resource` scripts, not `Node._process`** — node-free scripts unit-test headlessly in GUT; logic in per-frame callbacks needs the whole scene tree.
- **Signals up, method calls down** — child emits signals its parent listens for; parent calls methods on children it owns.
- **Autoload singletons for genuinely global state only** — overuse recreates uncontrolled global mutable state.

---

## Godot Gotchas

- New `class_name` scripts are invisible to headless GUT until the global script-class cache rebuilds: `godot --headless --editor --quit --path .` after adding one — `--import` does NOT rebuild it (3× in one wave, 2026-07).
- Reimport after every `.tscn`/asset edit before any headless run: `godot --headless --path . --import` (wrap as `just import`).
- **A GUT test file that fails to PARSE passes the gate silently** — GUT 9.7.1 drops the file and exits 0; the suite shrinks instead of failing. Every gate read checks the `Scripts N` count didn't drop AND greps for "could not find script" (dog-eat-dog w2, 2026-07-26).
- **GUT timing tests depending on a window NOT elapsing must size the window far beyond await drift** — real frames tick during `await wait_for_signal`; use an absurd window (100s) so only the mechanism under test can produce the asserted behavior (n=2 physical-clock class, 2026-07).
- **Export gates read the savepack manifest, not just the exit code** — `export_filter="all_resources"` packs everything scanned; EXIT:0 still shipped node_modules and GUT editor scenes (which break the export outright). Read "Storing File:" lines for anything non-game; route dev tooling through `exclude_filter` (`addons/gut/*, tests/*, node_modules/*, package.json, .gutconfig.json, scenes/dev/*, scripts/dev/*`) — dev-scene dirs count (n=3, 2026-07-25/27).
- **Godot re-imports its own export output** — a web export under the project root gets scanned back in as project resources. Drop `.gdignore` in the build dir; have the export recipe `touch` it since build dirs are gitignored (2026-07-25).
- **Emoji on web builds = bundle a whole COLR font** — default fonts carry no emoji glyphs, web export has no system fallback, and subsetters strip color tables (verified dead end). Bundle full Twemoji Mozilla COLRv0 ttf (~1.5MB), FontVariation fallback scoped to the label, ttf via LFS, CC-BY attribution (2026-07-25).
- **A correct node drawn BEHIND an opaque sibling passes every assertion AND the playtest gate** — sibling order is the whole mechanism, and a missing HUD element reads to a player as "not built yet," returning as a feature request, not a bug report. Any wave adding a HUD element over an opaque-painting scene asserts DRAW ORDER (`hud.get_index() > host.get_index()`), not just visibility (2026-07-29 dog-eat-dog 3a: ClockLabel behind opaque Road a whole wave; two playtests missed it).
- **An invariant holding only by arithmetic luck between two independently-tuned numbers is not an invariant — clamp it structurally.** Tunables whose product must stay under a bound drift apart at the next feel retune; write the bound as a clamp (2026-07-29: traffic band max × jitter = 1.0125 of dog top speed — a car that outruns the dog can never pin; fixed `clampf(v, top*0.05, top*0.95)`).
- **A feel lever appearing in docs as a LITERAL drifts every time it moves** — keep the literal (player-facing prose should name the number), but re-grep every doc for the old value in the same action batch that ships the new one (2026-07-29: `work_start_minutes` moved twice; README + repo CLAUDE.md stale both times).

## Geometry & Docs Invariants

- **Any wave changing floor geometry re-verifies the FULL marker/respawn set live against the FINAL state — including every erosion/degradation loop.** Markers are placed early; holes are authored later by different tasks, and no per-task review sees the pairing. A respawn over a hole is a softlock that passes every gate. Raycast down from each marker in the running physics space at each loop; report the sample count every run so a drifting probe window can't shrink coverage silently (what-is-dark 3b T9.4: 58 erodable bodies + 5 chasms opened under verified markers).
- **Doc claims about CONTROLS and INPUT are live-testable in one probe — test them, never review them by reading.** The line a design ruling touches is the line most likely false: editing it under the ruling feels like verifying it (n=2, both caught only at whole-branch review: "air-only" erosion wording vs ground-scaling code; README "hold Jump to ride" vs a ride taking no input).

## TDD Scope

Full TDD with 100% coverage applies to **pure logic**: state machines, damage/score calculation, inventory, save/load — anything expressible as a plain script with no node-tree dependency. Scene/node-tree tests are smoke-level (instantiates, `_ready` runs clean). **There is no coverage gate on visual scenes** — state this explicitly in reviews and checklists so it's never mistaken for an oversight.

---

## Playtest Gate (mandatory)

Automated coverage, GUT, and a clean headless run do not catch what a human playing the game catches (n=2: duel 2026-06-30 — missing HUD + two copy bugs + contrast regression past full automation, caught in a 2-minute playtest; what-is-dark phase 1 — user-caught issues on 4 of 8 tasks with green suites). Every games task ends with driving the actual running build. Playtest verdicts can be design rulings, not just bug reports — treat them as spec input.

**Known blind spot: the gate cannot see ABSENCE.** A player reads a missing element as unbuilt, not broken — it returns as a feature request rounds later or never. Anything whose failure mode is "isn't there" needs an assertion; the human gate is not the backstop for it (2026-07-29 dog-eat-dog 3a, n=1).

---

## Definition of Done

- [ ] GUT — all suites green
- [ ] Headless export builds succeed for each target platform
- [ ] Clean run with no `push_error`/`push_warning` output
- [ ] Manual playtest — the mandatory gate above
- [ ] README.md + repo CLAUDE.md updated
- [ ] Phase boundary: `claude-md-management:reflect` run before requesting push/PR

Run `superpowers:verification-before-completion` before declaring anything done.
