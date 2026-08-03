# Finalize — Steps 3–8: Batch remediation cycle (collect, fix, ONE commit, ONE push, reply/resolve, re-poll)

CodeRabbit findings and CI failures are remediated together in a single
**remediation cycle**, not as two independently-looping processes. A 9-finding
CodeRabbit review does not produce 9 commits, and a CI failure does not trigger
a second, separate push loop via `/envoy:fix-ci`. Every fix — whether it comes
from a CodeRabbit thread or a failing CI check — lands in the SAME ONE commit
and ONE push for this cycle.

Helper module: `lib/remediation-cycle.js` provides `buildCommitMessage(findings)`
(enumerates every finding with its thread URL, used in Step 5 below) and
`shouldEscalate(cycleCount, remaining)` (the cycle-cap check used in Step 6).

Helper module: `lib/coderabbit-retrigger.js` provides `shouldReTrigger(rateLimit, now, opts)`
and `formatHandoffMessage(resetsAt)` — the SAME shared helper `envoy:babysit` uses for
its own rate-limit re-trigger decision (Task 8). This is the ONE place the
wait/retrigger/handoff decision lives; do not re-derive it in prose here or in babysit.

### Step 3: Collect — Poll CodeRabbit AND Diagnose CI (Combined Fix List)

Announce: `Running Step 3: Collect CodeRabbit findings and diagnose CI failures...`

**3a. Poll CodeRabbit for unresolved threads (exponential backoff, unchanged):**

GitHub CodeRabbit App reviews the PR asynchronously. Poll with exponential backoff (22-minute max).

```bash
# CodeRabbit: 22min max (async review — GitHub App processes PR asynchronously)
PR_NUMBER=$(jq -r .prNumber .envoy/finalize/state.json)

# One snapshot source for the CodeRabbit signal: GraphQL unresolved review
# threads (REST comment counts miss inline threads, #25) plus rate-limit state.
PR_STATUS="node ${CLAUDE_SKILL_DIR}/../../lib/pr-status.js"

# Exponential backoff in seconds — 22min (1320s) max, extendable per
# lib/coderabbit-retrigger.js when a rate-limit reset is close (see below).
# intervals = [120s, 120s, 240s, 360s, 480s]
# cumulative =  2     4     8    14    22 min
ELAPSED=0
DEADLINE=1320
RETRIGGER_COUNT=$(jq -r '.retriggerCount // 0' .envoy/finalize/state.json 2>/dev/null || echo 0)
for WAIT in 120 120 240 360 480; do
  sleep $WAIT
  ELAPSED=$((ELAPSED + WAIT))

  # Probe is non-fatal: a pr-status failure must not abort the step under set -e/pipefail.
  SNAP=$($PR_STATUS "$PR_NUMBER" 2>/dev/null || true)

  # A missing snapshot (status probe failed) — keep polling, don't misread as clean.
  # Check before jq so jq never runs on empty input.
  if [ -z "$SNAP" ]; then
    echo "CodeRabbit status unavailable. $((ELAPSED / 60))min elapsed; retrying..."
    if [ "$ELAPSED" -ge "$DEADLINE" ]; then break; fi
    continue
  fi

  CR_STATE=$(echo "$SNAP" | jq -r '.coderabbit.checkState // empty')
  UNRESOLVED=$(echo "$SNAP" | jq -r '.coderabbit.unresolvedThreads // empty')
  RATE_LIMITED=$(echo "$SNAP" | jq -r '.coderabbit.rateLimit.rateLimited // empty')
  RESETS_AT=$(echo "$SNAP" | jq -r '.coderabbit.rateLimit.resetsAt // empty')

  # A rate-limited review is NOT a clean review. Consult the SHARED helper
  # (lib/coderabbit-retrigger.js — the SAME one envoy:babysit uses) for the
  # wait / retrigger / handoff decision. Max 2 re-triggers per finalize run.
  if [ "$RATE_LIMITED" = "true" ]; then
    DECISION=$(node -e '
      const { shouldReTrigger, formatHandoffMessage } = require("${CLAUDE_SKILL_DIR}/../../lib/coderabbit-retrigger.js");
      const result = shouldReTrigger(
        { rateLimited: true, resetsAt: process.env.RESETS_AT || null },
        new Date(),
        { currentDeadlineSeconds: Number(process.env.DEADLINE), retriggerCount: Number(process.env.RETRIGGER_COUNT), maxRetriggers: 2 }
      );
      if (result.action === "handoff") result.message = formatHandoffMessage(result.resetsAt);
      console.log(JSON.stringify(result));
    ' RESETS_AT="$RESETS_AT" DEADLINE="$DEADLINE" RETRIGGER_COUNT="$RETRIGGER_COUNT")

    ACTION=$(echo "$DECISION" | jq -r '.action')

    case "$ACTION" in
      handoff)
        # resetsAt is more than 10min away — do NOT block waiting. Exit
        # finalize with the explicit babysit handoff message.
        echo "$(echo "$DECISION" | jq -r '.message')"
        exit 0
        ;;
      wait)
        # resetsAt is <=10min away — extend the deadline (resetsAt+2min,
        # 60min hard ceiling) and keep polling.
        DEADLINE=$(echo "$DECISION" | jq -r '.extendedDeadlineSeconds')
        echo "CodeRabbit is rate-limited (resets $RESETS_AT). $((ELAPSED / 60))min elapsed; waiting (deadline now ${DEADLINE}s)..."
        if [ "$ELAPSED" -ge "$DEADLINE" ]; then break; fi
        continue
        ;;
      retrigger)
        # resetsAt has passed — re-trigger and reset the poll clock.
        gh pr comment "$PR_NUMBER" --body "@coderabbitai review"
        RETRIGGER_COUNT=$((RETRIGGER_COUNT + 1))
        jq --argjson n "$RETRIGGER_COUNT" '.retriggerCount = $n' .envoy/finalize/state.json > .envoy/finalize/state.json.tmp \
          && mv .envoy/finalize/state.json.tmp .envoy/finalize/state.json
        ELAPSED=0
        DEADLINE=1320
        echo "Re-triggered CodeRabbit (retrigger $RETRIGGER_COUNT/2). Poll clock reset."
        continue
        ;;
      capped)
        # Already used the max 2 re-triggers this run — stop asking it to
        # review again; surface and move on with whatever we have.
        echo "CodeRabbit re-trigger cap (2/2) reached this run. Not re-triggering again."
        break
        ;;
    esac
  fi

  # Unresolved CodeRabbit threads present — go address them.
  if [ "$UNRESOLVED" -gt 0 ]; then
    echo "CodeRabbit left $UNRESOLVED unresolved thread(s) after $((ELAPSED / 60))min. Addressing..."
    break
  fi

  # Terminal CodeRabbit check with zero unresolved threads — clean review.
  case "$CR_STATE" in
    SUCCESS|FAILURE|COMPLETED|NEUTRAL|SKIPPED|CANCELLED|TIMED_OUT|ACTION_REQUIRED)
      echo "CodeRabbit review settled ($CR_STATE), no unresolved threads after $((ELAPSED / 60))min."
      break
      ;;
  esac

  echo "CodeRabbit review still pending. $((ELAPSED / 60))min elapsed."
  if [ "$ELAPSED" -ge "$DEADLINE" ]; then break; fi
done
```

**Rate-limit re-trigger cap:** at most 2 re-triggers per finalize run, tracked via
`retriggerCount` in `.envoy/finalize/state.json`. Once capped, finalize stops
re-triggering and proceeds with whatever CodeRabbit state it has.

**If 22 minutes pass with no comments:**
```
CodeRabbit did not comment within 22 minutes. Proceeding without CodeRabbit.
(CodeRabbit may not be installed, or the PR is clean.)
```

**3b. Diagnose CI failures (no commit/push yet — diagnosis only):**

Run the CI diagnosis helper described in `steps/ci.md` (poll `gh pr checks`, classify
each failure using the same classify table `envoy:fix-ci` uses — `test-failure` /
`build-error` / `lint-violation` / `infra-issue` — and work out the fix for each).
This is diagnosis only: do NOT commit or push here, and do NOT invoke
`/envoy:fix-ci` as a separate skill — its independent commit/push loop is exactly
the churn this cycle replaces. If any failure is `infra-issue`, escalate immediately
per `steps/ci.md` and stop (infra issues are not fixable by remediation).

**3c. Combine into one fix list:**

Gather every CodeRabbit finding (from 3a) and every CI failure diagnosis (from 3b)
into ONE combined fix list for this cycle — regardless of whether a given CI
failure is related to a CodeRabbit finding. They share the same commit either way.

### Step 4: Fix — Apply Every Fix in the Combined List

Announce: `Running Step 4: Apply fixes for all CodeRabbit findings and CI failures...`

**No skipping — address everything including nitpicks.**

For each item in the combined fix list (CodeRabbit finding or CI failure diagnosis):
1. Read the finding/diagnosis
2. Apply the fix (or note why not applied, for CodeRabbit suggestions)
3. Verify CI-related fixes locally where practical (build/test/lint, per `steps/ci.md`)

Do NOT commit per item — all fixes for this cycle land in the single commit in Step 5.

### Step 5: Commit — Exactly ONE Commit, Enumerating Every Finding

Announce: `Running Step 5: Commit all fixes (one commit for this cycle)...`

Build the commit message with `lib/remediation-cycle.js`'s `buildCommitMessage(findings)` —
it enumerates every finding addressed, with its thread URL for CodeRabbit findings, so the
mapping between "what changed" and "which thread it resolves" survives in git history.

```bash
git add <all changed files for this cycle>
COMMIT_MSG=$(node -e '
  const { buildCommitMessage } = require("${CLAUDE_SKILL_DIR}/../../lib/remediation-cycle.js");
  const findings = JSON.parse(process.env.FINDINGS_JSON);
  console.log(buildCommitMessage(findings));
')
git commit -m "$COMMIT_MSG"
```

Exactly ONE commit for this cycle — every CodeRabbit finding and every CI failure
fixed in Steps 3-4 is enumerated in this one commit's body.

### Step 6: Push — Exactly ONE Push

Announce: `Running Step 6: Push (one push for this cycle)...`

```bash
git push
```

Exactly ONE push per cycle — this triggers exactly ONE CI run, not one per finding.

### Step 7: Reply + Resolve — Cite the Same Commit SHA

Announce: `Running Step 7: Reply and resolve CodeRabbit threads...`

```bash
# Reply with fix + the SAME commit hash from Step 5 for every thread addressed
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

Every reply for this cycle cites the same `$COMMIT` SHA — the one commit from Step 5.

### Step 8: Re-poll Both CodeRabbit and CI (Max 3 Cycles, with Completion Signal)

Announce: `Running Step 8: Re-poll CodeRabbit and CI...`

After pushing, CodeRabbit may open new review threads on the fixes, and the push
triggers exactly one new CI run. Check both.

**CodeRabbit — completion signal pattern (async, unchanged from before):**

A settled review — not rate-limited AND zero unresolved CodeRabbit threads — must be confirmed 3 consecutive times before the loop stops; a single check could miss threads still being posted. Output `ENVOY_LOOP_COMPLETE` on each settled check; reset the counter when threads remain unresolved (or the status is rate-limited/unavailable).

```bash
# Each step is a separate shell invocation — re-derive PR_NUMBER and PR_STATUS here.
PR_NUMBER=$(jq -r .prNumber .envoy/finalize/state.json)
PR_STATUS="node ${CLAUDE_SKILL_DIR}/../../lib/pr-status.js"
# Probe is non-fatal: a pr-status failure must not abort the step under set -e/pipefail.
SNAP=$($PR_STATUS "$PR_NUMBER" 2>/dev/null || true)

# A missing snapshot means the status probe failed — do NOT treat that as a clean
# review. Check before jq (same guard as Step 3) so jq never runs on empty input.
if [ -z "$SNAP" ]; then
  echo "CodeRabbit status unavailable — reset completion counter"
else
  UNRESOLVED=$(echo "$SNAP" | jq -r '.coderabbit.unresolvedThreads // empty')
  RATE_LIMITED=$(echo "$SNAP" | jq -r '.coderabbit.rateLimit.rateLimited // empty')
  if [ -n "$UNRESOLVED" ] && [ "$RATE_LIMITED" != "true" ] && [ "$UNRESOLVED" -eq 0 ]; then
    echo "ENVOY_LOOP_COMPLETE — no unresolved CodeRabbit threads (check N/3)"
  else
    echo "Unresolved CodeRabbit threads: ${UNRESOLVED:-unknown} (rate-limited: ${RATE_LIMITED:-unknown}) — reset completion counter"
  fi
fi
```

**CI — a fresh read is enough (synchronous, not async like CodeRabbit):**

```bash
gh pr checks $PR_NUMBER --json name,state,conclusion
```

**If either CodeRabbit threads or CI failures remain:** that is the next cycle's
Step 3 collect phase — go back to Step 3 with the remaining items. Reset the
CodeRabbit completion counter.

**Cycle cap check:** use `lib/remediation-cycle.js`'s `shouldEscalate(cycleCount, remaining)`
— max 3 full remediation cycles (collect → fix → commit → push → reply+resolve → re-poll
counts as one cycle). If cycle 3 completes and `shouldEscalate` is true (issues remain),
STOP — do not attempt a 4th cycle, do not silently finish. Surface exactly:

```
**Remediation cycle limit reached (3/3)**

These remain unresolved:
- <CodeRabbit thread / CI failure 1>
- <CodeRabbit thread / CI failure 2>

Options:
  A) Run another cycle
  B) Finish with these left open
  C) Abort

Awaiting your decision.
```

Await the user's decision — never auto-continue past cycle 3 and never auto-finish
with open threads/failures.
