# SKILLS.md — Skill Usage Reference

> Canonical reference for which skill fires in which situation. The `agent-factory` skill and `CLAUDE.md` point here. When skill routing changes, update this file — nowhere else.

---

## Trigger Discipline

- **Invoke before responding.** If there is even a 1% chance a skill applies, invoke it before any response — including clarifying questions. A skill that turns out wrong can be discarded; a skill never checked cannot.
- **Process skills before implementation skills.** "Build X" → `superpowers:brainstorming` first, then domain skills. "Fix Y" → `superpowers:systematic-debugging` first.
- **User instructions say WHAT, not HOW.** "Add X" does not mean skip the workflow.
- **Announce on invoke:** "Using [skill] to [purpose]."

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
| Executing any multi-task plan/checklist, wave start, dispatch or model decisions, spawn decisions at any depth | `agent-factory` (factory decides inline vs spawn at execution time; `inline-execute` remains the no-spawn path) |
| Executing a plan handed to a **separate fresh session** (rare — checklist workflows above are the default) | `superpowers:executing-plans` |
| 2–4 independent subtasks, no shared state | `superpowers:dispatching-parallel-agents` |
| Any bug, test failure, or unexpected behavior — before proposing fixes | `superpowers:systematic-debugging` |
| Implementing any feature or bugfix — before writing implementation code | `superpowers:test-driven-development` |
| After every implementation pass | `simplify` |
| Before claiming work is done | `superpowers:verification-before-completion` + `vercel:verification` |
| Confirm a fix or feature works by running the app | `verify` |
| Run/launch the app to observe a change | `run` |
| Review the current diff before merge | `code-review` |
| Requesting code review | `superpowers:requesting-code-review` |
| Receiving code review feedback | `superpowers:receiving-code-review` |
| Finishing a branch / ready to merge | `superpowers:finishing-a-development-branch` |
| Isolated feature work | `superpowers:using-git-worktrees` |
| Building any UI | `frontend-design:frontend-design` |
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
| Recon, implementation, review, workstream management | — | `recon` / `implementer` / `reviewer` / `manager` |
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
- Plugin skill overrides live in `claude-config/overrides/` — see README for the junction-repair procedure after plugin updates.
- `claude-md-management:reflect` Phase 5 is where skill gaps become skill edits — when reflect identifies a vague trigger or missing guidance, edit the skill in this repo, not the plugin cache.
- New skill candidates surface in reflect: any subprocess repeated more than once with no skill coverage.
