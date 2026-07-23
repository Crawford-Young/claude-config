---
name: yak-voice
description: Generate CarsickYak channel copy — YT titles/descriptions, shorts captions, stream titles, social posts — from the real-sample corpus. Use for ANY CarsickYak-facing text.
---

# yak-voice — corpus-driven CarsickYak copy

Voice lives in real accepted samples, not adjectives. Generation from voice descriptors was rejected twice ("yours feel way too forced") — this skill exists because few-shot from the user's own accepted copy is the only method that passed.

Base directory: `~/code/claude-config/skills/yak-voice/` (junction-visible at `~/.claude/skills/yak-voice/`).

## Protocol (follow in order)

1. **Input:** surface type (panel / stream title / video title / video description / shorts caption / social post) + topic (what the copy is about).
2. **Read matching `corpus/` bucket + `bans.md`.** Bucket map: panels→`corpus/panels.md`, stream+video titles→`corpus/titles.md`, descriptions→`corpus/descriptions.md`, shorts captions→`corpus/captions.md`, social posts→`corpus/social.md`. Thin/empty bucket → use nearest bucket AND say **"low confidence — cold start"** explicitly before options.
3. **Generate 2–3 options few-shot from the samples.** Match structure, register, mechanics (case, punctuation, length) of accepted samples. NEVER generate from voice adjectives ("dry", "authentic", "casual") — that is the rejected method.
4. **Bans pass:** check every option line against every `bans.md` entry. Hit → regenerate that option before presenting.
5. **Present options. User picks/edits.** Never present one finished answer. Trim-only on user edits: delete, reorder, fix mechanics — never add content words.
6. **Append the final picked text verbatim to the bucket** (with date). Then remind: commit claude-config — verify tree on `main` first (`git -C ~/code/claude-config status --short --branch`); foreign branch → defer commit, file edit persists.

## Hard rules

- Corpus files accept ONLY user-picked text. Never append a generated option the user didn't pick.
- Rejected options + user callouts → candidate `bans.md` entries, but only as concrete checkable patterns (adjective-dependent entries invalid).
- Alert messages out of scope (Twitch defaults — P3 decision).
