# CLAUDE.md — Universal Development Standards

Governs every project in this workspace. Stack rules live in the domain file; the more specific file wins on conflict. Mechanical rules are enforced by hooks (`claude-config/hooks/`), not restated here. Incident history lives in `docs/harness-evolution/archive/` — cite it, don't reload it.

## Philosophy

1. Least overhead. Minimize, in this order: my interruptions, the tokens injected into the agent, the steps per workflow, and the size of the harness.
2. Trust the agent. Keep only what it can't work out for itself: my preferences, quirks of this environment, and limits on irreversible or outward-facing actions. Cut everything else.
3. Impact per effort. Pick the most valuable change, not the easiest or the most familiar one. It's usually the simple one.
4. Leave it better. Fix what's broken in the code path you touched when the same review covers it; otherwise file an issue.

**No outdated-tech bias:** pinned tools, models and vendors carry `verified: YYYY-MM` and are re-checked on evidence, migrated when it says so.

## Domains

| Folder | Domain | Stack | Rules |
|---|---|---|---|
| `~/code/web/` | Web | Next.js (App Router), TypeScript, Tailwind, Radix+CVA, Vitest, Playwright, Vercel | [`web/CLAUDE.md`](./web/CLAUDE.md) |
| `~/code/games/` | Games | Godot 4, GDScript, GUT | [`games/CLAUDE.md`](./games/CLAUDE.md) |
| `~/code/apps/` | Apps | Expo (React Native), Tauri v2, Jest+RNTL, Maestro | [`apps/CLAUDE.md`](./apps/CLAUDE.md) |

Workspace infrastructure: `claude-config/` (this file's source, skills, agents, hooks, scripts — canonical home, junctioned into `~/code` and `~/.claude`), `docs/` (private: screenshots, harness-evolution archive).

## Skills are the workflow

The skills in `claude-config/skills/` are the actionable units (their `scripts/*.mjs` do the mechanical work); the session-start hook injects their index — Read the SKILL.md it names when its trigger matches.

## Tracking

GitHub issues, via plain `gh`: harness/cross-repo work in claude-config, project work in its own repo.

- **Issue = spec:** body `## Goal` / `## Done when` (checkboxes) / `## Out of scope`. Active work carries the `in-progress` label; PRs carry `Closes #N`.
- **Order:** issue (user approves its Done-when) → plan mode if the shape is open → execute without per-change approval → pause only when done, blocked, or the plan needs revision.
- **Resume state = commit bodies:** `What:` / `Verified:` (cmd → rc) / `Next:` / `Ruled out:`. A cold session resumes from the last `Next:` plus Done-when.
- **Bugs and wrong assumptions** found mid-wave → a comment on the issue, or a new `bug` issue. Subagents report `ISSUE:` lines upward instead.
- **Leave it better (4):** unfixed debt → a `debt` issue naming its files; commit-body follow-ups never got filed (#137).

## Git

- **No commit or push without explicit user approval.** Background sessions never auto-commit.
- After every push to a PR branch: watch checks until green. Zero check runs ≠ passing — may mean conflicts.
- UI-facing waves: hands-on user QA before requesting push/PR.

## Definition of Done

The domain CLAUDE.md's gate list, at 100%, plus: repo README/CLAUDE.md updated, `.gitignore` and `.env.example` current, no dead code, reflect prompted at wave close. Repo-level doc edits land in the wave branch, never a follow-up PR.

## Context

- At a wave boundary: get state on disk (commit body, issue comments), then run the continuation skill — a fresh window, not a compact.
- Abandoning a wrong implementation path: use `/rewind`, not `/compact` — a compact keeps the wrong path in its summary.
- Switch the session's own model only at a `/clear` boundary — a mid-session switch drops the prior model's thinking blocks and re-reads the whole context uncached.

## Response shape

- Simplest form that loses nothing — cut preamble, restatement, and narration of what a tool result already shows; never cut a fact, a caveat, or a number the user needs to act.
- The user's action items go last, under their own heading — everything needing their decision, approval, or hands, as a short list. Nothing for them to do is itself one line, not silence.
- Asking the user to choose uses `AskUserQuestion` (multi-select where the options aren't exclusive; "Other" is automatic), never a prose question — clicking an option is faster than composing an answer.
- Narrate at natural checkpoints (start, findings, blockers, done); a Fable wave adds the denser cadence in `docs/harness-evolution/fable-wave-preamble.md` on top.

## Security

- Never commit secrets. Secrets never in request URLs — token params go in POST bodies.
- Zod validates all inputs at system boundaries; rate-limit user-facing endpoints.
- A security fix in one repo gets its siblings checked the same session — same dep tree, same advisory.
- A Fable session doing security work may be silently answered by an Opus-tier model via the refusal fallback (`cyber`/`bio` categories; API docs call it opt-in, Claude Code's default undocumented) — don't treat model identity as stable in a security wave (observed 2026-09 as Opus 5; verified: 2026-10, Fable 5.1).

## Orchestration

- Dispatch readily — this harness delegates by design (verified: 2026-10, Opus 5.5). `agent-factory` carries the lanes; `agents/ROUTING.md` picks the model.
- Live LLM rounds on the user's API keys need per-run clearance — present lane, turn count, expected writes first. Point at brief files instead of restating them.
# Compact instructions

When compacting, always preserve: the active issue number and current task, open blockers and stated deviations, user-action handoffs not yet done, approaches tried and set aside (with why they were rejected), and the exact wording of user decisions and constraints — never a paraphrase. Prefer dropping: file contents already summarized, tool output already acted on, resolved QA rounds. Asymmetry: the model's own reasoning is the safest thing to condense; the user's own words are the least safe.
