---
name: coderabbit-pr-review
description: CodeRabbit PR reviewer expert. ALWAYS invoke when a PR has CodeRabbit comments to address or when the /envoy:coderabbit-pr-review command fires. Fixes every finding, replies and resolves each thread. Do not ignore or cherry-pick findings.
when_to_use:
  - When coderabbitai has posted comments on the current PR
  - When the user types /envoy:coderabbit-pr-review
  - As part of /envoy:finalize Steps 3–7
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - Skill
  - WebFetch
hooks:
  PreToolUse:
    - matcher: Agent
      command: node ${CLAUDE_SKILL_DIR}/hooks/agent-guard.js
      once: true
  Stop:
    - command: node ${CLAUDE_SKILL_DIR}/hooks/stop-audit.js
      once: true
---

## Briefing

!`node ${CLAUDE_SKILL_DIR}/preflight.js`

# CodeRabbit PR Comment Resolution

## Overview

Parse GitHub CodeRabbit PR comments, apply fixes, reply with commit hash, and resolve each conversation thread. Address ALL findings including nitpicks.

**Announce at start:** "I'm using envoy:coderabbit-pr-review to address CodeRabbit PR comments."

## Arguments

| Flag | Effect |
|------|--------|
| `<pr-number>` | Required: PR number to process |

## Process

### Step 1: Fetch PR Comments

```bash
# Get all review comments on the PR
OWNER=$(gh repo view --json owner -q '.owner.login')
REPO=$(gh repo view --json name -q '.name')

gh api repos/$OWNER/$REPO/pulls/<pr-number>/comments \
  --jq '.[] | select(.user.login == "coderabbitai" or .user.login == "github-actions[bot]") | {id, path, line, body, created_at, in_reply_to_id}'
```

### Step 2: Parse Each Comment (Regex-First)

Use `lib/coderabbit-parser.js` for regex-first parsing — avoids LLM tokens for 95%+ of comments:

```javascript
const { parseComments } = require('../../lib/coderabbit-parser');
const result = parseComments(comments);
// result.parsed — array of { path, line, severity, suggestion, category, confidence, needsLLM }
// result.regexRate — e.g., "96%"
```

**If `lib/coderabbit-parser.js` is not available or throws an error:**
Fall back to LLM parsing for ALL comments — apply the Haiku fallback below to each comment. Do not fail silently; log: "coderabbit-parser unavailable — falling back to LLM parsing for all <N> comments."

**For comments where `needsLLM: true` (confidence < 0.95):**
Send to a Haiku agent for structured extraction (cheap fallback):

```
Agent({
  model: "haiku",
  description: "Parse CodeRabbit comment",
  prompt: `Extract from this CodeRabbit comment:
  - file path
  - line number
  - severity (critical/warning/suggestion/nitpick)
  - suggested fix

  Comment: <body>

  Output as JSON.`
})
```

### Step 3: Categorize Findings

Group by severity but **address ALL of them**:

1. **Critical** (🔴) — Security, correctness, data loss risks
2. **Warning** (🟡) — Performance, maintainability issues
3. **Suggestion** (💡) — Better approaches, patterns
4. **Nitpick** (🔵) — Style, naming, minor improvements

**No skipping.** Every finding gets addressed.

Report parsing efficiency:
```
Parsed 12 comments: 11 by regex (92%), 1 by Haiku fallback
```

### Step 4: Apply Fixes

For each finding, in order of severity:

```bash
# 1. Read the file at the indicated line
# 2. Understand the context and suggestion
# 3. Apply the fix
# 4. Stage and commit

git add <file>
git commit -m "fix: <brief description of fix>

Addresses CodeRabbit comment on <file>:<line>"
```

**Important:** If a suggestion is wrong or inapplicable, still reply explaining why it was not applied.

### Step 5: Reply to Each Comment

After fixing, reply to the original comment:

```bash
# Reply with fix details + commit hash
COMMIT_HASH=$(git rev-parse --short HEAD)

gh api repos/$OWNER/$REPO/pulls/<pr-number>/comments/<comment-id>/replies \
  --method POST \
  --field body="Fixed in \`$COMMIT_HASH\`. <explanation of what was changed>"
```

For suggestions not applied:
```bash
gh api repos/$OWNER/$REPO/pulls/<pr-number>/comments/<comment-id>/replies \
  --method POST \
  --field body="Not applied: <explanation why>. The current approach <reason>."
```

### Step 6: Resolve Conversation Threads

After replying, resolve each conversation:

```bash
# Resolve the review thread using GraphQL
gh api graphql -f query='
  mutation {
    resolveReviewThread(input: {threadId: "<thread-node-id>"}) {
      thread { isResolved }
    }
  }
'
```

**Note:** You need the thread's node ID, which may require fetching via GraphQL:

```bash
gh api graphql \
  -f query='
    query($owner:String!, $repo:String!, $pr:Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) {
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              comments(first: 1) {
                nodes { body }
              }
            }
          }
        }
      }
    }
  ' \
  -F owner="$OWNER" \
  -F repo="$REPO" \
  -F pr=<pr-number>
```

### Step 7: Push Fixes

```bash
git push
```

### Step 8: Verify Resolution

Read the remaining unresolved-thread count from the single status source
(`lib/pr-status.js`) — its `.threads.unresolved` field counts unresolved review
threads from every author via GraphQL:

```bash
PR_NUMBER=<pr-number>
PR_STATUS="node ${CLAUDE_SKILL_DIR}/../../lib/pr-status.js"

# Probe is non-fatal: a pr-status failure must not abort under set -e/pipefail.
SNAP=$($PR_STATUS "$PR_NUMBER" 2>/dev/null || true)

# Check for an empty snapshot before jq so jq never runs on empty input.
if [ -z "$SNAP" ]; then
  echo "PR status unavailable — could not read unresolved thread count."
else
  UNRESOLVED=$(echo "$SNAP" | jq -r '.threads.unresolved // empty')
  echo "Unresolved threads: $UNRESOLVED"
fi
```

### Step 9: Report

```
**CodeRabbit PR comments addressed**

| Severity | Count | Status |
|----------|-------|--------|
| 🔴 Critical | <N> | All fixed |
| 🟡 Warning | <N> | All fixed |
| 💡 Suggestion | <N> | <N> applied, <N> explained |
| 🔵 Nitpick | <N> | All fixed |

Commits: <N> fix commits pushed
Unresolved threads: 0
```

## Error Handling

### No CodeRabbit Comments Found

```
No CodeRabbit comments found on PR #<number>.

CodeRabbit may still be processing. Wait 2-3 minutes and try again:
/envoy:coderabbit-pr-review <pr-number>
```

### Cannot Resolve Thread

```
Could not resolve thread for comment <id>.
This may require manual resolution on GitHub.

Thread URL: <link>
```

## Integration with Envoy

- Called by `envoy:finalize` during the review cycle
- Uses `envoy:verification` to verify fixes work
- Respects `envoy:receiving-code-review` principles (verify before implementing)
