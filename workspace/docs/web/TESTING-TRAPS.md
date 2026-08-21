# Testing Traps — the "unit green, live broken" family

Reference doc (moved from the `live-qa-traps` skill, 2026-08-21). Load before
writing tests or QA for interactive UI. Every entry shipped through 100%
coverage and clean review; only live browser QA (or a live-DB probe) caught it.
happy-dom/jsdom do no hit-testing, no SVG layout, no pointer-capture
retargeting — these classes are structurally invisible to unit suites.

## Structurally unit-invisible classes — plan live QA for these

- **Drag/pointer-capture UIs.** A captured drag's release click retargets to the capture element, so the button's `onClick` never fires after a real drag. One-shot flags reset on the NEXT interaction's pointerdown, not in the click they gate.
- **Fetch-and-cache widgets that unmount on close** (popups, drawers): explicit close→reopen test asserting FRESH data — first-open tests pass a load-once guard serving stale state forever.
- **Presence-selector state variants.** `data-[disabled]:` matches attribute PRESENCE; cmdk renders `data-disabled="false"` on enabled items → every item gets `pointer-events:none`. Write value-scoped variants (`data-[disabled=true]:`); diagnose live via `elementFromPoint`.
- **Programmatic nav under `experimental.viewTransition`** needs `React.startTransition(() => router.push(...))` — a raw push throws and the nav silently drops; `<Link>` works, mocked routers can't see it.
- **Column/driver type fidelity.** Unit tests never round-trip the DB driver — a wrong Postgres column type feeds correct-looking values to a fully-covered predicate. A wave adding a column that feeds arithmetic owes one live-DB probe (`information_schema.columns` + one round-tripped row).
- **Component-scoped axe ≠ page-level zero.** Shared chrome, cross-component ARIA references, and token contrast live outside the subtree. New/reshaped surfaces owe a per-surface jest-axe test (real children, real landmark) AND one browser-axe sweep of the route in both themes.
- **Derived pixel constants** (spacer `calc()`s, scroll math): read back off the rendered element (`getBoundingClientRect`, `scrollHeight`) before calling them correct. Overflowing content doesn't push bottom padding; borders are height the class list doesn't name. happy-dom reports every scroll metric as 0 — bottom-of-container checks are unconditionally true in tests; fix with a scrollable guard in the component.
- **Layout-dependent tiebreaks** (scroll-spy "current section", intersection ordering) are decidable only against real layout — a unit test will confidently encode whichever rule you wrote. Pin entry-order independence too.

## Test-writing rules

- Assert INTENDED wording/behavior written independently — never copy the rendered output into the assertion. When changing a user-facing string, grep ALL test dirs including `e2e/`.
- Component mocks must render the DATA props they receive, not just identity — identity-only dialog mocks have hidden real contract bugs.
- A test that never imports the module it is named for proves nothing and blocks the slot a real test would fill. Review grep: test files naming a module they don't import. Stale coverage excludes naming nonexistent paths are the same class.
- A comment explaining why a stronger assertion is impossible expires when the system changes — a wave that changes the constraint re-reads the comments citing it.
- Theme-dependent e2e seeds BOTH themes explicitly (localStorage via `addInitScript` + class guard) — never rely on the app default for one side.
- Mocking `auth()` null: `vi.mocked(auth).mockResolvedValueOnce(null as never)`.
- Structurally unreachable guards block the 100%-statements gate — restructure as JSX inline guards.
- Live-verify a fix through the exact input modality the user reported (click vs keyboard) — two bugs can stack behind one symptom.
- A QA script handed to the user after a state reset is re-derived FROM the post-reset state — expected outcomes stated in terms of actual field values, not step ordinals.
