# DOCS-AGENT.md

Context for subagents tasked with updating documentation and MD files in `~/code`.

> Orchestration rules: `~/code/docs/ORCHESTRATOR.md` — read if you are unsure how to scope or hand off work.

---

## Your Job

Update, restructure, or create documentation files — CLAUDE.md, agent briefing MDs, plan docs, spec docs, ADRs. Deliver complete, accurate files ready for the user to review. Never commit.

---

## File Locations

| Type | Location |
|---|---|
| Workspace standards | `~/code/CLAUDE.md` |
| Agent briefing MDs | `~/code/docs/agents/` |
| Project specs | `~/code/docs/<project-name>/specs/<date>-<topic>-design.md` |
| Project checklists | `~/code/docs/<project-name>/checklists/active/` and `done/` |
| Issue logs | `~/code/docs/<project-name>/issues/` |
| Companion references | `~/code/docs/PATTERNS.md` (code patterns), `TEMPLATES.md` (scaffolding), `STACK.md` (tool choices), `ENV.md` (env vars), `COMPONENT-LIBRARY.md`, `TYPESCRIPT-STYLE.md`, `ORCHESTRATOR.md` |
| Brand docs | `~/code/docs/brand/` |

---

## Rules

- Read the current file before proposing any edit — never overwrite blindly
- Show exact diffs (old → new) for every change before applying
- Keep CLAUDE.md concise — it loads into every session; every line has a context cost
- Workspace-level rules go in `~/code/CLAUDE.md`; project-specific details go in the repo-level `CLAUDE.md`
- Agent briefing MDs must be self-contained — subagents start cold with zero session context
- Never add project-specific details to workspace CLAUDE.md
- Never add obvious/derivable information — only document what can't be inferred from code or git history
- One line per concept in CLAUDE.md where possible
- If a companion doc exceeds ~500 lines, consider splitting by concern (e.g. implementation patterns vs scaffolding templates)
- CLAUDE.md target: ≤250 lines. Companion docs load on demand — their size matters less, but keep them coherent

---

## When Editing CLAUDE.md

- Check if the addition duplicates something already present
- Keep tables terse — use short synonyms
- Place new sections near related existing sections, not appended to the end
- After any structural change, verify the companion references block at the top is still accurate

---

## When Creating a New Agent Briefing MD

Every new `docs/agents/*.md` must include:
1. What the agent's job is (one sentence)
2. The pointer to `ORCHESTRATOR.md`
3. Repo/dir location it operates in
4. Step-by-step task order (strict where order matters)
5. Definition of Done checklist
6. What NOT to do

---

## Definition of Done

- [ ] All changed files read before editing
- [ ] Diffs shown to user before applying
- [ ] No duplicate content introduced
- [ ] CLAUDE.md companion references block updated if new docs were created
- [ ] No commit made — user approves all commits
