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

Helper module: `lib/pr-poll.js` is the ONE backgrounded wait for both CodeRabbit (Step 3a)
and CI (`steps/ci.md`). It owns the backoff table, calls `shouldReTrigger` itself, and
exits 0 settled / 1 deadline / 2 handoff / 3 probe unavailable. Every wait in finalize
is a single Bash call to it with `run_in_background: true`. There are no foreground wait loops.

### Step 3: Collect — Poll CodeRabbit AND Diagnose CI (Combined Fix List)

Announce: `Running Step 3: Collect CodeRabbit findings and diagnose CI failures...`

```bash
PR_URL=$(jq -r '.prUrl // empty' .envoy/finalize/state.json 2>/dev/null || true)
echo "PR: $PR_URL"
```

**3a. Wait for CodeRabbit in the background (`lib/pr-poll.js`):**

The GitHub CodeRabbit App reviews the PR asynchronously. Do NOT wait in the
foreground. Run this as ONE Bash call with `run_in_background: true`. The
session stays free, and Claude is re-invoked when the poller exits:

```bash
# Run with run_in_background: true. Claude is re-invoked when it exits.
PR_NUMBER=$(jq -r .prNumber .envoy/finalize/state.json)
RETRIGGER_COUNT=$(jq -r '.retriggerCount // 0' .envoy/finalize/state.json 2>/dev/null || echo 0)
node ${CLAUDE_SKILL_DIR}/../../lib/pr-poll.js "$PR_NUMBER" --target coderabbit --retrigger-count "$RETRIGGER_COUNT"
```

The poller owns the backoff table (probes at 2, 4, 8, 14 and 22 min; 1320s default
deadline). Each probe reads one `lib/pr-status.js` snapshot (GraphQL
`unresolvedThreads` plus `rateLimit`), and the rate-limit decision comes from
`shouldReTrigger`. It prints one line per probe. When it exits, branch on the exit
code and the last line:

- **Exit 0 (settled).** The last line gives the reason:
  - `settled: unresolved=N`: CodeRabbit left N unresolved threads. Add them to the combined fix list.
  - `settled: clean (...)`: the review finished with no unresolved threads. No CodeRabbit findings this cycle.
  - `settled: retrigger`: the rate-limit reset has passed. Post the re-trigger, bump `retriggerCount`, then run the background wait above again (a fresh run resets the poll clock):
    ```bash
    PR_NUMBER=$(jq -r .prNumber .envoy/finalize/state.json)
    gh pr comment "$PR_NUMBER" --body "@coderabbitai review"
    jq '.retriggerCount = ((.retriggerCount // 0) + 1)' .envoy/finalize/state.json > .envoy/finalize/state.json.tmp \
      && mv .envoy/finalize/state.json.tmp .envoy/finalize/state.json
    ```
  - `settled: capped`: the 2 re-triggers for this run are used up. Do not re-trigger again. Proceed with whatever CodeRabbit state exists.
- **Exit 1 (deadline).** The deadline passed with the review still pending. Report this and proceed without CodeRabbit:
  ```
  CodeRabbit did not comment within 22 minutes. Proceeding without CodeRabbit.
  (CodeRabbit may not be installed, or the PR is clean.)
  ```
- **Exit 2 (handoff).** The rate limit resets more than 10 min out. Relay the line's `run /envoy:babysit after HH:MM` message verbatim and STOP finalize. Do not wait.
- **Exit 3 (probe unavailable).** `pr-status.js` could not be read. Never treat this as a clean review. Re-run the background wait once. If it exits 3 again, report "CodeRabbit status unavailable" and stop for the user.

**Rate-limit re-trigger cap:** at most 2 re-triggers per finalize run, tracked via
`retriggerCount` in `.envoy/finalize/state.json` and passed to the poller as
`--retrigger-count`. Once capped, finalize stops re-triggering and proceeds with
whatever CodeRabbit state it has.

**3b. Diagnose CI failures (no commit/push yet — diagnosis only):**

Run the CI diagnosis helper described in `steps/ci.md` (wait for CI in the background via
`lib/pr-poll.js --target ci`, read `gh pr checks`, classify
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

```bash
PR_URL=$(jq -r '.prUrl // empty' .envoy/finalize/state.json 2>/dev/null || true)
echo "PR: $PR_URL"
```

**No skipping — address everything including nitpicks.**

For each item in the combined fix list (CodeRabbit finding or CI failure diagnosis):
1. Read the finding/diagnosis
2. Apply the fix (or note why not applied, for CodeRabbit suggestions)
3. Verify CI-related fixes locally where practical (build/test/lint, per `steps/ci.md`)

Do NOT commit per item — all fixes for this cycle land in the single commit in Step 5.

### Step 5: Commit — Exactly ONE Commit, Enumerating Every Finding

Announce: `Running Step 5: Commit all fixes (one commit for this cycle)...`

```bash
PR_URL=$(jq -r '.prUrl // empty' .envoy/finalize/state.json 2>/dev/null || true)
echo "PR: $PR_URL"
```

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
PR_URL=$(jq -r '.prUrl // empty' .envoy/finalize/state.json 2>/dev/null || true)
echo "PR: $PR_URL"
```

**Re-check main-drift before this push.** Drift can land mid-loop — someone
may have merged a conflicting PR into `origin/main` while this run was
looping through CodeRabbit/CI cycles. The Preconditions check (Step 1) only
caught drift present at finalize's start; re-run the SAME check here, every
cycle, right before pushing:

```bash
node -e '
  const { computeDrift } = require("${CLAUDE_SKILL_DIR}/../../lib/main-drift.js");
  const result = computeDrift(process.cwd());
  console.log(result.message);
  if (result.hasDrift) console.log("__ENVOY_MAIN_DRIFT__");
'
```

**If `__ENVOY_MAIN_DRIFT__` printed, stop before pushing and present the
rebase/merge/proceed options (A/B/C) to the user.** Drift with no overlapping
files is informational only — the note prints but does not stop the push.

```bash
git push
```

Exactly ONE push per cycle — this triggers exactly ONE CI run, not one per finding.

### Step 7: Reply + Resolve — Cite the Same Commit SHA

Announce: `Running Step 7: Reply and resolve CodeRabbit threads...`

```bash
PR_URL=$(jq -r '.prUrl // empty' .envoy/finalize/state.json 2>/dev/null || true)
echo "PR: $PR_URL"
```

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

```bash
PR_URL=$(jq -r '.prUrl // empty' .envoy/finalize/state.json 2>/dev/null || true)
echo "PR: $PR_URL"
```

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
gh pr checks $PR_NUMBER --json name,state,bucket
```

**If either CodeRabbit threads or CI failures remain:** that is the next cycle's
Step 3 collect phase — go back to Step 3 with the remaining items. Reset the
CodeRabbit completion counter.

**Last step before merge:** once CodeRabbit is settled, no CI failures remain, and no
push is pending, if `ci.fullSuiteOwed` is true run the "Last Step: Full-Suite Run" in
`steps/ci.md` (exit 3 = re-poll on the next pass, never a failure or escalation).

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
