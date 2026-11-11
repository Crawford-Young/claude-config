# feat: Sparkbars and InlineStackedBar (strate#54)

## Goal
The library pieces strate#54 (Audit breakdown columns, mockup alternative A) needs: compact per-row cells that show a breakdown inside a table cell.

## Done when
- [ ] `Sparkbars`: one bar per value (for example one per day), heights scaled to the row's own max, a zero value drawn as a muted stub, `--chart-1` fill, token-only colors, fits a table row (about 20px high).
- [ ] `InlineStackedBar`: one thin rounded bar (about 8px) split into segments by share, a color per segment from the `--chart-1..6` tokens (the caller picks the token, so a series keeps its color across rows), and an optional label line under it.
- [ ] Both carry exact values for hover (a tooltip, or `title`) and an accessible summary (role="img" + label listing each value).
- [ ] Stories/docs, tests at the lib's coverage gate, a11y.
- [ ] 0.33.0 changeset, stacked on feat/135. Strate consumes it as a vendored local tgz until npm access is back.

## Out of scope
- Publishing (npm account locked).
- strate's AuditView wiring (strate#54).
