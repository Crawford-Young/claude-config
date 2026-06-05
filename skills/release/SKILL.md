---
name: release
description: "Guides the full release process for a published npm package — running all quality checks, building the package, verifying the output, creating a changeset, and preparing the release commit. Use this skill whenever the user says 'release', 'publish', 'cut a release', 'ship a version', 'create a changeset', or 'ready to publish'. Enforces that nothing ships unless all checks pass at 100%. Never skip the verification steps."
---

# Release Workflow

You are preparing a release for a published npm package. Nothing ships unless every gate passes.

Read `~/code/CLAUDE.md` for the full standards this release must satisfy, specifically the Published Package Libraries section.

<HARD-GATE>
Do not create a changeset or prepare a release commit until every verification step has passed. A release with failing tests, broken types, or a bad build is worse than no release.
</HARD-GATE>

---

## Step 1 — Pre-flight Verification

Run all checks in sequence. Each must pass before continuing.

```bash
just check
```

This runs: lint → typecheck → unit tests (100% coverage) → e2e (includes axe).

If `just check` fails:
- Identify the specific failure
- Fix it (do not suppress or skip)
- Re-run until it passes

**Coverage must be 100%.** If it is not, find the uncovered code and write a test for it.

---

## Step 2 — Build Verification

```bash
just build
```

Verify the output:
- `dist/index.js` exists (CJS)
- `dist/index.mjs` exists (ESM)
- `dist/index.d.ts` exists (types)
- No build errors or warnings

If the build fails, fix the source — do not modify the build config to suppress errors.

---

## Step 3 — Storybook Build

```bash
just storybook-build
```

The Storybook docs must build without errors. If it fails:
- Check for missing stories (every `ui/` component needs one)
- Check for broken imports
- Fix before continuing

---

## Step 4 — Summarise What's Changing

Before creating the changeset, show the user a clear summary:

1. Run `git log` to list commits since the last release tag
2. Categorise them by type (feat, fix, chore, etc.)
3. Identify which components were added, changed, or removed
4. Determine the appropriate semver bump:
   - **patch** — bug fixes, no API changes
   - **minor** — new components or features, backward-compatible
   - **major** — breaking changes (removed props, renamed exports, changed behaviour)

Present this summary to the user and confirm the bump type before creating the changeset.

---

## Step 5 — Create the Changeset

```bash
pnpm changeset
```

Guide the user through the prompts:
- Select the package (usually just one)
- Confirm the bump type (patch/minor/major)
- Write a clear, user-facing description of what changed — this goes in the public CHANGELOG

Good changeset description: "Add Badge component with default, secondary, destructive, and outline variants"
Bad changeset description: "stuff" / "updates" / "fix things"

Commit the changeset file:
```bash
git add .changeset/
git commit -m "chore: add changeset for <brief description>"
```

---

## Step 6 — Prepare Release Commit

Stage all changes that are part of this release (built files are gitignored — do not commit `dist/`):

```bash
git add src/ stories/ tests/ package.json pnpm-lock.yaml
```

Present the staged diff to the user for approval. **Do not commit until the user approves.**

---

## Step 7 — Report

```
Release Summary
───────────────
Package: <name>@<next-version>
Bump type: patch | minor | major

Changes:
<list of commits/components>

Verification:
✓/✗ just check (lint + typecheck + tests + e2e)
✓/✗ Coverage: 100%
✓/✗ Build: dist/index.js, dist/index.mjs, dist/index.d.ts
✓/✗ Storybook build
✓/✗ Changeset created

Next steps:
- Push branch and open PR → merge → CI will publish automatically via Changesets action
- Or: merge to main directly if branch is already approved → CI publishes
```

Remind the user: **do not run `pnpm changeset publish` manually** unless CI is not set up. The Changesets GitHub Action handles publishing on merge to main.
