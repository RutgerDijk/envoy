# Blocker Protocol

Complex does not equal deferrable. Blocked does not equal deferrable.

| Situation | Correct response |
|-----------|-----------------|
| Task seems complex | Read the spec again. Break into sub-steps. Execute. |
| Task needs research | Do the research inline. Don't defer. |
| Task has a genuine external blocker | Surface a Blocker Report. Wait for decision. |
| Task contradicts the architecture | Surface a Blocker Report. Wait for decision. |

## Definition of genuine blocker

A genuine blocker is: missing external dependency that cannot be created in this PR, architectural contradiction requiring changes to already-merged code, or an acceptance criterion that is impossible to satisfy as written. "This is hard" is not a blocker. "This will take longer than expected" is not a blocker.

## Blocker Report format

```
⛔ Task N blocked: <one-line reason>
Root cause: <specific technical explanation>
Options:
  A) <approach — tradeoff>
  B) <approach — tradeoff>
  C) Defer to follow-up issue (requires creating issue before proceeding)
Awaiting your decision.
```

Only the user decides what happens. If option C: create the follow-up issue first, then continue with remaining tasks.
