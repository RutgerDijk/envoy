# Workflow

The full Envoy pipeline from idea to merged PR.

```
brainstorm → pickup → review → finalize → cleanup
```

## 1. Brainstorm

```
/envoy:brainstorm "Add user profile editing"
```

Socratic dialogue that produces:
- A design doc with architecture decisions
- An implementation plan with numbered tasks
- A GitHub issue linking the spec
- A feature branch with the spec committed

Use `--design-only` to stop after the design doc (no plan).

## 2. Pickup

```
/envoy:pickup 42
```

- Fetches the GitHub issue
- Creates a git worktree from the feature branch
- Loads the spec and detects stack profiles
- Auto-continues to execution if the spec has implementation tasks

Use `--plan-only` to stop after workspace setup.

## 3. Review (Local)

```
/envoy:review
```

5-layer local review, complexity-tier gated:

| Layer | What | When |
|-------|------|------|
| 0. Lint | `npm run lint` | Always |
| 0.5. Cleanup | Fresh agent removes AI slop from diff | Small+ |
| 1. AI Review (Sonnet) | Spec compliance, TDD, codebase patterns | Small+ |
| 2. Visual Review | DevTools screenshots, console, network, health | Medium+ |
| 3. Doc Gaps | Missing docstrings, outdated docs | Medium+ |

The AI reviewer uses **iterative retrieval** — up to 3 cycles reading related files to understand codebase context, not just the diff.

Fixes all findings before proceeding.

## 4. Finalize (Ship It)

```
/envoy:finalize
```

No local reviews — trusts that `/review` already ran.

1. Add docstrings to public APIs
2. Push branch and create PR
3. Poll for GitHub CodeRabbit comments
4. Parse comments with regex (95%+ hit rate, Haiku fallback for the rest)
5. Address ALL findings including nitpicks
6. Reply to each comment with fix + commit hash, resolve thread
7. Push fixes, re-poll (max 3 cycles)
8. Final verification: tests, build, lint, health, zero unresolved conversations
9. Wiki sync

Uses the **completion signal protocol** — "no new comments" must be confirmed 3 consecutive times before the loop stops.

## 5. Cleanup

```
/envoy:cleanup
```

After the PR is merged:
- Removes the git worktree
- Deletes the feature branch

Use `--all` to clean up all merged worktrees at once.
