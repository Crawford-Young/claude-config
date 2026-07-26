# CLAUDE.md — Universal Development Standards

This file governs **every project in this workspace**, across all domains. It carries the rules that do not depend on language or stack: workflow order, planning discipline, git and branch strategy, commit policy, context hygiene, orchestration, and security baselines.

**Stack-specific rules live in the domain file.** Claude Code loads every `CLAUDE.md` from your working directory upward, root first, so a session in `~/code/web/scheduling-advisor` gets this file, then `web/CLAUDE.md`, then the repo's own — each overriding the last on conflict.

## Domains

| Folder | Domain | Stack | Rules |
|---|---|---|---|
| `~/code/web/` | Web | Next.js (App Router), TypeScript, Tailwind, Radix+CVA, Vitest, Playwright, Vercel | [`web/CLAUDE.md`](./web/CLAUDE.md) |
| `~/code/games/` | Games | Godot 4, GDScript, GUT | [`games/CLAUDE.md`](./games/CLAUDE.md) |
| `~/code/apps/` | Apps | Expo (React Native) mobile, Tauri v2 desktop, TypeScript, Jest+RNTL, Maestro | [`apps/CLAUDE.md`](./apps/CLAUDE.md) |

Workspace infrastructure stays at the root: `claude-config/` (this file's source + agents + skills), `docs/` (private planning-docs repo), `.claude/`, `.agents/`.

> **Predefined subagents** — `claude-config/agents/` (junctioned to `~/.claude/agents/`): dispatch via `subagent_type` — `recon`, `implementer`, `reviewer`, `manager`, `docs-agent` are domain-neutral and inherit rules from their working directory's CLAUDE.md chain; `component-agent`, `new-repo-agent`, `wave-release-agent` are web-only. Tool access + model defaults enforced by frontmatter; routing authority = `claude-config/agents/profiles/`.
> **Orchestration** (agent factory: spawn protocol, profiles, performance MDs) → invoke the `agent-factory` skill when orchestrating — canonical home is `claude-config/skills/agent-factory/SKILL.md`. Skills and agents live at user level (`~/.claude/`), so they load in every domain.
> [`docs/SKILLS.md`](./docs/SKILLS.md) — canonical situation→skill routing, trigger discipline, cost notes (load when unsure which skill applies).

> **Canonical location:** this file, the domain files, and the workspace reference docs live in the `claude-config` repo under `workspace/` and are symlinked/junctioned into `~/code`. Edit through either path — same file. Commit changes in `claude-config`.

---

## Project Planning Docs

Specs and checklists live in `~/code/docs/<domain>/<project-name>/`. Workspace-level reference docs live in `~/code/docs/` root. Ambiguous or historical docs go to `~/code/docs/archive/`.

`~/code/docs` is its own **local-private git repo** (no remote — initialized 2026-06-11). Commit planning docs there at wave boundaries: spec approval, checklist completion, reflect close. Junctioned workspace files (`brand/`, root reference MDs) are gitignored — their history lives in `claude-config`. **Commit with explicit paths, never `git add -A`** — the repo is shared by concurrent sessions; `-A` sweeps another session's in-flight checklists/issues into your commit (2026-07-01: 2a spike commit swept w2.2L + cybond-w2.2 files).

**claude-config is config + reference docs only.** Never write project working artifacts (specs, checklists, issues, screenshots, continuation handoffs, assets) into junctioned dirs — they land in the claude-config repo. Brand/design-system project work uses `docs/brand-design/` as its project dir; junctioned `docs/brand/` holds only the living reference MDs + README.

**Structure per project:**
```
~/code/docs/<domain>/<project-name>/
  specs/          # brainstorming output: <date>-<topic>-design.md
  checklists/
    active/       # current phase checklist (one at a time)
    done/         # completed phase checklists
  issues/
    <date>-<wave>-issues.md   # open issue log (created at wave start)
    done/                     # closed after reflect
  screenshots/
    <issue-or-checklist-slug>/   # scoped to one issue/checklist/wave
      <timestamp>-<description>.png
  continuation/
    <YYYY-MM-DD-HH-MM>-handoff.md   # written by `continuation` skill before /clear; delete after resumed
```

`<domain>` is `web`, `games`, or `apps`, mirroring `~/code`. Meta/workspace projects (agent-factory, superpowers, claude-config, brand-design, workspace-restructure) live at `docs/` root with no domain folder.

**Screenshots convention:**
- Always save to `docs/<domain>/<project>/screenshots/<slug>/` — never to the project root or a generic folder
- `<slug>` matches the active issue log name or checklist name (e.g. `2026-06-01-splash-debug`, `cyrein-core-wave1`)
- Name each file `<timestamp>-<description>.png` (e.g. `14-40-02-home-broken.png`)
- Pass the full path as the `filename` parameter when using the Playwright MCP screenshot tool
- Each debugging session / issue gets its own subfolder so screenshots from parallel processes never collide

**Order for any new feature or project:**
1. `superpowers:brainstorming` → at a genuine approach fork, `persona-debate` skill debates the options before approaches are presented → write spec to `docs/<domain>/<project>/specs/<date>-<topic>-design.md` → user approves
2. `superpowers:writing-plans` → write checklist to `docs/<domain>/<project>/checklists/active/<project>-<phase>.md` → `agent-factory` skill: `**Factory:**` header line, spawn decisions at execution time → user approves
3. Create issue log at `docs/<domain>/<project>/issues/<date>-<wave>-issues.md` (orchestrator only — never subagents)
4. Write code — execute fully without approval on each change once plan is approved
5. Pause only when: checklist complete, blocked, or plan revision required

**Issue log** (`docs/<domain>/<project>/issues/<date>-<wave>-issues.md`) is a living log of wrong assumptions, missing behaviors, and bugs discovered during the wave. Orchestrator logs entries proactively at four triggers: (1) user corrects built behavior, (2) same feature needs >1 correction, (3) missing behavior found mid-build, (4) design rethink from test failure. User can also request logging anytime. Reviewed together at reflect, then moved to `done/`. Full spec → `docs/superpowers/specs/2026-05-31-issue-log-workflow-design.md`.

**Checklist** (`docs/<domain>/<project>/checklists/active/<project>-<phase>.md`) is the session resume file and live progress tracker. Scan `docs/<domain>/<project>/checklists/active/` at session start — it is the source of truth across sessions and compaction. On phase complete, move to `docs/<domain>/<project>/checklists/done/`. Full orchestration rules → `agent-factory` skill.

---

## Workflow

### 1. Planning Phase

Always write and commit the spec before producing an implementation plan. No exceptions.

`superpowers:brainstorming` applies to **feature evolution on existing components**, not just new builds. If a request adds non-trivial behavior to an existing component (new interaction model, new data flow, new state machine branch), treat it as a new feature — brainstorm first.

**Uncertainty rule:** Before starting any multi-step feature, Claude must surface its top assumptions explicitly and confirm them with the user before writing code. Wrong assumptions presented as correct are the primary cause of wasted iteration cycles.

**Plan path verification:** Every file path listed in a plan must be verified to exist (Glob) at plan-writing time — stale grep results are not evidence.

**Parallel-cluster annotation:** writing-plans marks genuinely independent task clusters explicitly (`**Parallel-safe with:** T4, T5` — no shared files, no Consumes/Produces edge between them); agent-factory may worktree-parallelize ONLY annotated clusters. No annotation → serial default. Windows worktree overhead (removal fights, per-worktree install, gate CPU contention) makes speculative parallelism a net loss — gates dominate wall-clock, not agent count. (2026-07-16 w3L: strict dependency chain, parallelism worth zero.)

**Plan-embedded verbatim code must be prettier-clean AND TS-style-clean** against the target repo's config at plan-authoring time (check `.prettierrc` — quotes, semis, trailing commas — and the four TS-style rules, explicit return types on exported functions especially). A byte-for-byte implementer faithfully reproduces the drift; it surfaces only at the full gate run or review. (2026-07-15 w16: plan-authored test + story + README table cost a full gate rerun. 2026-07-21 motion-pass T6: plan block's missing return type shipped byte-faithful, flagged as review Minor.) **Tailwind-class-sorted too** when the repo runs prettier-plugin-tailwindcss, and asset-copy instructions ("byte-identical copy of X") state the FORMAT AUTHORITY — which side gets prettier-formatted — or identity and the gate conflict (2026-07-24 carsickyak W1: both facets in one wave; resolution = format the docs source, recopy). **Plan-cited utility classes are premises about the repo's token config** — grep tailwind.config at plan time; an undefined utility emits NO CSS and every gate passes silently (2026-07-24 carsickyak T10: `bg-charcoal/60` scrim on an undefined token — invisible scrim, coverage/tsc/axe all green).

**Port/generalization waves inherit the source's bugs:** byte-faithful porting preserves the source's defects — parity review + 100% coverage structurally cannot catch them. The wave's QA step must drive the FEATURE's semantics live (all-day = which day? what persists?) plus the repo's documented trap list (close→reopen, create-after-create), not just port parity. And shell-extraction plans must diff ALL form/container attributes across EVERY source being generalized, never just the primary reference. (2026-07-22/23 slot-W2: user-caught all-day null-instant bug was the DELETED source dialog's own bug shipped through green gates; `noValidate` was a one-attr diff between the two sources — cost a mid-wave patch release. Issues #4/#6.)

**Deferred-gate plans give intermediates a scoped probe:** a plan that defers a repo-wide gate (tsc especially) across tasks masks NEW-file errors until the gate task — intermediate tasks producing new files need a scoped typecheck substitute, or the gate task's brief must explicitly own new-file errors, not just rewire errors. (2026-07-23 slot-W2: A2/A3 shipped 12 strict-null errors invisible to vitest, surfaced at A4; issue #5.)

**Plan premise verification:** Any plan step that says "follow the existing pattern in X" must cite a verified `file:line` confirmed at plan-writing time. **An "import X from Y works" premise is verified per CONSUMER TOOLCHAIN, not per package** — bundler/runtime aliasing, tsc types, and test-runner resolution are three separate facts that can disagree. (2026-07-21 motion-pass T7: plan asserted `import { ViewTransition } from 'react'`; true under Next's vendored-canary alias, false under tsc (stable @types) and vitest (real node_modules/react) — implementer NEEDS_CONTEXT'd with zero edits; resolution = canary-types d.ts + per-test partial react mock.) Unverifiable premises are written as assumptions to confirm, never as facts. (2026-06-10: a plan asserted e2e session mocking existed — it didn't; cost a full task to deferral.) **An e2e plan step must verify the SUITE CAN OBSERVE the target surface at plan time** — auth model, server-side redirects, mocking capability. n=2: the 2026-06-10 case above; 2026-07-24 event-series A10 — unauth suite asserted to render authed surfaces, but the server-side auth redirect makes them structurally unobservable; step dead on arrival (issue #6). A premise about a library component's runtime behavior must trace the FULL wiring chain (view → leaf), not just leaf-level gates — a leaf gate plus unconditional parent wiring inverts the conclusion. This binds dispatch briefs too, and "prop threads through" claims specifically: trace the intermediate wrapper, not prop existence at both ends. **And it binds SPEC/BRAINSTORM-time claims** — a brainstorm-quick dist read verifies the paths it looks at, not the component; full-surface recon before spec claims, not just before plans. (2026-07-15 user-profiles: chip-level lock gates verified, view-level unconditional handler wiring missed → "fully inert read-only chips" premise shipped false; caught only at Task 9 doc verification. n=2 2026-07-20 w3 A12: orchestrator brief premise from a leaf-only dist read — view constructed an always-defined wrapper, leaf gate alone inert; implementer TDD'd its way to the wiring bug. n=3 2026-07-24 visibility-w1: spec's "zero-handler WeekCalendarView = read-only for free, no lib wave" premise false — chip wiring unconditional; plan recon caught it, wave shape changed to lib-patch-first.)

**Measured numbers entering a diagnosis brief are premises — verify each two independent ways before writing it as fact.** A single-method measurement can be systematically wrong (sampling stride aliasing with a buffering window; a feel-bar calibrated against the wrong reference), and a faithful diagnostician downstream builds on the bad number. n=2 in one wave (2026-07-24 momentum-lab: R12 turn-rate bar miscalibrated vs CS-at-equal-speed; R13 stride-2 telemetry samples phase-locked onto a 2-tick drain window → reported −57°/s where position-delta truth was −118.8°/s — convicted a phantom engine bug, cost a full diagnosis round). Rate/derivative measurements specifically: compute from POSITION deltas over the span, never from stride-sampled per-tick deltas when the stride shares a factor with any pipeline buffering window.

**Live-state enumeration is a plan premise too:** a plan that enumerates live working-tree state (worktree registrations, dirty files, loose root artifacts, branch positions) re-verifies that enumeration at execution start — design-time recon is an assumption, not fact; concurrent sessions invalidate it. Prefer fail-fast steps (explicit-path commands that error loudly on a missing path) over silent re-capture. (2026-07-21 restructure w1: plan enumerated 5 worktree registrations at design time; a concurrent PR merge left 1 by execution — the fail-fast `git status` on an enumerated path caught it.)

**Product-copy recon:** A wave whose deliverable is marketing/descriptive copy about OTHER products (portfolio cards, pitches, comparison pages) must include a plan-time recon step reading each product's actual repo/README — the describing site's own data files are not a source of truth about the products they describe, and personal-facts claims (roles, achievements, history) get an explicit user fact-pass at spec or QA time. (2026-07-18 marketing-reposition: n=2 in one wave — tuner flagship shipped wrong stack + missed its most distinctive feature until user correction; Cybond pitch omitted the product's competitive differentiator. Plus 4 user-caught factual errors in personal hobby copy that a voice-only rewrite never fact-checked.)

**Voice/persona copy work starts from raw user-authored material** (journals, poems, real messages, VOD transcripts) — Q&A produces answers, not voice, and ~10 accepted copy samples are insufficient persona signal on their own. Request raw material at spec time, before drafting. (2026-07-23 carsickyak voice wave: acceptance failed 2 misreads in one round on corpus+Q&A alone; user-volunteered raw material → persona doc → clean first-presentation pass. n=1, provisional.)

**New-page-surface enumeration:** A plan adding a user-facing page must enumerate its entry points (sidebar/nav item, links from sibling surfaces) and its parity affordances vs the nearest existing surface (toggles, filters, controls) at plan time. (2026-07-15 user-profiles QA: sidebar link, sanitize-as-typed input, and sleep toggle were all user-caught gaps of this one kind — 3 QA fix rounds.) A search/aggregation feature's content-group enumeration is validated against the app's nav surface list at spec time — every user-content nav item is a candidate group. (2026-07-22 gs-p1: Reflections nav surface missing from the search groups; user-caught at QA, added as a 4th group mid-QA.) **A feature added to a shared multi-mode component (create/edit dialog, view/edit panel) enumerates every mode × call-site combination at plan time** — a section built for one mode renders in ALL modes unless gated, and no single task owns the others. (2026-07-24 event-series #7: Repeat section ported for create flows rendered ungated in edit mode; edit path discarded `values.recurrence` — dead control shipped through A5 review, caught only by the A10 docs-agent reading shipped code. n=1, provisional.)

**Contract-surface enumeration:** A plan task that adds or changes a field in a shared payload, form-values type, or server-action contract must list EVERY component that emits that payload — found by grepping the action/dialog name at plan-writing time, not recalled from memory. (Wave 2.3 hit this 3×: S8 dialog callers omitted, S10 relabel gap unowned, S6 create button in no task's file list — it silently dropped 5 fields and shipped.) CustomEvent flows are contract surfaces too: a plan or QA step naming an event emitter/listener must grep the actual dispatchers at plan time — a checklist and README both carried an "Ask Cybond" emitter that never existed in code (2026-07-15, chat-popup wave). **Teardown/rewrite plans grep EVERY deleted or changed symbol's importers at plan time** — including root layout, `src/trigger/` jobs, and chip/popover components (popover-action features render in the chip component, not the view) — and a "fix X" scope includes X's entry-point CALLER, not just the definition module; dropped DB columns are contract surfaces too (a feature reading a dropped column is a consumer). (w3 2026-07-16→20: SIX misses in one wave — activity-card-actions, quick-schedule-input, action-confirm-card, profile.ts+reflection-card+layout.tsx at teardown, generation.ts entry point, chip component for the Duplicate action; two were in orchestrator dispatch briefs, not plans.) Teardown grep-sweep briefs state explicitly that TEST FIXTURES count as hits — "zero live hits" reads as production-code-only to a faithful implementer; stale row-shape fixture keys survived an otherwise-clean A9 sweep (2026-07-24 event-series, reviewer-caught). **`$inferSelect`-typed test fixtures are consumers of a schema column** — a schema-column task's scope includes every fixture file typed off the table's `$inferSelect`-derived types; grep those consumers at plan time or the column add NEEDS_CONTEXTs at the fixture boundary. (2026-07-24 visibility-w1 V2: 5 tsc errors in generation.test.ts fixtures outside the task's file scope; n=1, provisional.)

**Invariant-consumer enumeration:** A plan task that CHANGES a cross-cutting invariant (time semantics, data shape, ordering) must list every consumer of that invariant — including observability/validation nets (drift checks, assertions), which are read-path consumers too. Per-task reviews structurally cannot see a task invalidating an earlier task's net. (w2.6: S12 made generation TZ-aware; S8's drift net still compared UTC time-of-day → DST false positives, caught only at final whole-branch review.) **Changing what a predicate MEANS counts as changing the invariant** — n=2 (2026-07-24 event-series #4): standalone series made `activityId IS NULL` no longer mean "one-off"; the query consuming that predicate (`getStandaloneEvents`) was never enumerated, occurrences double-rendered through 100%-green gates. Mitigation that worked: a reviewer probe that NAMES the invariant ("activityId IS NULL = one-off") gets its consumers traced — the A6 reviewer chased the INSERT path cross-module and caught it.

**Invariant adoption audit:** When an invariant is adopted into a repo's AGENTS.md (e.g. "times are local wall-clock"), audit ALL code paths against it at adoption — write/generation paths, not just the read paths whose bugs prompted it. (w2.6 QA-R2: local-wall-clock invariant fixed read paths in 0.19.0; UTC-day series generation stayed latent until an evening-created series shifted a whole day.)

**Value-judgment UX semantics get a user pick at spec time:** any behavior encoding a product-feel judgment (streak projections, motivational displays, optimistic vs confirmed states, gesture-release motion — how a drag/snap/dismiss FEELS, not just where it lands) is presented as an explicit spec question, never buried as a plan walk-rule. Built-and-reviewed-green is worthless if the user rejects the semantics on first sight. (w2.6: S2 future-chip flame projection rejected wholesale at QA R2, rebuilt as S13. n=2 2026-07-22 slot-w1 T13: spec fixed the snap TARGET corner, never the release feel — instant jump rejected at QA, rebuilt as animated glide. n=3 2026-07-22 gs-p1: "command palette" framing buried the modal-vs-inline-dropdown PRESENTATION choice — modal rejected on first sight, whole shell rebuilt in QA-R1; a feature's presentation pattern is this class too.) Fallback-surface AFFORDANCES are this class too: an error/empty/loading state's action set (retry only? home link? support contact?) is a spec question — enumerate it when the spec introduces the fallback, per boundary level (a root/global boundary strands the user; a segment boundary keeps nav). (2026-07-16 eb3: home-link gap user-caught at ship gate; whole rollout shipped retry-only.) **Theme DEFAULT (which theme greets a first visit) is this class too** — a multi-round palette gate on rendered candidates never asks it, and per-surface entry affordances (is the preview card itself clickable?) ride along; copy accepted on a corpus/acceptance page gets re-judged in live page context at QA. (2026-07-24 carsickyak W1 QA-R1: spec'd light-first reversed + accepted motto pulled + teaser cards made clickable, all in the user's first hands-on minute; n=1 provisional.)

**Live-dev migration sequencing:** When a wave adds or renames DB columns that a running dev server reads, the migration applies in the SAME task that lands the schema change — otherwise every authenticated page 500s from that task until the migration task runs. (Wave 2.3: schema landed at S3, migration was planned at S6; user hit `column does not exist` browsing dev.)

**Gated-consume API assumptions:** When a plan consumes a dependency version that does not exist yet at plan-writing time (publish-gated waves), every API name taken from the spec or memory is written in the checklist as an ASSUMPTION and verified against the installed dist at the first dispatch after the dependency publishes — never treated as fact. (cybond w2.4: checklist + brief carried `onToggleLock` for the view-level prop; 0.19.0 shipped `onEventToggleLock`; cost a warm redo, 2026-07-08.) **A bump crossing intermediate releases must also diff the installed-vs-target export surface** (`dist/index.d.ts` export list, old vs new) at the bump step — the bump consumes EVERY intermediate release's breaking changes, not just the wave's own additions; verifying only the wave's new API names passes while removed/renamed exports break tsc app-wide. File-overlap checks against concurrent branches don't catch this — the coupling is the library surface, not files. (2026-07-17 eb4 w4d: 0.22→0.24 bump verified `homeHref` present, missed 0.23.0's `Activity*`→`Event*` rename; cost a full implementer dispatch to discover, wave sub-task deferred.)

### 2. Visual / Token Work — Preview Gate

**An animation whose correctness IS its time-ordering (staggered reveals, sequenced transitions) needs multi-frame capture (screenshots at 2–3 timestamps mid-animation) or live eyes at verify time** — single end-state screenshots structurally cannot catch sequencing bugs. (2026-07-18 marketing-reposition: SplitText per-char delay was non-monotonic across words — words revealed scrambled; the bug survived descender-fix verification and both theme captures because every static shot looked correct. Frame captures at 350/600/900ms verified the fix.)

If Playwright MCP is unavailable or wedged (calls timing out): verify generated SVGs/images textually instead — grep output for `NaN|Infinity|undefined`, inspect the header (width/height/viewBox) and key coordinates — and note the deviation rather than fighting the browser. (2026-06-10: MCP wedged mid-session; textual verification caught everything the eyeball pass would have.)

**Brand/visual asset waves: plans lock pipeline, sizes, palette — never *look*.** Aesthetic decisions (mark form, composition language, copy placement) are per-asset user gates with rendered references; plan-locked composition prose was rejected on sight 3× in one wave — badge composition, flat-vector banner, mark-as-pfp all reversed at gate (2026-07-22 carsickyak P0). **Per-surface art DIRECTION anchors on the user's shipped, liked assets on adjacent surfaces** (emotes, mark, web) — never on spec adjectives ("majestic-illustrated") or whatever a recon test render looked like; two consecutive direction rejections = stop generating, re-anchor on shipped assets before the next gen. (2026-07-23 carsickyak gemini wave: n=2 in one wave — landscape round anchored on the recon test image, painted round on a stale spec adjective; both rejected, user wanted the emote-chibi language.)

**Organic/illustrative shapes: never hand-author SVG paths blind.** Trace a user-approved raster (potrace) from the start; carry `fill-rule` (or split subpaths explicitly) when re-emitting traced paths. (2026-07-22 carsickyak P0: 3 failed hand-author rounds — sheep/mammoth/rodent reads — before trace pivot; a regex re-emit dropped `fill-rule="evenodd"` and silently filled the negative-space crescent.) **This rule has NO "simple geometric" exception, and it extends to CSS-composed art on hero/moment surfaces** (alerts, emotes, badges, points icons — anything the audience reads as a hype/identity moment rather than UI chrome): composing existing flat marks with CSS primitives hits the same aesthetic ceiling; go raster-gen from the start. (2026-07-22 carsickyak P3: n=3 in one wave — plan carved a "geometric grass blades" exception, rejected on sight; CSS-composed alert motion rejected at two consecutive gates before the raster pivot.)

**AI-image generation routes are quota-gated external dependencies** — provider limits can stall mid-wave for ~18h with no local workaround. Plans with generation-dependent tasks sequence them EARLY and keep non-generation tasks (existing-asset composition, docs, pipeline work) as fill for the stall window. (2026-07-22 carsickyak P3: ChatGPT image quota hit mid-T3; wave re-sequenced around it, T4–T6 ran on existing assets. n=1, provisional.) **Model choice for brand raster gen: ChatGPT primary, Gemini (Nano Banana 2) fallback for quota stalls** — Gemini's pipeline is solid (fast gens, square via prompt wording, img2img via clipboard paste) but lost 4 rounds head-to-head at user gates, including img2img asked to match shipped ChatGPT emotes. (2026-07-23 carsickyak gemini wave, user verdict "google loses pretty bad". n=1, provisional.)

**Transparent-bg PNG export: Playwright CLI `screenshot` cannot** — use a node script with `page.screenshot({ omitBackground: true })`; for scratchpad scripts, resolve playwright via `createRequire('<repo-with-playwright>/package.json')`. (2026-07-22 carsickyak watermark set.)

**AI-raster pipelines assume the input is ONE baked-background contact sheet, not per-asset transparent files** — image models deliver checkerboard "transparency" as opaque pixels and batch multiple assets per image; plan the split/strip step (border flood-fill, row/column profile split) from the start, and set column-merge thresholds BELOW the real inter-asset gap (measure it — a 28px accent-merge threshold glued two emotes across a 6px gap). (2026-07-22 carsickyak P2 emotes; checkerboard-baked precedent also P0.) **Gen-side, sheet batching is mandatory on quota-priced models:** N same-style assets = ONE labeled/gapped 2×2 contact sheet per gen, never one gen per asset — "one subject per cell" constrains a CELL's content, not the sheet. (n=2: P2 emote set shipped from one sheet; 2026-07-23 gemini wave ran 17 single gens before the user caught it.)

**Packaging/CTR surfaces (thumbnails, titles, social hooks) optimize for click-through, not brand consistency** — face/stakes/curiosity beats brand-minimalism, and brand-lens reasoning actively harms them. Get the user's packaging direction BEFORE rendering; the user is the authority on what lands with their audience. (2026-07-22 carsickyak P1: two brand-lens thumbnails rejected — "won't land", "powerpoint opening"; user's own face+stakes composite won. n=1.)

**Assets with an update cycle (data-driven graphics) commit their generator + data into the asset repo** — scratchpad generators die with the session; the update cycle is edit data → run generator → re-render. (2026-07-22 carsickyak P1: `ranks.json` + `generate-yak2peak.mjs` persisted beside outputs.)

**Theme/palette waves ask "where does color live" (interactive elements vs surfaces vs grounds) as an explicit gate question with rendered candidates** — a brand palette table alone underdetermines a UI theme; applying it literally to surface tokens invites wholesale rejection. Ambiguous feel-words in gate feedback ("cold") get one clarifying read-back before generating the next round. (2026-07-24 cy-theme W0: 4 gate rounds — palette-literal charcoal/offwhite rejected, "cold"-as-tint misread cost round 2, colored card backgrounds rejected round 3; landed = neutral grounds + color in buttons only. n=1, provisional.)

**CSS-var-override preview capture waits ~400ms after style injection** — `transition-colors` elements screenshot their STALE pre-injection colors otherwise; a contact sheet can lie about every button. Probe computed styles when a rendered color contradicts the injected vars. (2026-07-24 cy-theme W0, mechanism-verified.)

### 3. Branch Strategy

- New branch per feature/fix — never commit to `main`
- Names mirror Conventional Commits: `feat/`, `fix/`, `chore/`, `refactor/`
- **Cut every branch from `origin/main`, and verify: `git log origin/main..HEAD` must be empty at branch creation.** A branch cut from another branch's tip silently drags foreign commits into the PR range — re-check the range before requesting merge. (2026-07-01: precision-foundation was cut from a fix branch's tip; stray commit found only at PR-prep, fixed with `git rebase --onto origin/main <stray>`.)
- Use `superpowers:using-git-worktrees` for isolated parallel work
- **New worktree setup copies `.env.local` AND `.env` from the main checkout** (gitignored, never staged) before the first dev/test run — real secrets typically live in `.env.local`; copying only `.env` ships stale values and the env-validation crash surfaces at the worst time (QA dev-server spin-up). Port collision is also expected: a concurrent session's dev server usually holds `:3000`, and running the worktree on `:3001` is fine for cookie-based QA (localhost cookies are port-agnostic) — only fresh OAuth sign-in needs the registered `:3000`. (2026-07-14, activities-grouping wave.) Check the port holder (`netstat`) BEFORE launching any gate suite that includes e2e — `reuseExistingServer: !process.env.CI` silently runs e2e against the OTHER session's dev server/branch; apply the temp `:3001` playwright edit first, revert pre-commit. (2026-07-16 eb3: gate launched before check → TaskStop + relaunch.)
- **Windows worktree removal:** `git worktree remove` reliably fails on a worktree with `node_modules` (file locks, then >260-char long paths in react-server-dom). Working sequence: `git worktree remove --force` → `Remove-Item -Recurse -Force` from a shell whose cwd is OUTSIDE the worktree → robocopy `/MIR` empty-dir mirror for long-path remnants → `git worktree prune`. (2026-07-16: hit 2× in one day, w16 + eb2 worktrees.)
- **Two concurrent sessions on one repo MUST use separate worktrees.** A shared checkout is one working tree: a second session switching branches corrupts the first session's in-flight gate. This includes `claude-config` and the docs repo — a session touching junctioned workspace files commits into whatever branch claude-config's working tree is on. (2026-06-12: working tree flipped to `feat/wave-9-token-components` mid-e2e-gate → motion stories absent, false timeouts, a blocked task. 2026-07-01: concurrent session committed `motion.md` onto another wave's open `feat/native-subagents` branch.)
- **claude-config working tree on a foreign branch → defer junctioned-file commits.** Edit on disk (junction edits persist), log the deferral in the active checklist + a memory entry, revisit at wave close; commit with explicit paths only once the tree is back on main. Never commit onto another session's open branch. (2026-07-02: wave-15 brand-MD + reflect edits deferred past `docs/agent-validation`.)
- **Rebase-only workflow — linear history is required:**
  - Sync with main: `git fetch origin && git rebase origin/main` — never `git merge main`
  - Pull remote changes to same branch: `git pull --rebase` — never `git pull`
  - Set as default: `git config --global pull.rebase true`
  - Merge commits in a branch break GitHub's "Rebase and merge" PR strategy
  - **PR merge method: "Rebase and merge" ONLY — never squash-merge** (user directive 2026-07-21, after motion-pass PR #35 was squashed following the then-established squash practice). Branch commits land individually on main, staying true ancestors — so plain `git rebase origin/main` works for every follow-on branch. `gh pr merge <n> --rebase --delete-branch`.
  - **A branch built on a SQUASH-merged base, when main has diverged, must be SQUASH-integrated onto fresh main — not `rebase --onto`.** (HISTORICAL-BASE CASE ONLY as of 2026-07-21 — PRs merged before then were squashed, so branches based on that history still need this; rebase-merged PRs keep their commits as true ancestors and plain rebase works.) When the base was squash-merged, the previous wave's individual commits are NOT ancestors of main (only the squashed commit is), so `git rebase --onto origin/main <old-base>` replays the already-merged work and conflicts on every touched file. Instead: `git checkout -B <branch> origin/main`, bring the new wave's files (`git diff --name-only <wave-base> <wave-head> | grep -vxF <files-main-also-changed> | xargs git checkout <wave-head> --`), 3-way-merge (`git merge-file`) only the handful of files main independently changed (docs, schema), REGENERATE any colliding migration via `drizzle-kit generate` (never hand-edit the snapshot JSON), `pnpm install`, full gate, one integration commit. History loss is fine — the PR squash-merges anyway. (2026-07-17 chat wave B: 30 commits on a squash-merged base; main +4 PRs incl. a ui major bump + a migration-number collision; `rebase --onto` conflicted on commit 1/30, squash-integration was clean.)

### 4. Commit & Push Policy

- **Do not commit or push without explicit user approval**
- **User QA gate before PR (UI-facing waves):** when the wave's final task completes, spin up local dev fresh (`:3000` for apps with OAuth callbacks; wipe `.next`/build caches first if dependencies changed mid-wave — turbopack's persistent cache serves stale Tailwind CSS otherwise, 2026-07-08) and prompt the user to QA the feature hands-on BEFORE requesting push/PR approval. Proceed to the push request only after the user finishes QA or explicitly waives it (a blanket "go for it" on push counts as a waive for that wave, not permanently).
- Stage changes, present a clear summary, wait for approval
- **Before presenting any commit batch, re-read the task's unticked steps.** A step neither ticked nor represented in the staged diff is a stop signal — resolve it (do it, or mark deferred with reason) before the batch goes to the user. Reflect-timing rules don't catch this class; the omission happens at batch assembly. (2026-07-17 eb4: Step 2.4 wave-table row skipped at batch time → micro PR #99; third occurrence of the forced-follow-up-docs-PR class after #65, #96.)
- Co-Authored-By trailer required on all commits
- Conventional Commits format enforced by commitlint
- **Checklist ticks + orchestration-log lines land in the same action batch as the commit they record.** A session dying between commit and tick leaves disk truth ahead of checklist claims ("drafted uncommitted" that was committed; commits with no log line) — resume sessions burn a re-verification pass. (w2.6 S10 + wave-A Task 9, found 2026-07-12/14.)
- **After every push to a PR branch, verify CI passes:** `gh pr checks <number> --watch` — do not move on until all checks are green or explicitly dismissed by the user
- **Zero check runs on a PR ≠ passing — it may mean conflicts.** GitHub runs no `pull_request` CI on a conflicting PR (only deploy checks like Vercel appear). If `gh pr checks` shows only Vercel/no test jobs, check `mergeStateStatus` — rebase onto `origin/main` before trusting the PR. (2026-06-12: PR #55 opened conflicting after a same-day merge to main; looked check-clean, ran no CI.)

### 6. Definition of Done

Every domain defines its own gate list — see the domain's `CLAUDE.md`. Universal to all: nothing is "done" until the domain gates pass at 100%, the repo's `README.md` + `CLAUDE.md` are updated, `.gitignore` and `.env.example` are current, no dead code or commented-out blocks remain, and `claude-md-management:reflect` has run at the wave close **before** requesting push/PR. Repo-level doc edits land in the wave branch, never a second PR.

Run `superpowers:verification-before-completion` before declaring anything done.

### 7. Context Hygiene

- Orchestrator stops at `<!-- COMPACT POINT -->` markers and prompts the user to run `/compact` (the agent cannot invoke it) — not ad-hoc
- **Marker stop is absolute.** Blanket task approval ("i trust you, go for it") never waives it — only an explicit user instruction to skip compaction itself does. (2026-07-01: two markers passed under a blanket go-ahead; user corrected.)
- **If no checklist exists, compact at every major task boundary** — a 5h+ uncompacted session is unacceptable regardless of marker presence
- **Any checklist with 8+ tasks MUST include `<!-- COMPACT POINT -->` markers every 3–4 tasks** — writing the checklist without them is incomplete. **A finalization task (full gates + preview + Lighthouse + docs + reflect + release tails) gets its own marker immediately BEFORE it** — those tails run long and unmarked; motion-pass ran T7+T8 on one context stretch and `/usage` showed 68% of spend at >150k context (2026-07-21).
- **Appending tasks to an active checklist re-triggers the marker rule.** Mid-wave additions (QA-driven fixes, feature extensions with their own spec) get a `<!-- COMPACT POINT -->` written at the end of the appended block, and the orchestrator prompts `/compact` at the spec→plan and plan→dispatch boundaries of the addition — the spec/plan are durably on disk; context doesn't need to carry the authoring turns. (2026-07-05: L10–L12 appended post-plan with no marker → 222k-token session; user flagged.)
- **User-QA rounds count as task boundaries.** Each QA round that ends in a commit is a boundary — after logging it, prompt `/compact` before starting the next round once the session has crossed ~2 such rounds. (2026-07-17 chat wave B: QA-R1→R5 + the integration ran with ONE early compaction; `/usage` showed 61% of spend at >150k context and the session ran 3 days — the single biggest cost driver. Re-prompt `/compact` EVERY ~2 QA rounds, not once per wave; a long QA tail is exactly when this slips.)
- **Visual-gate waves prompt `/compact` after EVERY gate pass**, not every 3–4 tasks — gate turns carry image reads (screenshots, contact sheets, rendered references) that are dead context weight the moment the user says pass. (2026-07-22 carsickyak P3: 3 compactions still left 38% of spend at >150k context.)
- `/clear` prompted by `reflect` skill at project end only — not mid-phase
- Always `Grep` before `Read`; always pass `offset`+`limit` to `Read`
- >10 files read → offload remaining research to a focused subagent
- Do not re-read files already summarised in the conversation

---

## TDD Requirement

1. Write failing test
2. Write minimum code to pass
3. Refactor → run `simplify` skill
4. Repeat

**Never write implementation code before its test.**

---

## Code Quality

**Universal rules:**
- No `any` — use `unknown` and narrow it
- No `@ts-ignore` / `eslint-disable` without a comment explaining why
- No dead code, no commented-out code, no `console.log`
- **Never round-trip UTF-8 (no BOM) text files through PowerShell `Get-Content`/`Set-Content` — ANY edition, pwsh 7 included, source files included** — the round-trip mojibakes em-dashes/arrows and/or stamps a BOM on write-back. Use the Edit/Write tools for file mutations (checklist ticks especially). Briefs for bulk rename/replace tasks must carry this rule explicitly — agents reach for the PS one-liner otherwise. (2026-07-01: a `-replace` pass corrupted a checklist. 2026-07-23 slot-W2 QA-R2: recurred under pwsh — implementer mojibaked + BOM'd a test file, self-recovered via git checkout + Edit redo.)
- **A pipe after a gate command reports the pipe's exit code, not the gate's.** `just check 2>&1 | tail -60` in background reported "completed (exit 0)" while lint had FAILED — `tail` exits 0. Run gates unpiped with `; echo EXIT:$?` appended, and read the output before trusting completion. (2026-07-01: splash-handoff gate.) Same trap via background tasks: a background command ending in `; echo EXIT:$?` ALWAYS completes "exit 0" — the harness notification is the echo's exit, never the gate's. Grep the output file for the `EXIT:` line before trusting any background gate. (2026-07-14: two "completed (exit 0)" notifications hid EXIT:1 lint and EXIT:2 tsc failures.) Coverage claims read ALL FOUR metric lines from the vitest summary block (Statements/Branches/Functions/Lines) — tailing just Functions/Lines hid a 99.94% statements figure behind a "100% coverage" claim (2026-07-15). Dependency installs are gates too: run scratchpad/dep installs unpiped in the foreground — a backgrounded `npm install --silent 2>&1 | tail` reported clean while the install had failed (exit 128, transitive git-ssh dep); MODULE_NOT_FOUND right after a "clean" install means suspect a hidden install failure first. (2026-07-22 carsickyak P2: png-to-ico.)
- **Live LLM rounds on the user's API keys require per-run user clearance** — present lane, turn count, and expected writes first; read-only recon (code, logs, DB SELECTs) is always fine. Applies to orchestrator AND subagents: never dispatch a task whose steps fire live AI calls without the clearance recorded in the brief. (2026-07-14: wave-A Task 8 verification turns run unasked; user corrected.)
- **Bash cwd persists across tool calls.** After committing in another repo (claude-config, docs), the next git command runs THERE — a fetch+rebase once targeted claude-config instead of the working worktree, blocked only by a foreign dirty file. Multi-repo git ops use `git -C <path>` or re-`cd` in the same call. (2026-07-01.)
- **A local-only lint/format failure may be a line-ending checkout artifact, not real drift.** Before mass-rewriting (`prettier --write .`), check `git diff --numstat` (empty = EOL-only) and the committed blob's EOL (`git show HEAD:<file> | cat -A`); on Windows with `core.autocrlf=true` + no `.gitattributes`, CRLF-on-disk trips prettier's default `endOfLine:lf` while CI (Linux, LF) is already green. Fix at the source (`.gitattributes` `* text=auto eol=lf` + `.prettierrc` `endOfLine:"auto"`), don't churn files. (2026-06-30: a "repo-wide prettier drift, run prettier --write" flag was carried across two sessions as a blocker — it was a no-op CRLF artifact.)
- **When a library component generalizes app-local code, port the ACTUAL source's staging/timing verbatim — read the shipped file, not the spec's paraphrase.** The spec may describe intent ("Cy's bond" with a space) while the working code achieves it differently (gap from a CSS translate, no space char). Re-tune pixel/duration constants for the library's context (product `text-4xl` → library `text-7xl` needed the split translate to go ±12px→±32px or glyphs overlap). (2026-07-01: BrandSplash first port paraphrased the spec — wrong `'s` staging, dropped quote fade, an `animate-pulse` the product never had; cost a full re-QA round.)

**Dependencies:**
- Always use the latest stable major version — stale majors are a blocker, not deferred debt
- Upgrading a major dependency mid-feature-PR is a bug: do it in a standalone housekeeping PR before the feature starts
- devDependency upgrades that land in the same commit as feature/coverage work can break release workflows — keep them separate

**Security:**
- OWASP Top 10 mitigations
- `.gitignore` is the first commit in every new repo
- Never commit `.env`, credentials, API keys, or tokens
- **Secrets never in request URLs** — OAuth client-credentials/token params go in the POST body, never the query string. Request URLs are not secret-safe: framework error messages (Next DYNAMIC_SERVER_USAGE embeds the fetch URL), access logs, and Sentry captures all echo them, and no coverage/tsc/axe gate catches it. Review grep: fetch calls interpolating URLSearchParams built from env secrets into a URL. (2026-07-24 carsickyak: real Twitch client_secret printed in the prod build log; POST-body fix + regression test.)
- `.env.example` documents all required vars — committed and kept current
- `t3-env` validates all env vars at startup
- Zod validates all inputs at system boundaries
- Rate limit all user-facing endpoints via Upstash
- **Advisory-parity sweep:** a security-advisory fix (pin/override/ignore) landed in one workspace repo gets its siblings checked the same session — same dep tree, same advisory, and CI on the sibling's next PR goes red otherwise. (2026-07-25 GHSA-mh99-v99m-4gvg: lib fix `fb6ac9f`, then the identical advisory re-diagnosed from scratch in the app repo a session later — `8a4ed89` mirrored the same pin + ignore.)

---

## Orchestration

Agent factory: spawn protocol, dispatch template, performance-MD duty, escalation, type authoring — all in the `agent-factory` skill. Invoke it for any multi-task plan execution or `Agent()` dispatch decision.
Routing authority is `claude-config/agents/profiles/<type>.md` — type defs are general guidance only.
Every `Agent()` call sets `model:` explicitly from the profile's model sweet spot.

- Dispatch prose never restates brief contents — point at the brief file; a paraphrase that drifts ("both-vars gate" vs the brief's client-only snippet) makes the implementer + reviewer burn a round reconciling the contradiction. (2026-07-04.) This binds REVIEWER constraint blocks too, and the copy source is the brief/plan — not the spec — when the two differ: a reviewer dispatch quoted the spec's "series rows only" while the brief carried the plan's `recurrence !== null`; the reviewer burned a round adjudicating a contradiction the orchestrator created. (2026-07-14, activities-grouping task 4.)

---

## When Stuck

Ask one focused question at a time. Surface uncertainty before writing code.
