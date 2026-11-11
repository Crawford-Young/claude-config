# Reword history-narrating comments to current behaviour

Comments that narrate history ("no longer", "used to", "retired") instead of stating current behaviour. Found during the wave-3b close-out; they don't name the five retired symbols, so they stayed out of #10.

Files: scripts/game.gd:384, tests/unit/test_scene_smoke.gd:238 and :267, tests/unit/test_lane_sim.gd:341, tests/unit/test_day_flow.gd:289, :334 and :418, plus a "retired" comment in tests/unit/test_lab_smoke.gd.

## Done when
- [ ] Each one states current behaviour or is deleted
- [ ] `just test` green
