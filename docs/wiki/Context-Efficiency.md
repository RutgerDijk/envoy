# Context Efficiency

Libraries inspired by [lean-ctx](https://github.com/yvgude/lean-ctx) that reduce token waste, improve agent coordination, and preserve state across sessions.

## Overview

| Library | Purpose | Used By |
|---------|---------|---------|
| `lib/session-state.js` | Cross-session task continuity | `hooks/session-start.sh` (surfaces state); pickup `steps/tdd.md`, `steps/verify.md` |
| `lib/agent-scratchpad.js` | Multi-agent coordination | `skills/pickup/preflight.js` (`### Scratchpad`, `--init-scratchpad`, `--scratchpad-briefing/-post/-done`; parallel strategy only) |
| `lib/context-budget.js` | LITM-aware prompt structuring | `skills/pickup/preflight.js` (`### Complexity`); `lib/context-budget.js build` CLI run from pickup `steps/prompts.md` / `steps/tdd.md` |
| `lib/relevance-scorer.js` | Task-aware file scoring | `skills/review/preflight.js` (`### File relevance`) |
| `lib/learning-loader.js` | Known patterns and corrections | `skills/pickup/preflight.js`, `skills/review/preflight.js` (`### Known patterns`) |
| `lib/output-compressor.js` | Shell output compression | `hooks/output-compress.js` (PostToolUse Bash) |
| `lib/compliance.js` | Envoy trail in the PR body | `skills/finalize/SKILL.md` Step 2, `skills/hotfix/SKILL.md` Step 5 |
| `lib/cost-reporter.js` | Token usage analytics | costs skill, `hooks/cost-summary-export.js` |

## Session State

**File:** `.envoy-session.json` (gitignored, per-worktree)

Persists between context compactions and session restarts:
- Current branch and plan path
- Task progress (pending/in_progress/done/blocked)
- Key decisions made during implementation
- Files modified and why
- Last test results
- Next steps

**Lifecycle:**
1. `pickup` creates/updates state during execution
2. `session-start.sh` detects and surfaces state on session startup (~300-500 tokens)
3. `cleanup` removes the file along with the worktree's other runtime state

```javascript
const session = require('../../lib/session-state');
const state = session.load();           // Resume or create
session.updateTask(state, 'task-1', 'done', 'Added User entity');
session.addDecision(state, 'Used Guid PK — matches existing entities');
session.save(state);
```

## Agent Scratchpad

**File:** `.envoy-scratchpad.json` (gitignored, atomic writes)

Enables parallel agents to coordinate without duplicating work or causing conflicts.

**Features:**
- Agent registration with role and file scope
- Categorized messages: discovery, conflict, dependency, question, decision
- File ownership tracking (prevents two agents editing the same file)
- Read-tracking (agents see only unread messages)
- Briefing formatter for agent prompts

```javascript
const scratchpad = require('../../lib/agent-scratchpad');
const pad = scratchpad.load();
scratchpad.registerAgent(pad, 'agent-backend', 'Fix UserService', ['backend/']);
scratchpad.post(pad, 'agent-backend', 'discovery', 'UserService needs new constructor param', ['src/Services/UserService.cs']);
scratchpad.save(pad);

// Check before integrating
const conflicts = scratchpad.getConflicts(pad);
```

**Wiring:** `skills/pickup/preflight.js` prints a `### Scratchpad` section listing tasks whose file scopes overlap, and exposes `--init-scratchpad [--exclude ids]`, `--scratchpad-briefing <id>`, `--scratchpad-post <id> <category> <msg> [files]` and `--scratchpad-done <id>`. Pickup uses them only when Step 12 chooses the parallel strategy.

## LITM-Aware Prompts

Based on "Lost in the Middle" (Liu et al., 2023). LLMs attend most to the beginning and end of context, with a U-shaped dip in the middle.

**Claude attention profile:** begin=0.92, middle=0.50, end=0.88

`buildAgentPrompt()` orders sections by priority into a monotonic U — the highest-priority sections at the two ends, the lowest in the middle:

| Position | Attention | Content |
|----------|-----------|---------|
| Beginning | 0.92 | Objective, acceptance criteria, shared state (scratchpad) |
| Middle | 0.50 | Reference material (stack profiles), context |
| End | 0.88 | Known patterns, constraints (last) |

With all seven sections present the order is Objective, Acceptance, Shared State, Reference, Context, Known Patterns, Constraints. `fitToBudget` excludes the fixed Constraints (Iron Laws) from the line count; when a prompt is over budget it drops Reference first, then Context, and never trims the other sections. The `build` CLI appends a `prompt-budget-trimmed` event to `.envoy/ledger.jsonl` when it trims.

**Wiring:** `skills/pickup/preflight.js` prints a `### Complexity` table with each task's tier (the model tier is advisory). Pickup then builds each implementer prompt with `node lib/context-budget.js build <params.json> --tier <tier>` (see pickup `steps/prompts.md`).

**Task complexity classification** determines prompt budget and model tier:

| Tier | Description | Model | Max Lines |
|------|-------------|-------|-----------|
| Mechanical | Rename, move, format | Haiku | 30 |
| Simple | Single-file, clear spec | Sonnet | 60 |
| Standard | Multi-file feature | Sonnet | 120 |
| Complex | Cross-cutting concern | Opus | 250 |
| Architectural | System design | Opus | Unlimited |

```javascript
const { classifyComplexity, buildAgentPrompt } = require('../../lib/context-budget');
const tier = classifyComplexity({ filesChanged: 3, servicesAffected: 1 });
const prompt = buildAgentPrompt({
  objective: 'Implement user authentication',
  constraints: 'Follow TDD. Do NOT modify shared config.',
  context: 'Branch: feature/auth, Plan: docs/plans/auth.md',
  reference: stackProfiles,
  acceptance: 'All tests pass. Return summary and git log.',
  learnings: reminders,
});
```

## Known Patterns

`lib/learning-loader.js` loads confirmed review/CodeRabbit patterns and team corrections. `skills/pickup/preflight.js` and `skills/review/preflight.js` each print a `### Known patterns` section, which fills `${KNOWN_PATTERNS}` in pickup's `steps/prompts.md` and the review AI-review layer.

## Relevance Scoring

Walks import chains forward from changed files and scores related files via heat diffusion.

**Algorithm:**
1. Parse imports from changed files (supports TS, JS, C#, Python)
2. Resolve to absolute paths and build the dependency graph by walking imports forward (seed → what it imports), max 3 hops, capped at 200 files (`maxFiles`; the cap is reported when hit)
3. Run heat diffusion (4 iterations, alpha=0.5) from seed files; both `imports` and `importedBy` edges are kept
4. Heat decays per hop rather than accumulating — along an import chain, seed files read `full`, one hop away `focused`, two hops `skim`, three hops `skip`

**Limits:** the walk is forward-only — files that import the changed files are not discovered. Requires built at runtime (e.g. `require(path.join(...))`) are not followed.

**Read depth recommendations:**

| Score | Depth | Description |
|-------|-------|-------------|
| Seed file | `full` | Read entire file |
| >= 0.5 | `focused` | Read signatures + changed sections |
| 0.2 - 0.5 | `skim` | Scan exports only |
| < 0.2 | `skip` | Not relevant |

```javascript
const { scoreTaskRelevance, formatForPrompt } = require('../../lib/relevance-scorer');
const results = scoreTaskRelevance(changedFiles, projectRoot);
const briefing = formatForPrompt(results);
// Include `briefing` in reviewer/agent prompts
```

**Wiring:** `skills/review/preflight.js` prints a `### File relevance` section for the files changed in `baseSha..headSha` plus the files they import, which fills `${relevanceBriefing}` in the AI-review layer. Pickup does not use the scorer.

## Output Compression

Pattern-based compression for verbose CLI output. `lib/output-compressor.js` has 11 patterns:

| Pattern | Compresses | Applied by the hook |
|---------|-----------|---------------------|
| `dotnet-build` | Build output → success line + errors/warnings | yes (`dotnet build`) |
| `dotnet-test` | Test output → failures + summary counts | yes (`dotnet test`) |
| `npm-install` | Install output → "added N packages" + audit | no |
| `npm-build` | Build output → compiled line + errors | no |
| `jest-vitest` | Test output → FAIL blocks + summary | yes (direct `jest`/`vitest`, `npx jest`/`npx vitest`) |
| `git-status` | Status → strip verbose headers | no |
| `git-diff-stat` | Pass-through (already compact) | no |
| `git-log` | Log → compact commit + message lines | no |
| `docker-compose` | Strip pull progress bars and layer output | no |
| `playwright` | Test output → failures + summary | no |
| `cargo` | Build/test → errors + summary | yes (`cargo build`/`check`/`clippy`; not `cargo test`) |

**Safeguard ratio:** If compression removes more than 95% of the content, the original is returned to prevent information loss.

```javascript
const { compress } = require('../../lib/output-compressor');
const result = compress(rawOutput, 'dotnet test');
// result.compressed — noise stripped
// result.savings — { original, compressed, ratio, pattern }
```

### `output-compress` hook

`hooks/output-compress.js` runs on every Bash call (PostToolUse, `standard` and `strict` profiles) and replaces the tool output with the compressed version via `updatedToolOutput`. It is conservative by design:

- **Allowlist:** only a simple (non-compound) command whose leading tool is `dotnet build`/`test`, direct `jest`/`vitest`, or `cargo build`/`check`/`clippy` is compressed. `git`, `docker`, `npm install`/`build`/`test`, `playwright` and `cargo test` are deliberately left alone because their patterns could hide failures. Commands with `&&`, `||`, `;`, `|`, `&`, `$(`, backticks or newlines are never compressed (a single trailing `2>&1` is allowed).
- **Loss guard:** if any line carrying a failure signal (`: error `, `error CODE:`, `error :`, `aborted`, `host process crashed`) would be dropped, the original output is passed through.
- **Fail-open:** any error or unexpected input leaves the output unchanged. `stderr` is never touched.
- **Cost:** one extra node process per Bash call (about 35 ms).

Disable it with `ENVOY_DISABLED_HOOKS=output-compress`.

## Compliance Trail

`lib/compliance.js` reads the worktree's `.envoy/ledger.jsonl` and `.envoy/observe-log.jsonl` and reports which rigid steps (pickup → review → finalize → cleanup) ran or were skipped, the handoffs, and gate overrides.

`skills/finalize/SKILL.md` Step 2 and `skills/hotfix/SKILL.md` Step 5 append an `## Envoy trail` section to the PR body:

```bash
node "${CLAUDE_SKILL_DIR}/../../lib/compliance.js" --pr-body "$(git rev-parse --show-toplevel)"
```

Before merge, `cleanup` shows as pending rather than skipped. Under a hotfix, the brainstorm, pickup, review and finalize skips are shown as sanctioned rather than flagged. `--pr-body` always exits 0, so a trail failure never blocks PR creation.

## Cost Reporter

Reads Claude Code's native session JSONL files to extract real token usage with per-activity breakdown.

**Data source:** `~/.claude/projects/<project-id>/<session>.jsonl`

**What it tracks:**
- Token breakdown (input, output, cache write, cache read)
- Cost by activity (which skill/agent consumed tokens)
- Cost by model (opus vs sonnet vs haiku)
- Cost by branch
- Per-session detail

**Usage:**
```
/envoy:costs              — Last 7 days
/envoy:costs --days 30    — Last 30 days
/envoy:costs --branch X   — Filter by branch
/envoy:costs --session    — Current session only
```

**Pricing:** Based on published Anthropic API rates. Cache read tokens ($1.50/MTok for Opus) typically dominate total cost in long sessions.
