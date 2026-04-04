---
name: coderabbit-pr-review
description: Use when a PR has GitHub CodeRabbit comments that need to be addressed and resolved
---

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
gh api graphql -f query='
  query {
    repository(owner: "'$OWNER'", name: "'$REPO'") {
      pullRequest(number: <pr-number>) {
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
'
```

### Step 7: Push Fixes

```bash
git push
```

### Step 8: Verify Resolution

```bash
# Check for any remaining unresolved threads
UNRESOLVED=$(gh api graphql -f query='
  query {
    repository(owner: "'$OWNER'", name: "'$REPO'") {
      pullRequest(number: <pr-number>) {
        reviewThreads(first: 100) {
          nodes { isResolved }
        }
      }
    }
  }
' --jq '.data.repository.pullRequest.reviewThreads.nodes | map(select(.isResolved == false)) | length')

echo "Unresolved threads: $UNRESOLVED"
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

- Called by `envoy:finishing-branch` during the review cycle
- Uses `envoy:verification` to verify fixes work
- Respects `envoy:receiving-code-review` principles (verify before implementing)
