# Review — Layer 0.5: Cleanup pass (all tiers except trivial)

Announce: `Running Layer 0.5: Cleanup Pass...`

**YOU MUST spawn an Agent tool call here. Inline cleanup without spawning an agent is wrong. Do not skip this.**

Spawn a fresh cleanup agent — on the model chosen in Pre-Review Setup
step 6 (`state.workerModel`) — that ONLY sees the diff: no implementation
context, no conversation history. This is a focused mandate to remove
AI-generated slop.

**Key principle:** Never add "don't do X" instructions to the implementing agent — let it implement freely, then run this focused cleanup.

Build the prompt string first, then route it through
`lib/model-dispatch.js`'s `dispatch()` so the model choice (including
kimi's headless path) determines how it's dispatched, not the prompt text:

```javascript
const { dispatch } = require('../../lib/model-dispatch');

const cleanupPrompt = `${EXECUTION_ANNOUNCE}

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
`;

// Cleanup edits and commits, so it needs a write-capable surface. State
// it explicitly: dispatch() fails CLOSED (read-only) for callers that
// name no tools, and on the kimi path this becomes a real
// `--allowed-tools` restriction on an unsupervised background process.
const descriptor = dispatch({
  model: state.workerModel,
  prompt: cleanupPrompt,
  taskId: 'cleanup',
  allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'],
});

if (descriptor.kind === 'agent') {
  // fable/opus/sonnet/haiku — Agent tool can name the model directly.
  Agent({
    model: descriptor.model,
    description: "Cleanup pass",
    prompt: descriptor.prompt,
  });
} else {
  // kimi — descriptor.kind === 'bash'. dispatch() already wrote the
  // prompt to descriptor.promptFile; the command reads it via stdin
  // redirection, so no prompt text is interpolated into the command
  // string. Never build this command by hand.
  const { shell_id } = Bash({
    command: descriptor.command,
    run_in_background: true,
    description: descriptor.description,
  });
  // WAIT for exit before reading. descriptor.outputFile is written
  // incrementally, so reading it early yields a truncated report.
  // Poll BashOutput(shell_id) until it reports the shell has exited
  // (or use Monitor to block on that condition), THEN read
  // descriptor.outputFile (.envoy/agent-output/cleanup.md) as the
  // cleanup agent's report, in place of an Agent-tool return value.
}
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
dotnet test && npm test
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
dotnet test && npm test
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
dotnet test && npm test
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
dotnet test && npm test
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
dotnet test && npm test
git add <changed-files>
git commit -m "refactor: remove dead code and unused imports"
```

## Error Handling for Cleanup

If tests fail after any cleanup category: **revert that category's changes** and continue with the next category. Do not leave broken code.

```bash
git checkout -- .   # revert failed category
```
