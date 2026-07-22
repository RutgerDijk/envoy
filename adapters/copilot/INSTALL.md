# Envoy — GitHub Copilot Adapter

This directory contains the GitHub Copilot adapter for Envoy. It translates Envoy's skills, commands, stacks, and agents into native GitHub Copilot formats.

## What's Included

| File/Directory | Copilot Format | Purpose |
|---------------|---------------|---------|
| `templates/copilot-instructions.md` | `.github/copilot-instructions.md` | Always-active workflow instructions (replaces session hook) |
| `templates/prompts/*.prompt.md` | `.github/prompts/` | Slash commands in Copilot Chat |
| `templates/instructions/*.instructions.md` | `.github/instructions/` | Stack-specific guidance, auto-activates by file type |
| `templates/agents/*.agent.md` | `.github/agents/` | Specialized agents in Copilot agent mode |

## Installation

Run the install script from your **project root** (not from the envoy directory):

```bash
/path/to/envoy/adapters/copilot/install.sh
```

This copies all templates into your project's `.github/` directory.

### Options

```bash
# Copy files (default)
./install.sh

# Symlink instead of copy — easier to pick up updates from envoy
./install.sh --symlink

# Specify envoy directory explicitly
./install.sh --envoy-dir /path/to/envoy
```

### After Installation

Commit the `.github/` directory to your repository:

```bash
git add .github/
git commit -m "chore: add Envoy Copilot adapter"
```

## Usage

### Slash Commands

In VS Code Copilot Chat, type `/` to see all available commands:

| Command | What it does |
|---------|-------------|
| `/brainstorm` | Turn an idea into a GitHub issue + spec document |
| `/pickup` | Pick up a GitHub issue and implement it |
| `/review` | Full code review (lint, AI, docs, security) |
| `/quick-review` | Fast AI-only review during development |
| `/finalize` | Review + docstrings + wiki sync + PR creation |
| `/docstrings` | Add XML/JSDoc documentation to public APIs |
| `/wiki-sync` | Sync `docs/wiki/` to the GitHub wiki |
| `/cleanup` | Remove worktree and branch after PR merge |
| `/visual-review` | Visual UI checklist (manual — no Chrome DevTools in Copilot) |

### Stack Instructions (Automatic)

Stack instructions activate automatically when you open relevant files:

| File type | Instructions that activate |
|-----------|---------------------------|
| `*.cs`, `*.csproj` | .NET, API patterns, security |
| `*.tsx`, `*.jsx` | React, Tailwind, shadcn/ui |
| `*.ts`, `*.tsx` | TypeScript, React Query, React Hook Form |
| `*Tests.cs` | .NET testing (xUnit + FluentAssertions) |
| `*.spec.ts` | Playwright testing |
| `*.bicep` | Bicep, Azure Container Apps |
| `*.yml` in `.github/workflows/` | GitHub Actions |
| `docker-compose*.yml` | Docker Compose |

### Agents (VS Code Copilot Agent Mode)

In VS Code, open Copilot Chat and select an agent from the picker:

- **Code Reviewer** — Reviews code against plan, standards, and best practices
- **Security Auditor** — OWASP Top 10 audit for .NET/React/Azure
- **Test Writer** — Writes comprehensive tests (xUnit, Vitest, Playwright)

## Differences from Claude Code Version

| Feature | Claude Code | GitHub Copilot |
|---------|-------------|----------------|
| Workflow commands | `/envoy:brainstorm` etc. | `/brainstorm` etc. |
| Stack detection | Automatic via session hook | Automatic via `applyTo` file patterns |
| Start-up message | Auto-loaded via session hook | Via `copilot-instructions.md` |
| Visual review | Chrome DevTools MCP (screenshots) | Manual checklist |
| Skill invocation | `Skill(name)` tool | Prompt files embedded directly |
| Personal skill overrides | `~/.claude/skills/` shadowing | Not applicable |

## Keeping Up to Date

If you installed with `--symlink`, files automatically reflect updates from the envoy directory.

If you installed by copy (default), just re-run the install script:

```bash
/path/to/envoy/adapters/copilot/install.sh
```

The installer keeps a manifest (`.github/.envoy-copilot-manifest.json`) with the content hash of every file it manages. On re-run, each file is handled by comparing hashes:

- **Missing** → installed
- **Unmodified since install** → updated to the current template
- **Locally edited** → left untouched, reported as `Locally modified, skipped`

To take an upstream update for a file you edited, delete your copy (or revert your edits) and re-run the installer. Installs made before the manifest existed are adopted automatically: files identical to the current templates become managed; edited files are treated as yours.

## Directory Structure

```
envoy/adapters/copilot/
├── INSTALL.md          ← This file
├── install.sh          ← Install script
└── templates/
    ├── copilot-instructions.md
    ├── prompts/
    │   ├── brainstorm.prompt.md
    │   ├── pickup.prompt.md
    │   ├── review.prompt.md
    │   ├── quick-review.prompt.md
    │   ├── finalize.prompt.md
    │   ├── cleanup.prompt.md
    │   ├── docstrings.prompt.md
    │   ├── wiki-sync.prompt.md
    │   └── visual-review.prompt.md
    ├── instructions/
    │   ├── dotnet.instructions.md
    │   ├── react.instructions.md
    │   ├── typescript.instructions.md
    │   ├── entity-framework.instructions.md
    │   ├── testing-dotnet.instructions.md
    │   ├── testing-playwright.instructions.md
    │   ├── tailwind.instructions.md
    │   ├── react-query.instructions.md
    │   ├── react-hook-form.instructions.md
    │   ├── openapi.instructions.md
    │   ├── azure-container-apps.instructions.md
    │   ├── azure-postgresql.instructions.md
    │   ├── azure-static-web-apps.instructions.md
    │   ├── bicep.instructions.md
    │   ├── docker-compose.instructions.md
    │   ├── github-actions.instructions.md
    │   ├── health-checks.instructions.md
    │   ├── jwt-oauth.instructions.md
    │   ├── orval.instructions.md
    │   ├── postgresql.instructions.md
    │   ├── security.instructions.md
    │   ├── serilog.instructions.md
    │   ├── shadcn-radix.instructions.md
    │   ├── api-patterns.instructions.md
    │   └── application-insights.instructions.md
    └── agents/
        ├── code-reviewer.agent.md
        ├── security-auditor.agent.md
        └── test-writer.agent.md
```
