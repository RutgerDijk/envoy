# Envoy - Claude Code Plugin

## What This Is

Envoy is a Claude Code plugin providing professional development workflows. It is NOT a .NET/React application — it's a plugin that provides skills, stack profiles, agents, and hooks for use in other projects.

## Project Structure

- `skills/` — Workflow skills (SKILL.md files with YAML frontmatter)
- `stacks/` — Technology profiles (best practices, common mistakes, review checklists)
- `agents/` — Specialized agent definitions for code review, testing, security
- `commands/` — Thin wrappers that route `/envoy:*` commands to skills
- `hooks/` — Session lifecycle hooks and automation (see Hooks section)
- `lib/` — Shared Node.js utilities (skills-core.js, stack-loader.js) — changes here affect ALL skills and hooks
- `contexts/` — Phase-specific context fragments (review.md, implement.md, research.md)
- `adapters/copilot/` — GitHub Copilot integration (prompts, instructions, agents)
- `templates/` — Example artifacts (plan docs, spec docs, issue templates)
- `memory/` — Team learnings (graduated patterns, CodeRabbit aggregation, corrections) — committed to repo
- `docs/` — Anti-patterns guide and skill authoring reference

## Conventions

### Skills
- Each skill lives in `skills/<skill-name>/SKILL.md`
- Frontmatter: only `name` and `description` fields, max 1024 chars
- Description must be under 30 words and start with "Use when..." — triggering conditions only
- Rigid skills (TDD, systematic-debugging, verification, review, pickup, receiving-code-review): follow exactly, no adaptation
- Flexible skills (brainstorming, planning): adapt principles to context
- Include "Announce at start" directive and "Integration with Envoy" section

### Stack Profiles
- Each profile in `stacks/<stack-name>.md`
- Must include: Best Practices, Common Mistakes, Review Checklist sections
- Detection patterns are defined in `lib/stack-loader.js` STACK_RULES array
- Use selective loading: `loadStackSection()` for specific sections, `detectStacksFromDiff()` for changed-file stacks

### Commands
- Each command in `commands/<name>.md` with YAML frontmatter (`description`)
- Commands are thin — they just invoke the corresponding skill

### Agents
- Agent definitions in `agents/<name>.md`
- Include stack profile references and review criteria

### Hooks
- Hook scripts in `hooks/` (JS or shell)
- All hooks route through `hooks/hook-runner.js` for profile-aware execution
- Registration in `hooks/hooks.json` with `_profiles` annotation
- Three profiles: `minimal`, `standard` (default), `strict`
- Control via `ENVOY_HOOK_PROFILE` and `ENVOY_DISABLED_HOOKS` env vars
- Async hooks (cost-tracker, learning-extractor, coderabbit-aggregator) never block or pollute context

### Graduated Learning
- Patterns graduate through levels: detected (1-2x) → confirmed (3-4x) → automated (5+x) → archived
- `memory/review-learnings.md` stores review patterns with embedded JSON data
- `memory/coderabbit-patterns.md` stores cross-PR CodeRabbit patterns
- `memory/corrections.md` stores project-specific team corrections
- `~/.claude/learnings/corrections.md` stores personal universal corrections
- `lib/learning-loader.js` provides `loadConfirmedPatterns()`, `loadCorrections()`, `formatReminders()`
- `lib/automation-suggester.js` generates prevention suggestions for 5x patterns
- Archived patterns (not seen in 5 reviews) get re-promoted if they reappear

### Context Efficiency (lean-ctx inspired)
- `lib/session-state.js` — Cross-session task continuity via `.envoy-session.json`; auto-detected by `session-start.sh`
- `lib/agent-scratchpad.js` — Multi-agent coordination via `.envoy-scratchpad.json`; agents register, post findings, check file ownership
- `lib/context-budget.js` — LITM-aware prompt structuring; classifies complexity (mechanical→architectural), orders sections for U-curve attention
- `lib/relevance-scorer.js` — Task-aware file scoring via import chain heat diffusion; recommends read depth (full/focused/skim/skip)
- `lib/output-compressor.js` — Shell output compression (patterns: dotnet, npm, jest, playwright, cargo, git, docker); safeguard ratio prevents over-compression
- `lib/cost-reporter.js` — Token usage analytics from Claude Code session JSONL logs; per-model/branch/session breakdown
- `.envoy-session.json` and `.envoy-scratchpad.json` are gitignored ephemeral files

### Context Fragments
- Phase-specific context in `contexts/` (review.md, implement.md, research.md)
- Loaded dynamically based on current phase instead of loading everything
- Keep fragments minimal (~15-20 lines)

## Development

### Testing Skills Locally
1. Edit the skill in `skills/<name>/SKILL.md`
2. Start a new Claude Code session in a test project with envoy installed
3. Invoke the skill and verify behavior matches intent
4. For discipline skills: run pressure scenarios with subagents

### Adding a New Stack Profile
1. Create `stacks/<stack-name>.md` with required sections
2. Add detection rule to `lib/stack-loader.js` STACK_RULES array
3. Add detection pattern to `hooks/session-start.sh`
4. Update `adapters/copilot/` if needed (instructions template)

### Adding a New Hook
1. Create `hooks/<hook-name>.js` with `run(rawInput)` export
2. Register in `hooks/hooks.json` with appropriate event type and matcher
3. Add profile annotation (`_profiles` array)
4. Add to `HOOK_PROFILES` in `hooks/hook-runner.js`

## Do Not

- Do not add project-specific code (this is a generic plugin)
- Do not add `.env` files or credentials
- Do not modify `lib/` without understanding downstream impact on all skills and hooks
- Do not modify linter/formatter configs during review-fix loops (config-protection hook enforces this)
