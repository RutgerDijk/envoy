# Consumer CI convention: `full-ci`

If your CI gates the expensive full suite behind a label, envoy can notice the suite was skipped and react. You only need to follow this convention.

## The contract

- **Label:** `full-ci`. The full suite runs only when the PR carries it.
- **Marker:** when the label is absent, emit a check/job whose **name** matches `/FULL SUITE NOT RUN/i`. Envoy reads check names from `statusCheckRollup` via `lib/pr-status.js`. It does not read logs or job summaries, so the marker must be in the name.
- **Skipped markers are ignored:** when the label is present the marker job is skipped but still appears in `statusCheckRollup`. Detection ignores a matching check whose state is SKIPPED or NEUTRAL. Only a marker that ran means the suite did not.

## What envoy does

Envoy only **detects and reacts**. It ships no workflow. When `finalize`, `fix-ci` or `babysit` see the marker, they run:

```
node lib/full-ci.js <pr>
```

This adds the `full-ci` label and runs `gh run rerun`, for at most 3 cycles per PR. Exit codes: 0 rerun triggered, 1 failure / no run / run in progress, 2 blocked after 3 cycles. To unblock:

```
node lib/loop-safeguards.js cleanup full-ci-<pr>
```

## Example (GitHub Actions)

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, labeled]

jobs:
  full-suite-not-run:
    name: FULL SUITE NOT RUN
    if: ${{ !contains(github.event.pull_request.labels.*.name, 'full-ci') }}
    runs-on: ubuntu-latest
    steps:
      - run: echo "Add the full-ci label to run the full suite"

  full-suite:
    if: contains(github.event.pull_request.labels.*.name, 'full-ci')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
```

`labeled` in `types` is required. The check name comes from `name:`, not the job id, so keep `name: FULL SUITE NOT RUN` exactly.

## Caveat: reruns and labels

A rerun of a `pull_request` run reuses the **original** event payload. A plain `gh run rerun` therefore re-emits the stale payload, and the marker is still present. Adding the label is what fixes it: the label event triggers a fresh run via `labeled`, which sees the label and skips the marker.
