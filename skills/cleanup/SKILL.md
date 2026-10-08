---
name: cleanup
description: Use at the end of a wave or session to sweep the workspace — worktrees, dev servers, checklists, uncommitted files — before handing off or clearing.
disable-model-invocation: true
---

# Cleanup

```
node ~/code/claude-config/scripts/cleanup.mjs                       # report: dirty repos, worktrees, active checklists
node ~/code/claude-config/scripts/cleanup.mjs --kill-port 3000      # kill a dev-server port holder
node ~/code/claude-config/scripts/cleanup.mjs --remove-worktree <p> # safe worktree removal
```

End-of-wave order:

1. Gates green (Read `skills/qa/SKILL.md`), reflect run (Read `skills/reflect/SKILL.md`), checklist archived (`checklist.mjs done` — git-mvs the file to `done/`, which stages the index blob; any further edit to that file needs an explicit `git add`).
2. `cleanup.mjs` — resolve everything it reports: commit-or-explain uncommitted files, remove finished worktrees, kill stale servers.
3. Anything left for a next session → Read `skills/continuation/SKILL.md` before `/clear`.
