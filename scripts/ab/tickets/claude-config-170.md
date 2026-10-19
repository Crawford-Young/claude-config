## Goal
Two worktree-flow failures from dog-eat-dog #17 (2026-10-13) get caught mechanically instead of by CI or a failed teardown.

## Done when
- [ ] Before a `git push` from a worktree, commitlint runs over `<base>..HEAD` (a bash-guard check on `git push`, or a worktree-skill script step) and blocks on failure, in repos that have a commitlint config
- [ ] Worktree teardown stops whatever process listens on the repo's serve port (or holds files under the worktree) before `git worktree remove`, rather than relying on stopping the `just serve` wrapper
- [ ] Each one has a test, or a dry-run fixture

## Out of scope
Fixing husky install in worktrees (separate, if it turns out to be the cause).

Evidence:
- **commitlint:** 7f30602 subject "feat(hud): HIT/MISS…" failed `subject-case` only in CI on PR dog-eat-dog#23. That meant a reword, a force-push and an extra CI round. `.husky/_/` was untracked in the worktree, so the local commit-msg hook likely never ran (unverified).
- **serve:** TaskStop on `just serve` left `node …serve/build/main.js build/web -p 8060` (PID 39424) alive. `git worktree remove --force` failed with "Permission denied" until it was killed.
