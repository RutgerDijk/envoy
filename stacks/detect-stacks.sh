#!/bin/bash
# Stack Auto-Detection Script
# Detects which technology stacks are present in the current project

# Note: Not using set -e because detect_stack returns 1 when stack not found

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DETECTED_STACKS=()

# Colors for output
GREEN='\033[0;32m'
NC='\033[0m' # No Color

detect_stack() {
    local name=$1
    local pattern=$2
    local search_type=${3:-"file"} # "file" or "content"

    if [ "$search_type" = "file" ]; then
        if find . -maxdepth 3 -name "$pattern" 2>/dev/null | grep -q .; then
            DETECTED_STACKS+=("$name")
            return 0
        fi
    elif [ "$search_type" = "content" ]; then
        if grep -r -l "$pattern" --include="*.csproj" --include="package.json" --include="*.bicep" . 2>/dev/null | head -1 | grep -q .; then
            DETECTED_STACKS+=("$name")
            return 0
        fi
    fi
    return 1
}

echo "Detecting project stacks..."
echo ""

# Core stacks
detect_stack "dotnet" "*.csproj" "file"
detect_stack "react" '"react"' "content"
detect_stack "typescript" "tsconfig.json" "file"
detect_stack "postgresql" "Npgsql\|PostgreSQL" "content"

# Testing stacks
detect_stack "testing-dotnet" "xunit\|Moq\|FluentAssertions" "content"
detect_stack "testing-playwright" "@playwright/test" "content"

# Infrastructure stacks
detect_stack "docker-compose" "docker-compose*.yml" "file"
detect_stack "azure-container-apps" "containerApps" "content"
detect_stack "azure-static-web-apps" "staticwebapp.config.json" "file"
detect_stack "azure-postgresql" "flexibleServers" "content"
detect_stack "bicep" "*.bicep" "file"
detect_stack "github-actions" ".github/workflows/*.yml" "file"

# Supporting stacks
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
detect_stack "openapi" "Swashbuckle\|AddSwaggerGen\|AddEndpointsApiExplorer" "content"

# Security is always applicable
DETECTED_STACKS+=("security")

echo "Detected stacks:"
echo ""
for stack in "${DETECTED_STACKS[@]}"; do
    echo -e "  ${GREEN}✓${NC} $stack"
done
echo ""

# Output as JSON for programmatic use
if [ "$1" = "--json" ]; then
    echo "["
    first=true
    for stack in "${DETECTED_STACKS[@]}"; do
        if [ "$first" = true ]; then
            first=false
        else
            echo ","
        fi
        echo -n "  \"$stack\""
    done
    echo ""
    echo "]"
fi

# Output stack profile paths
if [ "$1" = "--paths" ]; then
    echo "Stack profiles:"
    for stack in "${DETECTED_STACKS[@]}"; do
        profile_path="${SCRIPT_DIR}/${stack}.md"
        if [ -f "$profile_path" ]; then
            echo "  $profile_path"
        fi
    done
fi
