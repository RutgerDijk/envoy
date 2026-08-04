# Skills Reference

Envoy includes 23 skills organized by purpose.

## Core Workflow

| Skill | Trigger |
|-------|---------|
| `envoy:brainstorm` | Starting any new feature or significant change |
| `envoy:pickup` | Ready to implement a GitHub issue (handles planning and execution) |
| `envoy:review` | After implementation, before creating PR |
| `envoy:finalize` | Implementation reviewed, ready to create PR |
| `envoy:cleanup` | After PR merged, before starting new work |

## Lifecycle & PR Shepherding

| Skill | Trigger |
|-------|---------|
| `envoy:babysit` | Move open PRs forward in one pass — re-trigger a rate-limited CodeRabbit, fix CI, resolve threads (composes with `/loop`) |
| `envoy:prs` | Read-only status across open PRs — CI, CodeRabbit, unresolved threads, idle |
| `envoy:hotfix` | Urgent single-defect fix on a fast path — worktree + failing test + verification, no brainstorm |

## Quality & Review

| Skill | Trigger |
|-------|---------|
| `envoy:coderabbit-pr-review` | PR has GitHub CodeRabbit comments to address |
| `envoy:visual-review` | UI changes need visual verification |
| `envoy:verification` | Before committing or claiming a task is complete |
| `envoy:requesting-code-review` | Completing tasks or before merging |
| `envoy:receiving-code-review` | Receiving code review feedback |
| `envoy:fix-ci` | CI/CD checks fail on a PR — diagnose and fix test, build, or lint failures |
| `envoy:review --quick` | Fast review — lint + cleanup only (Layers 0 and 0.5) |

## Advanced Patterns

| Skill | Trigger |
|-------|---------|
| `envoy:envoy-authoring` | Authoring/testing Envoy itself — search-first, writing/editing skills, eval-harness, pressure-test-scenarios, dispatching-parallel-agents (all steps of this one skill) |

## Execution & Orchestration

| Skill | Trigger |
|-------|---------|
| `envoy:systematic-debugging` | Bug, test failure, or unexpected behavior |
| `envoy:test-driven-development` | Implementing any feature or bugfix |

## Utilities

| Skill | Trigger |
|-------|---------|
| `envoy:using-git-worktrees` | Starting feature work needing isolation |
| `envoy:docstrings` | Public APIs need documentation |
| `envoy:wiki-sync` | After updating documentation in docs/wiki/ |
| `envoy:costs` | View token usage and estimated costs for this project |
| `envoy:using-envoy` | Starting any conversation (auto-loaded) |

## Skill Types

**Rigid skills** (follow exactly, no adaptation):
- `test-driven-development`, `systematic-debugging`, `verification`, `review`, `pickup`, `receiving-code-review`

**Flexible skills** (adapt principles to context):
- `brainstorm`, `envoy-authoring`

## Skill Anatomy

Every skill has:
- **Frontmatter:** `name` and `description` (under 30 words, starts with "Use when...")
- **Announce at start:** Declares which skill is being used
- **Process:** Step-by-step instructions
- **Error handling:** What to do when things go wrong

Discipline skills additionally have:
- **Iron Laws:** Non-negotiable rules
- **Rationalization Tables:** Counter common excuses to skip the discipline
