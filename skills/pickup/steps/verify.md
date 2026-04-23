# Pickup — Step 14: Spec compliance check (after all tasks)

### Step 14: Spec Compliance Check (after ALL tasks)

Before calling envoy:review, verify all tasks were implemented:
- Count tasks in issue body.
- Check git log for commits corresponding to each task.
- If any task has no commits: STOP. Surface discrepancy. Do not proceed to review.

### Write the review handoff

Once spec compliance is verified, write `.envoy/pickup/handoff-to-review.json`
conforming to `lib/schemas/handoff-pickup-to-review.json`:

```bash
BASE_SHA=$(git rev-list --all --first-parent main..HEAD | tail -1 | xargs -I{} git rev-parse {}^ 2>/dev/null || git merge-base main HEAD)
HEAD_SHA=$(git rev-parse HEAD)
```

```javascript
const handoff = {
  $schemaVersion: '1',
  issueNumber: Number(issueNumber),
  branch: currentBranch,
  baseSha: BASE_SHA,
  headSha: HEAD_SHA,
  tasksCompleted: tasks.map(t => ({
    id: t.id,
    title: t.title,
    commitSha: t.commitSha,
    filesChanged: t.filesChanged || [],
  })),
  stackProfiles: detectedStacks,
  producedAt: new Date().toISOString(),
};

fs.mkdirSync('.envoy/pickup', { recursive: true });
fs.writeFileSync('.envoy/pickup/handoff-to-review.json', JSON.stringify(handoff, null, 2));
```

Review preflight will read this file and fail fatal if it's missing, so skipping this write blocks the pipeline.

---

## Report Completion

When all tasks complete:

```
**Execution complete for issue #<number>: <title>**

| Metric | Value |
|--------|-------|
| Tasks completed | N/N |
| Spec compliance | ✓ all tasks verified |
| Commits | M |
| Tests | All passing |
| Build | Success |
| Strategy | parallel/batch/sequential |

Next steps:
1. `/envoy:review` — Run comprehensive review (invoked above)
2. `/envoy:finalize` — Prepare PR (clears session state)
```

Update session state with next steps:

```javascript
const session = require('../../lib/session-state');
const state = session.load();
state.nextSteps = ['Run envoy:review', 'Run envoy:finalize'];
session.save(state);
```
