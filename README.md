# claude-config

Personal Claude Code harness — fully owned skills, cross-platform Node scripts and hooks, workspace standards across three domains (web, games, apps). Restructured 2026-08 around simplification and trust in the models: skills are the actionable workflow units, scripts do the mechanical work, hooks enforce the rules that must always hold, and incident history lives in the docs repo's archive instead of always-loaded context.

## Layout

| Path | What | Linked to |
|---|---|---|
| `skills/` | Owned skills — workflow (`plan`, `worktree`, `agent-factory`, `qa`, `git-ops`, `reflect`, `continuation`, `cleanup`, `harness-editing`) + domain (`new-component`, `new-repo`, `release`, `visual-asset-gates`, `yak-voice`) | `~/.claude/skills/<name>` (junction/symlink per skill) |
| `scripts/` | Workflow scripts (`worktree`, `checklist`, `qa`, `land`, `cleanup`, `reflect-gather`, `session-state` — all `.mjs`, tested via `node --test scripts/test/`) | invoked by skills |
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

Both are idempotent and dynamic — a new skill directory or workspace doc links on the next run. Hook wiring is manual: copy the block from `hooks/README.md` into `~/.claude/settings.json`. Migrating from the pre-2026-08 harness: `docs/MIGRATION-2026-08.md`.

> **Windows:** file symlinks need Developer Mode or an elevated shell; directory junctions need neither.

## Conventions

- The main checkout is the live junction surface: it never leaves `main` and never commits. Live edits land here; commits go through `node scripts/land.mjs` (ephemeral worktree, path-scoped diff). Both rules are hook-enforced.
- Gates: `node --test scripts/test/*.test.mjs` and `node scripts/verify-frontmatter.mjs` (CI).
- New rules are one imperative line; incident stories go to `docs/harness-evolution/archive/rule-history.md`. A rule that must hold every time becomes a hook, then its prose is deleted.
