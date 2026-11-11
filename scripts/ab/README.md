# scripts/ab: the #271 A/B runner

Three arms on 10 replayed claude-config tickets (`manifest.json`; harness only, user decision 2026-10-16): `bare` is Claude Code under `--safe-mode`; `current` is the harness at each ticket's parent; `solo` (#374) is `current` with subagent spawning off. `run.mjs` runs one round, `grade.mjs` writes blind packets, `canary.mjs` proves what an arm loads. The headers of each script give the details. The full set is 60 rounds (10 tickets, 2 runs, 3 arms); `run.mjs --dry-run` prints the estimate in total and per arm.

## The solo arm and subagent metrics

`solo` runs `current`'s command plus `--disallowedTools Agent,Workflow` (`claude --help`, 2.1.322: "Comma or space-separated list of tool names to deny"). `Agent` spawns a subagent, and `Workflow` runs a script that spawns them. Everything else matches `current`: the same CLAUDE.md chain, skills, agents, rules, hooks, estimate and cap. The canary proves the deny works. Its stub records the tools each request offers the model, and it passes `current` only when `Agent` is among them, `solo` only when neither tool is. On 2026-11-10 the solo request also dropped the agent-type listing. `ListAgents` and the deferred `SendMessage` stay, but they only reach agents that already exist, and a solo session has none.

Each `result.json` has a `subagents` block, read from the round's own transcripts (the session's jsonl plus each subagent's under `<session>/subagents/`):
- `spawned`: distinct subagent ids. `reportedSpawned` is claude's own `subagent_stats.spawned`, and a mismatch adds a note.
- `models`: the models the subagents ran on.
- `tokens`: the subagents' input, output and cache tokens, against the round's total, with their `share`.
- `costUsd`: the subagents' $ and `share`. Claude reports $ per model, not per agent, so each model's `costUSD` is split by the priced token weight its session and subagent calls carried (output 5x an input token, a cache read 0.1x, a 5-minute cache write 1.25x, a 1-hour one 2x). A model only subagents ran is theirs exactly. `null` when claude's output had no `modelUsage`.
- `notes`: a `current` run that spawned none says it measures the same thing as `solo`. A `solo` run that spawned any says spawning was not off.

**`spawnExpected`** (each manifest ticket, `true`/`false`, required) marks a ticket large enough that a director would spawn: its merged PR had several independent files or steps. A one-script-plus-test ticket is `false`. The `current`-vs-`solo` comparison reads the `true` tickets, so one-file tickets don't dilute it. A ticket added to the manifest gets the mark judged the same way, from its merged PR's diff.

## Auth: your own token, set for one command

A live round (`run.mjs` without `--dry-run`) and the canary refuse to start without `CLAUDE_CODE_OAUTH_TOKEN`. Create a token once with `claude setup-token`. Then run each cleared round from your own PowerShell, with the token set there only:

```powershell
$env:CLAUDE_CODE_OAUTH_TOKEN = Read-Host; node scripts/ab/run.mjs --only <ticket> --arm <bare|current|solo> --run <n>
```

The variable lasts until that window closes (`Remove-Item Env:CLAUDE_CODE_OAUTH_TOKEN` clears it sooner). Don't set it as a persistent user env var: every Claude Code session would then run on that token. The director never holds it, and the runner never copies your login (`.credentials.json`), because a refresh inside a copy can revoke the live one.

Only the `claude` process gets the token; the gates run model-written code without it. Inside the session, Claude Code 2.1.301 keeps it out of its children: a zero-cost probe (local API stub) found it in neither a SessionStart hook's env nor a Bash tool child's, with no extra setting. The documented `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` ([env vars](https://code.claude.com/docs/en/env-vars), "What the subprocess environment scrub removes") adds nothing for the token and also hides `CLAUDE_CONFIG_DIR` from hooks and Bash, which the live harness doesn't, so the runner doesn't set it. If the session prints the token anyway, every copy in the results dir and in the round's transcripts is replaced with `<CLAUDE_CODE_OAUTH_TOKEN>`. The final message is redacted before `result.json` is written, and `tokenRedactions` counts the files. However the round ends, a failed capture included, that redaction runs and the round dir is removed (`--keep` prints its `Remove-Item` line instead). A file the redaction can't read or write doesn't stop it: every other file is redacted, the round is still removed or named, and the run fails naming that file, which may still hold the token. Under `--keep`, round files outside `.claude/projects/` aren't redacted. The canary removes its round the same way, a round that fails to build included.

## Isolation and contamination

HOME, USERPROFILE, HOMEDRIVE+HOMEPATH, APPDATA, LOCALAPPDATA, TEMP, TMP and TMPDIR all point into the round dir, for the session and the gates. The round dir is removed when the round ends; `--keep` retains it and prints the `Remove-Item` line. Git can't reach the network (every network transport is off; the file transport stays because claude-config's own tests clone local repos).

Git Bash's `/tmp` is the one way back to the real temp, and the round can't close it. msys mounts `/tmp` at the real `%TEMP%` (its `usertemp` mount) whatever TEMP the round sets: under the round env, `cygpath -w /tmp` still answers the real temp, and the session's `$TEMP` reads as `/tmp/ab/<round id>/tmp`. A remap is out, because `mount` writes the mount table that every Git Bash of the user shares. A probe on 2026-10-19 mounted a test point in one bash, and a freshly spawned bash saw it. Remapping `/tmp` for a round would move it for every other session too. A private msys copy, with its own mount table, is untested. So the scan watches `/tmp` instead.

The scan reads the transcripts, the lines the diff adds (hunk by hunk; binary hunks aren't scanned), and each gate log. It looks for the real workspace, config dir, global `~/.claude.json` and its `.backup` copy, and temp dir in raw, JSON-escaped, double-escaped, forward-slash and git-bash spellings, plus git-bash's `/tmp` for the temp dir. A path ends at a separator, a quote, a delimiter, a `:` (so `PATH=/c/Users/<you>/code:$PATH` names the workspace) or dots before any of those or the end (`code.\x` is `code\x` on Windows); `code2`, `code.bak` and `.claude.json` are not `code` or `.claude`. The round itself, which sits under the real temp, is masked out in each spelling, its `/tmp/ab/<round id>` alias included.

The transcripts are split by what the session wrote and what it was served. The session wrote every tool call's input: the Bash command, a `file_path`, a pattern. A hit there always flags, as does a hit in the diff's added lines, because spelling the path in a command is the reach. The content an Edit, Write or MultiEdit wrote (`old_string`, `new_string`, `content`) is its own source, `edit content`, read a line at a time: a hit is explained when its whole line is verbatim a line of the checkout at the parent, LF or CRLF (user decision, 2026-10-19). Keeping the live-hook line of `hooks/README.md` reaches nothing; a new line that spells the path flags, and so does a piece of a tree line, because the tree spells the live repo path inside longer lines. The round served the rest: tool results, loaded instructions, hook output, the model's prose, and the gate logs. A hit in that part is explained when the round's own tree spells it, in the checkout at the parent or the harness at its commit. Reading `hooks/README.md`, which names the live hook paths, reaches nothing, but `cat`-ing one of those paths flags. Bare `/tmp` in served text is explained too, because Claude Code's own environment note names it. For served text, "the tree spells it" means the match is a substring of some line there (`git grep -F`), not that it names a file in the tree. Explained hits are recorded under `contaminationExplained`. Any other match goes in `contamination` (source `tool inputs`, `edit content`, `transcripts`, `diff.patch` or `gate-<name>.log`), and `grade.mjs` excludes that run. A packet that still identifies its arm after anonymizing is held, and the other runs still get theirs. The grade summary counts excluded and held runs per arm; `blind-key.json` lists each with its reason.

The scan cannot see:
- a reach through the Windows known-folder API, which ignores env (Rust `dirs::home_dir`, .NET `GetFolderPath`) and returns the real profile;
- a relative path that walks out of the round, or a path built at run time from parts;
- an obfuscated spelling of a path: `/./tmp`, `/usr/../tmp`, `<round>/../other` (the last is masked as the round);
- a read whose path never appears in any output.

A clean scan means no reach showed up, not that there was none.

## Known deviations

- **No memory.** No arm starts with auto-memory (user decision, 2026-10-16). The live harness has memory.
- **Solo still reads the dispatch rules.** The harness CLAUDE.md chain tells the session to dispatch agents, and in `solo` it can't. That is the arm: the harness, minus what its multi-agent rules buy.
- **claude-config-124 prompts with its original body.** `tickets/claude-config-124.md` is the issue as filed at 02:35Z on 2026-10-09, not the body `gh` fetches today (user decision, 2026-10-19). The body was edited at 03:26Z, four minutes after the parent commit and before the fix commit, to spell out the fix's implementation choices. Every other ticket is its body as fetched.
- **Hooks approximate the parent harness (m1).** The current and solo arms' hooks come from the live `settings.json` wiring, rewritten to the harness checkout and dropped where that commit lacks the script. A hook wired later whose script already existed at the parent still runs. A hook wired at the parent but unwired since does not.
- **Canary auth.** `claude auth status` reports `loggedIn` for any token that is set, valid or not, so the canary proves the token is present, not that it works.
- **`--safe-mode` and settings.** Permission rules still apply under `--safe-mode`: the [CLI reference](https://code.claude.com/docs/en/cli-reference) says "permissions work normally". The docs don't say whether `settings.env` applies, and round 1 (claude-config-240 bare r1) never exercised it. If it doesn't, the bare arm runs without the live settings' env vars, which fits "bare".
- **Spend cap.** `--max-budget-usd` is twice the ticket's prior estimate, the same in every arm. The printed estimate learns from measured runs, but the cap doesn't, so one arm's spend never caps the other's (#288).

## Grading twice, and the results (#375)

`grade.mjs` writes each gradable run three ways, each under its own salted id, so two copies of a run can't be matched by id:

- `packets/` for the first grader.
- `packets-second/` for a second, separate grader.
- `packets-user/` for your blind sample: 10 runs (all of them when fewer exist), spread as evenly across arms as the runs allow, picked by the salt. A re-run keeps that pick, so a packet you've graded never moves.

Give each slot's packets to its own fresh grader, and never one grader two slots of the same run. Grading is a live round: each needs your clearance, like a run.

Once the packets are graded, run `node scripts/ab/results.mjs [--pair current:bare[,solo:bare]] [--seed 1] [--iterations 10000]`. It joins `result.json`, `blind-key.json` and every `grade.json`, and writes `results.md` and `results.json` beside `runs/`. Both name the arms, so neither goes to a grader.

- **Per ticket:** one row per ticket. Each arm's cell is the median of its counted runs, with the range when they differ: Done-when pass rate, gates (as runs all green), quality, cost, turns, wall time, and input, output, cache-read and cache-write tokens. A run's pass rate is passed boxes over all boxes, averaged over the graders who graded it. Unverifiable is not a pass, and it shifts every arm alike, because the boxes are the same. Tokens are summed from the run's saved transcripts, main and subagent. Each API message counts once by id (Claude Code writes one line per content block). On round 1 (claude-config-240 bare r1) that sum matches `claude.json`'s own usage exactly.
- **Paired difference:** for each `--pair a:b` (default `current:bare`; any two arms the runs hold), each ticket gets median(a) − median(b), with a 95% interval from resampling each arm's runs. Across tickets it reports the mean of those differences, with a 95% interval from resampling tickets, and the tickets won, tied and lost from a's side. Lower wins for cost, turns, time and tokens. The bootstrap is seeded (`--seed`), so a result repeats. With one run a side, a ticket's interval is just its point.
- **Grader agreement:** Cohen's kappa on Done-when verdicts, for the two graders over every packet both graded, and for you against each grader over your sample. Quality scores are reported only when both kappas reach **0.60** and you've graded at least 10 sample packets; otherwise they're withheld, with the reason. Why kappa and not raw agreement: when most boxes pass, raw agreement is high by chance alone (two graders who each pass 90% of boxes at random agree 82% of the time). 0.60 is the floor of "substantial" agreement (Landis & Koch, 1977); below it, grader noise is as large as the arm differences this A/B can detect. Pass rates stay in the table either way, with the agreement shown beside them.
- **Runs left out or flagged, per arm:** each one is named, because dropping runs silently favours the arm that fails more.
  - Excluded (contaminated) and resultless runs count in no metric.
  - A held run has no grade, but counts in the run-side metrics (gates, cost, turns, time, tokens).
  - Timed-out and budget-capped runs count in every metric, because they are the arm's real outcome. A timed-out run has no cost or turns, since claude was killed before it reported them. Budget-capped means claude's `error_max_budget_usd`, or spend at or over the cap.
