# Review — Layer 1: AI code review (Small+ tiers)

Announce: `Running Layer 1: AI Code Review...`

**YOU MUST spawn an Agent tool call here with `subagent_type: "envoy:code-reviewer"`. Inline review without spawning an agent is wrong. Do not skip this.**

**If you do not spawn an Agent tool call, STOP — do not proceed to Layer 2.**

Spawn a fresh agent — on the model chosen in Pre-Review Setup step 6
(`state.workerModel`) — with NO implementation context. The agent uses
**iterative retrieval** to understand codebase context. Build the prompt
string first, then route it through `lib/model-dispatch.js`'s
`dispatch()` so the model choice (including kimi's headless path)
determines how it's dispatched, not the prompt text:

```javascript
const { dispatch } = require('../../lib/model-dispatch');

const reviewPrompt = `You are reviewing code changes. Context provided via files, not inline.

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
`;

// This layer is read-only. Declare that as a tool surface, not just as
// prompt text — on the kimi path dispatch() turns it into an actual
// `--allowed-tools` restriction on an unsupervised background process.
const descriptor = dispatch({
  model: state.workerModel,
  prompt: reviewPrompt,
  taskId: 'ai-review',
  allowedTools: ['Read', 'Grep', 'Glob'],
});

if (descriptor.kind === 'agent') {
  // fable/opus/sonnet/haiku — Agent tool can name the model directly.
  Agent({
    subagent_type: "envoy:code-reviewer",
    model: descriptor.model,
    description: "AI code review",
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
  // incrementally, so reading it early yields a truncated review.
  // Poll BashOutput(shell_id) until it reports the shell has exited
  // (or use Monitor to block on that condition), THEN read
  // descriptor.outputFile (run-unique, under .envoy/agent-output/) as the
  // reviewer's findings, in place of an Agent-tool return value.
}
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
