#!/usr/bin/env bash
set -euo pipefail

# Envoy Copilot Adapter — Install Script
# Copies (or symlinks) Envoy Copilot templates into your project's .github/ directory.
#
# Usage: ./install.sh [--symlink] [--envoy-dir <path>]
#
# Options:
#   --symlink           Create symlinks instead of copying files (easier to keep up to date)
#   --envoy-dir <path>  Path to the envoy directory (default: auto-detect)
#
# Run from your project root:
#   /path/to/envoy/adapters/copilot/install.sh

# ─── Defaults ────────────────────────────────────────────────────────────────

SYMLINK=false
PROJECT_DIR="$(pwd)"

# Resolve the directory where this script lives
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATES_DIR="$SCRIPT_DIR/templates"

# ─── Argument Parsing ─────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case $1 in
    --symlink)
      SYMLINK=true
      shift
      ;;
    --envoy-dir)
      TEMPLATES_DIR="$2/adapters/copilot/templates"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--symlink] [--envoy-dir <path>]"
      echo ""
      echo "Installs Envoy Copilot templates into .github/ of the current directory."
      echo "Run this from your project root."
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# ─── Validation ───────────────────────────────────────────────────────────────

if [[ ! -d "$TEMPLATES_DIR" ]]; then
  echo "❌ Templates directory not found: $TEMPLATES_DIR"
  echo "Make sure you're running this script from the envoy/adapters/copilot/ directory"
  echo "or use --envoy-dir to specify the path to the envoy directory."
  exit 1
fi

# ─── Helper Functions ─────────────────────────────────────────────────────────

install_file() {
  local src="$1"
  local dest="$2"
  local dest_dir
  dest_dir="$(dirname "$dest")"

  mkdir -p "$dest_dir"

  if [[ -e "$dest" || -L "$dest" ]]; then
    echo "  ⏭  Already exists, skipping: ${dest#"$PROJECT_DIR/"}"
    return
  fi

  if [[ "$SYMLINK" == "true" ]]; then
    ln -s "$src" "$dest"
    echo "  🔗 Symlinked: ${dest#"$PROJECT_DIR/"}"
  else
    cp "$src" "$dest"
    echo "  ✅ Copied: ${dest#"$PROJECT_DIR/"}"
  fi
}

install_dir() {
  local src_dir="$1"
  local dest_dir="$2"
  local extension="${3:-}"

  if [[ ! -d "$src_dir" ]]; then
    return
  fi

  for src_file in "$src_dir"/*; do
    [[ -f "$src_file" ]] || continue
    local filename
    filename="$(basename "$src_file")"
    # Filter by extension if specified
    if [[ -n "$extension" && "$filename" != *"$extension" ]]; then
      continue
    fi
    install_file "$src_file" "$dest_dir/$filename"
  done
}

# ─── Install ──────────────────────────────────────────────────────────────────

echo ""
echo "Installing Envoy Copilot adapter into: $PROJECT_DIR"
echo "Templates from: $TEMPLATES_DIR"
echo "Mode: $( [[ "$SYMLINK" == "true" ]] && echo "symlinks" || echo "copy" )"
echo ""

GITHUB_DIR="$PROJECT_DIR/.github"

# 1. Core instructions
echo "📄 Core instructions"
install_file \
  "$TEMPLATES_DIR/copilot-instructions.md" \
  "$GITHUB_DIR/copilot-instructions.md"

# 2. Prompt files (slash commands)
echo ""
echo "⚡ Prompt files (.github/prompts/)"
install_dir \
  "$TEMPLATES_DIR/prompts" \
  "$GITHUB_DIR/prompts" \
  ".prompt.md"

# 3. Stack instruction files
echo ""
echo "📚 Stack instructions (.github/instructions/)"
install_dir \
  "$TEMPLATES_DIR/instructions" \
  "$GITHUB_DIR/instructions" \
  ".instructions.md"

# 4. Agent definition files
echo ""
echo "🤖 Agent definitions (.github/agents/)"
install_dir \
  "$TEMPLATES_DIR/agents" \
  "$GITHUB_DIR/agents" \
  ".agent.md"

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "─────────────────────────────────────────────────"
echo "✅ Envoy Copilot adapter installed"
echo ""
echo "What was installed:"
echo "  .github/copilot-instructions.md    — Always-active workflow instructions"
echo "  .github/prompts/*.prompt.md        — Slash commands (/brainstorm, /pickup, etc.)"
echo "  .github/instructions/*.instructions.md — Stack-specific guidance (auto-activates by file type)"
echo "  .github/agents/*.agent.md          — Specialized agents (code-reviewer, security-auditor, test-writer)"
echo ""
echo "Next steps:"
echo "  1. Commit the .github/ directory to your repository"
echo "  2. Open VS Code with GitHub Copilot Chat"
echo "  3. Try: /brainstorm — to start designing a new feature"
echo "  4. Read: envoy/adapters/copilot/INSTALL.md for full usage guide"
echo ""
