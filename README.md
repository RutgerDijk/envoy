# Envoy

Professional .NET/React/Azure development workflows for Claude Code.

## Overview

Envoy is a Claude Code plugin that provides structured workflows for:

- **Planning**: Turn ideas into GitHub issues + detailed specs through Socratic dialogue
- **Execution**: Execute implementation plans with configurable strategies
- **Review**: 4-layer code review with CodeRabbit, AI analysis, visual verification, and documentation gap detection
- **Finalization**: Automated docstrings, wiki sync, and PR creation

## Installation

```bash
# Add the marketplace
/plugin marketplace add RutgerDijk/envoy

# Install the plugin
/plugin install envoy@envoy-marketplace
```

Or use the interactive plugin manager:
```bash
/plugin
```
Then browse to "envoy-marketplace" in the Discover tab.

## Commands

### Planning & Design

| Command | Description |
|---------|-------------|
| `/envoy:brainstorm` | Turn ideas into GitHub issues + spec documents |
| `/envoy:write-plan` | Create detailed implementation plan |
| `/envoy:pickup [issue]` | Pick up a GitHub issue and start implementation |

### Execution

| Command | Description |
|---------|-------------|
| `/envoy:execute-plan [path]` | Execute plan with configurable strategy |

### Review

| Command | Description |
|---------|-------------|
| `/envoy:review` | Full 4-layer review process |
| `/envoy:quick-review` | Fast review (CodeRabbit + AI only) |
| `/envoy:visual-review` | Chrome DevTools visual verification |

### Finalization

| Command | Description |
|---------|-------------|
| `/envoy:finalize` | Complete branch: review, docs, wiki, PR |
| `/envoy:docstrings` | Add documentation to public APIs |
| `/envoy:wiki-sync` | Sync docs/wiki/ to GitHub wiki |

## 4-Layer Review Process

1. **CodeRabbit Analysis** - Static analysis via `@coderabbitai review`
2. **Documentation-Informed AI Review** - Fresh agent reviews against project docs, stack profiles
3. **Chrome DevTools Visual Review** - Screenshots, console, network verification
4. **Documentation Gap Detection** - Identify missing or outdated documentation

## Stack Profiles

Envoy includes best practices, common mistakes, and review checklists for:

### Core Stacks
- .NET, React, TypeScript, PostgreSQL

### Testing
- xUnit/Moq/FluentAssertions, Playwright

### Infrastructure
- Docker Compose, Azure Container Apps, Azure Static Web Apps
- Azure PostgreSQL, Bicep, GitHub Actions

### Supporting
- Entity Framework, Serilog, JWT/OAuth, API Patterns
- shadcn/Radix, React Query, React Hook Form, Tailwind
- Orval, Security, Application Insights

## Execution Strategies

Plans can be executed with different strategies:

- **parallel**: Spawn agents for independent tasks
- **batch**: Execute in phases with review checkpoints
- **sequential**: Step-by-step with validation

## Project Structure

```
envoy/
├── .claude-plugin/
│   └── plugin.json          # Plugin manifest
├── skills/                   # Skill definitions
│   ├── brainstorming/
│   ├── writing-plans/
│   ├── pickup/
│   ├── executing-plans/
│   ├── layered-review/
│   ├── visual-review/
│   ├── verification/
│   ├── finishing-branch/
│   ├── wiki-sync/
│   └── docstrings/
├── commands/                 # Command shortcuts
├── stacks/                   # Stack-specific best practices
│   ├── detect-stacks.sh     # Auto-detection script
│   ├── dotnet.md
│   ├── react.md
│   └── ...
├── templates/               # Document templates
│   ├── github-issue.md
│   ├── spec-doc.md
│   └── plan-doc.md
├── agents/                  # Curated agent prompts
│   ├── code-review.md
│   ├── test-writer.md
│   └── security-audit.md
└── docs/
    └── plans/              # Implementation plans
```

## Workflow Example

### 1. Brainstorm a Feature

```
/envoy:brainstorm Add user profile editing
```

Creates:
- GitHub issue with labels and acceptance criteria
- Spec document at `docs/specs/YYYY-MM-DD-user-profile-editing.md`

### 2. Create Implementation Plan

```
/envoy:write-plan docs/specs/2024-01-15-user-profile-editing.md
```

Creates:
- Implementation plan at `docs/plans/YYYY-MM-DD-user-profile-editing-plan.md`
- Bite-sized tasks with dependencies

### 3. Pick Up and Implement

```
/envoy:pickup #123
```

- Creates git worktree for isolated development
- Loads spec and plan context
- Guides through implementation

### 4. Review Changes

```
/envoy:review
```

Runs full 4-layer review:
1. CodeRabbit static analysis
2. AI review against project documentation
3. Visual verification with Chrome DevTools
4. Documentation gap detection

### 5. Finalize and Create PR

```
/envoy:finalize
```

- Runs final review
- Adds docstrings to public APIs
- Syncs wiki documentation
- Creates pull request

## Configuration

### Stack Auto-Detection

Envoy automatically detects your project's stack:

```bash
./stacks/detect-stacks.sh
```

### Custom Stack Profiles

Add project-specific profiles in `stacks/` following the standard format:
- Detection script
- Best practices
- Common mistakes
- Review checklist
- Resources

## Requirements

- Claude Code CLI
- GitHub CLI (`gh`) for issue/PR management
- Chrome with DevTools MCP for visual review (optional)
- CodeRabbit integration (optional)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Follow existing patterns for skills and commands
4. Submit a pull request

## License

MIT

---

*Built with Envoy - Professional development workflows for Claude Code*
