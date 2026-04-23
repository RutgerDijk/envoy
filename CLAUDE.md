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
- Rigid skills follow a contract-backed pattern (see `## Rigid Skills` below). Flexible skills (brainstorming, planning) use the simpler legacy frontmatter — `name`, `description`, and nothing else required.
- Rigid skills: `review`, `pickup`, `finalize`, `cleanup`, `fix-ci`, `coderabbit-pr-review`, `wiki-sync`, `verification`, `test-driven-development`, `systematic-debugging`, `receiving-code-review`. Follow exactly, no adaptation.
- Flexible skills: `brainstorm`, `using-envoy`, `search-first`, `dispatching-parallel-agents`, `pressure-test-scenarios`, `requesting-code-review`, etc. Adapt principles to context.
- Include "Announce at start" directive and "Integration with Envoy" section.

### Rigid skills (contract-backed)

Rigid skills are enforced by files, not prose. Each lives in its own folder:

```
skills/<name>/
├── SKILL.md              # body + frontmatter declaring hooks
├── preflight.js          # invoked inline via !`node ${CLAUDE_SKILL_DIR}/preflight.js`
├── contract.json         # declarative rules read by the skill's own hooks
├── hooks/
│   ├── agent-guard.js    # PreToolUse[Agent] — validates subagent prompts
│   └── stop-audit.js     # Stop — verifies required artifacts + loop signals
└── steps/ or layers/     # long-form content, one file per phase (SKILL.md under 500 lines)
```

**Frontmatter primitives (in order):**
- `name`, `description` (directive template: `<Skill> expert. ALWAYS invoke when… Do not…`)
- `when_to_use:` — list of concrete trigger phrases
- `allowed-tools:` — pins the skill's tool surface
- `paths:` — glob for path-scoped activation (`docs/wiki/**`, etc.)
- `model:` / `effort:` — optional per-skill tuning
- `context: fork` — forks the conversation for pure task-shaped skills (review, finalize). Skip for skills with user-approval pauses (pickup).
- `hooks:` — declares `PreToolUse[Agent]` → `hooks/agent-guard.js` and `Stop` → `hooks/stop-audit.js`, both with `once: true`.

**Inline preflight pattern:** each rigid SKILL.md body opens with
`## Briefing\n!`node ${CLAUDE_SKILL_DIR}/preflight.js``, immediately
followed by a visible checklist of steps/layers. Preflight prints
`## STATUS: ok|degraded|fatal` as its first content line. `fatal` stops
the skill. `ENVOY_HOOK_PROFILE=strict` promotes `degraded` → `fatal`.

**Deferred-pending-upstream:** `disable-model-invocation` is intentionally
NOT set on any skill; Claude Code plugin support is tracked in
anthropics/claude-code#22345.

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

### Schema-backed handoffs and runtime state

Rigid skills hand off to each other through validated JSON artifacts,
not through prose conventions. Two locations:

- `.envoy-tasks/<issue>.json` — **committed**. Brainstorm → pickup.
  Conforms to `lib/schemas/tasks.json`. Visible in PR diffs so the
  contract is reviewable.
- `.envoy/` — **gitignored** runtime state:
  - `.envoy/active-skill.json` (which skill currently owns the session)
  - `.envoy/pickup/session.json` (replaces the retired `.envoy-session.json`)
  - `.envoy/pickup/handoff-to-review.json`
  - `.envoy/review/handoff-to-finalize.json`
  - `.envoy/finalize/state.json` (replaces the retired `/tmp/envoy-active-pr.txt`)
  - `.envoy/search-decisions/<task-id>.json`
  - `.envoy/loops/<name>.json`

**Schemas** live in `lib/schemas/`, all with `"$schemaVersion": "1"`.
`lib/validate-schema.js` exposes `validate(name, data)` and
`validateFile(name, path)`; every preflight uses it to reject invalid
handoffs at fatal tier.

### Loop discipline (CLI)

`lib/loop-safeguards.js` is a Node CLI — no more prose protocol:

```
node lib/loop-safeguards.js confirm <name>
node lib/loop-safeguards.js status  <name>
node lib/loop-safeguards.js reset   <name> --reason "<why>"
node lib/loop-safeguards.js cleanup <name>
node lib/loop-safeguards.js history <name>
```

State lives in `.envoy/loops/<name>.json` as `{loop, confirmed,
maxCycles, cyclesSeen, history[]}`. Exit codes: 0 confirmed, 1 pending,
2 blocked on maxCycles. Stop-audit hooks call `status` to gate
completion. The module still exports `COMPLETION_SIGNAL`,
`REQUIRED_CONSECUTIVE`, and `PROTOCOL` for existing consumers.

### Evaluation-driven development

Rigid-skill behaviour is validated by a scenario harness:

- `tests/evals/<skill>/scenarios.json` — at least 3 scenarios per
  skill, listing `setup.files`, `env`, and `expected` (status / regex /
  artifacts_created / artifacts_missing)
- `tests/evals/run-evals.js` — sandboxed harness; run
  `node tests/evals/run-evals.js [--skill <name>]`

Per Anthropic best-practices, evaluation scenarios are written BEFORE
the contracts that satisfy them; scenarios drive preflight and hook
design. Scenarios PENDING when `preflight.js` is missing, and turn
into real pass/fail once the script exists.

### Context Efficiency (lean-ctx inspired)
- `lib/agent-scratchpad.js` — Multi-agent coordination via `.envoy-scratchpad.json`; agents register, post findings, check file ownership
- `lib/context-budget.js` — LITM-aware prompt structuring; classifies complexity (mechanical→architectural), orders sections for U-curve attention
- `lib/relevance-scorer.js` — Task-aware file scoring via import chain heat diffusion; recommends read depth (full/focused/skim/skip)
- `lib/output-compressor.js` — Shell output compression (patterns: dotnet, npm, jest, playwright, cargo, git, docker); safeguard ratio prevents over-compression
- `lib/cost-reporter.js` — Token usage analytics from Claude Code session JSONL logs; per-model/branch/session breakdown

Preflight scripts own the plumbing — rigid SKILL.md files do NOT tell
Claude to `require('../../lib/relevance-scorer.js')` any more. They
describe what Claude does; preflight supplies the inputs.

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
