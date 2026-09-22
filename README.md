# claude-config

Personal Claude Code harness — fully owned skills, cross-platform Node scripts and hooks, workspace standards across three domains (web, games, apps). Restructured 2026-08 around simplification and trust in the models: skills are the actionable workflow units, scripts do the mechanical work, hooks enforce the rules that must always hold (one hook, `notification-toast.ps1`, stays PowerShell because it calls Windows Runtime toast-notification APIs with no cross-platform equivalent), and incident history lives in the docs repo's archive instead of always-loaded context.

## Layout

| Path | What | Linked to |
|---|---|---|
| `skills/` | Owned skills — workflow (`plan`, `worktree`, `agent-factory`, `qa`, `git-ops`, `reflect`, `continuation`, `cleanup`, `harness-editing`) + domain (`new-component`, `new-repo`, `release`, `visual-asset-gates`, `yak-voice`) | `~/.claude/skills/<name>` (junction/symlink per skill) |
| `scripts/` | Workflow scripts (`worktree`, `checklist`, `qa`, `land`, `cleanup`, `reflect-gather`, `session-state`, `verify-frontmatter`, `harness-map` — all `.mjs`, tested via `node --test scripts/test/*.test.mjs` — the bare directory form fails on Windows Node 24) | invoked by skills |
| `hooks/` | Node hooks (guards, gates, logs — see `hooks/README.md` for the settings.json wiring) | `~/.claude/settings.json` `hooks` block |
| `agents/` | Subagent defs (`implementer`, `reviewer`, `recon`, `web-recon`, `docs-agent`, `Explore`) + `ROUTING.md` (model guide) | `~/.claude/agents/` (junction) |
| `workspace/CLAUDE.md` | Universal standards | `~/code/CLAUDE.md` (symlink) |
| `workspace/<domain>/CLAUDE.md` | Web / games / apps standards | `~/code/<domain>/CLAUDE.md` |
| `workspace/docs/` | Reference docs (web stack docs, `TESTING-TRAPS`, games `DIAGNOSTICS`, brand) | `~/code/docs/...` (file-by-file symlinks) |
| `workspace/.claude/rules/` | Path-scoped rules | `~/code/.claude/rules` |
| `statusline/` | Usage statusline | `statusLine.command` |
| `telemetry/` | OTel usage receiver + report | data in `~/.claude/otel/` |
| `docs/` | Repo-only docs (migration notes, prompts) | — |

Claude Code loads every `CLAUDE.md` from the working directory upward, so a session in `~/code/web/<repo>` gets universal → web → repo rules. Skill routing is the skills' own frontmatter descriptions — there is no routing table.

Retired in the 2026-08 restructure (full text in git history and `docs` repo → `harness-evolution/archive/`): all vendored plugins (superpowers, claude-md-management, vercel, sentry, stripe, frontend-design, caveman), the `overrides/` junction hack, the SKILLS.md routing table, per-type agent profiles + performance-MD/eval machinery, the relocation gate, and the PowerShell hook set.

## Setup

```powershell
# Windows (junctions, no admin)
git clone https://github.com/Crawford-Young/claude-config
cd claude-config; .\setup.ps1
```

```bash
# macOS / Linux (symlinks)
git clone https://github.com/Crawford-Young/claude-config
cd claude-config && bash setup.sh
```

Both are idempotent and dynamic — a new skill directory or workspace doc links on the next run. Hook wiring is manual: copy the block from `hooks/README.md` into `~/.claude/settings.json`. Migrating from the pre-2026-08 harness: `docs/MIGRATION-2026-08.md`. `settings.json`'s `"model"` key is set to `"opus"` — the alias is deliberate, and it resolves to Opus 5.5 as of CLI v2.1.280 (2026-09-22), Opus 5 before that. Because 5.5 defaults to `medium` effort where Opus 5 defaulted to `high`, `modelSettings.claude-opus-5-5.effortLevel` pins it back to `high`; a future Opus needs its own entry or it starts at the model's default. Picking the `(default)` row in `/model` **deletes** the `"model"` key; put it back, because the account default isn't controlled by the harness, and if it ever became Fable, sessions would start on a billed model without the `FABLE OK` gate firing. Fable is opted into per wave via `/model` at a `/clear` boundary.

> **Windows:** file symlinks need Developer Mode or an elevated shell; directory junctions need neither.

## Conventions

- The main checkout is the live junction surface: it never leaves `main` and never commits. Live edits land here; commits go through `node scripts/land.mjs` (ephemeral worktree, path-scoped diff). Both rules are hook-enforced.
- Gates: `node --test scripts/test/*.test.mjs`, `node scripts/verify-frontmatter.mjs` and `node scripts/harness-map.mjs check` (CI).
- `harness-map.json` is the wiring map: every part, what it calls, gates or feeds. Read it before opening files one by one.
- New rules are one imperative line; incident stories go to `docs/harness-evolution/archive/rule-history.md`. A rule that must hold every time becomes a hook, then its prose is deleted.
