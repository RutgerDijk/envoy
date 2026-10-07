# Consumer CI convention: `full-ci`

If your CI gates the expensive full suite behind a label, envoy can notice the suite was skipped and react. You only need to follow this convention.

## The contract

- **Label:** `full-ci`. The full suite runs only when the PR carries it.
- **Marker:** when the label is absent, emit a check/job whose **name** matches `/FULL SUITE NOT RUN/i`. Envoy reads check names from `statusCheckRollup` via `lib/pr-status.js`. It does not read logs or job summaries, so the marker must be in the name.

## What envoy does

Envoy only **detects and reacts**. It ships no workflow. When `finalize`, `fix-ci` or `babysit` see the marker, they run:

```
node lib/full-ci.js <pr>
```

This adds the `full-ci` label and runs `gh run rerun`, for at most 3 cycles per PR. To unblock after the cap:

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

Name the marker job so the check name contains `FULL SUITE NOT RUN`, for example `name: FULL SUITE NOT RUN`.

## Caveat: reruns and labels

A rerun of a `pull_request` run reuses the **original** event payload, so a label added afterwards is **not** visible to a plain `gh run rerun`. The `labeled` trigger is what makes this work: adding the label starts a fresh run that sees it. Keep `labeled` in `types`, and treat the rerun as best-effort.
