---
name: harness-editing
description: Use before editing the workspace harness - the CLAUDE.md chain, claude-config, hooks, skills, agent profiles, or settings.json. Carries layout and load paths, junction and branch edit rules, commit rules, hook conventions, skill authoring caps, and probe verification rules for harness changes.
---

# Harness Editing

Guidelines for any agent editing this workspace's harness (CLAUDE.md chain, claude-config, hooks, skills, agent profiles, settings.json). Sources: root CLAUDE.md, `plan-premises` skill, `docs/SKILLS.md`, and P1 sweep findings — gap-report IDs (`G<n>`) cite `docs/harness-evolution/specs/2026-08-06-gap-report.md`.

## Layout — what lives where, what loads from where

- **claude-config repo** is the canonical home of: root + domain CLAUDE.md (under `workspace/`, junctioned into `~/code`), `agents/` (junctioned to `~/.claude/agents/`), `skills/`, `hooks/`, workspace reference MDs. Edit through either path — same file; commit in claude-config.
- **Junctions load from the MAIN checkout only.** `skills/` and `workspace/` junctions resolve to the main claude-config tree; a worktree edit changes files nothing reads. Check `git -C <claude-config> branch --show-current` before ANY claude-config edit.
- **Load chain:** Claude Code loads every CLAUDE.md from cwd upward at launch (root first, each level additive — the doc wording is "judgment to reconcile", not hard override; G11), plus each subdirectory's file on demand when files there are read. Domain CLAUDE.md files and `.claude/rules/` path-scoped files are **dropped by compaction** and reload only on next matching file read (G7) — compaction-critical rules belong in root.
- **Loading caps to respect:** MEMORY.md loads first 200 lines / 25KB only (G26). Skill bodies re-injected post-compact are truncated at 5k tokens/skill, 25k total, start-of-file kept (G33) — put load-bearing rules in a skill's first ~5k tokens. Skill descriptions are silently shortened when many skills are present (~90 here) — lead with discriminating keywords (G22).
- **settings.json** (`~/.claude/settings.json`): model pin, permissions (defaultMode auto + deny/ask rules incl. fable-dispatch and push/PR ask gates), hooks wiring, plugins, skillOverrides. Auto-mode `autoMode` config is read from USER settings only, never project-level (by design, v2.1.207+). env block also carries the OTel telemetry vars (telemetry/README.md is the reproducible record).
- **New skill = new junction; new agent def = no wiring.** `~/.claude/skills/` holds one junction PER skill; `setup.ps1` creates them and is NOT auto-re-run — a new `claude-config/skills/<name>/` is unreachable in every session until setup.ps1 re-runs (idempotent, skips existing) or the junction is created by hand; `verify-relocation.mjs` classes an unjunctioned skill as archival. `agents/` is a whole-directory junction — new defs go live on write. (Cold review Critical 1/Major 4, 2026-08-06 — this wave's own skill was the trigger case.)

## Edit rules

- **The Edit tool refuses to write through a symlink/junction — pass the real target path** (resolves into `claude-config/workspace/...`). The refusal guards against committing in a repo that doesn't track the file.
- **Junction edits bind LIVE behavior to the main checkout; commits do not.** Live-edit vs commit split: when the claude-config tree sits on another session's branch, edit the live file on disk (routing stays correct), log the deferral, and land the commit via an origin/main worktree PR — never commit onto another session's open branch.
- **Mid-session CLAUDE.md edits are inert for the current session** — content is read once at session start; the edit applies only after the next `/clear`, `/compact`, or restart (G8). Don't edit a rule and assume it now governs your own remaining work.
- **Never round-trip UTF-8 files through PowerShell Get-Content/Set-Content** (mojibake/BOM; hook-enforced). Use Edit/Write.
- **PS 5.1 redirected stdout is OEM CP437** — non-ASCII glyphs mangle on the wire (U+2192 → 0x1A; U+00B7 round-trips CP437-symmetrically, so a same-encoding test capture is structurally blind to it). Any harness script emitting non-ASCII forces `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)` on BOTH producer and test-capture sides (2026-08-06 P2 cold review F1).
- **Under `$ErrorActionPreference = 'Stop'`, a PowerShell-level stderr redirect of a native command (`git ... 2>$null`) throws NativeCommandError** — route through `cmd /c "git ... 2>nul"` and read `$LASTEXITCODE` (2026-08-06 P2 issue #3 round 3).
- **Prose is a request; a hook or permission rule is a guarantee** (G3, G48 — doc-verbatim: "If a rule must hold every time, make it a hook rather than a prompt instruction"). Before adding a "never X" line to CLAUDE.md, ask whether it belongs in `permissions.deny/ask`, `autoMode.hard_deny`, or a PreToolUse hook instead.
- **Recurrence despite a rule = prune-or-hook trigger, not restate-louder trigger** (G17/G18 family — bloated files cause rule-dropping). Additions to CLAUDE.md pass the test "would removing this cause mistakes?"; reflect additions use claim+cite form; retirement of stale/n=1-never-refired rules is part of maintenance, not vandalism (G18).
- **Two enforcement layers may deliberately overlap** (settings deny + hook regex for `git add -A`, G84) — check for a sibling layer before narrowing either; document the split where it exists.
- **Rule-birth re-sweep:** a new audit rule re-sweeps what already shipped under the old rule, or the deferral is written down with a target list (root CLAUDE.md rule — applies to harness edits too).

## Commit rules

- Docs repo (`~/code/docs`, remote `Crawford-Young/docs`, branch `master`): direct commits are established practice; **explicit paths only, never `git add -A`** (deny-ruled + hook-enforced; the repo is shared by concurrent sessions).
- claude-config: no commit/push without user approval; branch-per-change from `origin/main` when PRing; rebase-only workflow; "Rebase and merge" only.
- **Foreign-branch escape hatch:** worktree route works for COMMITS (PR from an origin/main worktree) while junctions keep serving live edits from the main tree — see memory `project_claude_config_deferred_commits` for the landed precedent (PR #12) and the commit-from-the-index trick.
- `git -C <path>` for multi-repo git ops — Bash cwd persists across calls.
- Checklist ticks + orchestration-log lines land in the same action batch as the commit they record.
- **Background sessions never auto-commit or push (G2 resolution 2026-08-06):** the approval rule is absolute, no carve-out; background-session / claude-agents adoption is deferred until mechanically guarded (hook or deny rule).

## Hooks

- Wiring lives in `~/.claude/settings.json` `hooks` block; scripts in `claude-config/hooks/` (invoked via forward-slash quoted absolute paths). Current set: PreToolUse guards (`Bash|PowerShell` command guard; `Agent` model guard — blocks model-omitted dispatches on frontmatter-less types), PreCompact archive, SubagentStop log, Notification toast (`notification-toast.ps1` — WinRT desktop toast for WezTerm, G53), SessionStart OTel-receiver spawn (`otel-receiver-spawn.ps1` — lazy-spawns the local usage-telemetry receiver on :4318, OTel wave 2026-08-07) — 5 of ~28 documented events (G70 lists mapped pilot candidates).
- **Fail-open convention:** guard scripts catch their own errors and append to `~/.claude/hook-errors.log` rather than blocking work. Check that log when a hook misbehaves; `claude --safe-mode` (all customizations off) and `/doctor` are the documented isolation path (G60).
- Exit-code semantics: 0 = proceed (stdout JSON processed), 2 = block (stderr reason), other = non-blocking error. A hook `allow` does NOT skip deny/ask rules; a hook deny applies even in bypassPermissions.
- The `if` field (permission-rule syntax) filters which calls spawn the hook process — only valid on PreToolUse/PostToolUse/PostToolUseFailure/PermissionRequest/PermissionDenied, best-effort (fails open on unparseable commands) — use the permission system for hard guarantees (G41).
- Hook-written logs have no rotation (G42) — bound or document cleanup when adding a logging hook.
- Hook output >50K goes to disk with a path + preview, not into context.

## Skills

- **Description-based routing has measured limits.** `live-qa-traps` and `games-diagnostics` missed 10/10 fresh-session probes through two description-rewrite rungs; the fix is promoting the TRIGGER into always-loaded files (CLAUDE.md §Workflow), not rewriting the description — tried, failed, ladder TERMINAL. Evidence: `docs/SKILLS.md` §Writing a Skill `description`.
- **Do not "fix" this by re-attempting description rewrites** — with two doc-grounded exceptions untested at ladder close, both cheap and both legal under the never-tune-to-probe rule: shorten + front-load keywords against listing truncation (G22), and third-person voice (G21). `paths:` frontmatter is NOT a fix — file-access-triggered, post-scoping timing (G24; considered and rejected on timing class, not empirically tested).
- Platform constraints for authoring (G21): name ≤64 chars lowercase/digits/hyphens, no 'claude'/'anthropic'; description ≤1024 chars, no XML tags, non-empty (and a `: ` in the description silently unpublishes — local rule); body <500 lines; references one level deep; 100+-line reference files get a TOC (G23).
- Routing authority is `docs/SKILLS.md`; keep its trigger table in sync when adding/renaming skills. `/verify` and `/code-review` are explicit-invoke-only since v2.1.215 (G12).
- Heavy skills: `disable-model-invocation`/`skillOverrides` zero their idle cost (G-adjacent, whats-new F11); post-compact truncation applies (G33).

## Verification — probe rules for harness changes

- **Routing/behavior claims are verified by probe, not by inspection.** A probe = a FRESH session, an uncontaminated prompt (never containing the description's own words — "never tune a description to the prompt you are testing it with", SKILLS.md), and a near negative control (a prompt that should NOT fire the skill/rule).
- **Audit by tool trace, not announce line** — skills fire without announcing (3 of 4 probes); read the Skill/tool call list (SKILLS.md). OTel `skill_activated` + `invocation_trigger` is the automated version if ever piloted (G61).
- Plan-premise discipline applies to harness edits: verify the premise a rule rests on before building on it (the depth-5 claim, the synchronous-subagent claim — both went stale silently; G1, G38). A claim carried from an older CLI version names the version or gets re-checked (`claude --version` first).
- Doc-sourced facts carry the doc URL; version-dependent facts carry the version; n=1 findings are marked provisional. Retract-if-unsupported: when the cited evidence no longer holds, the rule is corrected or removed, not left (G18).
- Cold review before dispatch for process-doc waves (n=5, 0 self-caught — root CLAUDE.md); reviewer Criticals verified against source before acting.

## Where each artifact type lives

| Artifact | Location |
|---|---|
| Specs, checklists, issue logs, agent logs, screenshots | `~/code/docs/<domain>/<project>/` (meta-projects incl. harness-evolution at `docs/` root) |
| Living reference MDs (brand refs, workspace docs) | claude-config junctions (`docs/brand/`, root MDs) — never project working artifacts |
| Skills | `claude-config/skills/` (junctioned) |
| Agent types + profiles | `claude-config/agents/` + `agents/profiles/` (profiles = routing authority) |
| Hooks | `claude-config/hooks/` + wiring in `~/.claude/settings.json` |
| Statusline | `claude-config/statusline/usage-statusline.ps1` (wired via `statusLine.command`); usage-history contract in `claude-config/statusline/README.md` |
| OTel telemetry (receiver, report, schema contract) | `claude-config/telemetry/` (data: `~/.claude/otel/`, NEVER in-repo) |
| Auto memory | `~/.claude/projects/C--Users-young-code/memory/` (MEMORY.md index, 200-line/25KB load cap — G26) |
| Session transcripts | `~/.claude/projects/<encoded-cwd>/*.jsonl` (plaintext, 30-day cleanup, format internal — don't parse) |
| Harness-evolution deliverables | `docs/harness-evolution/` (gap report, fact sheet, research/; the promoted source of this skill is stubbed there) |
