# Component test & story gotchas

Reference for the `new-component` skill (moved from the retired
component-agent def, 2026-08-21). Read at Step 2 (tests) and Step 6 (story).

## Test gotchas

- **V8 branch-tracking gap:** V8 cannot track `??` inside complex spread expressions (`{ ...obj, key: val ?? 'default' }`). When such a branch is structurally unreachable for coverage, `/* c8 ignore next */` on that line is the ONLY acceptable use — never to skip genuinely testable branches.
- **Custom dropdown testing** (popover-like patterns, not native `<select>`):
  1. Assert open/closed via `aria-expanded` — don't search for menu-item text after click; content may not be in the DOM yet.
  2. `startsWith` not `includes` for aria-label selectors (`startsWith('choose')` avoids matching "Go to the Previous Month").
  3. Cover the outside-click close path — it's a separate listener.
  4. react-day-picker v9 `captionLayout="dropdown"` needs `fromYear`/`toYear` or the dropdown renders empty with no error.

  ```tsx
  const dropdownBtn = screen.getAllByRole('button')
    .find((b) => b.getAttribute('aria-label')?.toLowerCase().startsWith('choose'))
  await user.click(dropdownBtn!)
  await waitFor(() => expect(dropdownBtn).toHaveAttribute('aria-expanded', 'true'))
  ```

## Story gotchas

- **Hooks in stories:** extract a named component — anonymous arrows in `render:` trip `react-hooks/rules-of-hooks`.
- **Form controls need labels** in stories (`aria-label` forwards through `...props`) — axe fails a critical `label` violation otherwise.
- **Story colors meet WCAG AA** — `green-600`/`blue-600` with white text at small sizes often fail; prefer `*-700`/`*-800`.
- **Static build is `pnpm build-storybook`** (not `pnpm storybook build`, which starts the dev server). E2E runs against the static build.

## Finishing

- `pnpm prettier --check` clean on every delivered file before reporting done — even verbatim plan code drifts.
- Design tokens only, never hardcoded hex — the emerald ramp in `~/code/docs/brand/brand-identity.md` §Color System.
