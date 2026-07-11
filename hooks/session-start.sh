#!/bin/bash
# Envoy Session Start Hook
# Injects the using-envoy skill and auto-detects stack profiles

# Prevent terminal escape sequences from leaking through
exec < /dev/null

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"

# Function to escape content for JSON
escape_json() {
    local content="$1"
    # Escape backslashes, quotes, and control characters
    content="${content//\\/\\\\}"
    content="${content//\"/\\\"}"
    content="${content//$'\n'/\\n}"
    content="${content//$'\r'/\\r}"
    content="${content//$'\t'/\\t}"
    echo "$content"
}

# Read the using-envoy skill
SKILL_FILE="$PLUGIN_DIR/skills/using-envoy/SKILL.md"
if [ -f "$SKILL_FILE" ]; then
    SKILL_CONTENT=$(cat "$SKILL_FILE")
else
    SKILL_CONTENT="Error: using-envoy skill not found at $SKILL_FILE"
fi

# Strip frontmatter from skill content (POSIX-compatible, no BSD sed warnings)
SKILL_CONTENT=$(echo "$SKILL_CONTENT" | awk 'BEGIN{s=0} /^---$/{s++;next} s>=2{print}')

# Detect stacks in current directory
DETECTED_STACKS=""
detect_stack() {
    local name=$1
    local pattern=$2
    local search_type=${3:-"file"}

    if [ "$search_type" = "file" ]; then
        if find . -maxdepth 3 -name "$pattern" 2>/dev/null | grep -q .; then
            DETECTED_STACKS="$DETECTED_STACKS $name"
        fi
    elif [ "$search_type" = "content" ]; then
        if grep -r -l "$pattern" --include="*.csproj" --include="package.json" --include="*.bicep" . 2>/dev/null | head -1 | grep -q .; then
            DETECTED_STACKS="$DETECTED_STACKS $name"
        fi
    fi
}

# Run stack detection (same logic as detect-stacks.sh)
detect_stack "dotnet" "*.csproj" "file"
detect_stack "react" '"react"' "content"
detect_stack "typescript" "tsconfig.json" "file"
detect_stack "postgresql" "Npgsql\|PostgreSQL" "content"
detect_stack "testing-dotnet" "xunit\|Moq\|FluentAssertions" "content"
detect_stack "testing-playwright" "@playwright/test" "content"
detect_stack "docker-compose" "docker-compose*.yml" "file"
detect_stack "bicep" "*.bicep" "file"
detect_stack "github-actions" ".github/workflows/*.yml" "file"
detect_stack "entity-framework" "Microsoft.EntityFrameworkCore" "content"
detect_stack "serilog" "Serilog" "content"
detect_stack "jwt-oauth" "JwtBearer\|OAuth\|OpenIdConnect" "content"
detect_stack "api-patterns" "AddControllers\|ApiController" "content"
detect_stack "shadcn-radix" "@radix-ui\|class-variance-authority" "content"
detect_stack "react-query" "@tanstack/react-query" "content"
detect_stack "react-hook-form" "react-hook-form" "content"
detect_stack "tailwind" "tailwindcss" "content"
detect_stack "orval" '"orval"' "content"
detect_stack "application-insights" "ApplicationInsights" "content"
detect_stack "health-checks" "AddHealthChecks\|HealthChecks" "content"
detect_stack "openapi" "Swashbuckle\|AddSwaggerGen" "content"

# Trim leading space
DETECTED_STACKS=$(echo "$DETECTED_STACKS" | xargs)

# Detect session state (cross-session continuity)
SESSION_STATE=""
if [ -f ".envoy-session.json" ]; then
    # Extract all fields in a single Node process
    eval "$(node -e "
      const s=JSON.parse(require('fs').readFileSync('.envoy-session.json','utf8'));
      const esc=v=>(v||'').replace(/'/g,\"'\\\\''\");
      console.log('SESSION_BRANCH=\'' + esc(s.branch||'unknown') + '\'');
      console.log('SESSION_PLAN=\'' + esc(s.plan||'') + '\'');
      const d=(s.tasks||[]).filter(t=>t.status==='done').length;
      console.log('SESSION_TASKS=\'' + d+'/'+(s.tasks||[]).length + '\'');
      console.log('SESSION_UPDATED=\'' + esc(s.updatedAt||'') + '\'');
      const ns=(s.nextSteps||[]).slice(0,3).map(n=>'- '+n).join('\n');
      console.log('SESSION_NEXTSTEPS=\'' + esc(ns) + '\'');
      const dc=(s.decisions||[]).slice(-3).map(d=>'- '+d.text).join('\n');
      console.log('SESSION_DECISIONS=\'' + esc(dc) + '\'');
    " 2>/dev/null)"

    SESSION_STATE="---

**Session state detected** (from \`.envoy-session.json\`, last updated: $SESSION_UPDATED)

**Branch:** $SESSION_BRANCH"

    if [ -n "$SESSION_PLAN" ]; then
        SESSION_STATE="$SESSION_STATE
**Plan:** $SESSION_PLAN"
    fi

    SESSION_STATE="$SESSION_STATE
**Progress:** $SESSION_TASKS tasks complete"

    if [ -n "$SESSION_DECISIONS" ]; then
        SESSION_STATE="$SESSION_STATE
**Recent decisions:**
$SESSION_DECISIONS"
    fi

    if [ -n "$SESSION_NEXTSTEPS" ]; then
        SESSION_STATE="$SESSION_STATE
**Next steps:**
$SESSION_NEXTSTEPS"
    fi

    SESSION_STATE="$SESSION_STATE

Load full state with: \`const session = require('./lib/session-state').load()\`
To clear after branch is done: \`require('./lib/session-state').clear()\`"
fi

# Build stack list for output
if [ -n "$DETECTED_STACKS" ]; then
    STACK_INFO="**Detected stacks:** $DETECTED_STACKS

When implementing or reviewing code, load the relevant stack profiles from \`stacks/<stack-name>.md\` for best practices and common mistakes."
else
    STACK_INFO="No specific stacks detected. Load stack profiles as needed from \`stacks/\`."
fi

# Build the output message
OUTPUT_CONTENT="<EXTREMELY_IMPORTANT>
You have Envoy superpowers.

**Below is the full content of your 'envoy:using-envoy' skill - your introduction to using Envoy skills. For all other skills, use the 'Skill' tool:**

$SKILL_CONTENT

---

$STACK_INFO
$SESSION_STATE
</EXTREMELY_IMPORTANT>"

# Escape for JSON
ESCAPED_CONTENT=$(escape_json "$OUTPUT_CONTENT")

# Output JSON response
cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "$ESCAPED_CONTENT"
  }
}
EOF
