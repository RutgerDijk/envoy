# Finalize — Steps 3–7: CodeRabbit polling, address, resolve, re-poll

### Step 3: Poll for CodeRabbit Comments (Exponential Backoff)

Announce: `Running Step 3: Poll for CodeRabbit comments...`

GitHub CodeRabbit App reviews the PR asynchronously. Poll with exponential backoff (22-minute max).

```bash
# CodeRabbit: 22min max (async review — GitHub App processes PR asynchronously)
PR_NUMBER=$(jq -r .prNumber .envoy/finalize/state.json)

# One snapshot source for the CodeRabbit signal: GraphQL unresolved review
# threads (REST comment counts miss inline threads, #25) plus rate-limit state.
PR_STATUS="node ${CLAUDE_SKILL_DIR}/../../lib/pr-status.js"

# Exponential backoff in seconds — 22min (1320s) max
# intervals = [120s, 120s, 240s, 360s, 480s]
# cumulative =  2     4     8    14    22 min
ELAPSED=0
for WAIT in 120 120 240 360 480; do
  sleep $WAIT
  ELAPSED=$((ELAPSED + WAIT))

  SNAP=$($PR_STATUS "$PR_NUMBER")
  CR_STATE=$(echo "$SNAP" | jq -r '.coderabbit.checkState')
  UNRESOLVED=$(echo "$SNAP" | jq -r '.coderabbit.unresolvedThreads')
  RATE_LIMITED=$(echo "$SNAP" | jq -r '.coderabbit.rateLimit.rateLimited')
  RESETS_AT=$(echo "$SNAP" | jq -r '.coderabbit.rateLimit.resetsAt')

  # A rate-limited review is NOT a clean review — keep waiting past the reset.
  if [ "$RATE_LIMITED" = "true" ]; then
    echo "CodeRabbit is rate-limited (resets $RESETS_AT). $((ELAPSED / 60))min elapsed; waiting..."
    if [ "$ELAPSED" -ge 1320 ]; then break; fi
    continue
  fi

  # Unresolved CodeRabbit threads present — go address them.
  if [ "$UNRESOLVED" -gt 0 ]; then
    echo "CodeRabbit left $UNRESOLVED unresolved thread(s) after $((ELAPSED / 60))min. Addressing..."
    break
  fi

  # Terminal CodeRabbit check with zero unresolved threads — clean review.
  case "$CR_STATE" in
    SUCCESS|FAILURE|COMPLETED|NEUTRAL|SKIPPED)
      echo "CodeRabbit review complete, no unresolved threads after $((ELAPSED / 60))min."
      break
      ;;
  esac

  echo "CodeRabbit review still pending. $((ELAPSED / 60))min elapsed."
  if [ "$ELAPSED" -ge 1320 ]; then break; fi
done
```

**If 22 minutes pass with no comments:**
```
CodeRabbit did not comment within 22 minutes. Proceeding without CodeRabbit.
(CodeRabbit may not be installed, or the PR is clean.)
```

Skip to CI checks (Step 8).

### Step 4: Address All CodeRabbit Findings

Announce: `Running Step 4: Address CodeRabbit findings...`

**No skipping — address everything including nitpicks.**

For each CodeRabbit comment:
1. Read the suggestion
2. Apply the fix (or explain why not)
3. Commit

```bash
git add <changed-files>
git commit -m "fix: address CodeRabbit feedback — <summary>"
```

### Step 5: Reply and Resolve Each Comment

Announce: `Running Step 5: Reply and resolve comments...`

```bash
# Reply with fix + commit hash
COMMIT=$(git rev-parse --short HEAD)
gh api repos/$OWNER/$REPO/pulls/$PR_NUMBER/comments/<id>/replies \
  --method POST \
  --field body="Fixed in \`$COMMIT\`. <explanation>"
```

Resolve threads via GraphQL:

```bash
gh api graphql -f query='
  mutation {
    resolveReviewThread(input: {threadId: "<thread-node-id>"}) {
      thread { isResolved }
    }
  }
'
```

For suggestions not applied:

```bash
gh api repos/$OWNER/$REPO/pulls/$PR_NUMBER/comments/<id>/replies \
  --method POST \
  --field body="Not applied: <reason>. The current approach <explanation>."
```

### Step 6: Push Fixes

Announce: `Running Step 6: Push fixes...`

```bash
git push
```

### Step 7: Re-poll (Max 3 Cycles, with Completion Signal)

Announce: `Running Step 7: Re-poll for new comments...`

After pushing, CodeRabbit may leave new comments on the fixes. Use the **completion signal pattern** (inline):

"No new comments" must be confirmed 3 consecutive times before the loop stops — a single check could miss comments still being posted. Output `ENVOY_LOOP_COMPLETE` on each clean check; reset the counter when new comments appear.

```bash
PR_STATUS="node ${CLAUDE_SKILL_DIR}/../../lib/pr-status.js"
SNAP=$($PR_STATUS "$PR_NUMBER")
UNRESOLVED=$(echo "$SNAP" | jq -r '.coderabbit.unresolvedThreads')
RATE_LIMITED=$(echo "$SNAP" | jq -r '.coderabbit.rateLimit.rateLimited')

# Completion requires a settled review: not rate-limited AND zero unresolved
# CodeRabbit threads (GraphQL reviewThreads, not a REST comment count).
if [ "$RATE_LIMITED" != "true" ] && [ "$UNRESOLVED" -eq 0 ]; then
  echo "ENVOY_LOOP_COMPLETE — no unresolved CodeRabbit threads (check N/3)"
else
  echo "Unresolved CodeRabbit threads: $UNRESOLVED (rate-limited: $RATE_LIMITED) — reset completion counter"
fi
```

**If new comments:** address -> reply -> resolve -> push -> re-poll. Reset completion counter.

**Max 3 address-and-push cycles.** After 3 cycles with remaining issues:

```
**Escalation: CodeRabbit cycle limit reached**

After 3 cycles, these comments remain unresolved:
- <comment 1>
- <comment 2>

Please review and decide how to proceed.
```
