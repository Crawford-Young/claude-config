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

# --- Workspace standards (CLAUDE.md + reference docs) ---
CODE="$HOME/code"
WS="$REPO/workspace"
mkdir -p "$CODE/docs"

link_item() {
    local link="$1" target="$2"
    if [ -L "$link" ]; then
        echo "Already linked: $link (skipping)"
        return
    fi
    if [ -e "$link" ]; then
        echo "WARNING: $link exists and is not a symlink. Remove it manually first."
        return
    fi
    ln -s "$target" "$link"
    echo "Linked: $link"
}

link_item "$CODE/CLAUDE.md" "$WS/CLAUDE.md"
for f in "$WS"/docs/*.md; do
    link_item "$CODE/docs/$(basename "$f")" "$f"
done
for d in "$WS"/docs/*/; do
    link_item "$CODE/docs/$(basename "$d")" "${d%/}"
done

echo ""
echo "Done. Skills and workspace standards available immediately."
