## Goal
A new worktree in a husky repo has husky's hook stubs before its first commit, so commit-msg (commitlint) runs and git-lfs never fills the hooks dir instead.

Found by the what-is-dark#18 unit (2026-10-14). `core.hooksPath` is `.husky/_`, which is relative to each worktree root and untracked. `worktree.mjs new` without `--install` leaves `.husky/_/` missing. Later, `git lfs install` (or a git-lfs smudge setup) writes git-lfs's own pre-push, post-checkout, post-commit and post-merge into it. The result has no `h` and no `commit-msg` stub, so `.husky/commit-msg` never runs. In `.worktrees/what-is-dark-phase4-wave1a`, that is the state of every commit on `feat/phase4-wave1a`. The worktree also has no node_modules, so `pnpm exec commitlint` could not run there anyway.

## Done when
- [ ] `worktree.mjs new` detects a husky repo (`"prepare": "husky"` in package.json, or `core.hooksPath` under `.husky/`). Without `--install`, it either creates the stubs (`pnpm exec husky` needs node_modules, so decide between that and installing) or prints a loud warning naming the fix.
- [ ] A test covers the detection path.

## Out of scope
The repo-side LFS pre-push hook (what-is-dark#18, dog-eat-dog#26).
