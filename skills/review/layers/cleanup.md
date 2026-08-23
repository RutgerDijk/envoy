# Review — Layer 0.5: Cleanup pass (all tiers except trivial)

Announce: `Running Layer 0.5: Cleanup Pass...`

**YOU MUST spawn an Agent tool call here. Inline cleanup without spawning an agent is wrong. Do not skip this.**

Spawn a fresh cleanup agent that ONLY sees the diff — no implementation context, no conversation history. This is a focused mandate to remove AI-generated slop.

**Key principle:** Never add "don't do X" instructions to the implementing agent — let it implement freely, then run this focused cleanup.

**Test command:** resolve it once before spawning the agent — do not
hardcode a stack-specific command:

```javascript
const { resolveTestCommands } = require('./lib/test-commands'); // CWD-relative — these snippets run with CWD at repo root
const TEST_CMD = resolveTestCommands(process.cwd()).full;
```

Pass `TEST_CMD` into the agent prompt below. If `TEST_CMD` is `null` (no
test command resolved for this repo), the agent should skip the "run
tests" step for each category and rely on the full-suite gate in Layer
0.75 (`layers/tests.md`) instead — do not fall back to a hardcoded
command.

```
Agent({
  model: "sonnet",
  description: "Cleanup pass",
  prompt: `${EXECUTION_ANNOUNCE}

  You are a code cleanup agent. Your job is to remove slop from a recent implementation.

  Read the diff:
  git diff main...HEAD

  Then read each changed file in full to understand context.

  Remove the categories below IN ORDER. Edit files directly.
  Run tests after each category. Commit after each category.

  IMPORTANT:
  - Only remove things that are genuinely unnecessary
  - If in doubt, leave it
  - Never change functionality — only remove noise
  - Never touch test assertions that verify real behavior
  - Intentional defensive code with explanatory comments is NOT slop

  Tools: Read, Edit, Write, Bash, Grep, Glob
  `
})
```

## Category 1: Unnecessary Defensive Checks

Remove:
- Null checks on parameters that can't be null (required params, just-constructed objects)
- Try/catch around code that can't throw (simple assignments, arithmetic)
- Redundant type guards (checking type after TypeScript already narrowed)
- `if (x !== undefined)` when x is always defined
- Empty catch blocks that swallow errors silently

**Keep:**
- Null checks on external input (API responses, user input, database results)
- Try/catch around I/O operations (file, network, database)
- Defensive checks documented as intentional (explicit comment explaining why)

```bash
${TEST_CMD}
git add <changed-files>
git commit -m "refactor: remove unnecessary defensive checks"
```

## Category 2: Over-Engineering

Remove:
- Interfaces/abstractions with only one implementation (and no documented plan for more)
- Generic type parameters that are always the same concrete type
- Factory functions that just call `new`
- Configuration objects for values that never change
- Premature caching/memoization without evidence of performance need
- Feature flags for non-optional features
- Backwards-compatibility shims for code that was just written

**Keep:**
- Abstractions required by the framework (dependency injection, etc.)
- Generics that genuinely serve multiple types
- Configuration that's documented as user-facing

```bash
${TEST_CMD}
git add <changed-files>
git commit -m "refactor: remove over-engineering"
```

## Category 3: Redundant Tests

Remove:
- Tests that just assert the mock returns what you told it to return
- Tests that duplicate another test with trivially different input (keep one, parameterize if needed)
- Tests for framework behavior (e.g., testing that React renders a div)
- Tests that only verify the test setup (e.g., "service is defined")

**Keep:**
- Tests for actual business logic
- Edge case tests that exercise different code paths
- Integration tests that verify real behavior
- Tests for error handling

```bash
${TEST_CMD}
git add <changed-files>
git commit -m "refactor: remove redundant tests"
```

## Category 4: Excessive Comments

Remove:
- Comments that restate the code (`// increment counter` above `counter++`)
- JSDoc/XML-doc on private methods with obvious signatures
- `// TODO` comments for things that are already done
- Commented-out code (it's in git history if needed)
- Section dividers that don't add information (`// ---- Helper Functions ----`)
- "This function does X" when the function name already says X

**Keep:**
- Comments explaining WHY (not what)
- Comments marking intentional trade-offs or workarounds
- JSDoc/XML-doc on public API methods
- Regulatory/compliance comments

```bash
${TEST_CMD}
git add <changed-files>
git commit -m "refactor: remove excessive comments"
```

## Category 5: Dead Code and Unused Imports

Remove:
- Imports not referenced anywhere in the file
- Functions/methods defined but never called
- Variables assigned but never read
- Type definitions not used
- Files created but not imported anywhere
- Unreachable branches

**Keep:**
- Exports that are part of the public API (even if not used internally)
- Types used only in test files

```bash
${TEST_CMD}
git add <changed-files>
git commit -m "refactor: remove dead code and unused imports"
```

## Error Handling for Cleanup

If tests fail after any cleanup category: **revert that category's changes** and continue with the next category. Do not leave broken code.

```bash
git checkout -- .   # revert failed category
```
