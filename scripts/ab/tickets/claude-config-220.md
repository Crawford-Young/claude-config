## Goal
`land.mjs sync` always needs a named path, even when the main checkout is clean and only behind origin/main (a plain fast-forward). Naming a path the merge itself changed is refused with "live edits differ from origin/main". This happened in this batch with `land.mjs sync -- harness-map.json` after #167 (PR #215) changed harness-map.json. Naming an untouched path (`CLAUDE.md`) works but is meaningless. Batch-close reflect (#176 / #190).

## Done when
- [ ] `land.mjs sync` with no path fast-forwards a clean main checkout that is strictly behind origin/main, and still refuses when there are live edits or divergence.
- [ ] Tests cover the clean-behind, dirty and diverged cases.
- [ ] git-ops SKILL.md and directing-a-batch.md drop the "name an untouched path" workaround.

## Out of scope
Changing the live-edit reconcile rules.
