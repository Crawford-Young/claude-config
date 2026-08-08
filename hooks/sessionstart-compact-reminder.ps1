# sessionstart-compact-reminder.ps1 - SessionStart(source=compact) hook:
# re-inject the post-compaction reminders prose discipline loses (G48, 2026-08-08).
# stdout -> session context. Fail-open, exit 0 always.
try {
    Write-Output "Post-compaction reminder: (1) scan docs/<domain>/<project>/checklists/active/ - the checklist, not the compaction summary, is the source of truth for progress and next task. (2) COMPACT POINT marker discipline continues - stop at markers and hand the user a /compact <focus> string. (3) Nested/domain CLAUDE.md files are dropped by compaction - re-read the domain CLAUDE.md for the repo you are working in before relying on stack rules."
} catch {}
exit 0
