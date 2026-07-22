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

if [[ "$SYMLINK" != "true" ]] && ! command -v node >/dev/null 2>&1; then
  echo "❌ node is required for the sync manifest (or use --symlink, which needs no manifest)."
  exit 1
fi

# ─── Helper Functions ─────────────────────────────────────────────────────────

# Manifest: .github/.envoy-copilot-manifest.json records the content hash of
# every file this script manages. A file whose local hash matches the manifest
# is unmodified and safe to update; a mismatch means local edits, which are
# never overwritten. Symlink installs self-update and are not manifest-tracked.

MANIFEST_FILE=""   # set after GITHUB_DIR is known
OLD_MANIFEST_TSV="$(mktemp)"
NEW_MANIFEST_TSV="$(mktemp)"
trap 'rm -f "$OLD_MANIFEST_TSV" "$NEW_MANIFEST_TSV"' EXIT

COUNT_INSTALLED=0
COUNT_UPDATED=0
COUNT_UNCHANGED=0
COUNT_ADOPTED=0
COUNT_SKIPPED_MODIFIED=0

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

load_manifest() {
  MANIFEST_FILE="$GITHUB_DIR/.envoy-copilot-manifest.json"
  if [[ -f "$MANIFEST_FILE" ]]; then
    node -e '
      const fs = require("fs");
      try {
        const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        for (const [k, v] of Object.entries(m.files || {})) console.log(k + "\t" + v);
      } catch { /* corrupt manifest: treat as absent */ }
    ' "$MANIFEST_FILE" > "$OLD_MANIFEST_TSV"
  fi
}

manifest_lookup() {
  awk -F'\t' -v k="$1" '$1 == k { print $2 }' "$OLD_MANIFEST_TSV"
}

manifest_record() {
  printf '%s\t%s\n' "$1" "$2" >> "$NEW_MANIFEST_TSV"
}

write_manifest() {
  node -e '
    const fs = require("fs");
    const files = {};
    const tsv = fs.readFileSync(process.argv[1], "utf8");
    for (const line of tsv.split("\n")) {
      if (!line) continue;
      const [key, hash] = line.split("\t");
      files[key] = hash;
    }
    fs.writeFileSync(process.argv[2], JSON.stringify({ "$schemaVersion": 1, files }, null, 2) + "\n");
  ' "$NEW_MANIFEST_TSV" "$MANIFEST_FILE"
}

install_file() {
  local src="$1"
  local dest="$2"
  local dest_dir rel_key src_hash dest_hash managed_hash
  dest_dir="$(dirname "$dest")"
  rel_key="${dest#"$GITHUB_DIR/"}"

  mkdir -p "$dest_dir"

  # Symlink mode: symlinks self-update; never rewrite or manifest-track them.
  if [[ "$SYMLINK" == "true" ]]; then
    if [[ -e "$dest" || -L "$dest" ]]; then
      echo "  ⏭  Already exists, skipping: ${dest#"$PROJECT_DIR/"}"
    else
      ln -s "$src" "$dest"
      echo "  🔗 Symlinked: ${dest#"$PROJECT_DIR/"}"
    fi
    return
  fi

  # A symlink left by a previous --symlink install already tracks the source.
  if [[ -L "$dest" ]]; then
    echo "  🔗 Symlink from a previous install, leaving: ${dest#"$PROJECT_DIR/"}"
    return
  fi

  src_hash="$(hash_file "$src")"

  if [[ ! -e "$dest" ]]; then
    cp "$src" "$dest"
    manifest_record "$rel_key" "$src_hash"
    COUNT_INSTALLED=$((COUNT_INSTALLED + 1))
    echo "  ✅ Copied: ${dest#"$PROJECT_DIR/"}"
    return
  fi

  dest_hash="$(hash_file "$dest")"
  managed_hash="$(manifest_lookup "$rel_key")"

  # A file identical to the current template is managed by definition,
  # whatever the manifest says (covers hand-copied updates, a run aborted
  # between cp and the manifest write, and pre-manifest installs).
  if [[ "$dest_hash" == "$src_hash" ]]; then
    manifest_record "$rel_key" "$src_hash"
    if [[ -z "$managed_hash" || "$managed_hash" != "$src_hash" ]]; then
      COUNT_ADOPTED=$((COUNT_ADOPTED + 1))
      echo "  ➕ Adopted as managed: ${dest#"$PROJECT_DIR/"}"
    else
      COUNT_UNCHANGED=$((COUNT_UNCHANGED + 1))
    fi
    return
  fi

  # No manifest entry and not identical to the template: user content,
  # stays untouched and untracked.
  if [[ -z "$managed_hash" ]]; then
    COUNT_SKIPPED_MODIFIED=$((COUNT_SKIPPED_MODIFIED + 1))
    echo "  ⚠️  Locally modified, skipped: ${dest#"$PROJECT_DIR/"}"
    return
  fi

  # Locally edited managed file: keep its manifest entry alive so that
  # reverting the edits makes it managed again on a later run.
  if [[ "$dest_hash" != "$managed_hash" ]]; then
    manifest_record "$rel_key" "$managed_hash"
    COUNT_SKIPPED_MODIFIED=$((COUNT_SKIPPED_MODIFIED + 1))
    echo "  ⚠️  Locally modified, skipped: ${dest#"$PROJECT_DIR/"}"
    return
  fi

  cp "$src" "$dest"
  manifest_record "$rel_key" "$src_hash"
  COUNT_UPDATED=$((COUNT_UPDATED + 1))
  echo "  ⬆️  Updated: ${dest#"$PROJECT_DIR/"}"
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
load_manifest

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

if [[ "$SYMLINK" != "true" ]]; then
  mkdir -p "$GITHUB_DIR"
  write_manifest
fi

echo ""
echo "─────────────────────────────────────────────────"
echo "✅ Envoy Copilot adapter installed"
if [[ "$SYMLINK" != "true" ]]; then
  echo ""
  echo "Sync summary: $COUNT_INSTALLED installed, $COUNT_UPDATED updated, $COUNT_UNCHANGED unchanged, $COUNT_ADOPTED adopted, $COUNT_SKIPPED_MODIFIED locally modified (skipped)"
fi
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
