# Hooks

Cross-platform Node hooks (2026-08 restructure — the old PowerShell set is in
git history). A rule that must hold every time lives here or in a deny rule,
never as CLAUDE.md prose. **Fail-open is the default**: errors append to
`~/.claude/hook-errors.log` and exit 0 — check that log first when a hook
seems silent. **Guards opt into fail-closed** (`bash-guard.mjs`,
`agent-model-guard.mjs`, `pre-model-switch.mjs`, `browser-gate.mjs`, via `run(..., { failClosed:
true })`): a fail-open guard failure is silent and unbounded (a crashed
`bash-guard` waves through `git add -A`; a crashed `agent-model-guard` waves
through an unclearanced usage-billed dispatch), while a fail-closed failure
is loud, immediate, and recoverable — `bash-guard` checks the file tools
(Write/Edit) fail-OPEN, so a crashed check can never lock anyone in. A
payload it can't parse (malformed JSON) still fails closed, file tools
included, since nothing was checked.

| Script | Event (matcher) | Does |
|---|---|---|
| `bash-guard.mjs` | PreToolUse (`Bash\|PowerShell\|Write\|Edit\|MultiEdit\|NotebookEdit`) | Blocks: `git add -A/--all` in any flag order; staging/committing `.env` files (`.env.example` allowed); gate commands (by command word, incl. `cargo test/clippy/fmt --check` and `just` gate recipes) piped onward; PS `Set-Content`/`Out-File`/`Add-Content` and the `sc`/`ac` aliases (mojibake); `git commit` on main/master in code repos (docs repo, worktrees, and a repo with no commits yet exempt); branch switches on the claude-config main checkout; `git push`/`gh pr create`/`gh pr merge` without an approving AskUserQuestion answer or typed user prompt in the transcript (`git push --dry-run` and remote branch deletes — `--delete`/`-d`, all-`:branch` refspecs — exempt; more than one gated verb in one command is blocked unspent); headed Playwright (`--headed`/`--ui`/`--debug`, `codegen`, `show-report`, `show-trace`, `open`) without browser consent (same rule as `browser-gate.mjs`); a write into a session transcript (`~/.claude/projects/**/*.jsonl`, auto-memory dirs exempt) or a gate state file (`push-gate-approvals.json`, `browser-gate-sessions.json`, `fable-clearance.json`) by redirect, tee, cp/mv (a copy into a dir judged under the source's name), ln, dd, sed/perl -i, truncate, curl/wget -o, PowerShell item cmdlets, a `find -exec`/`xargs` payload, inline interpreter code (`node -e`, `python -c`, heredoc-fed, `[IO.File]`) or Write/Edit, or a delete/move-away of a gate state file (rm, Remove-Item, `find -delete`, `find -exec`/`-execdir`/`-ok` rm or mv of what its `-name`/`-iname`/`-path` names, a pipeline-fed item cmdlet; it forgets single-use spends), since the push and browser gates trust those files (#190, #214; a PowerShell `if`/`elseif`/`while` condition is read as a command, so a gated verb inside one is gated; every rule matches a command by name, its basename less `.exe` in any case (`C:/…/rm.exe`, `RM`), read through `sudo`/`doas`/`setsid`/`nohup`/`env`/`nice`/`timeout`/`ionice`/`stdbuf` and their options, so `timeout 60 git push` is gated (#239); static, so best-effort — a script file is out of sight; the file tools fail open). |
| `browser-gate.mjs` | PreToolUse (`mcp__claude-in-chrome__.*`) | A visible browser needs consent: the latest AskUserQuestion answer must match `/\b(browser\|chrome\|launch\|playwright\|headed)\b/i` without the push gate's refusal words. Granted **per session** — `session_id` recorded in `~/.claude/browser-gate-sessions.json` (`CLAUDE_BROWSER_GATE_STATE` overrides), later calls pass. bash-guard keeps the model from writing that file or the transcript (#190). `tabs_context_mcp` / `list_connected_browsers` are never gated. Shared logic (`browserGateReason`, `latestAnswer`) lives in `_hooklib.mjs`. Fails closed. |
| `agent-model-guard.mjs` | PreToolUse (`Agent`) | A model-omitted dispatch on a frontmatter-less type gets `model: sonnet` via `updatedInput` (with `permissionDecision: allow`, which is the only documented pairing; ledger line `FILL`) when the session model is known and not billed. Otherwise it blocks (#74). Also blocks `fable\|mythos` dispatches without a live clearance marker; blocks forks on a live (or undeterminable) fable/mythos session. Ledger: `~/.claude/fable-dispatch.log`. Fails closed. |
| `fable-clearance-grant.mjs` | UserPromptSubmit | `FABLE OK` in the user's own prompt writes the single-use 30-min marker the Agent guard consumes. Speed bump + audit trail, not a hard gate. |
| `pre-model-switch.mjs` | PreModelSwitch | Blocks a `/model` switch **to** fable/mythos without a live `FABLE OK` marker (exit 2), consuming the same single-use 30-minute marker as the Agent guard. Switching away is never gated and never spends clearance. Ledger: `~/.claude/fable-dispatch.log`. Fails closed. |
| `post-model-switch.mjs` | PostModelSwitch | Records which model each session is on to `~/.claude/current-model.json`, keyed by `session_id`, newest 50 kept. Not a gate — it is the data `agent-model-guard.mjs` reads to catch a fork on a live fable session. Fires on Claude Code's own switches too (e.g. session resume), which is why records are never expired by age. |
| `context-gauge.mjs` | UserPromptSubmit, PostToolUse | Reads the live context size from the transcript and forces a deliberate checkpoint before the session gets costly. Bands are **absolute tokens** — note at 150k (stop at the next green commit), louder at 200k (checkpoint, then the continuation skill), **blocks at 250k** on UserPromptSubmit; a known window only floors the block (`min(250k, 0.94 × window)`). PostToolUse emits the same notes as `additionalContext` (a block is announced once, never enforced there; subagent calls skipped); both triggers share one state file so each band fires once per session, decided under a `withClaim` lease so parallel calls crossing a band together announce it once. Escapes: any `/`-prefixed prompt, or `CONTEXT OK`. Bands re-arm when context drops back under the nudge line. Each state write sweeps week-old files (dead sessions and their claim/temp sidecars) from the state dir. Tune per band with `CLAUDE_CTX_NUDGE` / `CLAUDE_CTX_WARN` / `CLAUDE_CTX_BLOCK`, or the floor with `CLAUDE_CTX_WINDOW`. |
| `stop-reflect-gate.mjs` | Stop | After a successful `gh pr merge` (Bash or PowerShell, parsed by `bash-guard.mjs`, so `gh -R x pr merge` counts; `--auto` only queues and doesn't) in the session's transcript, blocks ONCE per merge with "prompt the user to run reflect". Handled tool_use ids are a set (newest 200) in `~/.claude/stop-reflect-gate.json`, so parallel sessions don't re-fire each other; retries and later turn ends pass. A merge that precedes a reflect `SKILL.md` read (Read tool, or a Bash/PowerShell command such as `cat`/`Get-Content` naming it; or reflect Skill call, or a user-typed `/reflect`) is marked handled without blocking; a merge after a reflect always gets its reminder, even within the hour, and the reminder lets the model dismiss it if the merge is reflect's own landing PR (#140). Reflect is prompted, never forced. Continuation gate (#122): it applies once reflect has run for the newest merge (the read came after it, or after the previous merge with no continuation ask in between: then it is reflect's own landing PR) and a genuine human reply (a typed message or an AskUserQuestion answer) followed the read. A turn whose closing text (the Stop payload's `last_assistant_message`, else the transcript) asks the user passes: a line outside ``` or ~~~ fences ends in `?`, or a closing action item starts Approve / Decide / Pick / Choose / Confirm / Tell me / Say. So neither a mid-dialogue pause nor a typed later one (commit approval, say; #199) spends the block. Nor does a wait on a background task, a teammate or a SendMessage reply (#206, #227): it passes until the task or teammate reports or is stopped, or a process exit or resume/fork ends it (#243). Then the next Stop blocks once per merge until an AskUserQuestion after both the reflect read and the merge has an option labelled fresh session (or one leading with clear, the older wording) plus another leading with continue — the labels `skills/continuation/SKILL.md` names; question text and descriptions don't count, so a reflect ask such as "File a fresh debt issue, or continue without one?" doesn't pass (#178); handled merges are a separate `cont` set in the same state file. |
| `session-start.mjs` | SessionStart | Emits the skill index (`skills/INDEX.md`) on every source, then open `in-progress` issues across owner Crawford-Young (one `gh search issues` call, at most 10, 3 s cap, silent on failure; `SESSION_START_GH` stubs it in tests); after a compaction adds the re-orientation reminder (domain CLAUDE.md reload). |
| `active-repo.mjs` | PostToolUse (`Write\|Edit\|MultiEdit\|NotebookEdit`) | Records the git checkout of the edited file as `{ top, ts }` in `~/.claude/active-repo/<session_id>.json` (`CLAUDE_ACTIVE_REPO_DIR` overrides), so the statusline names the repo actually being edited, worktrees included, rather than the launch dir. Toplevel only — the statusline reads branch and worktree from `.git` at render. Prunes records older than a week. Never blocks (#77). |
| `notification-toast.ps1` | Notification | Windows WinRT toast (WezTerm has no native notifications). Stays PowerShell — Windows-only integration. |
| `inline-edit-nudge.mjs` | PostToolUse (`Edit\|Write\|NotebookEdit`) | Main session only (a hook input with `agent_id` is a subagent call and is skipped). When 6 distinct files (files under the OS temp dir, such as scratchpad and commit/PR drafts, excluded, as are edits whose tool_result errored) have been edited since the last Agent dispatch (or session start), emits one `additionalContext` reminder to dispatch multi-file work; once per run, a new dispatch re-arms it. Reads the transcript backward only to the last dispatch; fired runs are kept in `~/.claude/inline-edit-nudge.json` (`CLAUDE_INLINE_NUDGE_STATE` overrides), with a `<state>.lock.<epoch>` claim sidecar (_hooklib `withClaim`, a 5 s lease: a parallel hook that finds it held stays silent and retries on its next edit; a crash-left one stops blocking after two leases, never broken) and an atomic-write `<state>.<pid>.tmp`. N=6 is the median run in the #99 baseline. Never blocks. |

## bash-guard details

**Commands, not text** — the git rules (1, 2, 5, 6), the gate-pipe rule (3),
the cmdlet rule (4) and the push gate (8) read parsed commands, so quoted text
never trips them: `grep -rn "git add -A"`, `grep -n "Set-Content"` and
`npm view vitest | tail` pass, while `bash -c "git add -A"` still blocks. Rule 3
blocks a gate (`pnpm test`, `node --test`, `just check`, `cargo clippy` …) with
any command after it in its pipeline — grep and tee mask the exit code too.
The billed-launch rule (7) still matches raw text, so a command that only
*mentions* it can be blocked. Workaround: Write the content to a file, then
run the file.

**Substitutions are commands (#92)** — every body the shell runs is parsed as
a command: `` `…` ``, `$(…)`, `<(…)`, bare or inside double quotes, a
double-quoted `-m` payload, or an unquoted-delimiter heredoc (`<<EOF`). So
`node -e "x = \`gh pr merge 5\`"` is a gated merge. Single-quoted text,
escaped backticks and `<<'EOF'` bodies stay literal. A heredoc fed to
node/python/deno/bun is that language's code, not shell, and is read as data.

**Nesting is bounded (#167)** — blocks, groups, substitutions and shell
strings are followed at most 100 levels deep. Each level re-reads its body, so
a deeper command would cost quadratic time and overflow the stack: it is
blocked with its own reason instead of a guard crash.

**Guard scoping** — three rules about *what a rule is allowed to read*, each one a
fixed false verdict; change them only with a test:

- Quoted `-m`/`--message` payloads are stripped first. A commit message is prose:
  `git commit -m "handle .env loading"` stages nothing and must not block.
- Flag rules are scanned **per clause**, so `git add -p a.ts && grep -A 3 x a.ts`
  is not a `git add -A`.
- The branch rules judge each **git call** — a clause whose command word is
  `git` (quoted text and `echo "git commit"` are not calls; `bash -c "…"` is
  parsed) — in the repo it runs in: the payload cwd walked through every
  `cd`/`Set-Location`/`pushd`/`popd` clause **before that call**, then `-C`. The
  workspace root is not itself a repo, so `cd <repo> && git commit` is the shape
  they must see, and `cd a; git status; cd docs && git commit` commits in docs.
  pushd stacks are modelled (`-n` pushes without moving; a bare `pushd` on a
  non-empty stack makes the dir unknown, since bash swaps but PowerShell's
  alias pushes and stays; `+N`/`-N` makes the dir unknown;
  `Push-Location`/`Pop-Location -StackName s` use stack `s`). On Windows a Git
  Bash `/c/…` target is read as `C:/…`. A target that still holds a variable
  after `$HOME`/`${HOME}`/`$env:HOME`/`$env:USERPROFILE`/`$PWD`/`~` expand
  (`cd $d`, `Set-Location $_.FullName`, `cd "$(…)"`), `cd -`, a pop with no
  known dir, or a relative `-C` from an unknown dir makes the repo unknown until
  a `cd` to an absolute, `~`/`$HOME` or bare (home) target, a popd back to a
  known dir, or an absolute `git -C`. A commit there is blocked, so commit with
  a literal path or `git -C <literal path>` (#163). A bare literal assignment
  earlier in the command resolves its name (`W=…; cd "$W"`, `export`/`declare`/
  `local`/`readonly W=…`, `$W = '…'`; bash names case-sensitive, PowerShell's
  not; an `&&` chain keeps it; a bare `export W`/`readonly W`/`declare -x W`
  keeps its value). A prefix one (`W=x git -C $W …`) doesn't, and these leave
  the name unknown: a substitution or unresolved value, `+=`, a flag beside a
  `W=` (`declare -r W=…`), a bare `local W`, `unset`/`read`/`mapfile`, a
  `for` loop var, `$W.Member`/`$W[0]`, and an
  assignment in a loop, subshell, pipeline, background job, if/case, block
  body or after `||`. A switch or restore in an unknown dir is not judged.
- **Push/PR approval (rule 8)** — `git push` (`-C` composes the same as the
  branch rules; `--dry-run` and remote branch deletes are exempt), `gh pr create` and `gh pr merge` are
  parsed by command word, same as `git`. Approval comes from the transcript:
  the hook walks `transcript_path`'s JSONL backward for two candidates — the
  latest record carrying `toolUseResult.answers` (an AskUserQuestion answer)
  and the latest prompt the user typed in an interactive session (#180:
  `origin.kind` human, `promptSource` typed/queued/suggestion_accepted, not
  meta, sidechain or compact summary; pasted blocks and system reminders
  inside it are cut). Peer and teammate messages, task notifications, tool
  results, hook feedback, scheduled wakeups and `claude -p` prompts never
  count. A prompt a model can supply as a launch argument — any record in a
  `claude --bg` session (`sessionKind`), or a process's first prompt
  (`turnPosition.promptIndex` 1, or no assistant turn before it) — never
  approves, but it still refuses: "stop" as the first prompt after
  `--resume` holds an older approval back. Newest first, the first that approves wins. An answer that doesn't
  approve blocks, as before #180, and so does a typed prompt that refuses
  (`denies()`, or stop/cancel/abort/nope/nah/later/actually). A neutral typed
  prompt ("also fix the typo") defers to the older candidate. An answer
  approves when some answer value matches
  `/\b(commit|push|pr|pull request|merge|ship|land)\b/i` and
  `denies()` in `_hooklib.mjs` doesn't refuse it: a hold word (hold, wait,
  not yet, review first) anywhere, an answer opening with "no", or a negator
  (no/not/never/don't) with an act word within the next four words. So
  "push and pr but dont know if…" approves and "don't push yet" refuses
  (#96). The browser gate uses the same `denies()`. A typed prompt is prose,
  so it approves only when every word is a ship word (`SHIP_WORDS`: acts,
  lgtm/ok/yes-style filler, it/the/and…), one is an act (push, pr, pull
  request, merge, ship, land), and there is no question mark: "lgtm push and
  pr", "ok, merge it" and "land it" approve; "PR #183 failed CI", "push it
  once I review", "Push — actually no" and task briefs don't. In a replay of
  the real typed prompts on 2026-10-13, the answer wording alone would have
  approved 11 briefs and asides, while this rule approved only the 2 real
  approvals. Nothing stops a model appending a forged line to its own
  transcript file; that has been true of the answer path since it was
  written. Each approval (keyed by its record `uuid`; an approving record
  without one blocks) is single-use per
  verb — spent from `~/.claude/push-gate-approvals.json`
  (`CLAUDE_PUSH_GATE_STATE` overrides) — so one approving answer covers
  `push` → `pr create` → `pr merge` once each, but a second push needs a
  fresh approval. A missing/unreadable transcript or no approving record
  blocks with a message telling the model to ask via AskUserQuestion and
  retry. A non-gated command never reads the transcript.

## settings.json wiring

Every hook uses **exec form**: `command` is the program and `args` is an array.
Claude Code then spawns it directly. A command *string* on Windows runs through
`Git\bin\bash.exe -c`, which starts a second `usr\bin\bash.exe` and costs about 22 ms
per hook firing; exec form is 38 ms vs 60 ms p50 for bash-guard
(measured 2026-10-08, #78). Exec form has no shell quoting, so the paths are
plain forward-slash absolute paths. Adjust the repo path per machine:

```json
"hooks": {
  "PreToolUse": [
    { "matcher": "Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit", "hooks": [{ "type": "command", "command": "node", "args": ["C:/Users/young/code/claude-config/hooks/bash-guard.mjs"] }] },
    { "matcher": "Agent", "hooks": [{ "type": "command", "command": "node", "args": ["C:/Users/young/code/claude-config/hooks/agent-model-guard.mjs"] }] },
    { "matcher": "mcp__claude-in-chrome__.*", "hooks": [{ "type": "command", "command": "node", "args": ["C:/Users/young/code/claude-config/hooks/browser-gate.mjs"] }] }
  ],
  "UserPromptSubmit": [ { "hooks": [
    { "type": "command", "command": "node", "args": ["C:/Users/young/code/claude-config/hooks/fable-clearance-grant.mjs"] },
    { "type": "command", "command": "node", "args": ["C:/Users/young/code/claude-config/hooks/context-gauge.mjs"] }
  ] } ],
  "PostToolUse": [ { "matcher": "Write|Edit|MultiEdit|NotebookEdit", "hooks": [{ "type": "command", "command": "node", "args": ["C:/Users/young/code/claude-config/hooks/active-repo.mjs"] }] },
    { "matcher": "Edit|Write|NotebookEdit", "hooks": [{ "type": "command", "command": "node", "args": ["C:/Users/young/code/claude-config/hooks/inline-edit-nudge.mjs"] }] },
    { "hooks": [{ "type": "command", "command": "node", "args": ["C:/Users/young/code/claude-config/hooks/context-gauge.mjs"] }] } ],
  "Stop": [ { "hooks": [{ "type": "command", "command": "node", "args": ["C:/Users/young/code/claude-config/hooks/stop-reflect-gate.mjs"] }] } ],
  "SessionStart": [ { "hooks": [{ "type": "command", "command": "node", "args": ["C:/Users/young/code/claude-config/hooks/session-start.mjs"] }] } ],
  "Notification": [ { "hooks": [{ "type": "command", "command": "powershell", "args": ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:/Users/young/code/claude-config/hooks/notification-toast.ps1"] }] } ],
  "PreModelSwitch": [ { "hooks": [{ "type": "command", "command": "node", "args": ["C:/Users/young/code/claude-config/hooks/pre-model-switch.mjs"] }] } ],
  "PostModelSwitch": [ { "hooks": [{ "type": "command", "command": "node", "args": ["C:/Users/young/code/claude-config/hooks/post-model-switch.mjs"] }] } ]
}
```

PreModelSwitch and PostModelSwitch take no matcher. The
`statusLine` and `subagentStatusLine` commands have no exec form; they always
run through `bash -c` (wiring in `statusline/README.md`).

Keep the settings `deny` rules for `git add -A` forms — the two layers
(deny rule + guard regex) deliberately overlap; change both or neither. The
same will hold for the #190 file-tool deny rules (`Edit(~/.claude/projects/**/*.jsonl)`
and one per gate state file) beside bash-guard rule 11, once they are added to
`~/.claude/settings.json` (user-side; this repo can't see whether they are).

## Conventions

- Exit-code semantics: 0 = proceed, 2 = block (stderr is the reason), other = non-blocking error. A hook allow does NOT skip deny rules.
- Unit-test by piping JSON to stdin: `echo '{"tool_input":{"command":"git add -A"}}' | node hooks/bash-guard.mjs` — tests live in `scripts/test/`, run `node --test scripts/test/*.test.mjs`.
- Hook wiring reloads live — no session restart needed to verify new wiring.
- Env overrides for tests/remotes: `CLAUDE_WORKSPACE_ROOT`, `CLAUDE_CONFIG_REPO`.
- A hook that a test imports must guard its `run()` behind an `isMain(import.meta.url)` check (`scripts/lib.mjs`, realpath-based so junctions work) — an unguarded import blocks forever reading stdin.

## Context-gauge thresholds

The bands are **absolute tokens**, independent of the window: **150k** nudge
(stop at the next green commit), **200k** warn (checkpoint: commit with the
resume block, comment blockers on the issue, then run the continuation skill),
**250k** block (UserPromptSubmit exit 2). Per-band overrides: `CLAUDE_CTX_NUDGE`
/ `CLAUDE_CTX_WARN` / `CLAUDE_CTX_BLOCK`.

Why: cost and quality. The user works at a ~200k max per session, and
$/request rises from $0.083 (100-200k) to $0.105-0.144 above 200k. The old
fractions of a 1M window (400k / 700k / 940k) sat far above that, so the gauge
was silent where it mattered. Scan of 30 days, 2026-10-08: of 27 sessions that
peaked above 150k, **1** nudge fired, **0** warns, and **15** crossed 200k
silently.

The window is only a **floor**: when one is known, `blockAt = min(250k, 0.94 ×
window)`, and warn and nudge are clamped to never exceed it, so the bands stay
ordered on a small window (warn and nudge default to 0.8 and 0.6 of the hard stop when that is below 250k) and the hard stop still lands before it fills. An explicit `CLAUDE_CTX_BLOCK` overrides the floor. A
window is not required — with none, the absolute bands stand. Resolution order:
`CLAUDE_CTX_WINDOW`, then `contextGaugeWindow` in `settings.json`, then the
newest `context_window_size` in `~/.claude/usage-history/<YYYY-MM>.jsonl`
(written by `statusline/statusline.mjs`; honours `CLAUDE_USAGE_HISTORY_DIR`).
Resolving the history source reads a 128 KB tail, so it is consulted lazily:
only once the context has reached a band line (so a window under ~160k known only from history is not floored until 150k). Messages state tokens and name
the window only when the floor applied.

PostToolUse: the same script runs on PostToolUse so a long autonomous turn sees
the gauge. It emits `hookSpecificOutput.additionalContext` JSON with exit 0 (a
tool that already ran can't be blocked, so the block band is announced once as
context), and skips subagent calls (`agent_id`). Both triggers share
`~/.claude/context-gauge/<sid>.json`, so a band announced by one is not
repeated by the other; UserPromptSubmit still blocks at 250k even if
PostToolUse already announced it. Overhead per PostToolUse call, p50 of 40
spawns on a 300 KB transcript tail: 32.5 ms below the nudge line, 33.0 ms above
it, versus 26.3 ms for a bare `node -e ""` (measured 2026-10-08, #122).
