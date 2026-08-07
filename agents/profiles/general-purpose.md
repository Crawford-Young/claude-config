# general-purpose — profile

Built-in harness type (no local definition file). Full tool access incl. WebFetch + Write — the only stock lane for tasks needing both (recon lacks WebFetch — P1 issue #1; Explore lacks Write — P1 cold-review C2).

## Strengths
- **Docs-sweep lane: WebFetch fan-out + single-report-file Write — sonnet, n=9 one wave (harness-evolution P1, 2026-08-06):** 9 sonnet sweeps (8–23 pages each), all single-pass PASS, 0 redos, 0 coverage gaps across 194 URLs; briefs as pointer-to-file (shared instructions factored out) held schema across all agents; low-confidence items flagged instead of guessed; verbatim lens-capture (usage-API facts) delivered at ~130–214 lines where present. Provisional until a second wave, but 9-for-9 uniform.
- **Pilot-first de-risks the fan-out cheap** — one bucket dispatched alone proved subagent WebFetch+Write behavior before the 9-way batch (P1 T5 Step 0, 2026-08-06; n=1)
- **opus for judgment-heavy buckets** — best-practices sweep (36 findings) challenged harness premises directly where sonnet buckets extracted; routing call validated (P1, 2026-08-06; n=1 provisional)

## Weaknesses
- **Section-order interleave in long reports — n=2 (tool-use, context-mgmt, P1 2026-08-06):** findings drifted after a mid-report section under length; content intact. Consumers of multi-section subagent reports read FULL files, never a single section by header.
- Finding numbering non-contiguous / non-sequential under length (cc-config: F12/F17/F20 absent) — never key merges on IDs; dedupe on stable content keys (doc-URL + target). n=1 (2026-08-06)
- Idle-notification return (no summary message) is common (4 of 10 P1 sweeps) — treat missing summary as normal when the deliverable is a file; verify the file, not the message.

## Model sweet spot
- **sonnet** for extraction-shaped sweeps/research with a tight brief + fixed report schema (n=9 one wave, provisional)
- **opus** for judgment-heavy analysis buckets (n=1 provisional)
- **Every dispatch names `model:` explicitly** — settings default is fable; an omitted param silently bills fable (P1 issue #3 / gap-report G4)

## Spawn-worthiness
- Earns its cost whenever the task needs a tool combination no scoped type has (WebFetch+Write). Prefer scoped types when they fit — general-purpose's breadth is a fallback, not a default.

## Open questions
- Does the docs-sweep lane hold at a second wave (firm the n=9)?
- P4 candidate `web-recon` profile would obsolete this type for read-only web sweeps (issue #1) — revisit after P4.
