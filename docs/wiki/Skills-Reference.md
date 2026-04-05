# Skills Reference

Envoy includes 24 skills organized by purpose.

## Core Workflow

| Skill | Trigger |
|-------|---------|
| `envoy:brainstorm` | Starting any new feature or significant change |
| `envoy:writing-plans` | Have a design doc, need implementation plan |
| `envoy:executing-plans` | Have a plan, ready to start coding |
| `envoy:pickup` | Ready to implement a GitHub issue from brainstorming |
| `envoy:finishing-branch` | Implementation complete, ready to create PR |
| `envoy:cleanup` | After PR merged, before starting new work |

## Quality & Review

| Skill | Trigger |
|-------|---------|
| `envoy:layered-review` | After implementation, before creating PR |
| `envoy:coderabbit-pr-review` | PR has GitHub CodeRabbit comments to address |
| `envoy:visual-review` | UI changes need visual verification |
| `envoy:verification` | Before committing or claiming a task is complete |
| `envoy:requesting-code-review` | Completing tasks or before merging |
| `envoy:receiving-code-review` | Receiving code review feedback |

## Advanced Patterns

| Skill | Trigger |
|-------|---------|
| `envoy:search-first` | Before implementing, check if solution already exists |
| `envoy:cleanup-pass` | After implementation, remove AI slop before review |
| `envoy:eval-harness` | Test whether a skill behaves correctly across scenarios |

## Execution & Orchestration

| Skill | Trigger |
|-------|---------|
| `envoy:dispatching-parallel-agents` | 2+ independent tasks without shared state |
| `envoy:subagent-driven-development` | Executing plans with independent tasks |
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
| `envoy:writing-skills` | Creating or editing Envoy skills |

## Skill Types

**Rigid skills** (follow exactly, no adaptation):
- `test-driven-development`, `systematic-debugging`, `verification`

**Flexible skills** (adapt principles to context):
- `brainstorm`, `writing-plans`, `search-first`

## Skill Anatomy

Every skill has:
- **Frontmatter:** `name` and `description` (under 30 words, starts with "Use when...")
- **Announce at start:** Declares which skill is being used
- **Process:** Step-by-step instructions
- **Error handling:** What to do when things go wrong

Discipline skills additionally have:
- **Iron Laws:** Non-negotiable rules
- **Rationalization Tables:** Counter common excuses to skip the discipline
