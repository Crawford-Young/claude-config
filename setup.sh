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

# --- Agents (subagent defs) ---
AGENTS_DIR="$REPO/agents"
CLAUDE_AGENTS="$HOME/.claude/agents"
link_item "$CLAUDE_AGENTS" "$AGENTS_DIR"

DOMAINS="web games apps"

link_item "$CODE/CLAUDE.md" "$WS/CLAUDE.md"

# Path-scoped rules (.claude/rules) — link so ancestor rules load workspace-wide (G34)
mkdir -p "$CODE/.claude"
link_item "$CODE/.claude/rules" "$WS/.claude/rules"

# Domain standards — one CLAUDE.md symlink per domain folder
for domain in $DOMAINS; do
    mkdir -p "$CODE/$domain"
    link_item "$CODE/$domain/CLAUDE.md" "$WS/$domain/CLAUDE.md"
done

# Universal reference docs at the docs root
for f in "$WS"/docs/*.md; do
    link_item "$CODE/docs/$(basename "$f")" "$f"
done

# Domain reference docs — real directories in the docs repo, individual file symlinks inside.
# NEVER symlink the whole directory: ~/code/docs/<domain>/ also holds the docs repo's own
# project folders, and a directory link would relocate them into this repo.
for domain in $DOMAINS; do
    [ -d "$WS/docs/$domain" ] || continue
    mkdir -p "$CODE/docs/$domain"
    for f in "$WS"/docs/"$domain"/*.md; do
        [ -e "$f" ] || continue
        link_item "$CODE/docs/$domain/$(basename "$f")" "$f"
    done
done

# Cross-domain reference directories (brand) stay whole-directory links
for d in "$WS"/docs/*/; do
    name="$(basename "$d")"
    case " $DOMAINS " in *" $name "*) continue ;; esac
    link_item "$CODE/docs/$name" "${d%/}"
done

echo ""
echo "Done. Skills and workspace standards available immediately."
