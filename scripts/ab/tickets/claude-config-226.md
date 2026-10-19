## Goal
The #167 depth-limit test stops failing CI under load.

On 2026-10-14, PR #224 run 38640665654 failed with `✖ #167: nesting past the depth the guard reads blocks with its own reason, in linear time (1012 ms)`: `AssertionError: powershell 5000: 520 ms`. The PR changed nothing near it (prices/audit only). The other run passed, and so did a re-run. #139 moved the scan budgets to CPU time (3003e3f), but this test still asserts wall-clock time while the full suite runs in parallel.

## Done when
- [ ] The linearity check uses CPU time (`process.cpuUsage`) or a ratio between two sizes, not an absolute wall-clock budget, and still fails on a quadratic regression (red→green against a deliberately quadratic stub, or show the ratio).
- [ ] Other absolute wall-clock budgets in `scripts/test/*.test.mjs` are listed in the PR and converted the same way where they gate CI.

## Out of scope
Changing the guard's depth limit.

Files: scripts/test/bash-guard.test.mjs
