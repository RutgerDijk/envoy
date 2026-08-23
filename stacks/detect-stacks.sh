#!/bin/bash
# Stack Auto-Detection Script
# Detects which technology stacks are present in the current project
#
# Single source of truth (#78 task-8): the probe rules, exclusion flags,
# and per-rule files: lists all live in lib/stack-loader.js STACK_RULES.
# This script delegates to `node lib/stack-loader.js` instead of carrying
# its own copy of the detection logic, so it can never drift from it.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
STACK_LOADER="$PLUGIN_DIR/lib/stack-loader.js"

# Colors for output
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo "Detecting project stacks..."
echo ""

echo "Detected stacks:"
echo ""
node "$STACK_LOADER" . --checklist 2>/dev/null | while IFS= read -r line; do
    name="${line#✓ }"
    echo -e "  ${GREEN}✓${NC} $name"
done
echo ""

# Output as JSON for programmatic use
if [ "$1" = "--json" ]; then
    JSON=$(node "$STACK_LOADER" . --json 2>/dev/null)
    node -e '
      const arr = JSON.parse(process.argv[1]);
      const lines = ["["];
      arr.forEach((s, i) => {
        lines.push("  \"" + s + "\"" + (i < arr.length - 1 ? "," : ""));
      });
      lines.push("]");
      console.log(lines.join("\n"));
    ' "$JSON"
fi

# Output stack profile paths
if [ "$1" = "--paths" ]; then
    echo "Stack profiles:"
    for stack in $(node "$STACK_LOADER" . 2>/dev/null); do
        profile_path="${SCRIPT_DIR}/${stack}.md"
        if [ -f "$profile_path" ]; then
            echo "  $profile_path"
        fi
    done
fi
