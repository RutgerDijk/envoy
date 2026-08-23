#!/bin/bash
# Stack Auto-Detection Script
# Detects which technology stacks are present in the current project
#
# Single source of truth (#78 task-8): the probe rules, exclusion flags,
# and per-rule files: lists all live in lib/stack-loader.js STACK_RULES.
# This script delegates to `node lib/stack-loader.js` instead of carrying
# its own copy of the detection logic, so it can never drift from it.
#
# One node invocation per script run (#78 code-review fix M6): the sweep
# itself is the expensive part (dozens of find/grep probes), so every flag
# below is derived from a single --json call rather than re-running it.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
STACK_LOADER="$PLUGIN_DIR/lib/stack-loader.js"

# Colors for output
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo "Detecting project stacks..."
echo ""

JSON=$(node "$STACK_LOADER" . --json 2>/dev/null)

# A node failure (crash, missing binary, bad projectDir) leaves $JSON empty
# or non-JSON — degrade to an empty result set rather than letting
# JSON.parse throw an unhandled SyntaxError (#78 code-review fix M5).
if ! echo "$JSON" | node -e 'JSON.parse(require("fs").readFileSync(0, "utf8"))' >/dev/null 2>&1; then
    JSON='[]'
fi

echo "Detected stacks:"
echo ""
node -e '
  const arr = JSON.parse(process.argv[1]);
  for (const name of arr) console.log("✓ " + name);
' "$JSON" | while IFS= read -r line; do
    name="${line#✓ }"
    echo -e "  ${GREEN}✓${NC} $name"
done
echo ""

# Output as JSON for programmatic use
if [ "$1" = "--json" ]; then
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
    for stack in $(node -e 'JSON.parse(process.argv[1]).forEach(s => console.log(s))' "$JSON"); do
        profile_path="${SCRIPT_DIR}/${stack}.md"
        if [ -f "$profile_path" ]; then
            echo "  $profile_path"
        fi
    done
fi
