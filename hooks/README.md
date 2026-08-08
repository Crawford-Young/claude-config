# Hooks

Harness enforcement scripts, wired in `~/.claude/settings.json` (2026-07-27, harness-upgrades-w1).

| Script | Event | Does |
|---|---|---|
| `pretooluse-guard.ps1` | PreToolUse (`Bash\|PowerShell`) | Blocks 3 CLAUDE.md incident classes: PS `Set-Content`/`Out-File`/`Add-Content` on text files, gate commands piped to `tail`/`head`, `git add -A`/`--all`. Block = exit 2 + stderr reason. Plus one **warn-only** rule: a claude-config commit runs `verify-relocation.mjs` and reports a red gate without blocking. |
| `agent-model-guard.ps1` | PreToolUse (`Agent`) | Blocks Agent dispatches that omit `model:` on a type with no frontmatter model (would silently inherit the fable session default — issue #3/G4). Frontmatter-model types pass; plugin-namespaced (`x:y`) and def-less built-ins always require explicit `model:`. Block = exit 2 + stderr reason; fail-open on script error. |
| `precompact-archive.ps1` | PreCompact | Copies transcript to `~/.claude/compact-archives/<sid>-<stamp>.jsonl` before every compaction. |
| `subagentstop-log.ps1` | SubagentStop | Appends line to `~/.claude/subagent-stops.log`. |
| `notification-toast.ps1` | Notification | Windows toast via WinRT (WezTerm gets no native desktop notifications — G53). Fail-open; Notification is a non-blockable event (exit 2 only surfaces stderr). `subagent-stops.log` self-trims at 512KB (keeps last 200 lines, G42 2026-08-08); `hook-errors.log` stays unbounded-by-convention — manual cleanup (grows ~bytes/week). |
| `otel-receiver-spawn.ps1` | SessionStart | Lazy-spawns the local OTel receiver (`claude-config/telemetry/otel-receiver.mjs`, port 4318) when the port isn't listening — detached via `Start-Process`, survives session end. 100ms TCP probe; false-negative spawn harmless (loser exits on EADDRINUSE). Reads no stdin (payload unused). Fail-open. (OTel usage-attribution wave 2026-08-07.) |
| `sessionstart-compact-reminder.ps1` | SessionStart (compact) | Re-injects checklist-scan + marker-discipline + domain-CLAUDE.md reminders into context after every compaction (G48). Non-blockable; fail-open. |
| `stop-reflect-gate.ps1` | Stop | Hard-blocks turn end when an active checklist touched in the last 6h is all-ticked except lines containing "reflect" (G48). Exit 2 + stderr reason; NO stop_hook_active self-disarm — 8-block platform cap is the escape (user decision, P4c spec: deliberate override of this README's warn-not-block rule; the mtime window is the cross-session mitigation). Fence-aware; fail-open. Fixture override: STOP_GATE_DOCS_ROOT. |

> **git-add-A coverage is deliberately two-layer:** settings `deny` rules catch the literal prefix forms (`git add -A`, `git add --all`, PowerShell twins); the pretooluse-guard regex catches flag-order variants (`-fA`, `-Af`, embedded flags). Editing either layer alone silently narrows coverage — change both or neither. (code:permissions.md, 2026-08-08 P5 G84.)

## Rules (learned the hard way — issue log 2026-07-27)

- **Command paths: forward-slash, wrapped in escaped quotes.** Lone backslashes get stripped before execution (JSON `\\` → `\` → shell eats it); PreCompact once fired with `C:Usersyoung...` and errored. Working form:
  `powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Users/young/code/claude-config/hooks/<script>.ps1"`
- **Fail-open design.** Script errors append to `~/.claude/hook-errors.log` and exit 0 — CLAUDE.md prose rules stay the backstop. Hook seems silent? Check that log first, then suspect path mangling — fired-but-errored is indistinguishable from silent.
- **Unit-test via direct stdin pipe:** `'{"tool_input":{"command":"..."}}' | powershell -File <script>` — check exit code + stderr. Live verification only in interactive sessions.
- **`claude -p` child sessions:** settings hooks unverified there (possibly the path bug; not re-tested). Don't rely on hooks firing in headless children — use unit tests.
- **Hook wiring is NOT inert for running sessions** — settings docs say `hooks` auto-reload live, and a Stop hook wired mid-session fired post-compaction in the same session (n=1, 2026-08-08 P4c). The old "hooks snapshot at session start" claim is falsified; don't require a fresh session to live-verify new wiring.
- **Extend the guard, don't add prose-only rules** for mechanically blockable incident classes.
- **Warn instead of blocking when the check reads state the committer does not own.** The
  relocation gate audits the whole `~/code` tree, so it goes red on another session's in-flight
  edits — and with several sessions running in parallel that is the normal case, not the edge
  case. A blocking rule there would wedge commits on failures their authors did not cause.
  Blocking is right for "this command is wrong" (the three rules above); warning is right for
  "the workspace is currently in a bad state". Flip the relocation rule to `exit 2` once the
  gate is reliably green. (2026-07-28 description-audit.)
- **Self-collision when testing the guard:** a test command containing a literal trigger
  (`Set-Content`, `just check | tail`, `git add -A`) is blocked by the *live* guard before it
  can pipe anything. Split the literal across shell concatenation so the outer command does not
  match while the JSON payload still does. Being blocked this way is itself a live confirmation
  the rule fires.
