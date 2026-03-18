---
mode: 'agent'
description: 'Run a full 4-layer code review: lint, AI review, documentation gaps, security'
---

# Code Review

Run a comprehensive review of the current branch changes before creating a PR.

## Pre-Review Setup

### 1. Get changed files

```bash
git diff --name-only main...HEAD
```

### 2. Detect relevant stacks

Based on changed files, identify which stack profiles apply:

| Changed files | Relevant stacks |
|--------------|-----------------|
| `*.cs`, `*.csproj` | .NET, Entity Framework, API Patterns |
| `*.tsx`, `*.jsx` | React, TypeScript, Tailwind |
| `*.ts` | TypeScript |
| `*.bicep` | Bicep, Azure Container Apps |
| `*Tests.cs` | .NET Testing |
| `*.spec.ts` | Playwright |

### 3. Load acceptance criteria

Read the linked spec/plan: `docs/plans/*.md`

### 4. Identify documented exclusions

Search for out-of-scope items:
```bash
grep -i "future\|out of scope\|deferred\|phase [2-9]\|later" docs/plans/*.md
```

Items documented as future enhancements are **not bugs** — exclude them from findings.

---

## Layer 0: Automated Linting

```bash
npm run lint
```

If lint fails, fix auto-fixable issues (`npm run lint -- --fix`) and fix the rest manually. Commit lint fixes before continuing.

---

## Layer 1: Static Analysis

Run available static analysis tools:

```bash
# .NET: Roslyn analyzers run with build
dotnet build --no-incremental

# Frontend: TypeScript type check
npx tsc --noEmit
```

Fix any errors before proceeding.

---

## Layer 2: AI Code Review

Review all changed files with the knowledge of:
- The implementation plan (was everything implemented as planned?)
- Relevant stack best practices (from `.instructions.md` context)
- Project coding conventions

Examine each changed file and check:

**Architecture**
- Clean Architecture layers respected? (Domain → Application → Infrastructure → API)
- No cross-layer violations?
- Appropriate abstractions used?

**Code quality**
- SOLID principles followed?
- Error handling at the right level?
- No magic strings or numbers?
- Async/await used correctly throughout?
- CancellationToken passed to all IO methods?

**Security**
- All endpoints have authorization attributes or are explicitly public?
- Input validated before use?
- No SQL concatenation?
- No secrets in code?

**Tests**
- All new business logic has unit tests?
- Tests follow Arrange-Act-Assert?
- Tests are independent (no shared mutable state)?
- Edge cases covered?

**Documentation**
- Public API methods have XML doc comments (C#) or JSDoc (TS)?
- Complex logic has explanatory comments?

---

## Layer 3: Documentation Gap Detection

```bash
# Check for public methods without XML doc comments in C#
grep -rn "public.*(" src/ --include="*.cs" | grep -v "///" | grep -v "test" | head -20

# Check for TODO/FIXME left in code
grep -rn "TODO\|FIXME\|HACK\|XXX" src/ --include="*.cs" --include="*.ts" --include="*.tsx"
```

---

## Review Output Format

```markdown
## Code Review

### Summary
<One paragraph: what was implemented, overall quality assessment>

### Plan Alignment
- ✅ All required tasks implemented
- ⚠️ Task N: <what's different from plan>

### Findings

#### Critical (must fix before merge)
- [ ] **File:Line** — Description of issue

#### Important (should fix)
- [ ] **File:Line** — Description of issue

#### Suggestions (nice to have)
- [ ] **File:Line** — Description of improvement

### Approved To Merge
<Yes / No — with reason>
```

---

## After Review

Fix all Critical and Important findings:

```bash
git add -p
git commit -m "fix: address code review feedback"
```
