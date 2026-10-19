## Goal
bash-guard's push gate reads Bash command text only, so a harness script that ran `git push` / `gh pr create` / `gh pr merge` internally would bypass the user-approval gate unseen. #170 nearly did this (prepush first designed to push itself; ruled out in 230e7c1). Make it mechanical.

## Done when
- [ ] `scripts/test/source-hygiene.test.mjs` fails when a tracked `hooks/`, `scripts/` or `statusline/` module spawns `git push` (except a remote branch delete: `push --delete`/`-d`/`:branch`) or `gh pr create`/`gh pr merge`, with a self-test of the matcher
- [ ] Existing scripts pass (land.mjs `finish`'s `push origin --delete` stays allowed)
- [ ] Deletion: drop the "No commit or push without user approval" clause from skills/git-ops/SKILL.md Conventions (restates CLAUDE.md)

## Out of scope
Changing bash-guard.mjs's gate itself.
