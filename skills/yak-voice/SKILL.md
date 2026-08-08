---
name: yak-voice
description: Generate CarsickYak channel copy — YT titles/descriptions, shorts captions, stream titles, social posts — from the real-sample corpus. Use for ANY CarsickYak-facing text.
---

# yak-voice — corpus-driven CarsickYak copy

Voice lives in real accepted samples, not adjectives. Generation from voice descriptors was rejected twice ("yours feel way too forced") — this skill exists because few-shot from the user's own accepted copy is the only method that passed.

Base directory: `~/code/claude-config/skills/yak-voice/` (junction-visible at `~/.claude/skills/yak-voice/`).

## Protocol (follow in order)

1. **Input:** surface type (panel / stream title / video title / video description / shorts caption / social post) + topic (what the copy is about).
2. **Read matching `corpus/` bucket + `bans.md` + `persona.md`.** Bucket map: panels→`corpus/panels.md`, stream+video titles→`corpus/titles.md`, descriptions→`corpus/descriptions.md`, shorts captions→`corpus/captions.md`, social posts→`corpus/social.md`, website copy→`corpus/website.md`. Thin/empty bucket → use nearest bucket AND say **"low confidence — cold start"** explicitly before options.
3. **Generate 2–3 options few-shot from the samples.** Match structure, register, mechanics (case, punctuation, length) of accepted samples. NEVER generate from voice adjectives ("dry", "authentic", "casual") — that is the rejected method.
4. **Bans pass:** check every option line against every `bans.md` entry. Hit → regenerate that option before presenting.
5. **Present options. User picks/edits.** Never present one finished answer. Trim-only on user edits: delete, reorder, fix mechanics — never add content words.
6. **Append the final picked text verbatim to the bucket** (with date). Then remind: commit claude-config via the worktree commit protocol (root CLAUDE.md §Branch Strategy — live edit on main checkout, commit via ephemeral origin/main worktree PR).

## Voice notes (evidence-backed, from accepted copy — NOT adjectives to generate from)

- **Register is literal-practical.** Lines that scan as flex are literal explanations ("leveling up for ranked is my warm up" = the warm-up phase, nothing more). Never amplify a line into swagger; user correction 2026-07-23: "im not trying to be cocky... im just explaning."
- **Personality carriers observed in accepted copy:** parentheticals ("(if I'm not outside touching grass)"), self-aware callbacks ("and yes, still gaming"), coined words ("friendslop"), inside-joke names with zero explanation ("Do the Face"). Options stripping ALL carriers read flat/vague — first acceptance round failed exactly this way (T6, 2026-07-23). Carriers come from the user's material, never invented.
- **Persona deep-dive landed 2026-07-23** → `persona.md` (raw journals/poems distilled: two registers + surface mapping, 9 concrete patterns with verbatim evidence). Read it every generation. Validated same day: first post-persona round passed clean on first presentation (user: "all three are so much better") — provisional flag lifted.

## Hard rules

- Corpus files accept ONLY user-picked text. Never append a generated option the user didn't pick.
- Rejected options + user callouts → candidate `bans.md` entries, but only as concrete checkable patterns (adjective-dependent entries invalid).
- Alert messages out of scope (Twitch defaults — P3 decision).
