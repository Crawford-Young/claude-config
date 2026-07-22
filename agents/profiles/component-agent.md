# component-agent — profile

## Strengths
- One Radix+CVA component end-to-end (impl, 100% tests, story, barrel) in `~/code/web/component-library` (seed — wave history since w2)
- Carries deep domain traps in its definition (dropdown testing, story hooks, WCAG in stories) — brief doesn't need to restate them (seed)
- Verbatim-plan briefs execute byte-for-byte: grade 5, 18 tool uses ~151s, scope clean, 6/6 tests + tsc + axe first attempt (2026-07-15 error-boundaries w16, n=1 provisional)
- Warm redo (SendMessage, same agent) cheap + reliable: 10-line restructure in ~40s vs 151s cold, self-verified gates (2026-07-15 w16, n=1 provisional)

## Weaknesses
- Stories + e2e entries commonly dropped when context/rate limits hit mid-run — wave-release-agent verifies (seed — definition note; did NOT fire 2026-07-15 w16 — counter-evidence n=1)
- Delivered files not prettier-clean when plan code wasn't — agent doesn't self-check formatting; fixed via DoD line in definition (2026-07-15 w16, n=1)

## Model sweet spot
- Default **sonnet**; no recorded need for opus within its niche

## Spawn-worthiness
- High within its exact niche (one new library component); never outside it — no feature work, no multi-component batches (seed)

## Open questions
- (none yet)
