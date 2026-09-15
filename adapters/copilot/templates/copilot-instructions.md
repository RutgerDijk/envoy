# Envoy — Development Workflow

You are working in a project that uses the **Envoy professional workflow** for .NET/React/Azure development. Follow these instructions on every interaction.

## Shared Rules (read first)

If the repo root has an `AGENTS.md` (or `CLAUDE.md`) file, those are the canonical project rules for ALL coding agents — code style, naming, comments, version control, and testing rules. Those rules are authoritative; this file only adds the Copilot-specific workflow surface. The stack-specific `.instructions.md` files in `.github/instructions/` apply automatically by file type.

## Workflow Overview

```
brainstorm → pickup → review → finalize → cleanup
```

Use the slash commands below (`.github/prompts/`) to drive each phase.

## Available commands

| Command | When to use |
|---------|-------------|
| `/brainstorm` | Starting a new feature or significant change |
| `/pickup` | Implementing a GitHub issue |
| `/review` | Full layered review before creating a PR |
| `/quick-review` | Fast AI-only review during development |
| `/finalize` | Review + docstrings + wiki sync + PR creation |
| `/docstrings` | Adding XML/JSDoc documentation to public APIs |
| `/wiki-sync` | Syncing `docs/wiki/` to the GitHub wiki |
| `/cleanup` | Removing worktree and branch after PR merge |

> Implementation plans travel in the issue itself as an embedded machine-readable task block (rendered by brainstorm, materialized locally by pickup as gitignored `.envoy-tasks/<issue-number>.json`). If an issue has no task block, treat it as not pickup-ready.

> **Visual review** (`/visual-review`) requires the Chrome DevTools MCP server, which is only available in Claude Code. In Copilot, perform visual checks by inspecting browser screenshots or by running the app and describing what you see.

## Workflow Decision Table

When the user asks you to do something, first decide which workflow applies:

| User intent | Use |
|-------------|-----|
| "I have an idea / new feature" | `/brainstorm` |
| "Pick up issue #N" or "implement this issue" | `/pickup` (requires the issue's embedded task block) |
| "Review my changes" | `/review` |
| "Quick check" | `/quick-review` |
| "Create a PR / wrap up the branch" | `/finalize` |
| "Add docs to public APIs" | `/docstrings` |
| "Update the wiki" | `/wiki-sync` |
| "PR was merged, clean up" | `/cleanup` |
| "There's a bug" | Apply TDD: write failing test first, then fix |
| "CI is failing on the PR" | Diagnose the failing check, fix the root cause, push — never bypass or skip checks |

## Handoff State (shared with Claude Code sessions)

Envoy sessions in a project — from any agent — share state through files, not conversation memory:

- **`.envoy-tasks/<issue>.json`** (gitignored) — the brainstorm → pickup task contract, materialized from the machine block embedded in the GitHub issue.
- **`.envoy/`** (gitignored, per-worktree) — runtime handoff state between workflow phases. Do not commit it; do not trust it over git history and the issue/PR state.
- **Worktrees** live at `.worktrees/<issue-number>-<topic>/`, one per issue.

If handoff state is missing, reconstruct from durable sources (git log, the GitHub issue's task block, the PR) rather than guessing.

## Iron Law: TDD

**NO PRODUCTION CODE WITHOUT A FAILING TEST.** This rule has no exceptions.

The cycle is always:

1. Write a failing test
2. Run it — confirm it fails
3. Write the minimal code to make it pass
4. Run it — confirm it passes
5. Commit test + implementation together

**Red flags** — stop if you think any of these:

| Thought | Reality |
|---------|---------|
| "I'll add the test after" | Tests guide implementation. Do it first. |
| "This is too simple to test" | Simple things break. Write the test. |
| "The test is obvious" | Obvious tests catch regressions. Write it. |
| "Let me just check if it works manually" | Tests ARE the check. Run them. |

## Code Quality Rules

- Follow stack-specific best practices (`.instructions.md` files apply automatically based on file type)
- Clean Architecture: Domain → Application → Infrastructure → API
- Dependency injection for all services
- Async all the way — `async/await` throughout, `CancellationToken` on every IO method
- No magic strings — use constants or strongly-typed options
- Error handling at boundaries only — internal code throws, controllers catch
- Never leave commented-out code
- Meaningful commit messages: `type(scope): description`

## Commit Message Format

```
feat(backend): add user entity and repository
fix(frontend): correct form validation on email field
test(api): add integration tests for user creation
docs(wiki): update authentication setup guide
refactor(domain): extract value object for email address
```

Never add AI attribution lines (`Co-Authored-By`, "Generated with …") to commit messages.

## When There Is No Applicable Command

If the user's request doesn't map to an Envoy command, answer directly and helpfully — Envoy commands are for workflow phases, not for every question.
