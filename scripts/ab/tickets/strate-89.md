# feat(core): context window for claude-haiku-5-5 (#89), and debt(core): a pricing-logic change alone doesn't re-price stored rows (#90)

Two issues, shipped as one ticket.

## Goal

#89: Haiku 5.5 sessions show a context %, like every other priced model.

#90: A change to strate's pricing *logic* re-prices stored `events.cost_usd`, not only a change to the prices.json bytes.

`store/account.rs` refresh re-prices only when meta `prices` ≠ `PRICES_JSON` (account.rs:262). A logic change such as #88's long-prompt tier, shipped without a prices.json change, would leave stored rows at the old $ unless someone remembers to bump `ROLLUP_VERSION`.

## Done when

- [ ] `crates/strate-core/data/context-windows.json` has `claude-haiku-5-5` with its max input tokens, from a cited, verified source
- [ ] A test covers `context_pct` for Haiku 5.5
- [ ] The re-price trigger keys on the prices.json bytes plus a pricing-logic version constant in cost.rs, or the rule is a test that fails when cost.rs pricing changes without a bump
- [ ] A test covers a logic-only change triggering a re-price

## Out of scope

- Pricing (#88)
- Changing prices (#88)
