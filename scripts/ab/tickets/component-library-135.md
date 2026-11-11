# feat: StatTile and TrendChart (strate#51)

## Goal
The library pieces strate#51 (Audit performance view) needs: a KPI tile with a period-over-period delta, and a trend line chart.

## Done when
- [ ] `StatTile`: label, value, optional delta (value + `goodWhen: 'up' | 'down'` → good/bad tone), hint, and an `unavailable` state that shows its reason instead of a value.
- [ ] `TrendChart`: recharts line chart, multi-series, categorical x axis, token-only colors, API in the style of `StackedBarChart`.
- [ ] Stories/docs, tests at the lib's coverage gate, a11y (tile is a `dl` pair; chart has an accessible summary).
- [ ] 0.32.0 changeset; strate consumes it as a vendored local tgz until npm access is back.

## Out of scope
- Publishing (npm account locked).
