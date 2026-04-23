# Finalize — Steps 3–7: CodeRabbit polling, address, resolve, re-poll

### Step 3: Poll for CodeRabbit Comments (Exponential Backoff)

Announce: `Running Step 3: Poll for CodeRabbit comments...`

GitHub CodeRabbit App reviews the PR asynchronously. Poll with exponential backoff (22-minute max).

```bash
# CodeRabbit: 22min max (async review — GitHub App processes PR asynchronously)
PR_NUMBER=$(jq -r .prNumber .envoy/finalize/state.json)

# Exponential backoff in seconds — 22min (1320s) max
# intervals = [120s, 120s, 240s, 360s, 480s]
# cumulative =  2     4     8    14    22 min
ELAPSED=0
for WAIT in 120 120 240 360 480; do
  sleep $WAIT
  ELAPSED=$((ELAPSED + WAIT))

  COMMENTS=$(gh api repos/$OWNER/$REPO/pulls/$PR_NUMBER/comments \
    --jq '[.[] | select(.user.login == "coderabbitai")] | length')

  if [ "$COMMENTS" -gt 0 ]; then
    echo "CodeRabbit left $COMMENTS comments after $((ELAPSED / 60))min. Addressing..."
    break
  fi

  echo "No CodeRabbit comments yet. $((ELAPSED / 60))min elapsed."
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
LAST_PUSH=$(git log -1 --format=%cI)
NEW_COMMENTS=$(gh api repos/$OWNER/$REPO/pulls/$PR_NUMBER/comments \
  --jq "[.[] | select(.user.login == \"coderabbitai\") | select(.created_at > \"$LAST_PUSH\")] | length")

if [ "$NEW_COMMENTS" -eq 0 ]; then
  echo "ENVOY_LOOP_COMPLETE — no new comments (check N/3)"
else
  echo "New comments found: $NEW_COMMENTS — reset completion counter"
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
