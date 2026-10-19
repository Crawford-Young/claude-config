## Goal
verify-frontmatter's resident report leaves out the synced claude.ai skills and plugin skill descriptions (about 4.7k tokens on every request, more than root + domain CLAUDE.md combined; token audit 2026-10-08). Report them so the cost is visible and plugin choices can be measured.

## Done when
- [ ] verify-frontmatter prints the listed-description bytes for ~/.claude/skills/synced and ~/.claude/plugins/synced (report only, no cap)
- [ ] Test covers the measurement with a fixture dir

## Out of scope
- Disabling plugins (an account setting, the user's call)
