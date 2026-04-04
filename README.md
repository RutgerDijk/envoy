# Envoy

Professional .NET/React/Azure development workflows for **Claude Code** and **GitHub Copilot**.

## Overview

Envoy provides a streamlined workflow from idea to merged PR:

```
brainstorm → pickup → implement → cleanup-pass → review → finalize → cleanup
```

**Key features:**
- **Brainstorming**: Turn ideas into designs + implementation plans through Socratic dialogue
- **Execution**: TDD-enforced implementation with automatic worktree management
- **Review**: 4-layer local review (Lint, Sonnet AI, Visual, Docs) with complexity tiers
- **Finalization**: Create PR, handle GitHub CodeRabbit comments, verify, ship
- **Cleanup**: Remove worktrees and branches after merge
- **Hooks**: Config protection, batch lint, cost tracking, learning extraction
- **Self-learning**: Graduated patterns, cross-PR CodeRabbit aggregation, user correction detection
- **Token optimization**: ~60% cost savings via Sonnet AI review, selective stack loading, regex-first parsing
- **Advanced patterns**: Eval harness, search-first, cleanup pass, iterative retrieval, completion signals

## Installation

### Claude Code

```bash
# Add the marketplace
/plugin marketplace add RutgerDijk/envoy

# Install the plugin
/plugin install envoy@envoy-marketplace
```

### GitHub Copilot

Run the install script from your **project root**:

```bash
/path/to/envoy/adapters/copilot/install.sh
```

This copies Envoy workflow templates into your project's `.github/` directory:
- `.github/copilot-instructions.md` — Always-active workflow instructions
- `.github/prompts/*.prompt.md` — Slash commands (`/brainstorm`, `/pickup`, `/review`, etc.)
- `.github/instructions/*.instructions.md` — Stack-specific guidance (auto-activates by file type)
- `.github/agents/*.agent.md` — Specialized agents (code-reviewer, security-auditor, test-writer)

Commit the `.github/` directory and you're ready to use Envoy in GitHub Copilot Chat.

See [`adapters/copilot/INSTALL.md`](adapters/copilot/INSTALL.md) for full details and options.

## How It Works

### Architecture

```
envoy/
├── .claude-plugin/        # Plugin configuration
│   ├── plugin.json        # Plugin metadata
│   └── marketplace.json   # Marketplace registration
├── hooks/                 # Session lifecycle hooks & automation
│   ├── hooks.json         # Hook registration (profile-annotated)
│   ├── hook-runner.js     # Profile-aware hook execution
│   ├── session-start.sh   # Auto-loads Envoy on startup
│   ├── config-protection.js    # Blocks linter config modifications
│   ├── post-edit-accumulator.js # Tracks edits for batched lint
│   ├── stop-batch-lint.js      # Runs lint once across all edits
│   ├── post-pr-poll.js         # Triggers CodeRabbit polling
│   ├── cost-tracker.js         # Async JSONL token logging
│   └── learning-extractor.js   # Async review pattern learning
├── memory/                # Team learnings (committed, shared via git)
│   ├── review-learnings.md     # Graduated patterns from AI review
│   ├── coderabbit-patterns.md  # Cross-PR CodeRabbit categories
│   └── corrections.md          # Team coding preferences
├── lib/                   # Shared utilities
│   ├── skills-core.js     # Skill discovery & shadowing
│   ├── stack-loader.js    # Stack detection, selective loading
│   ├── coderabbit-parser.js    # Regex-first CodeRabbit comment parser
│   ├── learning-loader.js      # Load confirmed patterns & corrections
│   ├── automation-suggester.js # Suggest hooks/rules for 5x patterns
│   └── loop-safeguards.js      # Completion signal threshold for loops
├── contexts/              # Phase-specific context fragments
│   ├── review.md               # Review phase constraints
│   ├── implement.md            # Implementation phase constraints
│   ├── research.md             # Research phase constraints
│   └── iterative-retrieval.md  # Multi-cycle retrieval protocol
├── commands/              # Entry points for /envoy:* commands
├── agents/                # Specialized agent definitions
├── skills/                # 24 workflow skills
├── stacks/                # 25 technology profiles
├── docs/                  # Anti-patterns & authoring guides
└── adapters/              # Platform adapters
    └── copilot/           # GitHub Copilot (prompts, instructions, agents)
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
│  3. REVIEW (local)                                                  │
│     /envoy:review                                                   │
│     → Lint → Sonnet AI review → Visual review → Doc gaps            │
│     → Fix all local findings                                        │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  4. FINALIZE (ship it)                                              │
│     /envoy:finalize                                                 │
│     → Docstrings → Create PR → Address GitHub CodeRabbit comments   │
│     → Reply + resolve → Verify → Wiki sync                          │
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
| `/envoy:review` | Local review: lint, Sonnet AI, visual, doc gaps |
| `/envoy:finalize` | Ship: create PR → handle GitHub CodeRabbit → verify |
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

## Review + Finalize (Separated Concerns)

**`/envoy:review`** finds and fixes issues locally (no PR needed):

| Tier | Criteria | Layers |
|------|----------|--------|
| Trivial | Docs/config only | Lint only |
| Small | 1-3 code files | Lint + Sonnet AI |
| Medium | 4-10 files | All 4 layers |
| Large | 10+ files | All 4 layers |

0. **Automated Linting** - `npm run lint`
1. **AI Review (Sonnet)** - Spec compliance, TDD verification, codebase patterns (~60% cheaper than Opus)
2. **Visual Review** - Chrome DevTools screenshots, console, network, health checks
3. **Doc Gap Detection** - Find missing or outdated documentation

**`/envoy:finalize`** ships the work (assumes review already ran):
- Create PR → GitHub CodeRabbit reviews automatically → address all comments → reply + resolve → verify → wiki sync

## Hook System

Envoy uses hooks for automation without polluting the context window:

| Hook | Type | Purpose |
|------|------|---------|
| `config-protection` | PreToolUse | Blocks linter/formatter config modifications |
| `post-edit-accumulator` | PostToolUse | Tracks edited files for batched processing |
| `post-pr-poll` | PostToolUse | Triggers CodeRabbit polling after PR creation |
| `stop-batch-lint` | Stop | Runs lint once across all session edits |
| `cost-tracker` | Stop (async) | Logs token usage to JSONL for optimization |
| `learning-extractor` | Stop (async) | Saves recurring review patterns to memory |
| `coderabbit-aggregator` | Stop (async) | Tracks CodeRabbit categories across PRs |
| `correction-detector` | UserPromptSubmit | Detects user corrections via Haiku classification |

### Hook Profiles

Control which hooks run via `ENVOY_HOOK_PROFILE`:

| Profile | Hooks | Use Case |
|---------|-------|----------|
| `minimal` | config-protection, cost-tracker | Low overhead, essential protection |
| `standard` | All hooks (default) | Full automation |
| `strict` | All hooks + verification gates | Maximum safety |

Override individual hooks: `ENVOY_DISABLED_HOOKS=cost-tracker,learning-extractor`

## Self-Learning System

Envoy creates a feedback loop where each review cycle is cheaper than the last:

```
implement (with confirmed patterns + corrections loaded)
  → fewer issues introduced
    → review finds fewer issues
      → CodeRabbit flags fewer things
        → corrections decrease over time
          → patterns that stop appearing get archived
```

### Graduated Patterns

Patterns from AI review and CodeRabbit graduate through levels:

| Level | Trigger | Action |
|-------|---------|--------|
| Detected | Seen 1x | Logged only |
| Confirmed | Seen 3x | Injected into implementation prompts |
| Automated | Seen 5x | Suggest hook/lint rule to user |
| Archived | 5 clean reviews | Removed (re-promoted if it reappears) |

### User Correction Learning

When you correct Claude's behavior, Haiku classifies the correction:
- **Project-specific** (references files, APIs, project patterns) → `memory/corrections.md` (team-shared)
- **Universal** (language/framework practices) → `~/.claude/learnings/corrections.md` (personal)

Both are loaded before implementation and review, so Claude doesn't repeat the same mistake.

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

Envoy includes 24 skills:

### Core Workflow

| Skill | When to Use |
|-------|-------------|
| `envoy:brainstorming` | Starting any new feature or significant change |
| `envoy:writing-plans` | Have a design doc, need implementation plan |
| `envoy:executing-plans` | Have a plan, ready to start coding |
| `envoy:pickup` | Ready to implement a GitHub issue |
| `envoy:finishing-branch` | Implementation complete, ready for PR |
| `envoy:cleanup` | After PR merged |

### Quality & Review

| Skill | When to Use |
|-------|-------------|
| `envoy:layered-review` | After implementation, before PR |
| `envoy:coderabbit-pr-review` | Address + resolve GitHub CodeRabbit PR comments |
| `envoy:visual-review` | UI changes need verification |
| `envoy:verification` | Before committing or claiming done |
| `envoy:requesting-code-review` | Get feedback on changes |
| `envoy:receiving-code-review` | Evaluate review feedback |

### Advanced Patterns

| Skill | When to Use |
|-------|-------------|
| `envoy:search-first` | Before implementing, check if solution already exists |
| `envoy:cleanup-pass` | After implementation, remove AI-generated slop before review |
| `envoy:eval-harness` | Test whether a skill behaves correctly across scenarios |

### Execution & Orchestration

| Skill | When to Use |
|-------|-------------|
| `envoy:dispatching-parallel-agents` | Multiple independent tasks |
| `envoy:subagent-driven-development` | Execute plan with fresh agent per task |
| `envoy:systematic-debugging` | Bug, test failure, or unexpected behavior |
| `envoy:test-driven-development` | Implementing any feature or bugfix |

### Utilities

| Skill | When to Use |
|-------|-------------|
| `envoy:using-git-worktrees` | Need isolated workspace |
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
# Local review: lint, Sonnet AI, visual, docs...

> /envoy:finalize
# Creates PR #43, handles CodeRabbit comments, verifies

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

CodeRabbit provides AI-powered code review on your PRs via the GitHub App.

1. **Install the CLI**:
   ```bash
   curl -fsSL https://cli.coderabbit.ai/install.sh | sh
   ```

2. **Authenticate**:
   ```bash
   coderabbit auth login
   ```

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

**Alternative**: Install the [GitHub App](https://github.com/apps/coderabbitai) for automatic PR reviews.

**Without CodeRabbit**: The finalize skill skips CodeRabbit comment handling. Local review (Sonnet AI, visual, docs) still runs.

### DevTools MCP Setup

Chrome DevTools MCP enables visual verification by capturing screenshots, console logs, and network activity.

1. **Add to MCP config** (`~/.mcp.json`):
   ```json
   {
     "mcpServers": {
       "chrome-devtools": {
         "command": "npx",
         "args": ["chrome-devtools-mcp@latest"]
       }
     }
   }
   ```

2. **Launch Chrome with debugging**:
   ```bash
   # macOS
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

   # Or create an alias
   alias chrome-debug='/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222'
   ```

**Without DevTools MCP**: The review skill skips visual verification (Layer 2) and continues with other layers.

### Verify Setup

Run this command to check your setup:

```bash
echo "=== Required ===" && \
(command -v gh &>/dev/null && echo "✓ GitHub CLI: $(gh --version | head -1)" || echo "✗ GitHub CLI not found") && \
(command -v node &>/dev/null && echo "✓ Node.js: $(node --version)" || echo "✗ Node.js not found") && \
echo "" && \
echo "=== Optional ===" && \
(command -v coderabbit &>/dev/null && echo "✓ CodeRabbit CLI installed" || echo "⚠ CodeRabbit CLI not found (install: curl -fsSL https://cli.coderabbit.ai/install.sh | sh)") && \
(test -f ~/.mcp.json && grep -q "chrome-devtools-mcp" ~/.mcp.json && echo "✓ Chrome DevTools MCP configured" || echo "⚠ Chrome DevTools MCP not configured (add to ~/.mcp.json)")
```

## License

MIT

---

*Built with Envoy - Professional development workflows for Claude Code*
