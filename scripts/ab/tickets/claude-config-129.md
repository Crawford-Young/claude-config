## Goal
The `import.meta.url === pathToFileURL(process.argv[1]).href` main-guard, used in 9 hooks/scripts (`grep -n "pathToFileURL(process.argv" hooks/*.mjs scripts/*.mjs`), turns the script into a silent no-op when it is invoked through a junction or symlink. It exits with rc 0 and prints nothing, so a gate runner can look green when nothing ran.

Evidence (#123 opus review, 2026-10-08): with a scratch junction `mklink /J j-scripts <repo>\scripts`, `node j-scripts/qa.mjs <repo> --list` printed nothing and exited with rc 0. With `--preserve-symlinks-main` it listed all 3 gates. Today's invocation paths are unaffected: `~/code/claude-config` is a real directory, and only `~/.claude/skills/*` and `~/.claude/agents` are junctions.

## Done when
- [ ] The guard compares realpaths (`realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])`) via one shared helper, used by all 9 call sites
- [ ] A test invokes a script through a junction/symlink and sees it run

## Out of scope
- Adding a scripts junction
