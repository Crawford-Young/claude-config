#!/usr/bin/env bash
# setup.sh — Wire skills from this repo into ~/.claude/skills via symlinks (macOS/Linux)
# Run from the repo root: bash setup.sh

set -e

REPO="$(cd "$(dirname "$0")" && pwd)"
SKILLS_DIR="$REPO/skills"
CLAUDE_SKILLS="$HOME/.claude/skills"

mkdir -p "$CLAUDE_SKILLS"

for skill_dir in "$SKILLS_DIR"/*/; do
    name="$(basename "$skill_dir")"
    link="$CLAUDE_SKILLS/$name"

    if [ -L "$link" ]; then
        echo "Already linked: $name (skipping)"
        continue
    fi

    if [ -e "$link" ]; then
        echo "WARNING: $link exists and is not a symlink. Remove it manually first."
        continue
    fi

    ln -s "$skill_dir" "$link"
    echo "Linked: $name"
done

echo ""
echo "Done. Skills available in Claude Code immediately."
