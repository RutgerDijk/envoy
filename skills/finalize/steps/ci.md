# Finalize — Step 8: Poll CI and auto-fix failures

### Step 8: Poll CI and Auto-Fix Failures

Announce: `Running Step 8: Poll CI...`

After CodeRabbit is resolved, poll GitHub Actions for CI status:

```bash
# CI: 15min max (synchronous checks, faster feedback loop)
# Poll with exponential backoff — 15min timeout
# intervals: 30s, 60s, 120s, 240s, 240s, 240s (cumulative: 15.5min)
ELAPSED=0
for WAIT in 30 60 120 240 240 240; do
  CHECKS=$(gh pr checks $PR_NUMBER --json name,state,conclusion 2>/dev/null)
  PENDING=$(echo "$CHECKS" | jq '[.[] | select(.state == "PENDING" or .state == "QUEUED")] | length')

  if [ "$PENDING" -eq 0 ]; then
    break  # All checks resolved
  fi

  ELAPSED=$((ELAPSED + WAIT))
  if [ "$ELAPSED" -ge 900 ]; then
    echo "CI checks still running after 15 minutes. Pending: $PENDING"
    break
  fi

  echo "CI checks still running ($PENDING pending, ${ELAPSED}s elapsed). Next poll in ${WAIT}s..."
  sleep $WAIT
done

FAILED=$(echo "$CHECKS" | jq '[.[] | select(.conclusion == "FAILURE")] | length')
```

**If all checks pass:** proceed to final verification (Step 9).

**If any checks fail:** invoke fix-ci logic:

```
/envoy:fix-ci $PR_NUMBER
```

This runs the full fix-ci cycle: classify failures, diagnose, fix, verify locally, push, re-poll. Max 3 fix cycles before escalation.

**After fix-ci completes (or escalates):** proceed to final verification.
