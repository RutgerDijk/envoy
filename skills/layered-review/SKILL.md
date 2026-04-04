---
name: layered-review
description: Use after implementation is complete, before creating PR or finalizing work
---

# Layered Review Process

## Overview

Local code review that finds and fixes issues before creating a PR. Runs lint, Sonnet AI review, and Chrome DevTools visual verification. Complexity tiers control which layers run.

After this skill completes, use `/envoy:finalize` to create the PR. GitHub CodeRabbit will review on the PR — that's finalize's concern, not ours.

**Announce at start:** "I'm using envoy:layered-review to review these changes."

## Arguments

| Flag | Effect |
|------|--------|
| (none) | Full review with default doc check |
| `--check-docs` | Deep documentation analysis |
| `--no-check-docs` | Skip documentation gap detection |

## Pre-Review: Load Context

### 1. Get Changed Files

```bash
git diff --name-only main...HEAD
```

### 2. Determine Complexity Tier

```bash
CHANGED=$(git diff --name-only main...HEAD)
FILE_COUNT=$(echo "$CHANGED" | wc -l)
CODE_FILES=$(echo "$CHANGED" | grep -v '\.\(md\|txt\|json\|yml\|yaml\)$' | wc -l)
```

| Tier | Criteria | Layers to Run |
|------|----------|---------------|
| **Trivial** | Docs/config only, or ≤2 files with no logic | Layer 0 only |
| **Small** | 1-3 code files | Layers 0, 1 |
| **Medium** | 4-10 code files | Layers 0, 1, 2, 3 |
| **Large** | 10+ code files or cross-cutting | Layers 0, 1, 2, 3 (full) |

### 3. Detect and Load Stack Profiles (Selective)

**Only load stacks relevant to changed files, and only the "Common Mistakes" section:**

| Changed File Pattern | Load These Stacks |
|---------------------|-------------------|
| `*.cs`, `*.csproj` | dotnet, entity-framework, api-patterns |
| `*.tsx`, `*.ts` | react, typescript, tailwind |
| `*.bicep` | bicep, azure-container-apps |
| `*test*` | testing-dotnet or testing-playwright |

```javascript
const { loadStackSection } = require('../../lib/stack-loader');
const mistakes = loadStackSection('dotnet', 'Common Mistakes');
```

### 4. Load Known Review Patterns

```bash
cat memory/review-learnings.md 2>/dev/null
```

If patterns exist, check them first — known patterns can be flagged immediately. This is a cheap local check before the AI review.

### 5. Load Acceptance Criteria

From linked issue/spec document.

### 6. Load Known Limitations

```bash
grep -i "future\|enhancement\|out of scope\|limitation\|deferred" docs/plans/*.md
```

Items documented as "future enhancement" or "out of scope" should NOT be flagged.

---

## Layer 0: Automated Linting

```bash
npm run lint
```

**If lint fails:**
- Fix auto-fixable issues: `npm run lint -- --fix`
- Fix remaining issues manually
- Commit:
  ```bash
  git add -p
  git commit -m "fix: address lint errors"
  ```

**For trivial tier: stop here.** Report and suggest `/envoy:finalize`.

---

## Layer 1: Token-Optimized AI Review (Sonnet)

Spawn a fresh **Sonnet** agent with NO implementation context. The agent uses **iterative retrieval** to understand codebase context — not just the diff:

```
Agent({
  model: "sonnet",
  description: "AI code review",
  prompt: `You are reviewing code changes. Context provided via files, not inline.

  FIRST: Read contexts/iterative-retrieval.md for the retrieval protocol.

  THEN: Follow the protocol:
  1. Read git diff main...HEAD
  2. Identify related files (imports, callers, shared types)
  3. Read those files, score relevance (0-1.0)
  4. If <3 files scored >=0.7, follow one more hop
  5. Stop when 3+ files have relevance >=0.7 or 3 cycles done

  Report your retrieval context before reviewing.

  Also read:
  - <spec-path> (acceptance criteria)
  - <stack-common-mistakes> (patterns to check)

  Focus areas:
  1. Spec/acceptance criteria compliance
  2. TDD verification: git log shows test commits before implementation?
  3. Codebase pattern consistency (informed by retrieved context)
  4. Stack profile common mistakes

  DO NOT check (GitHub CodeRabbit handles these on the PR):
  - Style, naming, formatting
  - Security basics
  - Common language mistakes
  - Performance anti-patterns

  Tools allowed: Read, Grep, Glob ONLY (read-only review)

  Output format:
  **Retrieval context:**
  - <file> (<score>) — <reason>

  **Review findings:**
  - ✓ Check passed: <description>
  - ⚠ Concern: <file>:<line> — <description>
  - ✗ Issue: <file>:<line> — <description>
  `
})
```

### Apply Fixes

For each finding:
- **Obvious fixes** — apply immediately, commit
- **Ambiguous** — present to user for decision

```bash
git add -p
git commit -m "fix: address AI review feedback

- <fix 1>
- <fix 2>"
```

---

## Layer 2: Visual/Functional Review

*Skipped for trivial and small tiers.*

Use envoy:visual-review skill for Chrome DevTools verification.

1. **Identify affected pages** from changed files
2. **For each affected page:**
   - Navigate to page
   - Take screenshot
   - Check console for errors
   - Check network for failures
3. **Test user flows** from acceptance criteria
4. **App health check:**
   ```bash
   curl -sf http://localhost:5000/health && echo "✓ Backend" || echo "✗ Backend"
   curl -sf http://localhost:5173 && echo "✓ Frontend" || echo "✗ Frontend"
   ```

### Fix Issues

Console errors, network failures, and visual bugs found here get fixed and committed before proceeding.

---

## Layer 3: Documentation Gap Detection

*Skipped for trivial tier. Skipped entirely with `--no-check-docs`.*

### Default Mode

- Public APIs missing docstrings
- Obvious outdated references in docs
- Changed behavior not reflected in README

### Deep Mode (--check-docs)

- Cross-reference all standards documents
- Check wiki for coverage of new features
- Identify patterns used but not documented

---

## Final Report

```
**Review Complete**

| Layer | Status | Issues |
|-------|--------|--------|
| 0. Lint | ✓ | 0 errors |
| 1. AI Review (Sonnet) | ⚠ | 2 concerns fixed |
| 2. Visual | ✓ | 0 issues |
| 3. Docs | ⚠ | 2 gaps noted |

Complexity tier: Medium

**All fixable issues addressed.**

Next: `/envoy:finalize` to create PR
(GitHub CodeRabbit will review on the PR)
```

---

## Quick Reference

| Command | Layers Run |
|---------|------------|
| `/envoy:review` | 0, 1, 2, 3 (default doc check) |
| `/envoy:review --check-docs` | 0, 1, 2, 3 (deep doc check) |
| `/envoy:review --no-check-docs` | 0, 1, 2 |
| `/envoy:quick-review` | 0, 1 only |
| `/envoy:visual-review` | 2 only |

### Complexity Tier Quick Reference

| Tier | Layers | AI Model | Cost |
|------|--------|----------|------|
| Trivial | 0 | None | ~$0 |
| Small | 0, 1 | Sonnet | ~$0.05 |
| Medium | 0-3 | Sonnet | ~$0.15 |
| Large | 0-3 | Sonnet | ~$0.25 |
