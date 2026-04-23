# Pickup — Step 14: Spec compliance check (after all tasks)

### Step 14: Spec Compliance Check (after ALL tasks)

Before calling envoy:review, verify all tasks were implemented:
- Count tasks in issue body.
- Check git log for commits corresponding to each task.
- If any task has no commits: STOP. Surface discrepancy. Do not proceed to review.

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
