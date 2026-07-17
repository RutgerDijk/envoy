# Workflow

The full Envoy pipeline from idea to merged PR.

```
brainstorm → pickup → review → finalize → cleanup
```

## 1. Brainstorm

```
/envoy:brainstorm "Add user profile editing"
```

Socratic dialogue that produces a GitHub issue with design, architecture, acceptance criteria, and a full implementation task list (with exact file paths) for use by `/envoy:pickup`.

Use `--design-only` to stop after the design doc (no plan).

## 2. Pickup

```
/envoy:pickup 42
```

- Fetches the GitHub issue
- Creates a git worktree from the feature branch
- Loads the spec and detects stack profiles
- Shows plan summary and waits for approval before executing tasks

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
2. Poll GitHub CodeRabbit via the shared `lib/pr-status.js` snapshot — unresolved review threads (GraphQL, not REST comment counts) plus rate-limit state (exponential backoff, 22min max)
3. Address ALL findings including nitpicks
4. Reply to each comment with fix + commit hash, resolve thread
5. Push fixes, re-poll (max 3 cycles)
6. Poll CI, auto-fix failures via `/envoy:fix-ci`
7. Final verification: tests, build, lint, zero unresolved conversations (read from the same `lib/pr-status.js` snapshot)
8. Wiki sync

Uses the **completion signal protocol** — a settled review (not rate-limited AND zero unresolved CodeRabbit threads) must be confirmed 3 consecutive times before the loop stops.

## 5. Cleanup

```
/envoy:cleanup
```

After the PR is merged:
- Removes the git worktree
- Deletes the feature branch

Use `--all` to clean up all merged worktrees at once.

---

## Platform constraints

Claude Code subagents cannot spawn subagents. When an agent definition declares `tools: [Agent, ...]`, the `Agent` tool is silently stripped from the subagent's runtime allowlist — only non-Agent tools come through.

Envoy's orchestrator skills (`review`, `pickup`, `finalize`) therefore run orchestration **in the skill itself** and spawn only leaf subagents (one level of nesting). Each skill loads shared discipline content from `contexts/discipline-*.md` and injects it verbatim into every subagent prompt so rules stay consistent across workers.
