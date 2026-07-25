# CLAUDE.md — Games Domain Standards

**Inherits:** `~/code/CLAUDE.md` (universal rules — workflow, git, planning discipline, security). This file adds the Godot stack on top and overrides it only where explicitly stated.

Applies to every project under `~/code/games/`.

---

## Stack (key decisions)

| Concern | Tool |
|---|---|
| Engine | Godot 4.x |
| Language | GDScript |
| Testing | GUT (Godot Unit Test) — addon-based unit testing framework, runs headlessly |
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

- `.gitignore` must exclude `.godot/` — Godot 4's local import/shader cache, regenerated automatically on open, never meaningful to diff or review.
- `export_presets.cfg` can carry signing secrets (keystore paths, credentials) — gitignore it, or scrub secrets first if presets genuinely need to be shared.
- `*.import` files are generated per-asset metadata (one per imported PNG/audio file) — never hand-edit; they regenerate on reimport.
- `.gitattributes` routes binary assets through Git LFS: `*.png *.jpg *.wav *.ogg *.glb *.blend filter=lfs diff=lfs merge=lfs -text` — these are opaque binary blobs that bloat git history if stored directly, unlike text files.
- `.tscn` and `.tres` are **plain text** (Godot 4's default scene/resource format) — diff and review them as code. This is not true of `.blend` or other binary source-asset formats, which git can only ever show as "binary file changed."

---

## Architecture Principles

- **One responsibility per scene** — a scene is a reusable, instantiable unit (Godot's rough analog of a component); a scene doing two unrelated jobs can be neither reused nor tested in isolation.
- **Logic in plain `RefCounted`/`Resource` scripts, not `Node._process`** — a script with no node dependency can be unit-tested headlessly in GUT; logic wired directly into a node's per-frame callback can only be exercised by running the actual scene tree.
- **Signals up, method calls down** — a child emits a signal its parent listens for; a parent calls methods directly on children it owns. Same shape as one-way data flow in web UI: state flows down, events bubble up.
- **Autoload singletons for genuinely global state only** — an autoload (Godot's Project Settings singleton mechanism) is always loaded and reachable from any script with no import wiring, so overusing it recreates uncontrolled global mutable state — the same failure mode Zustand-for-everything would be on web.

---

## Godot Gotchas

- New `class_name` scripts are invisible to headless GUT until Godot rebuilds its global script-class cache — run `godot --headless --editor --quit --path .` once after adding one. `--import` does NOT rebuild this cache. (Hit 3× in one wave: what-is-dark T5/T6/T7, 2026-07.)
- Reimport after every `.tscn`/asset edit before any headless run: `godot --headless --path . --import` (wrap as `just import`).

---

## Plan-Time Checks (games)

- **Respawn/reset math verified at BOUNDARY markers (first/last) at plan time.** A zero-floor progress clamp + `>=` catch check = infinite instant-recatch at marker 0 — shipped in plan-verbatim code, structurally uncatchable by per-task review, found only in playtest. (what-is-dark T7, 2026-07-22.)
- **Screen-covering / volumetric visuals get a "camera inside it" pass**, not just distant-view — a paper-thin QuadMesh void wall showed the unswallowed world at camera contact during the swallow fade. (what-is-dark T7, 2026-07-22.)
- **"Auto" traversal mechanics (auto-vault, auto-step, auto-climb) are spec-time user questions, never plan walk-rules** — auto-vault shipped built-and-reviewed-green and was cut on first play. Games instance of the universal value-judgment-UX rule. (what-is-dark T4, 2026-07-21.)
- **Difficulty bands state their FAILURE MODEL at spec time** — margin-first ("always makeable with slack") vs commitment-first ("clear only at full execution"); spec-HARD in a speedrun game = commitment-first. And bands calibrate against the FULL movement capability envelope including compound chains — measure each verb in a lab env (wall-jump chain measured 196 m/24 m where the single-arc model predicted a horizontal slide), never derive from single function calls. (what-is-dark phase 2: zones 1 AND 2 shipped "way too easy"/"incredibly easy" n=2; chain miss forced a mid-wave lab + shell retrofit, 2026-07-22.)
- **Director/tween sequence PAIRS get an overlap trace at plan time** — for every pair of concurrent sequences (swallow × loop, fall × anything), trace "the other fires mid-window" against the tween-callback timeline. "Same frame" claims about tween callbacks are false by construction — callbacks run at step END. (n=2: what-is-dark phase-1 T7 respawn, phase-2 T3 loop-credited-during-catch — both plan-authored, caught by review/playtest.)
- **A new mechanic's showcase placement + pacing is spec/plan-stated, never implementer latitude** — spacing across zone structure (mid-zone, one per zone-half) and rhythm (rest beat BEFORE the hard section, short re-entry after — the breather is preparation, not reward). Free latitude converges on clustering: flat-stretch availability correlates across zones (seams are flat). (what-is-dark phase-2 T5c/T5d/T5e: corridors clustered at the seam, then pacing inverted — two relocation rounds, n=2 in one wave, 2026-07-22/23.)

---

## Telemetry & Debug Probes

- **The probe pair violates the trailer rule by construction:** `git revert` auto-generates its commit message with NO `Co-Authored-By` trailer. Either amend the revert message at creation to add the trailer, or plan to drop the byte-net-zero pair via rebase pre-PR (verify the branch diff hash identical pre/post: `git diff origin/main..HEAD | git hash-object --stdin`). Caught at whole-branch review — the last rewritable window. (what-is-dark phase-3a M1, 2026-07-25.)
- **Temporary probe code lands as ONE purely-additive commit and is removed by `git revert`, never hand-deletion.** Hand-removal of a probe passed grep-zero (probe markers), full GUT, and a clean headless launch — and still left a structural residue (a variable extraction the probe diff introduced) that only a byte-diff against the pre-probe commit caught. Grep-zero proves marker removal, not structural revert; revert is byte-exact by construction. Mark every probe block `DEBUG PROBE — remove before gates` regardless, and verify removal with `git diff <pre-probe-sha> HEAD -- <files>` expecting empty. (what-is-dark momentum-lab, 2026-07-24.)
- **Rates/derivatives from tick telemetry: compute from position/state deltas over the measured span, never from stride-sampled per-tick delta rows.** A sampling stride sharing a factor with any buffering window (input drain, interpolation) phase-locks onto one step of the split and reports a systematically wrong rate — stride-2 prints over a 2-tick yaw drain reported −57°/s where truth was −118.8°/s, convicting a phantom engine bug. (what-is-dark momentum-lab R13, 2026-07-24.)

---

## TDD Scope

Full TDD with a 100% coverage expectation applies to **pure logic**: state machines, damage/score calculation, inventory, save/load serialization — anything expressible as a plain script with no node-tree dependency. Scene and node-tree tests are smoke-level (does it instantiate, does `_ready` run without error) — the scene runtime depends on the engine's frame loop and node lifecycle, which GUT can drive but cannot meaningfully assert against line-by-line. **There is no coverage gate on visual scenes.** State this explicitly in any review or checklist so it is never mistaken for an oversight.

---

## Playtest Gate (mandatory)

Automated coverage, GUT, and a clean headless run do not catch what a human playing the game catches. The `duel` project (2026-06-30) shipped a missing HUD, two copy bugs, and a contrast regression past full automated coverage, axe, and Lighthouse — a two-minute playtest caught all four. n=2: what-is-dark phase 1 (2026-07) had user-caught issues on 4 of 8 code tasks that green suites + clean reviews missed — two design rulings (auto-vault cut, wall-climb adopted) and two plan-authored bug pairs. Every games task ends with the equivalent: drive the actual running build, not just its tests, before calling it done. Playtest verdicts can be design rulings, not just bug reports — treat them as spec input.

**Feel-gate tuning loop** (evaluation/tuning waves; proven over 15 rounds, momentum-lab 2026-07): each round runs ride → symptom split (one focused question if the complaint is ambiguous) → probe-verified diagnosis → user pick → warm redo to the owning implementer chain → re-review. Two hard rules inside the loop: (1) **no constant or geometry change ships without a probe-verified diagnosis first** — three separate rounds found the physics authentic and the real defect elsewhere (layout, scale, turn-window law); an unverified "fix" would have masked each; (2) **any fork encoding a product-feel judgment (parity break, cap widening, geometry redesign) is a user pick, never an orchestrator walk-rule** — games instance of the universal value-judgment rule, and ride-BEFORE-review is the right order for those changes (review a value the user may reject and the round is wasted; log the review debt explicitly with its close condition instead).

---

## Definition of Done

- [ ] GUT — all suites green
- [ ] Headless export builds succeed for each target platform
- [ ] Clean run with no `push_error`/`push_warning` output
- [ ] Manual playtest — the mandatory gate above
- [ ] README.md + repo CLAUDE.md updated
- [ ] Phase boundary: `claude-md-management:reflect` run before requesting push/PR

Run `superpowers:verification-before-completion` before declaring anything done.

---

## Learning Mode

New to game development — these are the closest web equivalents, not exact matches; use them to build intuition, not to assume identical behavior.

| Godot concept | Web equivalent | Why it's close, and where it isn't |
|---|---|---|
| Node tree | DOM tree | Both are a hierarchy of typed objects with parent/child relationships and lifecycle hooks — but a node carries its behavior directly (an attached script), closer to a Web Component than a plain DOM element. |
| Signal | Event emitter / DOM event | Declared on the emitting node, connected by whatever's listening — same pub/sub shape as `addEventListener` or Node's `EventEmitter`. |
| `_process(delta)` | `requestAnimationFrame` loop | Called once per rendered frame with the elapsed time (`delta`) since the last call — the same contract as an rAF callback receiving a timestamp. |
| Autoload | Global store | Always loaded and reachable by name from any script with zero import wiring — closer to a bare global than a scoped store like Zustand; the "singleton, no setup" property is the whole point and the whole risk. |
| `Resource` | Serialized config object | Data plus schema that can be saved to disk (`.tres`/`.res`) and loaded back — closer to a validated config file than a runtime data-fetching concept. |
| `PackedScene` | Component | A saved, instantiable template (a `.tscn` file) — author once, `.instantiate()` many times, the same relationship a component definition has to its rendered instances. |
