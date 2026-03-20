---
agent: 'agent'
description: 'Fast AI-only code review during development (no lint or static analysis)'
---

# Quick Review

A fast, focused AI review of recent changes — useful for a sanity check during active development.

## Get Changed Files

```bash
git diff --name-only HEAD~1..HEAD
# Or for staged changes:
git diff --name-only --cached
```

## Review Each Changed File

For each changed file, check:

1. **Logic correctness** — Does the code do what it intends to?
2. **Edge cases** — Are null, empty, and boundary cases handled?
3. **Error handling** — Are exceptions caught at the right level?
4. **Security** — Any obvious vulnerabilities (injection, missing auth, exposed secrets)?
5. **Tests** — Does every new function have a corresponding test?
6. **Naming** — Are names clear and consistent with the project conventions?

## Output Format

```markdown
### Quick Review

**Files reviewed:** <list>

**Issues found:**

⚠️ **<File>** — <Issue description and suggested fix>

✅ **<File>** — Looks good

**Verdict:** Ready to continue / Fix these issues first
```

## When to Use Full Review Instead

Use `/review` (the full 4-layer review) before:
- Creating a PR
- Merging to main
- Sharing changes with the team

Use `/quick-review` during development for fast feedback between commits.
