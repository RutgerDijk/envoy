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

# Strip frontmatter from skill content
SKILL_CONTENT=$(echo "$SKILL_CONTENT" | sed '1{/^---$/d}' | sed '1,/^---$/d')

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
</EXTREMELY_IMPORTANT>"

# Escape for JSON
ESCAPED_CONTENT=$(escape_json "$OUTPUT_CONTENT")

# Output JSON response
cat << EOF
{
  "hookSpecificOutput": "$ESCAPED_CONTENT"
}
EOF
