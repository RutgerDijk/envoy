---
name: layered-review
description: Use after implementation is complete, before creating PR or finalizing work
---

# Layered Review Process

## Overview

Comprehensive 5-layer review combining automated linting, static analysis tools, token-optimized AI review (Sonnet), Chrome DevTools visual verification, and documentation gap detection.

**Announce at start:** "I'm using envoy:layered-review to review these changes."

## Arguments

| Flag | Effect |
|------|--------|
| (none) | Full review with default doc check |
| `--check-docs` | Deep documentation analysis |
| `--no-check-docs` | Skip documentation gap detection |

## Pre-Review: Load Context

Before starting layers, gather context:

### 1. Get Changed Files

```bash
git diff --name-only main...HEAD
```

### 2. Determine Complexity Tier

Classify the change to decide review depth:

```bash
CHANGED=$(git diff --name-only main...HEAD)
FILE_COUNT=$(echo "$CHANGED" | wc -l)
CODE_FILES=$(echo "$CHANGED" | grep -v '\.\(md\|txt\|json\|yml\|yaml\)$' | wc -l)
```

| Tier | Criteria | Layers to Run |
|------|----------|---------------|
| **Trivial** | Docs/config only, or ≤2 files with no logic | Layer 0 only (CodeRabbit handles rest on GitHub) |
| **Small** | 1-3 code files | Layers 0, 2 (Sonnet only) |
| **Medium** | 4-10 code files | Layers 0, 1, 2, 3, 4 |
| **Large** | 10+ code files or cross-cutting | Layers 0, 1, 2, 3, 4 (full) |

### 3. Detect and Load Stack Profiles (Selective)

**Only load stacks relevant to changed files, and only the needed section.**

```bash
# Get changed file extensions
git diff --name-only main...HEAD
```

| Changed File Pattern | Load These Stacks |
|---------------------|-------------------|
| `*.cs`, `*.csproj` | dotnet, entity-framework, api-patterns |
| `*.tsx`, `*.ts` | react, typescript, tailwind |
| `*.bicep` | bicep, azure-container-apps |
| `*test*` | testing-dotnet or testing-playwright |

**For review, load only "Common Mistakes" section** (not full profile):

```javascript
// Use selective loading from lib/stack-loader.js
const { loadStackSection } = require('../../lib/stack-loader');
const mistakes = loadStackSection('dotnet', 'Common Mistakes');
```

### 4. Load Known Review Patterns

**Check for learned patterns before external review:**

```bash
# Load patterns from memory if exists
cat memory/review-learnings.md 2>/dev/null
```

If patterns exist, check them first — known patterns can be flagged immediately without waiting for CodeRabbit or AI review. This is a cheap local check.

### 5. Load Acceptance Criteria

From linked issue/spec document.

### 6. Load Known Limitations

**Critical:** Check the spec/plan documents for documented limitations:

```bash
grep -i "future\|enhancement\|out of scope\|not included\|limitation\|deferred\|phase [2-9]\|later" docs/plans/*.md
```

**Create exclusion list:** Items documented as "future enhancement", "out of scope", or "deferred" should NOT be flagged as bugs.

---

## Layer 0: Automated Linting

Run linting before deeper analysis to catch basic issues early.

### Run Lint

```bash
npm run lint
```

### Handle Failures

**If lint passes:** Continue to next layer based on complexity tier.

**If lint fails:**
- Fix auto-fixable issues: `npm run lint -- --fix` (if supported)
- Fix remaining issues manually
- Commit fixes:
  ```bash
  git add -p
  git commit -m "fix: address lint errors"
  ```

**For trivial tier: stop here.** CodeRabbit will handle the rest on GitHub.

---

## Layer 1: CodeRabbit Static Analysis

*Skipped for trivial and small tiers.*

### Run CodeRabbit

```bash
coderabbit review --prompt-only --base main
```

### Triage Findings

Categorize each finding:

**Obvious fixes** (auto-fix):
- Style issues (formatting, naming)
- Missing error handling patterns
- Clear bugs with obvious solutions
- Security issues with clear fixes

**Ambiguous** (ask user):
- Architectural suggestions
- Performance trade-offs
- Alternative approaches

### Apply Fixes

For obvious fixes:
```bash
git add -p
git commit -m "fix: address code review feedback

- <fix 1>
- <fix 2>"
```

For ambiguous issues, present each:
```
**CodeRabbit suggests:** <suggestion>

Context: <why it might be good/bad>

Apply this fix? (y/n/discuss)
```

---

## Layer 2: Token-Optimized AI Review (Sonnet)

### Spawn Fresh Sonnet Agent

Create a new **Sonnet** agent with NO implementation context (prevents bias):

```
Agent({
  model: "sonnet",
  description: "AI code review",
  prompt: `Review the diff. Context provided via files, not inline.

  Read these files:
  - git diff main...HEAD (the changes)
  - <spec-path> (acceptance criteria)
  - <stack-common-mistakes> (patterns to check)

  Focus areas (what CodeRabbit does NOT cover):
  1. Spec/acceptance criteria compliance
  2. TDD verification: git log shows test commits before implementation?
  3. Codebase pattern consistency: read surrounding code, not just diff
  4. Stack profile common mistakes

  DO NOT check (CodeRabbit handles these):
  - Style, naming, formatting
  - Security basics
  - Common language mistakes
  - Performance anti-patterns

  Tools allowed: Read, Grep, Glob ONLY (read-only review)

  Output format:
  - ✓ Check passed: <description>
  - ⚠ Concern: <file>:<line> — <description>
  - ✗ Issue: <file>:<line> — <description>
  `
})
```

**Key differences from previous approach:**
- Uses **Sonnet** (60% cheaper than Opus)
- **Restricted tools** — Read, Grep, Glob only (no accidental edits)
- **Focused scope** — Only checks what CodeRabbit can't
- **Context via files** — No inline prompt bloat

### Review Checklist

The Sonnet agent checks:

1. **Spec compliance** — Does implementation match the design doc?
2. **TDD compliance** — Were tests written before implementation?
   - Check git log for test commits preceding implementation commits
   - Flag if implementation committed without prior test commit
3. **Codebase pattern consistency** — Matches existing codebase patterns?
   - Read surrounding files, not just the diff
4. **Stack common mistakes** — Check against loaded "Common Mistakes" section

**Exclusions check:** Before flagging any issue, verify it's not in the documented limitations/future enhancements list from pre-review.

### Report Format

```
**AI Review Results (Sonnet)**

✓ Spec compliance: Implementation matches design
✓ TDD: Test commits precede implementation
⚠ Concern: src/Services/UserService.cs:45 — Missing null check
✓ Codebase patterns: Consistent with existing code
✓ Stack checks: No common mistakes found

Issues requiring attention: 1
Token cost: ~60% less than Opus review
```

---

## Layer 3: Visual/Functional Review

*Skipped for trivial tier.*

Use envoy:visual-review skill for Chrome DevTools verification.

### Process

1. **Start application** (if not already running)
2. **Identify affected pages** from changed files
3. **For each affected page:**
   - Navigate to page
   - Take screenshot
   - Check console for errors
   - Check network for failures
4. **Test user flows** from acceptance criteria
5. **App health check:**
   ```bash
   curl -f http://localhost:5000/health || echo "Backend health check failed"
   curl -f http://localhost:5173 || echo "Frontend health check failed"
   ```

### Report Format

```
**Visual Review Results**

Pages checked: 3
- /users: ✓ OK
- /users/new: ✓ OK
- /users/:id: ⚠ Console warning (React key)

Health check: ✓ Backend + Frontend responding
Console errors: 0
Network failures: 0
User flows: 2/2 passed
```

---

## Layer 4: Documentation Gap Detection

### Default Mode

Surface-level checks:
- Public APIs missing docstrings
- Obvious outdated references in docs
- Changed behavior not reflected in README

### Deep Mode (--check-docs)

Comprehensive analysis:
- Cross-reference all standards documents
- Check wiki for coverage of new features
- Identify patterns used but not documented

### Skip Mode (--no-check-docs)

Skip this layer entirely for fast reviews.

---

## Final Report

Combine all layer results:

```
**Review Complete**

| Layer | Status | Issues |
|-------|--------|--------|
| 0. Lint | ✓ | 0 errors |
| 1. CodeRabbit | ✓ | 3 fixed, 1 needs decision |
| 2. AI Review (Sonnet) | ⚠ | 2 concerns |
| 3. Visual | ✓ | 1 warning |
| 4. Docs | ⚠ | 3 gaps |

Complexity tier: Medium
Token savings: ~60% (Sonnet AI review)

**Action needed:**

1. [ ] CodeRabbit: Decide on architectural suggestion
2. [ ] AI Review: Add null check in UserService
3. [ ] Visual: Fix React key warning
4. [ ] Docs: Add docstrings to public APIs

**After addressing issues:**
- `/envoy:finalize` to prepare PR
```

---

## Quick Reference

| Command | Layers Run |
|---------|------------|
| `/envoy:review` | 0, 1, 2, 3, 4 (default doc check) |
| `/envoy:review --check-docs` | 0, 1, 2, 3, 4 (deep doc check) |
| `/envoy:review --no-check-docs` | 0, 1, 2, 3 |
| `/envoy:quick-review` | 0, 1, 2 only |
| `/envoy:visual-review` | 3 only |

### Complexity Tier Quick Reference

| Tier | Layers | AI Model | Cost |
|------|--------|----------|------|
| Trivial | 0 | None | ~$0 |
| Small | 0, 2 | Sonnet | ~$0.05 |
| Medium | 0-4 | Sonnet | ~$0.15 |
| Large | 0-4 | Sonnet | ~$0.25 |
