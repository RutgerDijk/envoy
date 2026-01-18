---
name: layered-review
description: Use after implementation is complete, before creating PR or finalizing work
---

# Layered Review Process

## Overview

Comprehensive 4-layer review combining automated tools, documentation-informed AI review, Chrome DevTools visual verification, and documentation gap detection.

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

### 2. Detect and Load Stack Profiles

Based on changed files, load relevant stack profiles:

| Changed File Pattern | Load These Stacks |
|---------------------|-------------------|
| `*.cs`, `*.csproj` | dotnet, entity-framework, api-patterns |
| `*.tsx`, `*.ts` | react, typescript, tailwind |
| `*.bicep` | bicep, azure-container-apps |
| `*test*` | testing-dotnet or testing-playwright |

**Read each detected stack profile:**
```bash
cat stacks/dotnet.md       # For .NET changes
cat stacks/react.md        # For React changes
# etc.
```

**Extract from each profile:**
- Common mistakes (check code against these)
- Review checklist (use in Layer 2)

### 3. Load Project Standards

```bash
# If backend changes
cat .NET_STANDARDS.md 2>/dev/null

# If frontend changes
cat FRONTEND_STANDARDS.md 2>/dev/null
```

### 4. Load Acceptance Criteria

From linked issue/spec document.

### Load Known Limitations

**Critical:** Check the spec/plan documents for documented limitations, future enhancements, or out-of-scope items:

```bash
# Search for documented limitations in spec/plan
grep -i "future\|enhancement\|out of scope\|not included\|limitation\|deferred\|phase [2-9]\|later" docs/plans/*.md
```

**Create exclusion list:** Items documented as "future enhancement", "out of scope", or "deferred" should NOT be flagged as bugs. Keep this list for all review layers.

Example exclusions from spec:
- "Inline editing (future enhancement)"
- "Caching (Phase 2)"
- "Mobile support (out of scope)"

These are **not bugs** — they are documented scope boundaries.

---

## Layer 1: CodeRabbit Static Analysis

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
- Preference-based feedback

### Apply Fixes

For obvious fixes:
```bash
# Make the fix
# Then commit
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

## Layer 2: Documentation-Informed AI Review

### Spawn Fresh Agent

Create a new agent with NO implementation context (prevents bias):

```
Agent receives:
- git diff main...HEAD
- Project standards docs
- Relevant stack profiles
- Acceptance criteria from spec
- NOT the implementation conversation
```

### Review Checklist

The agent checks:

1. **Spec compliance** — Does implementation match the design doc?
2. **Standards compliance** — Does code follow project standards?
3. **TDD compliance** — Were tests written before implementation?
   - Check git log for test commits preceding implementation commits
   - Flag if implementation committed without prior test commit
4. **Test coverage** — Is business logic covered by tests?
   - Services, repositories, utilities → Must have tests
   - UI components → Visual review is primary, unit tests optional
5. **Architectural concerns** — Any structural issues?
6. **Security implications** — Any vulnerabilities introduced?
7. **Error handling** — Are errors handled appropriately?
8. **Performance concerns** — Any obvious performance issues?
9. **Pattern consistency** — Matches existing codebase patterns?

**Exclusions check:** Before flagging any issue, verify it's not in the documented limitations/future enhancements list from pre-review.

### Report Format

```
**AI Review Results**

✓ Spec compliance: Implementation matches design
✓ Standards: Follows .NET_STANDARDS.md
⚠ Concern: Missing null check in UserService.GetById
✓ Security: No issues found
⚠ Suggestion: Consider caching in GetUsers for performance

Issues requiring attention: 2
```

---

## Layer 3: Visual/Functional Review

Use envoy:visual-review skill for Chrome DevTools verification.

### Process

1. **Start application:**
   ```bash
   # Start backend
   cd backend && dotnet run &

   # Start frontend
   cd frontend && npm run dev &

   # Wait for startup
   sleep 10
   ```

2. **Identify affected pages** from changed files

3. **For each affected page:**
   - Navigate to page
   - Take screenshot
   - Check console for errors
   - Check network for failures

4. **Test user flows** from acceptance criteria:
   - Fill forms
   - Click buttons
   - Verify expected outcomes

### Report Format

```
**Visual Review Results**

Pages checked: 3
- /users: ✓ OK
- /users/new: ✓ OK
- /users/:id: ⚠ Console warning (React key)

Screenshots: 3 captured
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
- Suggest new documentation

### Skip Mode (--no-check-docs)

Skip this layer entirely for fast reviews.

### Report Format

```
**Documentation Gaps**

Missing docstrings:
- UserService.CreateUser (public method)
- UserController.Get (public endpoint)

Outdated docs:
- README.md mentions old API endpoint

Suggested additions:
- Add wiki page for user management feature
```

---

## Final Report

Combine all layer results:

```
**Review Complete**

| Layer | Status | Issues |
|-------|--------|--------|
| 1. CodeRabbit | ✓ | 3 fixed, 1 needs decision |
| 2. AI Review | ⚠ | 2 concerns |
| 3. Visual | ✓ | 1 warning |
| 4. Docs | ⚠ | 3 gaps |

**Action needed:**

1. [ ] CodeRabbit: Decide on architectural suggestion
2. [ ] AI Review: Add null check in UserService
3. [ ] AI Review: Consider caching (optional)
4. [ ] Visual: Fix React key warning
5. [ ] Docs: Add docstrings to public APIs

**After addressing issues:**
- `/envoy:finalize` to prepare PR
```

---

## Quick Reference

| Command | Layers Run |
|---------|------------|
| `/envoy:review` | 1, 2, 3, 4 (default doc check) |
| `/envoy:review --check-docs` | 1, 2, 3, 4 (deep doc check) |
| `/envoy:review --no-check-docs` | 1, 2, 3 |
| `/envoy:quick-review` | 1, 2 only |
| `/envoy:visual-review` | 3 only |
