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

## How It Works

### Architecture

```
envoy/
├── .claude-plugin/        # Plugin configuration
│   ├── plugin.json        # Plugin metadata
│   └── marketplace.json   # Marketplace registration
├── hooks/                 # Session lifecycle hooks
│   ├── hooks.json         # Hook registration
│   └── session-start.sh   # Auto-loads Envoy on startup
├── lib/                   # Shared utilities
│   ├── skills-core.js     # Skill discovery & shadowing
│   └── stack-loader.js    # Stack detection & loading
├── commands/              # Entry points for /envoy:* commands
├── agents/                # Specialized agent definitions
├── skills/                # 19 workflow skills
├── stacks/                # 25 technology profiles
└── docs/                  # Anti-patterns & authoring guides
```

### Session Start Hook

When you start Claude Code, Envoy automatically:

1. **Loads the `using-envoy` skill** - Claude knows about all Envoy capabilities
2. **Detects your tech stack** - Scans for .csproj, package.json, tsconfig.json, etc.
3. **Reports detected stacks** - Shows which profiles are relevant

```
Detected stacks: dotnet, react, typescript, entity-framework, tailwind

When implementing or reviewing code, load the relevant stack profiles
from `stacks/<stack-name>.md` for best practices and common mistakes.
```

### Skills System

Skills are structured workflows that Claude follows. Each skill has:

- **Trigger condition** - When to use it ("Use when...")
- **Iron Laws** - Non-negotiable rules for discipline skills
- **Rationalization Tables** - Counter common excuses
- **Step-by-step process** - What to do

**Skill types:**
- **Rigid** (TDD, debugging, verification) - Follow exactly, no adaptation
- **Flexible** (brainstorming, planning) - Adapt principles to context

### Stack Profiles

Each stack profile contains:

- **Best Practices** - Patterns to follow
- **Common Mistakes** - Anti-patterns with fixes
- **Review Checklist** - What to verify

Profiles are loaded automatically based on detected technologies.

### Personal Skill Shadowing

Create personal skills in `~/.claude/skills/` that override Envoy skills:

```
~/.claude/skills/
└── brainstorming/
    └── SKILL.md    # Your version overrides envoy:brainstorming
```

Use `envoy:skill-name` prefix to force Envoy's version.

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

## TDD Enforcement

Envoy enforces Test-Driven Development with an Iron Law:

> **NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.**
>
> Write code before test? Delete it. Start over.

The `executing-plans` skill includes rationalization counters:

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. |
| "I'll write tests after" | Tests passing immediately prove nothing. |
| "Time pressure" | Skipping tests costs MORE time. Always. |

## Skills

Envoy includes 19 skills for common development tasks:

| Skill | When to Use |
|-------|-------------|
| `envoy:brainstorming` | Starting any new feature or significant change |
| `envoy:writing-plans` | Have a design doc, need implementation plan |
| `envoy:executing-plans` | Have a plan, ready to start coding |
| `envoy:pickup` | Ready to implement a GitHub issue |
| `envoy:systematic-debugging` | Bug, test failure, or unexpected behavior |
| `envoy:verification` | Before committing or claiming done |
| `envoy:layered-review` | After implementation, before PR |
| `envoy:finishing-branch` | Implementation complete, ready for PR |
| `envoy:cleanup` | After PR merged |
| `envoy:dispatching-parallel-agents` | Multiple independent tasks |
| `envoy:subagent-driven-development` | Execute plan with fresh agent per task |
| `envoy:using-git-worktrees` | Need isolated workspace |
| `envoy:requesting-code-review` | Get feedback on changes |
| `envoy:receiving-code-review` | Evaluate review feedback |
| `envoy:visual-review` | UI changes need verification |
| `envoy:docstrings` | Public APIs need documentation |
| `envoy:wiki-sync` | Documentation updated |
| `envoy:using-envoy` | Discover available skills |
| `envoy:writing-skills` | Create new Envoy skills |

## Stack Profiles

25 technology profiles with best practices, common mistakes, and review checklists:

**Core:**
- .NET, React, TypeScript, PostgreSQL

**Testing:**
- xUnit/Moq/FluentAssertions, Playwright

**Infrastructure:**
- Docker Compose, Azure Container Apps, Azure Static Web Apps
- Azure PostgreSQL, Bicep, GitHub Actions

**Supporting:**
- Entity Framework, Serilog, JWT/OAuth, API Patterns
- shadcn/Radix, React Query, React Hook Form, Tailwind
- Orval, Application Insights, Health Checks, OpenAPI

**Security:**
- Always loaded for web applications

## Anti-Patterns

Envoy includes documentation of common anti-patterns with gate functions:

```markdown
BEFORE writing any implementation code:
  Ask: "Do I have a failing test for this behavior?"

  IF no:
    STOP
    Write the test first
```

See `docs/ANTI-PATTERNS.md` for the full list.

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

## Creating Custom Skills

See `docs/SKILL-AUTHORING-GUIDE.md` for:

- Claude Search Optimization (CSO) for descriptions
- Persuasion principles (Authority, Commitment, Social Proof)
- Iron Law pattern with rationalization tables
- Gate functions for anti-patterns
- Pressure scenario testing

## Prerequisites

### Required

| Prerequisite | Purpose | Installation |
|--------------|---------|--------------|
| Claude Code CLI | Runtime | [Install Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) |
| GitHub CLI (`gh`) | Issue/PR management | `brew install gh` then `gh auth login` |
| Node.js 18+ | Hook scripts | `brew install node` |

### Recommended

| Prerequisite | Purpose | Setup |
|--------------|---------|-------|
| CodeRabbit | AI code review (Layer 1) | See [CodeRabbit Setup](#coderabbit-setup) |
| Chrome DevTools MCP | Visual verification (Layer 3) | See [DevTools MCP Setup](#devtools-mcp-setup) |

### CodeRabbit Setup

CodeRabbit provides AI-powered code review for the first layer of Envoy's 4-layer review.

1. **Create account**: Go to [coderabbit.ai](https://coderabbit.ai) and sign up with GitHub
2. **Install GitHub App**: Add CodeRabbit to your repositories
3. **Configure** (optional): Add `.coderabbit.yaml` to customize rules:
   ```yaml
   reviews:
     auto_review:
       enabled: true
     path_instructions:
       - path: "**/*.cs"
         instructions: "Check for .NET best practices"
       - path: "**/*.tsx"
         instructions: "Check for React best practices"
   ```

**Without CodeRabbit**: The review skill will skip Layer 1 and continue with AI review, visual review, and doc gap detection.

### DevTools MCP Setup

Chrome DevTools MCP enables visual verification by capturing screenshots, console logs, and network activity.

1. **Install the MCP server**:
   ```bash
   npm install -g @anthropic/mcp-server-chrome-devtools
   ```

2. **Add to Claude Code settings** (`~/.claude/settings.json`):
   ```json
   {
     "mcpServers": {
       "chrome-devtools": {
         "command": "mcp-server-chrome-devtools",
         "args": []
       }
     }
   }
   ```

3. **Launch Chrome with debugging**:
   ```bash
   # macOS
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

   # Or create an alias
   alias chrome-debug='/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222'
   ```

**Without DevTools MCP**: The review skill will skip visual verification (Layer 3) and continue with other layers.

### Verify Setup

Run this command to check your setup:

```bash
echo "=== Required ===" && \
(command -v gh &>/dev/null && echo "✓ GitHub CLI: $(gh --version | head -1)" || echo "✗ GitHub CLI not found") && \
(command -v node &>/dev/null && echo "✓ Node.js: $(node --version)" || echo "✗ Node.js not found") && \
echo "" && \
echo "=== Optional ===" && \
(command -v mcp-server-chrome-devtools &>/dev/null && echo "✓ Chrome DevTools MCP installed" || echo "⚠ Chrome DevTools MCP not found (install: npm i -g @anthropic/mcp-server-chrome-devtools)") && \
echo "ℹ CodeRabbit: Check at github.com/apps/coderabbitai"
```

## License

MIT

---

*Built with Envoy - Professional development workflows for Claude Code*
