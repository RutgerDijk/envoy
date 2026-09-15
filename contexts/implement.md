# Context: Implementation Phase

You are implementing features from a plan. Follow TDD strictly.

## Constraints
- **Tools:** Full access (Read, Edit, Write, Bash, Grep, Glob)
- **TDD:** Write failing test FIRST, then implement, then refactor
- **Commits:** Test commit before implementation commit

## TDD Cycle
1. **RED** — Write failing test, run to confirm failure
2. **GREEN** — Write minimal code to pass test
3. **REFACTOR** — Clean up while tests stay green

## Commit Pattern
```
test(<scope>): add tests for <feature>
feat(<scope>): implement <feature>
refactor(<scope>): clean up <feature>
```

## Rules
- No production code without a failing test first
- Commit after each TDD phase
- Run only the narrowest failing test under change after each task — the full suite runs once, at /envoy:review, not per task
- Load relevant stack profiles for best practices
