# Pickup — Steps 7–8: Viability check, pause for approval

### Step 7: Viability Check

The implementation plan is in the GitHub issue body (fetched in Step 1). Read it now.

Verify the plan is still viable against the current repo state:
1. Do referenced file paths exist? (Or will be created as part of the plan — that's fine)
2. Have any referenced APIs, interfaces, or database schemas changed since the plan was written?
3. Are any referenced external dependencies missing?

**If viable:** proceed to Step 8.

**If stale:** surface specific staleness concerns:

```
Plan viability issue detected:
- <specific file/API that has changed>
- <what the plan expects vs. what exists now>

Options:
  A) Proceed anyway — the change is minor and the plan still holds
  B) Update the issue plan first, then re-run pickup

Awaiting your decision.
```

### Step 8: Pause for Approval

Show the plan summary:

```
**Plan verified** (from issue body)

| Item | Value |
|------|-------|
| Issue | #<number> (In Progress) |
| Branch | `feature/<N>-<topic>` |
| Worktree | `.worktrees/<N>-<topic>` |
| Tasks | N tasks |
| Strategy | parallel/batch/sequential |
| Stack profiles | <detected-stacks> |

**Task overview:**
1. Task 1: <name>
2. Task 2: <name>
...

**Execution strategy defaults** (if not specified in issue):
- 1–3 tasks → sequential
- 4–8 tasks → batch
- 9+ tasks → parallel

If the issue plan specifies a strategy, use that. If uncertain, ask — do NOT assume.

**Ready to execute? (yes / edit / abort)**
```

**Branching logic:**
- If `--plan-only` flag: **Stop here.** Report the issue plan and exit.
- If user says **abort**: Stop. Remove "in progress" label.
- If user says **edit**: Let user modify the plan, then re-show the summary.
- If user says **yes**: Continue to Step 9.

---

## Error Handling

### Issue Not Found

```
Issue #<number> not found.

Check:
- Is the issue number correct?
- Do you have access to the repository?

Run `gh issue list` to see available issues.
```

### Issue Has No Acceptance Criteria

```
Issue #<number> has no acceptance criteria in the body.

Cannot execute an implementation plan without clear acceptance criteria.

Options:
1. Add acceptance criteria to the issue and retry
2. Run /envoy:brainstorm to create a proper design first
```

### Worktree Already Exists

```
Worktree for this issue already exists at: .worktrees/<N>-<topic>

To continue working:
  cd .worktrees/<N>-<topic>

To start fresh:
  git worktree remove .worktrees/<N>-<topic>
  Then run /envoy:pickup <number> again
```
