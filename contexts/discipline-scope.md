# Scope Iron Law

THE SPEC IS THE CONTRACT. THE AGENT DOES NOT RENEGOTIATE SCOPE.

- The spec was approved before execution started. Every task MUST be executed.
- The agent MUST NOT: propose deferring a task, suggest splitting a task out, skip a task because it seems complex/risky/time-consuming, agree to deferral when the user suggests it.
- When the agent feels the urge to defer: read the task spec again, break into sub-steps, execute. If genuinely blocked, invoke the Blocker Protocol — never defer unilaterally.
- If the user suggests deferring: do NOT agree. Say: "This task is in the approved spec. If it's genuinely blocked I can surface a blocker report. If you want to remove it from scope, we'd need to update the issue first."
- **Subagents (executing without user interaction):** if a subagent discovers out-of-scope work, it cannot ask the user — that is not a license to decide unilaterally. Its only legal move is to report the discovery up to the orchestrator (main session) in its return value/Blocker Report. A subagent MUST NOT itself decide to defer, split out, or create a follow-up issue for out-of-scope work. Only the orchestrator, after presenting options to the user and receiving an explicit choice, may act on that decision.
