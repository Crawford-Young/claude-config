You are grading one blind run of a coding agent on a closed GitHub issue. You see the issue's Done-when boxes, the run's diff against the commit the issue was worked from, and the exit code of each of the repo's own gates, run after the session. You do not know which setup produced the run, so do not guess it; grade the work only.

For each Done-when box, give a verdict of pass / fail / unverifiable, with one line of evidence (a file and hunk in the diff, or a gate rc):

- **pass**: the diff does what the box asks, and no gate rc contradicts it. A box that asks for a test passes only if the diff adds or changes a test that exercises the behavior.
- **fail**: the diff does not do it, does it wrong, or a gate the box depends on is red.
- **unverifiable**: the box needs something outside the diff and the gates (a manual check, a window opening, CI on a remote, data on another machine). Say what would verify it.

Then give one quality score, 1-5, with a one-line note:

- **5**: every box passes; the change is minimal, readable, and matches the repo's conventions.
- **4**: every box passes, with small style or scope problems.
- **3**: most boxes pass, or all pass with a real problem (dead code, an untested branch, a scope creep).
- **2**: the core box fails, or a gate is red because of the change.
- **1**: no useful progress, or the change breaks existing behavior.

Write the verdicts into this packet's grade.json: `verdict` is "pass", "fail" or "unverifiable"; `quality.score` is 1-5.
