# `.envoy-tasks/` — Schema-backed issue task lists

This directory holds the **committed** handoff from `/envoy:brainstorm` to `/envoy:pickup`.

## Convention

Each GitHub issue with an implementation plan gets a single file:

```
.envoy-tasks/<issue-number>.json
```

The file conforms to `lib/schemas/tasks.json` (`$schemaVersion: "1"`) and contains the parsed task list for that issue — ids, titles, file lists, acceptance criteria, and optional dependency graph.

## Why committed?

Unlike `.envoy/` (which is gitignored and holds ephemeral runtime state), `.envoy-tasks/` is checked in so the task contract is visible in PR diffs:

- Reviewers can see exactly what was planned
- `git blame` shows when a task spec changed
- Pickup can replay the same tasks after a context loss

## Who writes it

- `/envoy:brainstorm` Phase 4 emits `.envoy-tasks/<issue>.json` alongside `gh issue create`.
- `/envoy:pickup` reads it during preflight and validates it against the schema; a missing or invalid file triggers a fatal-tier preflight failure with a remediation message.

## File shape

```json
{
  "$schemaVersion": "1",
  "issueNumber": 42,
  "strategy": "batch",
  "tasks": [
    {
      "id": "task-1",
      "title": "Add foo endpoint",
      "description": "Short description of what this task accomplishes.",
      "files": ["src/api/foo.ts"],
      "acceptance": ["Endpoint returns 200 with expected shape"],
      "dependsOn": []
    }
  ]
}
```

See `lib/schemas/tasks.json` for the authoritative schema.

## Related runtime state (gitignored)

- `.envoy/pickup/session.json` — live task progress
- `.envoy/pickup/handoff-to-review.json` — pickup → review handoff
- `.envoy/review/handoff-to-finalize.json` — review → finalize handoff
- `.envoy/finalize/state.json` — finalize PR state (replaces `/tmp/envoy-active-pr.txt`)
- `.envoy/search-decisions/<task-id>.json` — search-first outcome per task
- `.envoy/loops/<name>.json` — loop-safeguards CLI state
- `.envoy/active-skill.json` — which rigid skill currently owns the session
