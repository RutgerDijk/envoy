# Stack Profiles

Envoy includes 25 technology profiles with best practices, common mistakes, and review checklists.

## How Stack Detection Works

On session start, Envoy scans your project for technology markers:

| File/Pattern | Detected Stacks |
|-------------|-----------------|
| `*.csproj` | dotnet |
| `package.json` with `"react"` | react |
| `tsconfig.json` | typescript |
| `*.bicep` | bicep, azure-container-apps |
| `docker-compose*.yml` | docker-compose |
| `.github/workflows/*.yml` | github-actions |
| Package references | entity-framework, serilog, jwt-oauth, etc. |

## Profile Structure

Each profile in `stacks/<name>.md` has three sections:

### Best Practices
Patterns to follow during implementation. Loaded by `executing-plans` and `search-first`.

### Common Mistakes
Anti-patterns with fixes. Loaded by `layered-review` during the AI review layer.

### Review Checklist
What to verify during code review. Used by review agents.

## Selective Loading

Envoy 2.0 loads stack profiles selectively to save tokens:

- **By changed files:** Only stacks relevant to files in `git diff` get loaded
- **By section:** Reviews load "Common Mistakes" only, implementation loads "Best Practices" only

```javascript
const { loadStackSection, detectStacksFromDiff } = require('./lib/stack-loader');

// Only stacks for changed files
const stacks = detectStacksFromDiff('main');

// Only the section you need
const mistakes = loadStackSection('dotnet', 'Common Mistakes', stacksDir);
```

## Available Profiles

**Core:** dotnet, react, typescript, postgresql

**Testing:** testing-dotnet (xUnit/Moq/FluentAssertions), testing-playwright

**Infrastructure:** docker-compose, azure-container-apps, azure-static-web-apps, azure-postgresql, bicep, github-actions

**Supporting:** entity-framework, serilog, jwt-oauth, api-patterns, shadcn-radix, react-query, react-hook-form, tailwind, orval, application-insights, health-checks, openapi

**Security:** Always loaded for web applications (dotnet, react, or api-patterns detected)

## Adding a Stack Profile

1. Create `stacks/<name>.md` with Best Practices, Common Mistakes, and Review Checklist sections
2. Add detection rule to `lib/stack-loader.js` STACK_RULES array
3. Add detection pattern to `hooks/session-start.sh`
4. Update `adapters/copilot/` if needed
