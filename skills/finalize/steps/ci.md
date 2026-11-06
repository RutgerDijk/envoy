# Finalize — CI diagnosis helper (folded into the Step 3 collect phase)

This file is a **diagnosis-only helper** invoked from `steps/coderabbit.md`'s
Step 3b (collect phase) and Step 8 (re-poll). It no longer independently
invokes `/envoy:fix-ci` as a separate skill with its own commit/push loop —
that would defeat the point of the batch remediation cycle (one commit, one
push, one CI run per cycle). CI failures are diagnosed here; they get fixed
and committed together with CodeRabbit findings in `steps/coderabbit.md`
Steps 4-6.

### Wait for CI in the background (`lib/pr-poll.js`)

Do NOT wait in the foreground. Run this as ONE Bash call with `run_in_background: true`.
The session stays free, and Claude is re-invoked when the poller exits:

```bash
# Run with run_in_background: true. Claude is re-invoked when it exits.
# CI: 15min max (synchronous checks, faster feedback loop than CodeRabbit).
PR_NUMBER=$(jq -r .prNumber .envoy/finalize/state.json)
node ${CLAUDE_SKILL_DIR}/../../lib/pr-poll.js "$PR_NUMBER" --target ci --deadline 900
```

The poller owns the backoff table. It probes at once, then after 30, 60, 120, 240, 240
and 240s, clamped to the deadline. Each probe reads one `lib/pr-status.js` snapshot and
prints one line. It settles once at least one check is registered and none is still
pending. A freshly pushed PR with no checks yet counts as pending. When it exits, branch on
the exit code:

- **Exit 0 (settled).** Every check has finished. Run "Read CI Status" below.
- **Exit 1 (deadline).** Report `CI checks still running after 15 minutes.`, then run
  "Read CI Status" anyway. Pending checks are not failures: `FAILED` counts only
  fail/cancel, and the Step 8 re-poll picks up the rest.
- **Exit 2 (handoff).** Only the `coderabbit` target produces this. If it ever appears here, treat it as exit 3.
- **Exit 3 (persistently unavailable).** `pr-status.js` failed on 3 consecutive probes (the
  poller already tolerates 1-2 transient failures and retries them itself), or the poller crashed.
  Do not re-run the wait. Report the poller's last line, then run "Read CI Status" anyway. An
  unreadable `gh pr checks` makes `FAILED` "unknown", which fails closed (never treated as green).

### Read CI Status (after the wait)

```bash
PR_NUMBER=$(jq -r .prNumber .envoy/finalize/state.json)
# `gh pr checks` has no `conclusion` field: use `bucket` (pass|fail|pending|skipping|cancel).
# It exits 8 while checks are pending/failing but still prints the JSON, so keep stdout
# and validate it. A failed query yields an empty CHECKS and the counts become "unknown"
# (never 0): fail closed.
fetch_checks() {
  local out
  out=$(gh pr checks "$PR_NUMBER" --json name,state,bucket 2>/dev/null)
  if printf '%s' "$out" | jq -e 'type == "array"' >/dev/null 2>&1; then printf '%s' "$out"; fi
}
count_checks() {  # usage: count_checks <jq args...> <filter>; prints a number or "unknown"
  if [ -z "$CHECKS" ]; then echo unknown; return; fi
  printf '%s' "$CHECKS" | jq "$@" 2>/dev/null || echo unknown
}
# CodeRabbit's own check is not CI (the coderabbit wait owns it), so both counts leave it out.
PENDING_JQ='[.[] | select(((.name // "") | test("coderabbit"; "i")) | not) | select((.bucket // "") == "pending")] | length'
# "cancel" counts as failing: a cancelled check is not green (lib/pr-status.js treats CANCELLED as failing too).
FAILED_JQ='[.[] | select(((.name // "") | test("coderabbit"; "i")) | not) | select((.bucket // "") == "fail" or (.bucket // "") == "cancel")
        | select(($skip == "true" and ((.name // "") | ascii_downcase) == ($gate | ascii_downcase)) | not)] | length'

CHECKS=$(fetch_checks)   # ONE read, after the background wait has exited
PENDING=$(count_checks "$PENDING_JQ")   # non-zero only after an exit-1 (deadline) wait
echo "CI checks still pending: $PENDING"

# Check the FULL SUITE NOT RUN marker BEFORE treating CI as failed or passed.
PR_STATUS="node ${CLAUDE_SKILL_DIR}/../../lib/pr-status.js"
SNAP=$($PR_STATUS "$PR_NUMBER")   # ONE snapshot; both flags below read from it
SUITE_NOT_RUN=$(echo "$SNAP" | jq -r '.ci.fullSuiteSkipped')
SUITE_OWED=$(echo "$SNAP" | jq -r '.ci.fullSuiteOwed')

# A marker-red ci-gate is not a code failure: exclude it from FAILED.
GATE="${ENVOY_CI_GATE_CHECK:-ci-gate}"
FAILED=$(count_checks --arg skip "$SUITE_NOT_RUN" --arg gate "$GATE" "$FAILED_JQ")
```

`FAILED` is a number or `unknown`. `unknown` (the `gh pr checks` query failed or returned
non-JSON) is NOT zero failures: do not treat CI as green and do not enter the last step; re-poll.

`fullSuiteSkipped` = `true` means the CI gate failed with a `FULL SUITE NOT RUN` annotation:
CI is RED because the full suite was not run, not because of a code failure. Do not diagnose
it as a failure (the red `ci-gate` is excluded from `FAILED` above) and do NOT label or rerun
on first sight: the `full-ci` label is the LAST step before merge (see below). Any other real
failure still lands in `FAILED` and is fixed first.

### Last Step: Full-Suite Run (only when `fullSuiteOwed`)

`fullSuiteOwed` = `true` means the marker is the ONLY red or pending thing on the head SHA
(the fast run is green, the full run is owed). Run this step only when ALL of these hold:
CodeRabbit is resolved (the Step 8 completion signal in `steps/coderabbit.md`), `FAILED` is 0,
and no fix commit or push is pending from the CodeRabbit/CI loops. Otherwise skip it; finish
those first.

```bash
# Preconditions in the guard (fail closed): no failures, clean tree, nothing unpushed.
AHEAD=$(git rev-list --count @{u}..HEAD 2>/dev/null) || AHEAD=""   # no upstream / error => not last step
if [ "$SUITE_OWED" = "true" ] && [ "$FAILED" = "0" ] \
   && [ -z "$(git status --porcelain)" ] && [ "$AHEAD" = "0" ]; then
  FULL_CI_RC=0
  node ${CLAUDE_SKILL_DIR}/../../lib/full-ci.js "$PR_NUMBER" || FULL_CI_RC=$?   # label + rerun
  case "$FULL_CI_RC" in
    0) echo "full-ci rerun triggered — return to the Step 8 re-poll (the rerun is a whole run); do NOT compute FAILED from the stale CHECKS." ;;
    1) echo "full-ci helper: report only, do not loop (run in progress / no run / gh error). Report it and stop this CI step; retry on the next poll." ;;
    2) echo "full-ci blocked after 3 cycles per head commit — STOP and surface to the user." ;;
    3) echo "NOT READY — re-poll on the next pass. Not a failure, not an escalation." ;;
  esac
elif [ "$SUITE_OWED" = "true" ]; then
  echo "not the last step yet (failures, uncommitted/unpushed work, or no upstream) — finish those first; not a failure, not an escalation."
fi
```

Exit codes: 0 = rerun triggered (re-poll CI); 1 = report only, do not loop; if the run is still in progress, retry on the next poll/pass; 2 = blocked after 3 cycles per head commit, which applies only once the PR is otherwise ready (exit 3 takes precedence over exit 2) — stop and surface to the user (unblock: `node ${CLAUDE_SKILL_DIR}/../../lib/loop-safeguards.js cleanup full-ci-$PR_NUMBER`); exit 3 = `NOT READY: <reason>` (CodeRabbit not yet resolved or the gate is not marker-only) — re-poll on the next pass, never a failure and never an escalation (no writes, no cycle consumed).

**Bounded re-poll for exit 3 and exit 1:** there is no real "next pass" inside one finalize session, so
re-poll at most 3 polls. Space each one with one background `pr-poll.js` call (`run_in_background: true`), then
re-run the snapshot and this step. Pick the target from the NOT READY reason. If it names CodeRabbit, use
`node ${CLAUDE_SKILL_DIR}/../../lib/pr-poll.js "$PR_NUMBER" --target coderabbit --retrigger-count "$RETRIGGER_COUNT" --deadline 180`
(the short deadline keeps a missing CodeRabbit from holding it for 22 minutes; `RETRIGGER_COUNT=$(jq -r '.retriggerCount // 0' .envoy/finalize/state.json 2>/dev/null || echo 0)`), whose first
probe always waits 120s. Otherwise use the CI wait above. When only the gate is red, a `--target ci` wait settles
at once and would not space the re-polls. Here any exit code or settle reason from the poller only counts as spacing.
Ignore it and re-read the snapshot. If it is still exit 3 or 1 after the 3rd poll, end the CI step with this STATUS REPORT line and continue
to finalize's remaining steps:

```
ready except full-suite run — NOT READY: <reason>; re-poll on the next pass (babysit or re-run finalize)
```

This is a report, not a failure and not an escalation. Exit 2 is unchanged: blocked, surface to the user.
Envoy never removes the label itself; a consumer may drop it on a new push, and the helper adds it again at the next ready point.

**If `FAILED` is `0`** (non-gate checks pass; `fullSuiteOwed` may still be true and is handled by the last step above): no CI failures to add to this cycle's combined fix list.

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
