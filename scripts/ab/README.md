# scripts/ab: the #271 A/B runner

Bare Claude Code (`--safe-mode`) against the harness at each ticket's parent, on 10 replayed claude-config tickets (`manifest.json`; harness only, user decision 2026-10-16). `run.mjs` runs one round, `grade.mjs` writes blind packets, `canary.mjs` proves what an arm loads. The headers of each script give the details.

## Auth: your own token, set for one command

A live round (`run.mjs` without `--dry-run`) and the canary refuse to start without `CLAUDE_CODE_OAUTH_TOKEN`. Create a token once with `claude setup-token`. Then run each cleared round from your own PowerShell, with the token set there only:

```powershell
$env:CLAUDE_CODE_OAUTH_TOKEN = Read-Host; node scripts/ab/run.mjs --only <ticket> --arm <bare|current> --run <n>
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

- **No memory.** Both arms start without auto-memory (user decision, 2026-10-16). The live harness has memory.
- **claude-config-124 prompts with its original body.** `tickets/claude-config-124.md` is the issue as filed at 02:35Z on 2026-10-09, not the body `gh` fetches today (user decision, 2026-10-19). The body was edited at 03:26Z, four minutes after the parent commit and before the fix commit, to spell out the fix's implementation choices. Every other ticket is its body as fetched.
- **Hooks approximate the parent harness (m1).** The current arm's hooks come from the live `settings.json` wiring, rewritten to the harness checkout and dropped where that commit lacks the script. A hook wired later whose script already existed at the parent still runs. A hook wired at the parent but unwired since does not.
- **Canary auth.** `claude auth status` reports `loggedIn` for any token that is set, valid or not, so the canary proves the token is present, not that it works.
- **`--safe-mode` and settings.** Permission rules still apply under `--safe-mode`: the [CLI reference](https://code.claude.com/docs/en/cli-reference) says "permissions work normally". The docs don't say whether `settings.env` applies, and round 1 (claude-config-240 bare r1) never exercised it. If it doesn't, the bare arm runs without the live settings' env vars, which fits "bare".
- **Spend cap.** `--max-budget-usd` is twice the ticket's prior estimate, the same in both arms. The printed estimate learns from measured runs, but the cap doesn't, so one arm's spend never caps the other's (#288).
