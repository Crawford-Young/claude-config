---
paths:
  - "**/package.json"
  - "**/pnpm-lock.yaml"
  - "**/pnpm-workspace.yaml"
---
**Dependencies:**
- Always latest stable major — stale majors are a blocker, not deferred debt.
- Major dep upgrades mid-feature-PR are a bug: standalone housekeeping PR first.
- devDependency upgrades sharing a commit with feature/coverage work can break release workflows — keep separate.
