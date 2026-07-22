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

## TDD Scope

Full TDD with a 100% coverage expectation applies to **pure logic**: state machines, damage/score calculation, inventory, save/load serialization — anything expressible as a plain script with no node-tree dependency. Scene and node-tree tests are smoke-level (does it instantiate, does `_ready` run without error) — the scene runtime depends on the engine's frame loop and node lifecycle, which GUT can drive but cannot meaningfully assert against line-by-line. **There is no coverage gate on visual scenes.** State this explicitly in any review or checklist so it is never mistaken for an oversight.

---

## Playtest Gate (mandatory)

Automated coverage, GUT, and a clean headless run do not catch what a human playing the game catches. The `duel` project (2026-06-30) shipped a missing HUD, two copy bugs, and a contrast regression past full automated coverage, axe, and Lighthouse — a two-minute playtest caught all four. Every games task ends with the equivalent: drive the actual running build, not just its tests, before calling it done.

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
