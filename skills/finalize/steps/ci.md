# Finalize — CI diagnosis helper (folded into the Step 3 collect phase)

This file is a **diagnosis-only helper** invoked from `steps/coderabbit.md`'s
Step 3b (collect phase) and Step 8 (re-poll). It no longer independently
invokes `/envoy:fix-ci` as a separate skill with its own commit/push loop —
that would defeat the point of the batch remediation cycle (one commit, one
push, one CI run per cycle). CI failures are diagnosed here; they get fixed
and committed together with CodeRabbit findings in `steps/coderabbit.md`
Steps 4-6.

### Poll CI Status

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

**If all checks pass:** no CI failures to add to this cycle's combined fix list.

### Diagnose Failures (Classify, Do Not Fix Yet)

For each failed check, download the log and classify — same classify table
`envoy:fix-ci` uses standalone (see `skills/fix-ci/SKILL.md` Step 3 for the
canonical reference; this is the same logic, reused rather than reimplemented):

```bash
OWNER=$(gh repo view --json owner -q '.owner.login')
REPO=$(gh repo view --json name -q '.name')
BRANCH=$(git branch --show-current)

FAILED_RUNS=$(gh run list --branch $BRANCH --status failure --json databaseId,name -q '.[] | .databaseId')
gh run view $RUN_ID --log-failed 2>&1
```

| Type | Signal | Action |
|------|--------|--------|
| `test-failure` | Failed test names, assertion errors, `FAIL`, `Expected X but got Y` | Add to fix list: read test + source, fix in Step 4 |
| `build-error` | `error CS`, `error TS`, `Cannot find module`, compilation errors with file:line | Add to fix list: fix compilation at error location |
| `lint-violation` | ESLint/Prettier errors, `warning`/`error` with rule name + file:line | Add to fix list: auto-fix (`--fix`) or manual fix |
| `infra-issue` | Runner unavailable, permissions, timeouts, Docker pull failures, OOM | **Escalate immediately** — don't add to fix list, don't try to fix |

**Scope note:** `gh pr checks` detects all failures — including external status
checks (e.g., Vercel, Netlify) — but log download via `gh run list` / `gh run view
--log-failed` only works for GitHub Actions runs. If a failed check has no
corresponding workflow run, classify it as `infra-issue` with the note: "External
status check — check the service directly."

### Infrastructure Failures Escalate Immediately

If ANY failure is classified as `infra-issue`, stop the remediation cycle and escalate:

```
**CI Infrastructure Failure — Cannot Auto-Fix**

| Workflow | Error | Type |
|----------|-------|------|
| <name> | <error excerpt> | infra-issue |

This is not a code issue. Possible causes:
- GitHub Actions runner unavailable
- Docker image pull failure
- Permission/secret configuration issue
- Resource limit (OOM, disk space)
- Network timeout

Please investigate the CI infrastructure.
```

**Do not attempt to fix infrastructure issues, and do not include them in the
combined fix list.** This is diagnosis-only escalation — no commit/push happens
for an infra-issue.

### Output: CI Failure Diagnoses for the Combined Fix List

Every non-infra failure diagnosed here (test-failure / build-error /
lint-violation) is added to the same combined fix list as the CodeRabbit
findings from Step 3a — they get fixed, committed, and pushed together in
`steps/coderabbit.md` Steps 4-6. There is no separate CI commit/push cycle.
