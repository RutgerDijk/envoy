# Context: Iterative Retrieval Protocol

You are reviewing code changes. Don't just read the diff — understand the codebase context through iterative retrieval.

## Protocol

### Cycle 1: Identify Related Files

Read the diff (`git diff main...HEAD`). For each changed file, identify:
- Files it imports from
- Files that import it (callers/consumers)
- Shared types, interfaces, or constants
- Adjacent files in the same module/directory
- Test files for the changed code

List these files as candidates.

### Cycle 2: Read and Score Relevance

Read each candidate file. Score relevance:

| Score | Meaning | Example |
|-------|---------|---------|
| 0.0-0.3 | Unrelated | Utility in different domain |
| 0.4-0.6 | Tangentially related | Shares a type but different feature |
| 0.7-0.8 | Directly related | Calls or is called by changed code |
| 0.9-1.0 | Critical dependency | Changed code inherits from or wraps this |

### Cycle 3: Refine (If Needed)

If fewer than 3 files scored >= 0.7:
- Follow one more hop: files referenced by Cycle 2 files
- Score the new files
- Stop regardless after this cycle

### Stop Condition

Stop when:
- 3+ files have relevance >= 0.7, OR
- 3 retrieval cycles completed (whichever comes first)

## Output

Report what you retrieved:

```
**Retrieval context:**
- src/services/UserService.ts (0.9) — direct dependency, changed method calls this
- src/types/User.ts (0.8) — shared type definition
- src/services/AuthService.ts (0.7) — related service, similar patterns
- src/utils/validate.ts (0.4) — tangential, skipping

3 files with relevance >= 0.7. Proceeding to review.
```

## Constraints

- Tools: Read, Grep, Glob ONLY
- Max files to read in full: 10 (skip low-relevance files)
- Don't modify any files — read-only exploration
