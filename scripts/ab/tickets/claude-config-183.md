## Goal
`land.mjs sync` pre-checks untracked copies of incoming additions (#175 reflect), but not a file/directory conflict. If an untracked FILE `sub` is on disk and the incoming commits add `sub/new.md`, the conflict gets past every precondition. `merge --ff-only` then refuses after the reset. Carried edits are put back, but the checkout is left unsynced and needs a manual reconcile.

## Done when
- [ ] sync refuses that shape before any reset, with the path named.
- [ ] The 'sync puts a carried edit back when the ff-merge itself fails after the reset' test keeps a fixture that still reaches the post-reset failure branch, or that branch is shown to be unreachable and removed.

## Out of scope
Other sync behavior.

Files: scripts/land.mjs, scripts/test/land.test.mjs
