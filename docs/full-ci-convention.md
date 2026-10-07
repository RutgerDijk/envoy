# Consumer CI convention: `full-ci`

If your CI gates the expensive full suite behind a label, envoy can notice the suite was skipped and react. Follow this convention (the runtime-read pattern).

## The contract

- **Label:** `full-ci`. The full suite runs only when the PR carries it.
- **No label triggers:** the `pull_request` trigger has NO `labeled`/`unlabeled` types, so adding the label starts no run (a run started by a label event would report its skipped jobs as success to the required check).
- **Runtime label read:** a `changes` job reads labels at runtime with `gh pr view <pr> --json labels`, never from `github.event.pull_request.labels`, and exposes a `full` output.
- **Gate:** `ci-gate` reads `needs.changes.outputs.full`. When the run was not full, a test job ran and every job passed, it prints `::error::FULL SUITE NOT RUN — add the full-ci label` and fails.
- **Detection:** envoy looks at the gate check named `ci-gate` (override with env `ENVOY_CI_GATE_CHECK`). The check name must match exactly (case-insensitive): a reusable-workflow name such as `Caller / ci-gate` is not matched, so set `ENVOY_CI_GATE_CHECK` to the full name. If it failed, its annotation matching `/FULL SUITE NOT RUN/i` sets `ci.fullSuiteSkipped` in `lib/pr-status.js`.

## What envoy does

Envoy only **detects and reacts**. It ships no workflow. On `ci.fullSuiteSkipped`, `finalize`, `fix-ci` and `babysit` run the helper from the envoy plugin:

```
node <envoy-plugin>/lib/full-ci.js <pr>
```

It resolves the run that owns the failed `ci-gate` job (never the newest run of some other workflow or event), adds the `full-ci` label, then `gh run rerun <id>` (whole run, NOT `--failed`). The rerun re-runs `changes`, which now sees the label: no fresh labeled run, no stale marker. At most 3 cycles per PR, counted over the PR's whole lifetime (not reset by new pushes). Exit codes: 0 rerun triggered, 1 report only (failure / no run / run in progress), 2 blocked after 3 cycles. To unblock:

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
