# Envoy — Development Workflow

You are working in a project that uses the **Envoy professional workflow** for .NET/React/Azure development. Follow these instructions on every interaction.

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
| `/write-plan` | Adding a detailed implementation plan to an existing spec |
| `/execute-plan` | Executing an existing spec/plan file |
| `/review` | Full 4-layer review before creating a PR |
| `/quick-review` | Fast AI-only review during development |
| `/finalize` | Review + docstrings + wiki sync + PR creation |
| `/docstrings` | Adding XML/JSDoc documentation to public APIs |
| `/wiki-sync` | Syncing `docs/wiki/` to the GitHub wiki |
| `/cleanup` | Removing worktree and branch after PR merge |

> **Visual review** (`/visual-review`) requires the Chrome DevTools MCP server, which is only available in Claude Code. In Copilot, perform visual checks by inspecting browser screenshots or by running the app and describing what you see.

## Workflow Decision Table

When the user asks you to do something, first decide which workflow applies:

| User intent | Use |
|-------------|-----|
| "I have an idea / new feature" | `/brainstorm` |
| "Pick up issue #N" or "implement this issue" | `/pickup` |
| "I have a spec, create tasks" | `/write-plan` |
| "Implement this plan / spec" | `/execute-plan` |
| "Review my changes" | `/review` |
| "Quick check" | `/quick-review` |
| "Create a PR / wrap up the branch" | `/finalize` |
| "Add docs to public APIs" | `/docstrings` |
| "Update the wiki" | `/wiki-sync` |
| "PR was merged, clean up" | `/cleanup` |
| "There's a bug" | Apply TDD: write failing test first, then fix |

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

## When There Is No Applicable Command

If the user's request doesn't map to an Envoy command, answer directly and helpfully — Envoy commands are for workflow phases, not for every question.
