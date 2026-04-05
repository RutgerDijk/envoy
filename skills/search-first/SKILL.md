---
name: search-first
description: Use before implementing any feature to check if a solution already exists
---

# Search-First

## Overview

Before building anything, check if it already exists. Search the codebase, package registries, and GitHub. Decide: adopt, extend, compose, or build.

**Announce at start:** "I'm using envoy:search-first to check for existing solutions."

## Arguments

| Flag | Effect |
|------|--------|
| `<description>` | Required: what you're about to build |

## Decision Matrix

| Decision | Criteria | Action |
|----------|----------|--------|
| **Adopt** | Exact match: package does exactly what's needed | Install and use it directly |
| **Extend** | Partial match: existing solution covers 70%+ | Thin wrapper around it |
| **Compose** | Multiple weak matches: 2-3 packages each handle a part | Combine them |
| **Build** | Nothing found: no viable existing solution | Implement from scratch |

## Process

### Step 1: Search Existing Codebase

```bash
# Search for similar functions, utilities, patterns
grep -r "<relevant keywords>" --include="*.ts" --include="*.cs" --include="*.js" .

# Check for existing utilities
ls src/utils/ src/lib/ src/helpers/ src/shared/ 2>/dev/null

# Search for similar component names
find . -name "*<relevant>*" -not -path "*/node_modules/*"
```

**If found in codebase:** Evaluate reuse potential. Can the existing code be extended or called directly?

### Step 2: Search Package Registries

Search npm, PyPI, or NuGet based on the project stack:

```bash
# npm (JavaScript/TypeScript)
npm search <keywords> 2>/dev/null | head -10

# Or use WebSearch for more context
```

Evaluate each candidate:

| Factor | Good Signal | Bad Signal |
|--------|------------|------------|
| Downloads | >10K/week | <100/week |
| Last publish | <6 months ago | >2 years ago |
| Open issues | <50 | >500 |
| Bundle size | <50KB | >500KB |
| License | MIT, Apache-2.0 | GPL (if proprietary project), unlicensed |
| Dependencies | <5 | >20 |

### Step 3: Search GitHub

```bash
# Use WebSearch to find GitHub repos
# Search for: "<description> site:github.com"
```

Evaluate:
- Stars, forks, recent activity
- README quality and documentation
- Test coverage
- Actively maintained?

### Step 4: Evaluate and Decide

Score each candidate:

```
**Search-First Results for: <description>**

| Source | Match | Decision | Rationale |
|--------|-------|----------|-----------|
| codebase: src/utils/calc.ts | 80% | Extend | Has base logic, needs date handling |
| npm: date-fns | 95% | Adopt | Exact match, 25M downloads, tree-shakeable |
| npm: moment | 90% | Skip | Deprecated, 300KB bundle |
| GitHub: user/custom-lib | 60% | Skip | Unmaintained since 2023 |
| codebase: (nothing) | 0% | - | No existing solution |

**Recommendation:** Adopt `date-fns` for date operations + Extend `src/utils/calc.ts` for calculation logic
```

### Step 5: Report Decision

**If Adopt:**
```
**Decision: Adopt**

Package: <name>
Install: `npm install <name>` / `dotnet add package <name>`
Rationale: <why this is an exact match>

No custom code needed. Import and use directly.
```

**If Extend:**
```
**Decision: Extend**

Base: <existing code or package>
Gap: <what's missing>
Approach: Thin wrapper that adds <missing functionality>

Estimated effort: Much less than building from scratch
```

**If Compose:**
```
**Decision: Compose**

Components:
1. <package/code A> — handles <part 1>
2. <package/code B> — handles <part 2>

Glue code needed: <brief description>
```

**If Build:**
```
**Decision: Build**

Search found no viable existing solutions.
Searched: codebase, npm/NuGet, GitHub
Reason: <why nothing matched>

Proceed with implementation.
```

## Integration with Envoy

- Called by `envoy:pickup` before each implementation task
- If decision is Adopt/Extend, the task's implementation steps adjust accordingly
- Slot in workflow: `search-first → implement → review → finalize`

### In pickup

Before writing any implementation code for a task:

```
1. Run search-first for the task's functionality
2. If Adopt: install package, update imports, skip custom implementation
3. If Extend: install/import base, write only the wrapper
4. If Compose: install components, write glue code
5. If Build: proceed with full implementation as planned
```

## When NOT to Search

Skip search-first when:
- Task is modifying existing code (not creating new)
- Task is writing tests (tests are always custom)
- Task is configuration or documentation
- The spec explicitly names a specific approach to use
