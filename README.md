# claude-config

Personal Claude Code skills and workspace standards for Next.js fullstack development.

## Layout

| Path | What | Linked to |
|---|---|---|
| `skills/` | Custom skills | `~/.claude/skills/<name>` (junction/symlink) |
| `overrides/` | Edited official plugin skills | plugin cache dir (junction) |
| `workspace/CLAUDE.md` | Master development standards | `~/code/CLAUDE.md` (symlink) |
| `workspace/docs/` | Workspace reference docs — STACK, PATTERNS, TEMPLATES, ENV, COMPONENT-LIBRARY, TYPESCRIPT-STYLE, ORCHESTRATOR, **SKILLS** (skill routing), `agents/`, `brand/` | `~/code/docs/<name>` (symlinks for files, junctions for dirs) |
| `docs/` | Repo-only docs (daily updates, prompts) | — |
| `scripts/` | Workspace utility scripts | — |

Per-project planning docs (`~/code/docs/<project>/`) stay local — churn, not standards.

**Skill usage routing** lives in [`workspace/docs/SKILLS.md`](./workspace/docs/SKILLS.md) — the canonical situation→skill table. `ORCHESTRATOR.md` and `CLAUDE.md` point to it.

## Skills

| Skill | Trigger | Purpose |
|---|---|---|
| `continuation` | After heavy sessions / phase ends | Generates a structured handoff file before `/clear` so the next session resumes without loss |
| `inline-execute` | Executing a checklist with ≤2 files per task | Runs a checklist plan inline without subagent overhead |
| `new-component` | "add a component", "create a [name] component" | Full TDD workflow for Radix UI + CVA + Tailwind components — test → implement → export → story → check |
| `new-repo` | "new project", "create a repo", "scaffold" | 24-step production scaffold: git, env, justfile, ESLint, Husky, Vitest, Playwright, Storybook, CI, auth, monitoring |
| `release` | "release", "publish", "cut a release" | Full release process for npm packages — checks, build, verify, changeset, commit |

## Setup

**Windows** (junctions — no admin required):

```powershell
git clone https://github.com/crawfordyoung/claude-config
cd claude-config
.\setup.ps1
```

**macOS / Linux** (symlinks):

```bash
git clone https://github.com/crawfordyoung/claude-config
cd claude-config
bash setup.sh
```

Skills are linked into `~/.claude/skills/`, and workspace standards (`workspace/CLAUDE.md`, `workspace/docs/`) are linked into `~/code/` — available immediately in Claude Code, no restart needed.

> **Windows:** file symlinks (CLAUDE.md, docs root MDs) require Developer Mode (Settings → System → For developers) or an elevated shell. Directory junctions need neither.

## Scripts

`scripts/` holds workspace utility scripts:

| Script | Purpose |
|---|---|
| `export-harness.ps1` / `import-harness.ps1` | Export/import Claude Code harness config between machines |
| `open-admin-shells.ps1` | Open elevated PowerShell windows for admin tasks |

## Plugin skill overrides

Some official plugin skills are edited and tracked under `overrides/<plugin>/<skill>/SKILL.md`. The plugin cache directory is replaced with a junction to the repo, so the skill still loads under its original namespace (e.g. `claude-md-management:reflect`).

| Override | Original | Why |
|---|---|---|
| `overrides/claude-md-management/reflect/` | `claude-md-management:reflect` | Customized phase structure, workspace paths, dialogue prompts |

**After a plugin update:** check `~/.claude/plugins/cache/<plugin>/.../skills/<name>` — if the junction was replaced with a real directory, re-run the junction command:
```powershell
# Windows
Remove-Item -Recurse -Force <plugin-skill-dir>
New-Item -ItemType Junction -Path <plugin-skill-dir> -Target (Resolve-Path overrides/<plugin>/<skill>)
```

## Adding a skill

1. Create `skills/<name>/SKILL.md` with YAML frontmatter (`name`, `description`) and the skill body
2. Run `setup.ps1` / `setup.sh` to link it (or create the junction/symlink manually)
3. Commit and push

## Updating a skill

Edit `skills/<name>/SKILL.md` in the repo. The junction/symlink means Claude Code picks up the change immediately.

## Stack context

These skills assume the standard stack: Next.js App Router, TypeScript strict, Tailwind, Radix UI + CVA, pnpm, Vitest, Playwright, Auth.js v5, Neon + Drizzle, Vercel.
