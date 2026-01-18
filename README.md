# Envoy

Professional .NET/React/Azure development workflows for Claude Code.

## Overview

Envoy is a Claude Code plugin that provides a streamlined 5-step workflow from idea to merged PR:

```
brainstorm → pickup → review → finalize → cleanup
```

**Key features:**
- **Brainstorming**: Turn ideas into designs + implementation plans through Socratic dialogue
- **Execution**: TDD-enforced implementation with automatic worktree management
- **Review**: 4-layer code review (CodeRabbit, AI, Visual, Docs)
- **Finalization**: Automated docstrings, wiki sync, and PR creation
- **Cleanup**: Remove worktrees and branches after merge

## Installation

```bash
# Add the marketplace
/plugin marketplace add RutgerDijk/envoy

# Install the plugin
/plugin install envoy@envoy-marketplace
```

## The Workflow

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. BRAINSTORM                                                      │
│     /envoy:brainstorm "Add user profile editing"                    │
│     → Socratic dialogue → Design doc → GitHub Issue → Plan          │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. PICKUP                                                          │
│     /envoy:pickup 123                                               │
│     → Creates worktree → Loads context → Executes plan with TDD     │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  3. REVIEW                                                          │
│     /envoy:review                                                   │
│     → CodeRabbit → AI Review → Visual Review → Doc Gaps             │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  4. FINALIZE                                                        │
│     /envoy:finalize                                                 │
│     → Docstrings → Wiki sync → Create PR                            │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
                        [ PR Review & Merge ]
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  5. CLEANUP                                                         │
│     /envoy:cleanup                                                  │
│     → Remove worktree → Delete feature branch                       │
└─────────────────────────────────────────────────────────────────────┘
```

## Commands

### Main Workflow

| Command | Description |
|---------|-------------|
| `/envoy:brainstorm` | Design + plan a feature (combines design and planning) |
| `/envoy:pickup [issue]` | Create worktree + execute plan |
| `/envoy:review` | Full 4-layer review |
| `/envoy:finalize` | Docstrings + wiki + PR |
| `/envoy:cleanup` | Remove worktree and branch after merge |

### Additional Commands

| Command | Description |
|---------|-------------|
| `/envoy:quick-review` | Fast review (AI only, no visual) |
| `/envoy:visual-review` | Chrome DevTools visual verification |
| `/envoy:docstrings` | Add documentation to public APIs |
| `/envoy:wiki-sync` | Sync docs/wiki/ to GitHub wiki |

### Escape Hatches

| Flag | Effect |
|------|--------|
| `/envoy:brainstorm --design-only` | Stop after design doc + issue (no plan) |
| `/envoy:pickup --plan-only` | Stop after worktree setup (no execution) |
| `/envoy:cleanup --all` | Clean up ALL merged worktrees |

## 4-Layer Review

1. **CodeRabbit Analysis** - Static analysis via `@coderabbitai review`
2. **AI Review** - Fresh agent reviews against project docs and stack profiles
3. **Visual Review** - Chrome DevTools screenshots, console, network checks
4. **Doc Gap Detection** - Find missing or outdated documentation

## Skills

Envoy includes skills for common development tasks:

| Skill | When to Use |
|-------|-------------|
| `envoy:systematic-debugging` | Bug or test failure |
| `envoy:dispatching-parallel-agents` | Multiple independent tasks |
| `envoy:subagent-driven-development` | Execute plan with fresh agent per task |
| `envoy:using-git-worktrees` | Create isolated workspace |
| `envoy:requesting-code-review` | Get feedback on changes |
| `envoy:receiving-code-review` | Evaluate review feedback |
| `envoy:verification` | Verify before claiming done |
| `envoy:writing-skills` | Create new Envoy skills |

## Stack Profiles

Best practices, common mistakes, and review checklists for:

- **Core**: .NET, React, TypeScript, PostgreSQL
- **Testing**: xUnit/Moq/FluentAssertions, Playwright
- **Infrastructure**: Docker, Azure Container Apps, Bicep, GitHub Actions
- **Supporting**: Entity Framework, Serilog, JWT/OAuth, shadcn/Radix, React Query, Tailwind

## Quick Start Example

```bash
# Session 1: Planning
claude
> /envoy:brainstorm Add coach dashboard with athlete overview
# ... Socratic dialogue ...
# Creates: design doc, plan, GitHub Issue #42

# Session 2: Implementation (in worktree)
> /envoy:pickup 42
# Creates .worktrees/coach-dashboard
# Executes plan with TDD...

> /envoy:review
# 4-layer review, fix issues...

> /envoy:finalize
# Creates PR #43

# After PR is merged:
> /envoy:cleanup
# Removes worktree and branch
```

## Requirements

- Claude Code CLI
- GitHub CLI (`gh`) for issue/PR management
- Chrome with DevTools MCP for visual review (optional)
- CodeRabbit integration (optional)

## License

MIT

---

*Built with Envoy - Professional development workflows for Claude Code*
