# `claude-config/scripts/`

Workspace tooling. Each script's own header comment is the authority on its flags;
this file carries the **practice** around them — the things a future wave needs to
know that no script can enforce on itself.

| Script | Purpose |
| --- | --- |
| `verify-relocation.mjs` | Zero-loss gate for text relocation waves (see below) |
| `export-harness.ps1` / `import-harness.ps1` | Move harness config between machines |
| `open-admin-shells.ps1` | Spawn elevated shells for junction work |
| `baseline/` | Frozen pre-change copies of the files a relocation wave rewrites |

---

## Relocation waves

A **relocation wave** moves rule text between files without changing its meaning —
trimming an always-loaded `CLAUDE.md` into model-invoked skills, splitting an
oversized skill, archiving a wave-history table. The deliverable is that **every rule
survives verbatim**, so the wave's only real risk is silent loss: a rule that vanishes
during a move is indistinguishable from a rule that was never written.

`verify-relocation.mjs` is the gate. Freeze the pre-change files into `baseline/`,
then run it after every edit.

### What the gate actually proves — and what it does not

It proves **presence**: every baseline paragraph appears in some destination file.

Until 2026-07-28 it proved **only** presence — nothing checked that anything ever *loads*
the destination, so a live rule relocated into a history file, an archive, or an
un-junctioned skill directory passed and was lost exactly as thoroughly as a rule deleted.
(That is not hypothetical: an active workflow rule was moved into
`web/component-library/docs/WAVES.md`, which nothing loads. The gate passed it, correctly
by its own definition. Caught by a cold plan reviewer, not by the gate and not by its author.)

**Implemented 2026-07-28.** Every destination carries a load class, and a paragraph whose
only hits are archival reads `UNREACHABLE` — a blocker, listed separately from `MISSING`
because the remedies differ: `MISSING` means text vanished, `UNREACHABLE` means it survived
somewhere nothing reads.

| class | members | gates? |
| --- | --- | --- |
| `always` | the `CLAUDE.md` chain | reachable |
| `on-demand` | junctioned skills, repo-local `.claude/skills`, `docs/SKILLS.md` | reachable |
| `archival` | `web/component-library/docs/WAVES.md` | **fails** |

A skill directory under `claude-config/skills/` is `on-demand` only when its junction exists
under `~/.claude/skills/` — `setup.ps1` creates one junction per skill and is not re-run when
a skill is added, so an un-junctioned skill is an archival destination. Repo-local skills
need no junction. A destination in no class **aborts**; there is no default in either
direction, because defaulting to reachable is exactly the bug this class system fixes.

The check is `existsSync` on the junction root, so a plain directory of the right name
satisfies it as well as a real junction. That is the honest limit of a cheap check: it
catches the skill that was never wired, not a junction that was replaced by a folder.

Content that is *correctly* archival — history filed in a history file — would otherwise
read as a blocker, so `INTENTIONAL_ARCHIVES` exempts it by matched string, with the same
audit shape as `INTENTIONAL_EDITS`: each entry names its task, its reason, and what was
verified by other means, and stale-entry detection removes it the moment it stops firing.
This is the one place a live rule could hide behind an exemption; the reason field is what
keeps that visible rather than silent.

Hand-verification still covers what the classes cannot: whether a destination is on the load
path **for the situation its rules govern**. A rule that only matters during a games wave,
relocated into a web-only skill, is reachable by every mechanical test and useless in
practice.

### Exit codes, and running the suite

`0` = pass. `1` = the gate **ran** and found a real problem (MISSING, UNREACHABLE, stale
exemption). `2` = the gate **could not run** (unclassified destination, no baselines, no
destinations). The 1/2 split was harmonized 2026-07-28 — two abort sites used to exit `1`,
the same code a genuine loss uses, which is a small version of the failure this gate exists
to catch. The suite asserts the exact codes rather than `notEqual(0)`.

**The suite's invocation is load-bearing, and both wrong forms are worse than they look:**

```bash
cd /c/Users/young/code && node --test "claude-config/scripts/test/*.test.mjs"   # correct
```

- `node --test <dir>` resolves the directory as a module, dies `MODULE_NOT_FOUND`, exits 1
  and prints `fail 1` — it reads exactly like a red suite. Ask for test NAMES; getting none
  is the tell.
- `node --test` with an absolute MSYS-style glob (`/c/Users/...`) matches nothing, prints
  `tests 0`, and exits **0** — indistinguishable from a green run. Strictly worse than the
  first: that one at least fails.

**Read the `tests N` line, never the exit code alone.** Same family as the piped-gate rule in
root `CLAUDE.md`: a green exit proves a command finished, not that it did anything.

### Paragraph ≠ rule

The gate splits on blank lines and skips anything under `MIN_PARAGRAPH_CHARS` (60).
Consequences worth internalizing before trusting a green run:

- **A contiguous bullet block is ONE paragraph.** Eight rules in one list count as one.
  Never report paragraph counts as rule counts — verify rule counts with a separate grep
  against the source range.
- **A fenced code block is ONE paragraph.**
- **Editing a surviving list trips the gate.** ADDING a bullet to a bullet block fails
  identically to deleting one, because the block no longer matches its baseline byte-for-byte.
  The mechanism cannot tell additive from lossy. Before writing the exemption, verify the
  original lines individually (normalized line-by-line compare, N/N present) and record
  that verification in the entry.

### Exemptions

Two allowlists, both with stale-entry detection so an exemption cannot outlive its condition:

- `INTENTIONAL_DUPLICATES` — text that legitimately lives in more than one file (each
  domain's Definition of Done repeats the verification line by design).
- `INTENTIONAL_EDITS` — paragraphs the wave deliberately rewrote. A rewritten paragraph
  cannot match its baseline and reads as MISSING, indistinguishable from a loss.

**An exemption is never the first response to a red gate.** Ask "is the deletion right?"
before "how do I record the deletion?" — the gate firing is evidence about the plan, not
a defect in the gate. Reaching for exemption machinery first launders a genuine loss
through an audit trail that reads as honest. (2026-07-28: a cold reviewer independently
proposed a new `INTENTIONAL_DELETIONS` class for two "derivable, safe to delete" sections.
Correct machinery, false premise — executing the premise showed both claims were wrong,
and the blocker retired with zero new exemptions.)

Every entry records its task and its reason, and states what was verified by other means.

---

## Editing mechanics

Hard-won, and cheaper to obey than to rediscover.

**Slice by script, never retype.** Read the source, slice the line range, write it out —
in a `node` script, not by hand in an editor. Retyping reintroduces exactly the reword and
drift risk the wave exists to prevent, and slicing gets the byte-count check for free.
Prettier reporting "unchanged" afterward proves the slice was byte-exact.

**Mark-then-filter, never successive splices.** Build a `Set` of doomed line numbers and
filter in one pass. When two deleted ranges are adjacent, a second splice runs against
shifted indices and swallows the next range's heading — and the gate only notices if that
heading exceeds 60 chars.

**Preserve CRLF.** Split on `\n` only, so a trailing `\r` stays attached to its line;
rejoin with the EOL detected from line 1. `core.autocrlf=true` is on across this workspace.

**Re-verify design-time line ranges at execution time.** Ranges written during planning
are premises. Assert each boundary against a regex before mutating anything, and exit
non-zero on mismatch — a plan authored two tasks ago has usually drifted.

**Never round-trip through PowerShell `Get-Content`/`Set-Content`** — any edition. It
mojibakes em-dashes and arrows and stamps a BOM on write-back. Hook-enforced since
2026-07-27; the rule text lives in root `CLAUDE.md`.

---

## Reporting sizes

Byte figures in a commit message, a checklist, or a report are **claims**, and they get
measured like any other claim.

**Measure into the shell BEFORE the message is composed**, so the number is copied rather
than recalled. This is an ordering fix, not a memory fix: the failure happens while writing
the commit message, *after* the verification step already feels done. Writing the lesson
down does not prevent it — the same wave shipped three unmeasured figures, two of which
needed amends, with the lesson already recorded after the first.

**State the surface, and never mix surfaces in one before/after pair.** On-disk (CRLF) and
git-blob (LF) sizes differ by one byte per line — `agent-factory/SKILL.md` is 18,541 on disk
and 18,370 as a blob. One 2026-07-28 commit compared an on-disk before against a figure that
was neither, overstating a −21.4% cut as −25.9%.

```bash
# both ends, same surface, same command
wc -c < path/to/before.md; wc -c < path/to/after.md          # on-disk
git show HEAD:path/to/file.md | wc -c                        # blob
```

---

## Cross-repo hazards

**Bash cwd persists across tool calls.** After a commit in another repo, the next `git`
runs *there*. Use `git -C <absolute-path>` for every multi-repo operation rather than a
bare `cd` — and note that a relocation wave may itself create a second `docs/` directory,
which turns a relative `docs` path into a wrong-repo commit with no error.

**Two shells, incompatible quoting.** PowerShell and Git Bash are both available. Multi-line
strings for the Bash tool use a heredoc — `git commit -F - <<'EOF'` — never a PowerShell
here-string (`@'...'@`), which Bash does not parse; the bare `@` reaches commitlint as the
subject and fails `subject-empty`.

**Formatting hooks write after your gate runs.** A repo's `just check` may only
`prettier --check`, but its lint-staged pre-commit hook `--write`s. Re-run the relocation
gate **after the commit**, not just after the last edit — the commit is the boundary where
a 33 KB Markdown table can get reflowed out from under a green run.
