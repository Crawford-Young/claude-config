---
name: cleanup
description: Use at the end of a wave or session to sweep the workspace — worktrees, dev servers, checklists, uncommitted files — before handing off or clearing.
---

# Cleanup

```
node ~/code/claude-config/scripts/cleanup.mjs                       # report: dirty repos, worktrees, active checklists
node ~/code/claude-config/scripts/cleanup.mjs --kill-port 3000      # kill a dev-server port holder
node ~/code/claude-config/scripts/cleanup.mjs --remove-worktree <p> # safe worktree removal
```

End-of-wave order:

1. Gates green (`qa` skill), reflect run (`reflect` skill), checklist archived (`checklist.mjs done`).
2. `cleanup.mjs` — resolve everything it reports: commit-or-explain uncommitted files, remove finished worktrees, kill stale servers.
3. Anything left for a next session → `continuation` skill before `/clear`.

Finished background agents: stop stale task registrations (TaskList → TaskStop) so the task list stays readable.
