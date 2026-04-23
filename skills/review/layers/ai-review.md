# Review — Layer 1: AI code review (Small+ tiers)

Announce: `Running Layer 1: AI Code Review...`

**YOU MUST spawn an Agent tool call here with `subagent_type: "envoy:code-reviewer"`. Inline review without spawning an agent is wrong. Do not skip this.**

**If you do not spawn an Agent tool call, STOP — do not proceed to Layer 2.**

Spawn a fresh **Sonnet** agent with NO implementation context. The agent uses **iterative retrieval** to understand codebase context:

```
Agent({
  subagent_type: "envoy:code-reviewer",
  model: "sonnet",
  description: "AI code review",
  prompt: `You are reviewing code changes. Context provided via files, not inline.

  FIRST: Read contexts/iterative-retrieval.md for the retrieval protocol.

  **Pre-scored file relevance (from dependency analysis):**
  ${relevanceBriefing}

  Use these scores to guide your retrieval — start with 'full' and 'focused'
  files, then expand if needed:
  1. Read git diff main...HEAD
  2. Read 'full' relevance files first, then 'focused' files
  3. If <3 files scored >=0.7 after reading pre-scored files, follow one more hop
  4. Stop when 3+ files have relevance >=0.7 or 3 cycles done

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
  - Pass: <description>
  - Concern: <file>:<line> — <description>
  - Issue: <file>:<line> — <description>
  `
})
```

## Apply Fixes from Layer 1

For each finding:
- **Obvious fixes** — apply immediately
- **Ambiguous** — present to user for decision

```bash
git add <fixed-files>
git commit -m "fix: address review findings

- <fix 1>
- <fix 2>"
```

## If Layer 1 Produced Fixes: Re-run Layer 0.5

When Layer 1 fixes introduce new code, re-run cleanup but **scoped to files changed by Layer 1 fixes only**. Same five categories, same order, same test-after-each rule. This prevents review fixes from introducing new slop.

```bash
# Get files changed by Layer 1 fixes
L1_FILES=$(git diff --name-only HEAD~1)
```

Run the cleanup agent again with the diff scoped to these files. Commit messages use the same pattern but this pass appears as "0.5 re-run" in the report.
