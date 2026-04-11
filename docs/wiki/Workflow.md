# Workflow

The full Envoy pipeline from idea to merged PR.

```
brainstorm → pickup → review → finalize → cleanup
```

## 1. Brainstorm

```
/envoy:brainstorm "Add user profile editing"
```

Socratic dialogue that produces a GitHub issue with design, architecture, and acceptance criteria.

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

Assumes `/envoy:review` has already run. No local reviews here.

1. Push branch and create PR
2. Poll for GitHub CodeRabbit comments
3. Parse comments with regex (95%+ hit rate, Haiku fallback for the rest)
4. Address ALL findings including nitpicks
5. Reply to each comment with fix + commit hash, resolve thread
6. Push fixes, re-poll (max 3 cycles)
7. Final verification: tests, build, lint, health, zero unresolved conversations
8. Wiki sync

Uses the **completion signal protocol** — "no new comments" must be confirmed 3 consecutive times before the loop stops.

## 5. Cleanup

```
/envoy:cleanup
```

After the PR is merged:
- Removes the git worktree
- Deletes the feature branch

Use `--all` to clean up all merged worktrees at once.
