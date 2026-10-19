## Goal
`hooks/stop-reflect-gate.mjs` `continuationAsked` (~L118) accepts any AskUserQuestion asked after the reflect read and the merge whose text holds `fresh` or `clear` together with `continu`. A reflect question such as "File a fresh debt issue, or continue without one?" satisfies the gate, so the continuation ask is never forced. This existed before for `clear` ("Is that clear, or continue?"); #175 widened it to `fresh`. Found by the #175 round-3 reviewer, proven end to end (rc 0 with the debt ask, rc 2 without it).

## Done when
- [ ] The match is anchored to the continuation ask's shape (for example an option labelled fresh session or clear, plus one labelled continue), not loose words.
- [ ] A test has a reflect-dialogue ask with both words that does not satisfy the gate.
- [ ] A test reads the real continuation question and options from `skills/continuation/SKILL.md` and asserts `continuationAsked` accepts them, so a wording change there fails CI instead of the gate (#175 round 2: the new wording dropped "clear" and every post-merge stop would have blocked).

## Out of scope
Changing the continuation flow itself.

Files: hooks/stop-reflect-gate.mjs, scripts/test/stop-reflect-gate.test.mjs, skills/continuation/SKILL.md (read only)
