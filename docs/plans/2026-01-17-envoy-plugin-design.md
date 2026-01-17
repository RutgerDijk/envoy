# Envoy Plugin Design Document

**Date:** 2026-01-17
**Status:** Draft
**Author:** Rutger Dijkstra + Claude

---

## 1. Overview

**Envoy** is a Claude Code plugin for professional .NET/React/Azure development workflows. It emphasizes **handoff-ready artifacts** — every brainstorm session produces GitHub issues and spec docs that another developer (human or AI) can pick up and execute independently.

### Core Principles

1. **Artifact-first** — Work produces durable outputs: GitHub issues with labels, spec docs in `docs/plans/`, wiki pages. Nothing lives only in chat context.

2. **Handoff-optimized** — A developer who wasn't in the brainstorm can run `/envoy:pickup 123` and have everything they need: worktree created, plan loaded, execution strategy defined.

3. **Configurable execution** — Plans specify their own execution strategy (parallel agents, batched with checkpoints, or sequential). No one-size-fits-all.

4. **Layered review** — CodeRabbit for static analysis, then a fresh AI agent for architectural review. Implementation bias doesn't review itself.

5. **Stack-aware** — Modular stack profiles with auto-detection. Curated best practices from awesome-copilot, extended with custom instructions for your specific patterns.

6. **Composable skills** — Core skills (wiki-sync, docstrings) available standalone for post-PR iterations, not just locked into finalization workflow.

### Relationship to Superpowers

Envoy is **inspired by superpowers** but fully independent (~35% reuse, ~65% new work). It follows the same patterns (skills as markdown, plugin structure, evidence-over-claims philosophy) but owns its codebase and can evolve in its own direction.

---

## 2. Target Stack

Based on the HybridFitWebApp project analysis:

### Backend
| Technology | Version | Purpose |
|------------|---------|---------|
| .NET | 10.0 | Runtime |
| ASP.NET Core | 10.0 | Web framework |
| Entity Framework Core | 10.0 | ORM |
| Serilog | 10.0 | Structured logging |
| Application Insights | Latest | Azure telemetry |
| xUnit | 2.9.3 | Unit testing |
| Moq | 4.20.72 | Mocking |
| FluentAssertions | 6.12.0 | Test assertions |
| Swashbuckle | 10.1.0 | OpenAPI/Swagger |
| AspNetCoreRateLimit | 5.0.0 | Rate limiting |
| BCrypt.Net | 4.0.3 | Password hashing |
| JWT Bearer | 10.0.1 | Authentication |

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| React | 19.2.0 | UI framework |
| TypeScript | 5.9.3 | Language |
| Vite | 7.2.4 | Build tool |
| Tailwind CSS | 4.1.18 | Styling |
| Radix UI | Latest | Headless components |
| shadcn/ui | Latest | Component library |
| TanStack React Query | 5.90.12 | Server state |
| React Hook Form | 7.69.0 | Form management |
| Zod | 4.2.1 | Schema validation |
| Orval | 7.17.2 | OpenAPI client generation |
| Playwright | 1.57.0 | E2E testing |
| Axios | 1.13.2 | HTTP client |

### Database
| Technology | Version | Purpose |
|------------|---------|---------|
| PostgreSQL | 16 | Database |
| Npgsql | 10.0.0 | .NET PostgreSQL driver |
| Azure Database for PostgreSQL | Flexible Server | Managed hosting (target) |

### Infrastructure
| Technology | Purpose |
|------------|---------|
| Docker | Containerization |
| Docker Compose | Local development |
| Azure Container Apps | API hosting (target) |
| Azure Static Web Apps | Frontend hosting (target) |
| Bicep | Infrastructure as Code |
| GitHub Actions | CI/CD |
| nginx | Reverse proxy (local) |

### Quality & Observability
| Technology | Purpose |
|------------|---------|
| CodeRabbit | Automated code review |
| ESLint | Frontend linting |
| Application Insights | APM & telemetry |
| Health Checks | Liveness/readiness probes |

---

## 3. Plugin Structure

```
envoy/
├── .claude-plugin/
│   └── plugin.json                    # Plugin manifest
│
├── skills/
│   ├── brainstorming/SKILL.md         # Idea → GitHub issue + spec doc
│   ├── writing-plans/SKILL.md         # Spec → detailed implementation plan
│   ├── executing-plans/SKILL.md       # Configurable execution
│   ├── pickup/SKILL.md                # /envoy:pickup <issue> → worktree + load
│   ├── layered-review/SKILL.md        # Full 4-layer review process
│   ├── visual-review/SKILL.md         # Chrome DevTools verification (Layer 3)
│   ├── using-git-worktrees/SKILL.md   # Isolated workspace creation
│   ├── verification/SKILL.md          # Verify before claiming done
│   ├── finishing-branch/SKILL.md      # Complete branch workflow
│   ├── wiki-sync/SKILL.md             # Standalone wiki sync
│   └── docstrings/SKILL.md            # Standalone docstring generation
│
├── commands/
│   ├── brainstorm.md                  # /envoy:brainstorm
│   ├── write-plan.md                  # /envoy:write-plan
│   ├── execute-plan.md                # /envoy:execute-plan
│   ├── pickup.md                      # /envoy:pickup <issue-number>
│   ├── review.md                      # /envoy:review [--check-docs] [--no-check-docs]
│   ├── quick-review.md                # /envoy:quick-review (layers 1-2 only)
│   ├── visual-review.md               # /envoy:visual-review (Chrome DevTools only)
│   ├── finalize.md                    # /envoy:finalize
│   ├── wiki-sync.md                   # /envoy:wiki-sync
│   └── docstrings.md                  # /envoy:docstrings
│
├── stacks/                            # Modular stack profiles
│   │
│   │ # Backend
│   ├── dotnet.md                      # .NET 10, ASP.NET Core patterns
│   ├── entity-framework.md            # EF Core, DbContext, migrations
│   ├── serilog.md                     # Structured logging patterns
│   ├── jwt-oauth.md                   # Auth patterns (JWT, Google, Apple)
│   ├── api-patterns.md                # Rate limiting, health checks, Swagger
│   │
│   │ # Frontend
│   ├── react.md                       # React 19 patterns
│   ├── typescript.md                  # TypeScript 5.9 standards
│   ├── shadcn-radix.md                # shadcn/ui + Radix UI patterns
│   ├── react-query.md                 # TanStack Query patterns
│   ├── react-hook-form.md             # Forms + Zod validation
│   ├── tailwind.md                    # Tailwind CSS patterns
│   ├── orval.md                       # OpenAPI client generation
│   │
│   │ # Database
│   ├── postgresql.md                  # PostgreSQL patterns
│   │
│   │ # Testing
│   ├── testing-dotnet.md              # xUnit + Moq + FluentAssertions
│   ├── testing-playwright.md          # E2E testing
│   │
│   │ # Infrastructure
│   ├── docker-compose.md              # Docker Compose patterns
│   ├── azure.md                       # General Azure patterns
│   ├── azure-container-apps.md        # Container Apps deployment
│   ├── azure-static-web-apps.md       # SPA deployment
│   ├── azure-postgresql.md            # Flexible Server config
│   ├── bicep.md                       # Infrastructure as Code
│   ├── github-actions.md              # CI/CD patterns
│   │
│   │ # Security & Quality
│   ├── security.md                    # OWASP, security practices
│   └── application-insights.md        # Azure telemetry integration
│
├── agents/                            # Curated from awesome-copilot
│   ├── azure-architect.md             # Azure solution design
│   ├── bicep-implementer.md           # Bicep implementation
│   ├── playwright-tester.md           # E2E test generation
│   ├── postgresql-dba.md              # Database expertise
│   ├── security-reviewer.md           # Security assessment
│   └── tdd-cycle.md                   # Red/green/refactor
│
├── templates/
│   ├── github-issue.md                # Issue template with labels
│   ├── spec-doc.md                    # Design doc template
│   └── plan-doc.md                    # Implementation plan template
│
└── docs/
    └── plans/                         # Generated specs live here
```

---

## 4. Core Workflows

### Workflow A: Brainstorm → Issue + Spec

```
User: /envoy:brainstorm "Add user profile editing"
                ↓
        Socratic dialogue
        (one question at a time)
                ↓
        Design validated
                ↓
    ┌───────────┴───────────┐
    ↓                       ↓
GitHub Issue            Spec Doc
- Labels: backend,      docs/plans/2026-01-17-
  frontend, feature       user-profile-design.md
- Links to spec doc
- Setup commands
- Acceptance criteria
```

### Workflow B: Write Plan → Pickup → Execute (Handoff)

```
Developer A:
/envoy:write-plan docs/plans/2026-01-17-user-profile-design.md
                ↓
        Creates implementation plan with:
        - Bite-sized tasks (2-5 min each)
        - Execution strategy (parallel/batch/sequential)
        - Stack profiles to activate
                ↓
        Plan attached to GitHub issue

═══════════════════════════════════════════════════

Developer B (later):
/envoy:pickup 123
                ↓
        - Creates worktree: ../envoy-worktrees/user-profile
        - Loads plan from linked spec
        - Activates relevant stack profiles
                ↓
/envoy:execute-plan
                ↓
        Runs tasks per configured strategy:
        - parallel: spawn agents for independent tasks
        - batch: group related tasks, checkpoint between batches
        - sequential: one task at a time
```

### Workflow C: Review → Finalize

```
/envoy:review
        ↓
Layer 1: CodeRabbit
        coderabbit review --prompt-only --base main
        ↓
        Categorize findings:
        - Obvious fixes → auto-fix
        - Ambiguous → ask user
        ↓
Layer 2: Fresh AI Agent
        - No implementation context (blind review)
        - Reviews against project docs/wiki
        - Checks architectural consistency
        ↓
/envoy:finalize
        ↓
    ┌───┴───┬───────┬──────────┐
    ↓       ↓       ↓          ↓
Docstrings  Wiki   Tests      PR
            Sync   Pass?      Create
```

---

## 5. Stack Auto-Detection

When a skill activates, Envoy detects the project stack and injects relevant profiles:

```javascript
// Pseudo-logic for stack detection
detect() {
  const stacks = [];

  // Backend detection
  if (exists("*.csproj")) {
    stacks.push("dotnet.md");

    if (grep("Microsoft.EntityFrameworkCore", "*.csproj"))
      stacks.push("entity-framework.md");
    if (grep("Serilog", "*.csproj"))
      stacks.push("serilog.md");
    if (grep("JwtBearer", "*.csproj"))
      stacks.push("jwt-oauth.md");
    if (grep("AspNetCoreRateLimit", "*.csproj"))
      stacks.push("api-patterns.md");
    if (grep("xunit", "*.csproj"))
      stacks.push("testing-dotnet.md");
    if (grep("Npgsql", "*.csproj"))
      stacks.push("postgresql.md");
    if (grep("ApplicationInsights", "*.csproj"))
      stacks.push("application-insights.md");
  }

  // Frontend detection
  if (exists("package.json")) {
    const pkg = read("package.json");

    if (pkg.includes("react"))
      stacks.push("react.md");
    if (exists("tsconfig.json"))
      stacks.push("typescript.md");
    if (pkg.includes("@radix-ui") || exists("components.json"))
      stacks.push("shadcn-radix.md");
    if (pkg.includes("@tanstack/react-query"))
      stacks.push("react-query.md");
    if (pkg.includes("react-hook-form"))
      stacks.push("react-hook-form.md");
    if (pkg.includes("tailwindcss"))
      stacks.push("tailwind.md");
    if (pkg.includes("orval"))
      stacks.push("orval.md");
    if (pkg.includes("@playwright/test"))
      stacks.push("testing-playwright.md");
  }

  // Infrastructure detection
  if (exists("Dockerfile") || exists("docker-compose.yml"))
    stacks.push("docker-compose.md");
  if (exists("*.bicep") || exists("bicepconfig.json"))
    stacks.push("bicep.md");
  if (exists(".github/workflows/"))
    stacks.push("github-actions.md");

  // Always include security
  stacks.push("security.md");

  return stacks;
}
```

---

## 6. GitHub Issue Format

```markdown
## Summary

<2-3 sentence description of the feature/change>

## Labels

`backend` `frontend` `feature` `security` `refactor` `infrastructure`

## Linked Spec

[View full design](../docs/plans/2026-01-17-<topic>-design.md)

## Quick Start

```bash
# Create isolated workspace
git worktree add ../envoy-worktrees/<branch-name> -b feature/<branch-name>

# Navigate to workspace
cd ../envoy-worktrees/<branch-name>

# Start Claude and pickup the issue
claude
/envoy:pickup <issue-number>
```

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Execution Strategy

`parallel` | `batch` | `sequential`

<Rationale for chosen strategy>

## Stack Profiles

Auto-detected: `dotnet`, `react`, `postgresql`, ...

---

*Generated by Envoy*
```

---

## 7. Code Standards Enforcement

Envoy uses **soft enforcement** — standards live in documentation and stack profiles, violations are flagged in reviews, but developers retain autonomy. No blocking pre-commit hooks.

### Enforcement Layers

| Layer | Tool | When | Action |
|-------|------|------|--------|
| **IDE** | EditorConfig, ESLint | On save | Formatting hints |
| **Build** | Roslyn Analyzers, TypeScript | Build time | Warnings in output |
| **Review** | CodeRabbit + Stack Profiles | PR/Review | Flag violations |
| **AI Review** | Documentation-informed agent | `/envoy:review` | Check against standards docs |

### Standards Sources

| Source | Location | Purpose |
|--------|----------|---------|
| Project Standards | `.NET_STANDARDS.md`, `FRONTEND_STANDARDS.md` | Project-specific conventions |
| Stack Profiles | `stacks/*.md` | Technology best practices |
| Awesome-Copilot | Curated instructions | Industry standards |
| Wiki | `docs/wiki/` | Feature-specific patterns |

---

## 8. Layered Review Process

Envoy uses a **4-layer review process** that combines automated tools, documentation-informed AI, and visual verification.

### Review Flow

```
/envoy:review [--check-docs] [--no-check-docs]
                    ↓
┌─────────────────────────────────────────────────┐
│  LOAD CONTEXT                                   │
│  - Detect stack → load stack profiles           │
│  - Load project standards docs                  │
│  - Load relevant wiki pages                     │
│  - Load linked issue/spec acceptance criteria   │
└─────────────────────────────────────────────────┘
                    ↓
Layer 1: CodeRabbit (Static Analysis)
        - Run: coderabbit review --prompt-only --base main
        - Security scanning
        - Style/pattern checks
        - Triage: obvious → auto-fix, ambiguous → ask user
                    ↓
Layer 2: Documentation-Informed AI Review
        - Fresh agent (no implementation context)
        - Has: diff, stack profiles, standards docs, wiki
        - Checks: code follows documented patterns
        - Checks: consistent with existing codebase
        - Checks: meets acceptance criteria from spec
                    ↓
Layer 3: Visual/Functional Review (Chrome DevTools)
        - Start app (docker-compose up / npm run dev)
        - Navigate to affected pages
        - Take screenshots
        - Check console for errors/warnings
        - Check network requests for issues
        - Verify acceptance criteria visually
                    ↓
Layer 4: Documentation Gap Detection
        - Default: surface-level (missing docstrings, outdated refs)
        - --check-docs: deep analysis, suggest new docs
        - --no-check-docs: skip this layer
                    ↓
REPORT
        - Categorize findings: passed / obvious fix / ambiguous
        - Include doc references for violations
        - Present documentation gaps found
        - Get user approval to proceed
```

### Review Commands

| Command | Layers | Use Case |
|---------|--------|----------|
| `/envoy:review` | 1-4 (default doc check) | Full review |
| `/envoy:review --check-docs` | 1-4 (deep doc check) | Thorough review with doc analysis |
| `/envoy:review --no-check-docs` | 1-3 | Fast review, skip doc gaps |
| `/envoy:quick-review` | 1-2 only | Non-UI changes, skip DevTools |
| `/envoy:visual-review` | 3 only | Manual DevTools verification |

### Layer 1: CodeRabbit

```bash
coderabbit review --prompt-only --base main
```

CodeRabbit checks:
- Security vulnerabilities
- Code style violations
- Common anti-patterns
- Performance issues
- Test coverage gaps

### Layer 2: Documentation-Informed AI Review

The review agent receives:
- The diff of changes (`git diff main...HEAD`)
- Project standards (`*_STANDARDS.md`)
- Relevant stack profiles (auto-detected)
- Wiki pages related to changed areas
- Acceptance criteria from linked spec
- **NOT** the implementation conversation (prevents bias)

Review checklist:
1. Does the implementation match the spec?
2. Does the code follow project standards?
3. Are there architectural concerns?
4. Are there security implications?
5. Is error handling appropriate?
6. Are there performance concerns?
7. Is the code consistent with existing patterns?

### Layer 3: Visual/Functional Review (Chrome DevTools)

Uses Chrome DevTools MCP integration to verify the implementation works:

| Check | Tool | Purpose |
|-------|------|---------|
| Visual appearance | `take_screenshot` | Does it look right? |
| Console errors | `list_console_messages` | Any JS errors/warnings? |
| Network issues | `list_network_requests` | Failed requests? Slow endpoints? |
| Functional flows | `click`, `fill_form`, `wait_for` | Does the feature work? |
| Page state | `take_snapshot` | DOM structure correct? |
| Navigation | `navigate_page` | Routes work correctly? |

**Process:**
1. Start the application
2. Navigate to pages affected by changes
3. Execute key user flows from acceptance criteria
4. Capture screenshots for visual verification
5. Check console for errors
6. Verify network requests succeed

### Layer 4: Documentation Gap Detection

| Mode | Flag | Behavior |
|------|------|----------|
| **Default** | (none) | Surface-level: missing docstrings, obvious outdated refs |
| **Deep** | `--check-docs` | Cross-reference all standards, wiki; suggest new docs |
| **Skip** | `--no-check-docs` | Skip documentation checking entirely |

Documentation gaps reported:
- Code patterns not documented in standards
- New features not reflected in wiki
- Outdated documentation that contradicts current code
- Missing API documentation
- Undocumented configuration options

---

## 9. Stack Profile Structure

Each stack profile follows a consistent structure that enables documentation-informed review:

```markdown
# [Technology] Stack Profile

## Overview
Brief description of the technology and its role in the stack.

## Best Practices
- Practice 1: explanation
- Practice 2: explanation
- ...

## Common Mistakes to Check
- [ ] Mistake 1: why it's wrong, what to do instead
- [ ] Mistake 2: why it's wrong, what to do instead
- ...

## Review Checklist
- [ ] Check 1 (references: .NET_STANDARDS.md section X)
- [ ] Check 2 (references: awesome-copilot/xyz.instructions.md)
- ...

## Code Examples

### Good Pattern
```code
// Example of correct implementation
```

### Anti-Pattern
```code
// Example of what NOT to do
```

## References
- Link to project standards doc section
- Link to awesome-copilot instructions
- Link to official documentation
- Link to wiki pages
```

### Example: dotnet.md

```markdown
# .NET Stack Profile

## Overview
.NET 10 with ASP.NET Core for REST APIs, following clean architecture patterns.

## Best Practices
- Use async/await for all I/O operations
- Follow repository pattern for data access
- Use dependency injection for all services
- Return ActionResult<T> from controllers
- Use structured logging with Serilog

## Common Mistakes to Check
- [ ] Sync over async: using .Result or .Wait() instead of await
- [ ] Missing null checks on nullable reference types
- [ ] N+1 queries in EF Core (use Include/ThenInclude)
- [ ] Catching generic Exception instead of specific types
- [ ] Not disposing IDisposable resources
- [ ] Hardcoded configuration values

## Review Checklist
- [ ] Follows .NET_STANDARDS.md naming conventions
- [ ] Uses Serilog structured logging (not Console.WriteLine)
- [ ] Has XML documentation on public APIs
- [ ] Controllers are thin (logic in services)
- [ ] Async methods end with "Async" suffix
- [ ] Uses cancellation tokens for async operations

## Code Examples

### Good: Async Controller Action
```csharp
[HttpGet("{id}")]
public async Task<ActionResult<UserDto>> GetUser(int id, CancellationToken ct)
{
    var user = await _userService.GetByIdAsync(id, ct);
    if (user is null) return NotFound();
    return Ok(user);
}
```

### Anti-Pattern: Sync over Async
```csharp
// DON'T DO THIS
[HttpGet("{id}")]
public ActionResult<UserDto> GetUser(int id)
{
    var user = _userService.GetByIdAsync(id).Result; // BLOCKS THREAD
    return Ok(user);
}
```

## References
- Project: `.NET_STANDARDS.md`
- Awesome-Copilot: `csharp.instructions.md`
- Awesome-Copilot: `aspnet-rest-apis.instructions.md`
- Microsoft: https://docs.microsoft.com/aspnet/core
```

---

## 10. Execution Strategies

Plans can specify their execution strategy:

### Parallel
```yaml
execution:
  strategy: parallel
  max_concurrent: 4
```
- Spawn independent agents for each task
- Best for: unrelated changes across different files
- Risk: merge conflicts if tasks touch same files

### Batch
```yaml
execution:
  strategy: batch
  batches:
    - tasks: [1, 2, 3]
      checkpoint: true
    - tasks: [4, 5]
      checkpoint: true
    - tasks: [6, 7, 8]
      checkpoint: false
```
- Group related tasks, pause between batches for review
- Best for: features with logical phases (data model → API → UI)
- Balanced control and speed

### Sequential
```yaml
execution:
  strategy: sequential
```
- One task at a time, in order
- Best for: tightly coupled changes, learning/unfamiliar areas
- Maximum control, slowest execution

---

## 11. Standalone Skills

These skills can be invoked independently, not just as part of finalization:

### `/envoy:wiki-sync`
- Syncs `docs/wiki/` to GitHub wiki repository
- Handles divergence detection (asks user if wiki has external changes)
- Can be run after any documentation update

### `/envoy:docstrings`
- Adds/updates docstrings to public APIs
- Scope: files changed since base branch, or specified files
- Follows project conventions:
  - C#: `/// <summary>` XML docs
  - TypeScript: `/** */` JSDoc comments

---

## 12. Curated Awesome-Copilot Resources

### Instructions (Coding Standards)

| Resource | Stack Profile |
|----------|---------------|
| csharp.instructions.md | dotnet.md |
| dotnet-architecture-good-practices.instructions.md | dotnet.md |
| aspnet-rest-apis.instructions.md | api-patterns.md |
| reactjs.instructions.md | react.md |
| typescript-5-es2022.instructions.md | typescript.md |
| azure-verified-modules-bicep.instructions.md | bicep.md |
| bicep-code-best-practices.instructions.md | bicep.md |
| containerization-docker-best-practices.instructions.md | docker-compose.md |
| playwright-typescript.instructions.md | testing-playwright.md |
| playwright-dotnet.instructions.md | testing-playwright.md |
| security-and-owasp.instructions.md | security.md |
| code-review-generic.instructions.md | (all reviews) |
| github-actions-ci-cd-best-practices.instructions.md | github-actions.md |

### Agents (Specialized Assistants)

| Agent | Use Case |
|-------|----------|
| azure-principal-architect.agent.md | Azure solution design |
| azure-iac-generator.agent.md | Generate Bicep |
| bicep-implement.agent.md | Bicep implementation |
| playwright-tester.agent.md | E2E test generation |
| tdd-red/green/refactor.agent.md | TDD cycle |
| se-security-reviewer.agent.md | Security assessment |
| postgresql-dba.agent.md | Database expertise |
| github-actions-expert.agent.md | CI/CD workflows |

### Prompts (Task-Specific)

| Prompt | Use Case |
|--------|----------|
| csharp-xunit.prompt.md | xUnit test generation |
| csharp-docs.prompt.md | C# documentation |
| dotnet-design-pattern-review.prompt.md | Pattern evaluation |
| playwright-generate-test.prompt.md | E2E test creation |
| postgresql-code-review.prompt.md | Database code review |
| review-and-refactor.prompt.md | Code improvement |

---

## 13. Azure Hosting Architecture (Target)

```
┌─────────────────────────────────────────────────────────────────┐
│                         Azure                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  Static Web     │  │  Container      │  │  Database for   │  │
│  │  Apps           │  │  Apps           │  │  PostgreSQL     │  │
│  │                 │  │                 │  │                 │  │
│  │  React SPA      │  │  .NET API       │  │  Flexible       │  │
│  │  (Vite build)   │  │  (Docker)       │  │  Server         │  │
│  │                 │  │                 │  │                 │  │
│  │  CDN + SSL      │  │  Auto-scale     │  │  Managed        │  │
│  │  Free tier      │  │  Scale to zero  │  │  Backups        │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                     │           │
│           │         ┌──────────┴──────────┐          │           │
│           │         │  Application        │          │           │
│           └────────►│  Insights           │◄─────────┘           │
│                     │  (Telemetry)        │                      │
│                     └─────────────────────┘                      │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    Bicep IaC                                │ │
│  │  - Resource Group        - Container Apps Environment       │ │
│  │  - Static Web App        - Container App                    │ │
│  │  - PostgreSQL Server     - Application Insights             │ │
│  │  - Key Vault (secrets)   - Log Analytics Workspace          │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 14. Future Stack Modules (YAGNI'd)

Reserved for when needed:

| Module | Use Case |
|--------|----------|
| `nextjs.md` | Marketing frontend |
| `react-native.md` | iOS/Android apps |
| `maui.md` | Cross-platform mobile (alternative) |

---

## 15. Success Criteria

Envoy is successful when:

1. **Handoff works** — A developer can `/envoy:pickup 123` and have everything needed to execute without asking questions
2. **Artifacts are durable** — GitHub issues + spec docs survive context loss, can be resumed days later
3. **Review catches real issues** — 4-layer review (CodeRabbit → Doc-informed AI → Visual → Doc gaps) finds problems the implementer missed
4. **Visual verification works** — Chrome DevTools catches UI bugs, console errors, and network issues
5. **Stack profiles help** — Auto-detected best practices reduce boilerplate and prevent common mistakes
6. **Execution is flexible** — Parallel/batch/sequential strategies work for different types of work
7. **Wiki stays in sync** — Documentation updates flow to GitHub wiki without manual intervention
8. **Doc gaps are surfaced** — Review identifies missing or outdated documentation

---

## 16. Implementation Priority

### Phase 1: Core Skills
1. `brainstorming/SKILL.md` — The starting point
2. `writing-plans/SKILL.md` — Creates executable plans
3. `pickup/SKILL.md` — Enables handoff
4. `using-git-worktrees/SKILL.md` — Workspace isolation

### Phase 2: Execution & Review
5. `executing-plans/SKILL.md` — Configurable execution
6. `layered-review/SKILL.md` — Full 4-layer review process
7. `visual-review/SKILL.md` — Chrome DevTools verification
8. `verification/SKILL.md` — Verify before done

### Phase 3: Finalization
9. `finishing-branch/SKILL.md` — Complete workflow
10. `wiki-sync/SKILL.md` — Standalone wiki sync
11. `docstrings/SKILL.md` — Standalone docstrings

### Phase 4: Stack Profiles
12. Core stacks: dotnet, react, typescript, postgresql
13. Testing stacks: testing-dotnet, testing-playwright
14. Infrastructure stacks: docker-compose, azure-*, bicep, github-actions
15. Supporting stacks: remaining profiles

### Phase 5: Polish
16. Templates (github-issue.md, spec-doc.md, plan-doc.md)
17. Agents (curated from awesome-copilot)
18. Commands (all /envoy:* commands, including quick-review and visual-review)
19. Documentation and README

---

## 17. Open Questions

1. **Plan file format** — YAML frontmatter in markdown? Pure YAML? JSON?
2. **Worktree naming** — Convention for worktree directory names?
3. **Issue labels** — Fixed set or configurable per project?
4. **Agent spawning** — How to spawn "fresh" agents in Claude Code?
5. **Stack profile injection** — How to inject profiles into skill context?

---

## Appendix A: Skill-by-Skill Comparison with Superpowers

| Superpowers Skill | Envoy Equivalent | Reuse % | Key Differences |
|-------------------|------------------|---------|-----------------|
| brainstorming | brainstorming | ~30% | Outputs GitHub issue + linked spec |
| writing-plans | writing-plans | ~40% | Includes execution strategy config |
| executing-plans | executing-plans | ~35% | Configurable parallel/batch/sequential |
| using-git-worktrees | using-git-worktrees | ~80% | Minor adaptations |
| verification-before-completion | verification | ~70% | Minor adaptations |
| dispatching-parallel-agents | (part of executing-plans) | ~50% | Integrated into execution strategies |
| finishing-a-development-branch | finishing-branch | ~20% | Layered review, CodeRabbit integration |
| subagent-driven-development | (part of executing-plans) | ~40% | Integrated into execution strategies |
| test-driven-development | (via stack profiles) | ~60% | TDD guidance in testing-dotnet.md |
| systematic-debugging | (not included v1) | 0% | Future consideration |
| requesting-code-review | (part of layered-review) | ~30% | Merged into 4-layer review workflow |
| receiving-code-review | (part of layered-review) | ~30% | Merged into 4-layer review workflow |
| writing-skills | (not included v1) | 0% | Future consideration |
| using-superpowers | (README) | ~50% | Documentation only |
| (none) | visual-review | 0% | **NEW** Chrome DevTools verification |
| (none) | quick-review | 0% | **NEW** Fast review (layers 1-2 only) |

---

## Appendix B: File Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Spec docs | `YYYY-MM-DD-<topic>-design.md` | `2026-01-17-user-profile-design.md` |
| Plan docs | `YYYY-MM-DD-<topic>-plan.md` | `2026-01-17-user-profile-plan.md` |
| Worktrees | `../envoy-worktrees/<branch-name>` | `../envoy-worktrees/user-profile` |
| Branches | `feature/<topic>` | `feature/user-profile` |

---

*This design document was created during a brainstorming session on 2026-01-17.*
*Updated on 2026-01-17 with: code standards enforcement, 4-layer review process, Chrome DevTools visual verification, documentation gap detection, and stack profile structure.*
