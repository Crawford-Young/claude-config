# reviewer — profile

## Strengths
- Spec-compliance + quality review of a bounded diff (seed — routing-table default)
- Byte-compare of verbatim-code tasks — needs no strong model (seed)
- **Given the implementer's own deviation list to adjudicate (not rediscover) → one-pass mechanism-level verdicts** — w3L: 5/5 reviews grade 5, 0 Critical/Major whole wave, 0 false Criticals; adjudications cited runtime mechanisms (Radix sentinel, noValidate contract) not preference. Provisional: one wave (2026-07-16 w3L)
- Pairing "independently rerun X" with the SPECIFIC evidence gap in the dispatch produces exactly the missing proof (w3L L4 coverage rerun; n=1)
- **sonnet combined single review scales to 22-file verbatim batches** — eb3: one pass covered byte-compare + quality + cross-cutting greps (old-copy strings, non-async-export, shim imports) + independent gate rerun; zero findings, zero false alarms. Sonnet-for-byte-compare seed now n=2 (w1 lib + eb3). (2026-07-16 eb3)
- **sonnet combined review for verbatim rollout tasks — FIRM (n=5+ across eb3/eb4):** eb4 added 3 more grade-5 combined reviews (w4a lib, w4b, w4c), incl. sound one-pass adjudication of an implementer deviation (w4c CSS mock: verified postcss string-plugin form, zero prior CSS-importing tests, mock inert for assertions, probe-revert residue-free). Zero false alarms across both waves. (2026-07-16/17 eb4)
- **Adjudication-style briefs (enumerate probes + implementer's flagged decisions) — FIRM, n=10+ (cybond w3, 2026-07-16→21):** ten consecutive grade-5 sonnet reviews, zero false Criticals whole wave; every probe answered with file:line or command evidence; enumerated probes did not crowd out discovery (unprompted findings at A4/A7/A8). Pre-stating the test-accounting basis (total vs green-only) converts forensic reconciliation into cheap verification (A6→A7 confirmed).
- **"Try to construct a bypass" phrasing in security probes → actual attack attempts with per-attempt disposition** — stronger than "verify the check works" (w3 A9-hardening: 3 bypasses constructed and held; A10: 2 genuine spec-edge findings routed to issue log). n=3 (2026-07-17/18)
- **Implementer environment-limitation claims are adjudicable against installed dist source** — "read the .mjs render path" refuted an opus mis-diagnosis evidenced with a DOM dump (w3 A11, 2026-07-19). Standardize the probe for any "test env can't do X" deviation. n=1
- **sonnet combined review widened to small behavioral patches with latitude — FIRM (n=4: w3 A12/A13 + motion-pass T8a lib patch + T6):** all zero-real-finding, mechanism-level adjudications. T8a additionally verified fail-first by running new tests against the PARENT commit (`git show <sha>~1:`) unprompted, and correctly self-diagnosed its scoped-coverage EXIT:1 as a global-threshold artifact instead of reporting a false FAIL. (2026-07-20/21)
- **`git diff -w` disambiguates prettier-reflow from content drift on large verbatim diffs** — motion-pass T7: a 260-line reindented page verified as zero-content-drift in one command instead of a false drift flag. Cheap, decisive; standardize in byte-compare briefs. n=1 (2026-07-21)

## Weaknesses
- Nonzero false-Critical rate — orchestrator verifies every Critical against source before dispatching a fix (2026-06-10; a wrong fix cycle costs a full dispatch + re-review)
- Same trap-blindness as implementer when brief omits AGENTS.md citations (2026-07-14, w2.6 S14)

## Model sweet spot
- Default **opus** — but **sonnet matches opus when the brief is adjudication-style** (enumerated probes + flagged decisions): cybond w3 ran sonnet on ALL 10 app-wave reviews incl. security-load-bearing and integration diffs, ten grade-5s, zero false alarms (2026-07-21). Route sonnet by default when the orchestrator writes enumerated probes; keep opus for reviews where the orchestrator cannot pre-frame the holes.
- **sonnet** for mechanical spec-verbatim byte-compare (seed)
- **fable** for high-stakes design review (auth/payments/migration specs) — per-run user clearance required (seed fable lane)

## Spawn-worthiness
- Earns its cost after every implementer task with latitude; combined single-pass review suffices for verbatim tasks (2026-06-10)

## Open questions
- Fable design-review lane value — no scorecard has yet proven it earns its cost over opus
