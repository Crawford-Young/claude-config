# debt(audit): GroupBy is dead outside tests since the breakdown columns

Since #54 the Audit sends only `groupBy: 'hierarchy'` (`src/AuditView.tsx:95`, `src-tauri/src/commands.rs:177`). The Day, Pr, AgentType and Model variants of `GroupBy` run only in tests now; the breakdown columns replaced them.

## Goal

No dead group-by code: the Audit filter has no group-by, and the tree and timeline always build the hierarchy.

## Done when

- [ ] `GroupBy` and `AuditFilter.group_by` are gone from strate-core (`store/audit/mod.rs`, `tree.rs::path`, `timeline.rs`), `views.rs`'s re-export, `src-tauri/src/commands.rs` and `src/api.ts` (`GroupBy`, `AuditFilter.groupBy`).
- [ ] Tests that pinned the other groupings are removed or rewritten against the hierarchy. Behavior is pinned first: the hierarchy tree and the timeline give byte-identical JSON on a dev-store copy before and after.
- [ ] Strate's gates pass at 100%.

## Out of scope

- The breakdown columns themselves (#54)
- The teammate interim key (#86)

Files: crates/strate-core/src/store/audit/{mod,tree,timeline}.rs, crates/strate-core/src/store/views.rs, src-tauri/src/commands.rs, src/api.ts, src/AuditView.tsx. Wait for #54 and #84 to land (#84 also edits views.rs).
