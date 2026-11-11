# Godot export gotchas

Hand-load before any export, export-preset or web-build work (pointer in `games/CLAUDE.md`). Each passed a green gate until someone read past the exit code; the incidents are in `~/code/docs/harness-evolution/archive/rule-history.md`.

- **Read the savepack manifest, not just the exit code, on every export gate** — `export_filter="all_resources"` packs everything scanned, so an EXIT:0 export can still ship node_modules and GUT editor scenes (which break the export outright). Read the "Storing File:" lines for anything non-game, and route dev tooling through `exclude_filter` (`addons/gut/*, tests/*, node_modules/*, package.json, .gutconfig.json, scenes/dev/*, scripts/dev/*`) — dev-scene dirs count.
- **Drop a `.gdignore` in every build dir under the project root** — Godot re-imports its own export output, scanning a web export back in as project resources. Have the export recipe `touch` it, since build dirs are gitignored.
- **Bundle a whole COLR font to show emoji on a web build** — default fonts carry no emoji glyphs, web export has no system fallback, and subsetters strip color tables (verified dead end). Bundle the full Twemoji Mozilla COLRv0 ttf (~1.5MB) as a FontVariation fallback scoped to the label, the ttf via LFS, with CC-BY attribution.
