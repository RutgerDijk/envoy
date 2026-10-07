# Consumer CI convention: `full-ci`

If your CI gates the expensive full suite behind a label, envoy can notice the suite was skipped and react. Follow this convention (the runtime-read pattern).

## The contract

- **Label:** `full-ci`. The full suite runs only when the PR carries it.
- **No label triggers:** the `pull_request` trigger has NO `labeled`/`unlabeled` types, so adding the label starts no run (a run started by a label event would report its skipped jobs as success to the required check).
- **Runtime label read:** a `changes` job reads labels at runtime with `gh pr view <pr> --json labels`, never from `github.event.pull_request.labels`, and exposes a `full` output.
- **Gate:** `ci-gate` reads `needs.changes.outputs.full`. When the run was not full, a test job ran and every job passed, it prints `::error::FULL SUITE NOT RUN — add the full-ci label` and exits red.
- **Detection:** envoy looks at the gate check named `ci-gate` (override with env `ENVOY_CI_GATE_CHECK`). The check name must match exactly (case-insensitive): a reusable-workflow name such as `Caller / ci-gate` is not matched, so set `ENVOY_CI_GATE_CHECK` to the full name. If it failed, its annotation matching `/FULL SUITE NOT RUN/i` sets `ci.fullSuiteSkipped` in `lib/pr-status.js`.

## What envoy does

Envoy only **detects and reacts**. It ships no workflow. The marker is the raw signal (`ci.fullSuiteSkipped`); envoy acts on the derived **owed** state (`ci.fullSuiteOwed`): "fast run green, full run owed". A marker-red `ci-gate` is therefore not a failure. A real job failure, or any failed or pending check or commit status elsewhere on the head SHA, is still a failure and keeps `fullSuiteOwed` false.

The label is the **last step** before merge. Only `finalize` and `babysit` run the helper from the envoy plugin, on every pass while the suite is owed. `fix-ci` is report-only: it reports "fast run green, full run owed" and hands off to them, and never labels or reruns.

```
node <envoy-plugin>/lib/full-ci.js <pr>
```

It adds the `full-ci` label and reruns the whole run (`gh run rerun <id>`, NOT `--failed`) only when the PR is ready. No more pushes being planned is enforced by `finalize`/`babysit` calling the helper only as their last step, not by the helper itself. The helper enforces the rest: the pinned check read succeeded, the fast run is green apart from the marker, no unresolved review threads remain, CodeRabbit is not rate limited and, when the repo uses CodeRabbit, its latest commit status (`coderabbit.statusState`) is `success` (absent is not done). It resolves the run that owns the failed `ci-gate` job (never the newest run of some other workflow or event). The rerun re-runs `changes`, which now sees the label: no fresh labeled run, no stale marker.

Reads are pinned to the head SHA (latest check run per name, combined commit status). The head SHA is re-read right before the writes; if it moved, envoy reports only and retries on the next pass. A push after the label is on is fine: it just runs the full suite. Envoy never removes the label.

**CodeRabbit switch:** `ENVOY_CODERABBIT=on|off|auto` (default `auto`; anything else is exit 1). `auto` means CodeRabbit is in use iff `.coderabbit.yaml` or `.coderabbit.yml` exists at the repo root, so repos without CodeRabbit are never held waiting for its status.

Exit codes: 0 rerun triggered, 1 report only (failure / no run / run in progress / head moved), 2 blocked after 3 cycles, 3 NOT READY: re-poll on the next pass. Exit 3 is never a failure or escalation: it makes no writes (no label, no rerun) and uses no cycle. At most 3 cycles per PR, counted over the PR's whole lifetime (not reset by new pushes). The `NOT READY: <reason>` message goes to stderr. Resolve the stated reason (resolve CodeRabbit threads, wait for CodeRabbit's status or rate limit, fix a real failing check) and the next pass adds the label by itself; there is nothing to do manually. To unblock exit 2:

```
node <envoy-plugin>/lib/loop-safeguards.js cleanup full-ci-<pr>
```

## Example (GitHub Actions)

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      full: ${{ steps.l.outputs.full }}
    steps:
      - id: l
        env:
          GH_TOKEN: ${{ github.token }}
          PR: ${{ github.event.pull_request.number }}
          GH_REPO: ${{ github.repository }}
        run: |
          full=$(gh pr view "$PR" --json labels -q '[.labels[].name] | index("full-ci") != null')
          echo "full=$full" >> "$GITHUB_OUTPUT"

  test:
    needs: changes
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test

  ci-gate:
    if: always()
    needs: [changes, test]
    runs-on: ubuntu-latest
    steps:
      - run: |
          [ "${{ needs.changes.result }}" = "success" ] || exit 1
          if [ "${{ needs.changes.outputs.full }}" != "true" ] && [ "${{ needs.test.result }}" = "success" ]; then
            echo "::error::FULL SUITE NOT RUN — add the full-ci label"
            exit 1
          fi
          [ "${{ needs.test.result }}" = "success" ] || [ "${{ needs.test.result }}" = "skipped" ]
```
