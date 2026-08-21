# Git recovery signatures

Load on the failure, not preventively.

## A rebase onto main conflicts on every touched file

Cause: the branch was built on a SQUASH-merged base — the previous wave's
commits are not ancestors of main, so `git rebase --onto origin/main <old-base>`
replays already-merged work. (Historical bases only: PRs merged before
2026-07-21 were squashed; rebase-merged PRs rebase normally.)

Fix — squash-integrate onto fresh main:

1. `git checkout -B <branch> origin/main`
2. Bring the new wave's files:
   `git diff --name-only <wave-base> <wave-head> | grep -vxF <files-main-also-changed> | xargs git checkout <wave-head> --`
3. 3-way-merge (`git merge-file`) only the files main independently changed
4. Regenerate any colliding migration with the repo's tooling (`drizzle-kit generate`) — never hand-edit snapshot JSON
5. Install, full gate, one integration commit. History loss is fine.

## Windows worktree removal fails

`node scripts/worktree.mjs remove <path>` encodes the working sequence
(git remove → force → recursive delete with retries → prune). If a process
holds files, close it and re-run. Never `robocopy /MIR` a tree that still
contains junctions — targets get destroyed.

## `merge --ff-only` refuses over an untracked file

A merged PR that ADDED a file leaves the local untracked copy in the way.
Byte-verify (`git cat-file -p origin/main:<path>` vs the local file), delete
the local copy, re-run the merge — it re-materializes the tracked version.
If a restore re-materializes CRLF over the index's LF, normalize via
`git show HEAD:<file> > <file>` and retry.

## /rewind coverage gap

Checkpoint restore covers the main session's own file edits only — not
subagent edits, not Bash-side file operations. A subagent wave gone wrong is
git-only recovery: branch state plus the procedures above.
