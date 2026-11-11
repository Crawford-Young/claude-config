# CLAUDE.md — Games Domain Standards

Adds the Godot stack. Applies to every project under `~/code/games/`.

> **Hand-load [`../docs/games/DIAGNOSTICS.md`](../docs/games/DIAGNOSTICS.md)** before any work touching movement, physics, or game feel — probe discipline and the tuning loop are wave-shape decisions.
> **Hand-load [`../docs/games/EXPORT.md`](../docs/games/EXPORT.md)** before any export, export-preset or web-build work — the export gotchas that pass a green exit code.

## Stack (verified: 2026-10, #80)

| Concern | Tool |
|---|---|
| Engine | Godot 4.x |
| Language | GDScript |
| Testing | GUT (Godot Unit Test) — addon-based, runs headlessly |
| VCS | git + Git LFS for binary assets |
| Task runner | Justfile — required in every repo |
| Error monitoring | Sentry — shipped builds only |
| Commits | Conventional Commits — enforced by commitlint |

## Version Control

- `export_presets.cfg` can carry signing secrets — gitignore it, or scrub before sharing.
- `*.import` files are generated per-asset metadata — never hand-edit; they regenerate on reimport.
- `.gitattributes` routes binary assets through LFS: `*.png *.jpg *.wav *.ogg *.glb *.blend filter=lfs diff=lfs merge=lfs -text`.

## Architecture Principles

- **Logic in plain `RefCounted`/`Resource` scripts, not `Node._process`** — node-free scripts unit-test headlessly in GUT; logic in per-frame callbacks needs the whole scene tree.

## Godot Gotchas

- New `class_name` scripts are invisible to headless GUT until the global script-class cache rebuilds — run `godot --headless --editor --quit --path .` after adding one; `--import` does NOT rebuild it.
- Reimport after every `.tscn`/asset edit before any headless run: `godot --headless --path . --import` (wrap as `just import`).
- **On every GUT gate read, check the `Scripts N` count didn't drop AND grep for "could not find script"** — GUT 9.7.1 drops a test file that fails to PARSE and exits 0, so the suite shrinks instead of failing.
- **Size a GUT window that must NOT elapse far beyond await drift (e.g. 100s)** — real frames tick during `await wait_for_signal`, so a tight window can pass by drift alone, and only an absurd one leaves the mechanism under test as the sole cause.
- **Assert DRAW ORDER (`hud.get_index() > host.get_index()`), not just visibility, for any HUD element over an opaque-painting scene** — a correct node drawn behind an opaque sibling passes every assertion and the playtest gate.
- **Clamp an invariant structurally when it rests on two independently-tuned numbers** — tunables whose product must stay under a bound drift apart at the next feel retune; write the bound as a clamp (e.g. `clampf(v, top*0.05, top*0.95)` for a speed ratio that must stay bounded).
- **Re-grep every doc for a feel lever's old value in the same batch that ships its new one** — player-facing prose should name the number, so the literal drifts every time the lever moves.

## Geometry & Docs Invariants

- **Any wave changing floor geometry re-verifies the FULL marker/respawn set live against the FINAL state, including every erosion/degradation loop** — markers land early and holes later, in tasks no single review pairs, and a respawn over a hole is a softlock that passes every gate. Raycast down from each marker in the running physics space at each loop, and report the sample count every run so a drifting probe window can't shrink coverage silently.
- **Live-test doc claims about CONTROLS and INPUT in one probe, never review them by reading** — the line a design ruling touches is the line most likely false, because editing it under the ruling feels like verifying it.

## TDD Scope

Full TDD with 100% coverage applies to **pure logic**: state machines, damage/score calculation, inventory, save/load — anything expressible as a plain script with no node-tree dependency. Scene/node-tree tests are smoke-level (instantiates, `_ready` runs clean). **There is no coverage gate on visual scenes** — state this explicitly in reviews and issues so it's never mistaken for an oversight.

## Playtest Gate (mandatory)

Coverage, GUT and a clean headless run do not catch what a human playing the game catches — missing HUD elements, copy bugs and contrast regressions pass a fully green suite. Every games task ends with driving the running build; a rework wave rides each game at its step, since a ride can delete what later steps built on. Playtest verdicts can be design rulings, not just bug reports — treat them as spec input.

**Known blind spot: the gate cannot see ABSENCE.** A player reads a missing element as unbuilt, not broken — it returns as a feature request rounds later or never. Anything whose failure mode is "isn't there" needs an assertion; the human gate is not the backstop for it.

## Definition of Done

- [ ] GUT — all suites green
- [ ] Headless export builds succeed for each target platform
- [ ] Clean run with no `push_error`/`push_warning` output
- [ ] Manual playtest — the mandatory gate above

