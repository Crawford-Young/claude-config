# SKILLS.md — Skill Usage Reference

> Canonical reference for which skill fires in which situation. The `agent-factory` skill and `CLAUDE.md` point here. When skill routing changes, update this file — nowhere else.

---

## Trigger Discipline

- **Invoke before responding.** If there is even a 1% chance a skill applies, invoke it before any response — including clarifying questions. A skill that turns out wrong can be discarded; a skill never checked cannot.
- **Process skills before implementation skills.** "Build X" → `superpowers:brainstorming` first, then domain skills. "Fix Y" → `superpowers:systematic-debugging` first.
- **User instructions say WHAT, not HOW.** "Add X" does not mean skip the workflow.
- **Announce on invoke:** "Using [skill] to [purpose]."

## Writing a Skill `description`

**A domain skill that a process skill can precede MUST claim the scoping/planning phase in
its own `description`, or it will not load in the sessions that need it most.** Scope alone
is not enough. `visual-asset-gates` already said "image generation" and still failed to fire
on an image-generation request — in three fresh sessions, across two cwds, with the Tier-1
pointer removed as a variable and every relevant asset already found. It did not fire late
or partially; it did not fire at all, because `superpowers:brainstorming` legitimately owns
the front of those turns and a description implying execution gives a brainstorm no reason to
load it. The rewrite that fixed it added one clause: *"including while still scoping or
planning such work."* (2026-07-28 routing-verification, P1, resolved at ladder rung 1.)

The cost is inverted from what it looks like: a skill whose body is mostly *planning* rules —
batch this, anchor direction on shipped assets, defer that to a user gate — is unreachable
during exactly the phase those rules govern. **The rules most expensive to miss are the ones
structurally guaranteed to be missing.**

**The shape advice that stood here is retracted (2026-07-28, description-audit).** It read:
open on *what the user is in the middle of doing*, citing `live-qa-traps`, `games-diagnostics`,
and `cl-gates` as "the three descriptions that passed unmodified". Two of the three were then
re-probed on scoping-shaped prompts and **missed every time — 10 fresh sessions, through ladder
rung 0 and rung 1**. Their original passes came from already-mid-activity prompts, and the
passage generalized a shape recommendation out of that one narrow condition. Worse, the shape it
recommended — open on the activity in progress — is precisely the execution-flavored shape that
does not fire while work is still being scoped. The advice pointed the wrong way.
`cl-gates` was never probed at scope time; treat it as **unverified**, not as an exemplar.

What survives is narrower than "add a scoping clause", because that was tried and failed. Both
descriptions were rewritten to lead with "planning, scoping" and both still missed, with no
false fire on the near controls. The distinction against the one description that *did* get
fixed: `visual-asset-gates` enumerates **concrete artifact nouns** — images, brand assets, SVGs,
palettes, screenshots — and passed against a request that literally named one. "Interactive UI"
and "Godot work that touches movement, physics, or game feel" require a session to first
classify its own work into the category before any match can occur, and that inferential step is
where both die. Whether concrete nouns would fix it is **untested**: the nouns that would match
are the probe prompts' own words, barred by the rule below without new prompts.

One thing the failure did settle. A rival explanation — that no second skill loads once
`superpowers:brainstorming` claims the turn — is **false**: on the passing `visual-asset-gates`
re-probe, brainstorming fired first and the target second, inside brainstorming's own
context-exploration step. Co-fire works. Description matching is the broken link, not turn
ownership.

**Practical consequence: a rule that must be reachable while work is still being scoped cannot
rely on its `description` alone.** When routing fails at the ladder's end, promote the trigger —
an imperative load instruction in an always-loaded file, so the load is the orchestrator's job
rather than the router's. The skill body stays where it is; only the trigger moves.

**A `description` containing `: ` is silently unpublished.** Colon-space terminates an unquoted
YAML scalar, the frontmatter fails to parse, and the harness lists the skill by its H1 with no
description at all — maximally unreachable. `verify-relocation.mjs` is blind to it (body
paragraphs only); `verify-frontmatter.mjs` now catches it in CI. Use an em-dash.
(2026-07-28: caught by luck, one listing re-render — hence the CI gate.)

**Never tune a description to the prompt you are testing it with.** Adding the probe's own
keywords makes a subsequent pass unfalsifiable — the routing equivalent of putting the pass
criterion in the prompt.

**Routing is audited by tool trace, not by the announce line.** The "Using [skill]" rule above
holds, but skills were observed firing without it in 3 of 4 probes — a `Skill` tool call with
no announcement. Anything that verifies routing reads the call list; an absent announce line
is not evidence a skill did not load, and a present one is not evidence it did. (2026-07-28,
routing-verification issue #6.)

## Cost Notes

- `update-config` and `claude-md-management:claude-md-improver` load very large payloads — weigh the cost before invoking them for trivial edits.
- Honor `<!-- COMPACT POINT -->` markers before invoking heavy skills late in a session.
- Skills that read companion docs (`new-component`, `new-repo`) already point at the minimum set — do not preload extra workspace docs alongside them.

---

## Core Workflow (superpowers + harness)

| Situation | Skill |
|---|---|
| Starting any feature — **always first** (includes feature evolution on existing components) | `superpowers:brainstorming` |
| Brainstorm hits a genuine design fork — 2+ viable approaches with material trade-offs, or user says "debate this" | `persona-debate` |
| After brainstorm, before coding | `superpowers:writing-plans` |
| Writing or reviewing any plan or checklist — premise checks, contract-surface and invariant-consumer enumeration, verbatim-code checks, spec-time user questions | `plan-premises` (relocated from root `CLAUDE.md` §1, 2026-07-28) |
| Editing the workspace harness — CLAUDE.md chain, claude-config, hooks, skills, agent profiles, settings.json | `harness-editing` (promoted from docs/harness-evolution, 2026-08-06; hand-loaded via CLAUDE.md §Workflow trigger, never description-routed) |
| Executing any multi-task plan/checklist, wave start, dispatch or model decisions, spawn decisions at any depth | `agent-factory` (factory decides inline vs spawn at execution time; `inline-execute` remains the no-spawn path) |
| Executing a plan handed to a **separate fresh session** (rare — checklist workflows above are the default) | `superpowers:executing-plans` |
| 2–4 independent subtasks, no shared state | `superpowers:dispatching-parallel-agents` |
| Any bug, test failure, or unexpected behavior — before proposing fixes | `superpowers:systematic-debugging` |
| Implementing any feature or bugfix — before writing implementation code | `superpowers:test-driven-development` |
| Writing tests or QA for interactive UI — the unit-green/live-broken bug family, Vitest mocking traps | `live-qa-traps` (relocated from `web/CLAUDE.md`, 2026-07-28) |
| Godot diagnostic or tuning work — telemetry, debug probes, feel-gate tuning loop | `games-diagnostics` (relocated from `games/CLAUDE.md`, 2026-07-28) |
| After every implementation pass | `simplify` |
| Before claiming work is done | `superpowers:verification-before-completion` + `vercel:verification` |
| Confirm a fix or feature works by running the app | `verify` |
| Run/launch the app to observe a change | `run` |
| Review the current diff before merge | `code-review` |
| Requesting code review | `superpowers:requesting-code-review` |
| Receiving code review feedback | `superpowers:receiving-code-review` |
| Finishing a branch / ready to merge | `superpowers:finishing-a-development-branch` |
| Isolated feature work | `superpowers:using-git-worktrees` |
| A rebase conflicts on every touched file, or a Windows worktree refuses removal | `git-recovery-ops` (relocated from root `CLAUDE.md` §3, 2026-07-30 — recovery only, not the routine branch flow) |
| Building any UI | `frontend-design:frontend-design` |
| Any visual, asset, theme, or image-pipeline task — before the preview gate | `visual-asset-gates` (relocated from root `CLAUDE.md` §2 + `web/CLAUDE.md`, 2026-07-28) |
| Phase ends (branch merged, wave done) — **mandatory** | `claude-md-management:reflect` |
| After reflect, spec approval, or wave boundary — before `/clear` | `continuation` |
| Session-end CLAUDE.md learnings | `claude-md-management:revise-claude-md` |
| Creating or editing a skill | `superpowers:writing-skills` (process) + `skill-creator:skill-creator` (evals/optimization) |

**Routing rule:** `superpowers:executing-plans` is for plans executed in a separate session with review checkpoints. For checklists in the current session, the `agent-factory` skill governs: orchestrator judges at execution time — no spawns needed → `inline-execute`; spawns needed → dispatch per the factory protocol (profiles are the routing authority).

## Custom Skills (this repo, `skills/`)

Inline (current session) → use the skill. Subagent dispatch → use the predefined `subagent_type` (definitions in `claude-config/agents/`, junctioned to `~/.claude/agents/`). Agent definitions are the source of truth for patterns and gotchas; skills are the inline workflow.

| Situation | Inline skill | Subagent (`subagent_type`) |
|---|---|---|
| Creating a new UI component | `new-component` | `component-agent` |
| Scaffolding a new repository | `new-repo` | `new-repo-agent` |
| Releasing the component library | `release` | `wave-release-agent` |
| Doc/MD-only work via dispatch | — | `docs-agent` |
| Recon (local or web/docs), implementation, review, workstream management | — | `recon` / `web-recon` / `implementer` / `reviewer` / `manager` |
| Executing a small-task checklist inline | `inline-execute` | — |
| Spawn decisions, dispatch, model routing (via profiles), performance MDs, type authoring | `agent-factory` | — |
| Enumeration-shaped fan-out (consumer sweeps, adversarial verify) — propose Workflow tool | `agent-factory` §Workflow Lane | — |
| Spec-time debate at a design fork — personas argue, user picks | `persona-debate` | — |
| Handoff before `/clear` (auto-triggers after reflect, spec approval, wave end) | `continuation` | — |

## Next.js & Vercel

| Situation | Skill |
|---|---|
| App Router questions or architecture | `vercel:nextjs` |
| After editing TSX files | `vercel:react-best-practices` |
| Radix / component library patterns | `vercel:shadcn` |
| Next.js caching (`use cache`, `cacheLife`) | `vercel:next-cache-components` |
| Upgrading Next.js version | `vercel:next-upgrade` |
| Vercel answers seem outdated | `vercel:knowledge-update` |
| Managing env vars in Vercel | `vercel:env-vars` |
| Deployments, rollbacks, CI/CD | `vercel:deployments-cicd` |
| Vercel Marketplace integrations | `vercel:marketplace` |
| AI features (chat, agents, tool calling) | `vercel:ai-sdk` |

## Sentry

| Situation | Skill |
|---|---|
| Query production errors in natural language | `sentry:seer` |
| Fix a production issue using Sentry context | `sentry:sentry-workflow` |
| Set up Sentry in a new project | `sentry:sentry-sdk-setup` |
| Configure advanced Sentry features | `sentry:sentry-feature-setup` |

## Stripe

| Situation | Skill |
|---|---|
| Any Stripe integration work or review | `stripe:stripe-best-practices` |
| Upgrading Stripe API version or SDK | `stripe:upgrade-stripe` |
| Stripe error codes | `stripe:explain-error` |
| Test card numbers | `stripe:test-cards` |

## Harness & Config

| Situation | Skill |
|---|---|
| Hooks, permissions, env vars, settings.json | `update-config` (heavy — see Cost Notes) |
| Anthropic API / model IDs / pricing / tool use | `claude-api` |
| Keyboard shortcut customization | `keybindings-help` |
| Reduce permission prompts | `fewer-permission-prompts` |
| Recurring in-session task | `loop` |
| Scheduled cloud agent / routine | `schedule` |
| CLAUDE.md audit across repos | `claude-md-management:claude-md-improver` (heavy — see Cost Notes) |

## Communication

| Situation | Skill |
|---|---|
| Token-efficient replies (persistent mode) | `caveman:caveman` |
| Commit messages | `caveman:caveman-commit` |
| PR review comments | `caveman:caveman-review` |

---

## Maintenance

- Custom skills live in `claude-config/skills/`, linked into `~/.claude/skills/` by `setup.ps1` / `setup.sh`.
- **Creating `claude-config/skills/<name>/` is HALF the wiring.** The junction is per-skill, so a new directory is invisible to every session until `setup.ps1` is re-run — authoring is not installing. Re-run it in the same batch that creates the skill, then confirm the name appears in `~/.claude/skills/`. Junctions hot-load: a newly linked skill is live in the current session, no restart. (2026-07-28: `yak-voice` sat un-junctioned for 4 days, discovered only when a later wave audited the set — issue #2. Repo-local `.claude/skills/` inside a project needs no junction and no setup run.)
- Plugin skill overrides live in `claude-config/overrides/` — see README for the junction-repair procedure after plugin updates.
- `claude-md-management:reflect` Phase 5 is where skill gaps become skill edits — when reflect identifies a vague trigger or missing guidance, edit the skill in this repo, not the plugin cache.
- New skill candidates surface in reflect: any subprocess repeated more than once with no skill coverage.
