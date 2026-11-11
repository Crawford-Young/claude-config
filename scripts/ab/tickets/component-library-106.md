# bug(week-calendar-view): the create popover offers "New activity…" when nothing can handle it

## What happens

In `WeekCalendarView`'s create-event popover, the activity picker (`EventCreateForm`) shows a "New activity…" entry whenever `createActivityOptions` is passed, even when the consumer gave no `onCreateActivityRequest` handler. Choosing the entry then does nothing: there is nowhere for the request to go.

## Expected

"New activity…" appears only when choosing it can reach an `onCreateActivityRequest` handler, through `EventCreateForm` used alone or through `WeekCalendarView`.

## Done when

- [ ] Vitest — 100% coverage, full suite green
- [ ] TypeScript — `tsc --noEmit` clean
- [ ] ESLint + Prettier — clean
- [ ] Storybook — builds; a story shows the picker without the entry
- [ ] axe — zero violations
- [ ] CI — verify green on this PR before requesting merge
