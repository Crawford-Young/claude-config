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
- `pnpm audit` in CI, no high/critical. Transitive overrides: pin EXACT inside the consumer's declared range, why-comment the GHSA + drop condition (pnpm 11: overrides live in `pnpm-workspace.yaml`).
- Toolchain majors: check the Node floor against CI's `node-version` AND `engines`; read the host tool's migration guide, not just peer ranges — bundled plugins break independently.
- Playwright bumps pin new browser builds — `playwright install chromium` is part of the bump.
