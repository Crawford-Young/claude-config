# component-agent — profile

## Strengths
- One Radix+CVA component end-to-end (impl, 100% tests, story, barrel) in `~/code/web/component-library` (seed — wave history since w2)
- Carries deep domain traps in its definition (dropdown testing, story hooks, WCAG in stories) — brief doesn't need to restate them (seed)
- Verbatim-plan briefs execute byte-for-byte: **FIRM n=3** — w16 error-boundaries (grade 5, 18 tools ~151s) + slot-W2 L3 FormDialog (grade 5, 39 tools ~464s: self-ran full gates unpiped with EXIT lines, verified story ids against built index.json unprompted) + L2 ColorSwatchPicker (grade 4, impl byte-matched before infra death) (2026-07-15 + 2026-07-22)
- Warm redo (SendMessage, same agent) cheap + reliable: 10-line restructure in ~40s vs 151s cold, self-verified gates (2026-07-15 w16, n=1 provisional)
- **File-first work ordering makes infra-death recovery cheap** — L2 session-limit death mid-commit left a complete artifact set on disk; orchestrator verified + gated + committed inline with zero rework (2026-07-22 slot-W2, n=1)

## Weaknesses
- Stories + e2e entries commonly dropped when context/rate limits hit mid-run — wave-release-agent verifies (seed — definition note; did NOT fire 2026-07-15 w16 — counter-evidence n=1)
- Delivered files not prettier-clean when plan code wasn't — agent doesn't self-check formatting; fixed via DoD line in definition (2026-07-15 w16, n=1)

## Model sweet spot
- Default **sonnet**; no recorded need for opus within its niche

## Spawn-worthiness
- High within its exact niche (one new library component); never outside it — no feature work, no multi-component batches (seed)

## Open questions
- (none yet)
