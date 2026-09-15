# Context Efficiency

Libraries inspired by [lean-ctx](https://github.com/yvgude/lean-ctx) that reduce token waste, improve agent coordination, and preserve state across sessions.

## Overview

| Library | Purpose | Used By |
|---------|---------|---------|
| `lib/session-state.js` | Cross-session task continuity | pickup, finalize |
| `lib/agent-scratchpad.js` | Multi-agent coordination | envoy-authoring (dispatching-parallel-agents step), finalize |
| `lib/context-budget.js` | LITM-aware prompt structuring | envoy-authoring (dispatching-parallel-agents step), pickup |
| `lib/relevance-scorer.js` | Task-aware file scoring | pickup, review |
| `lib/output-compressor.js` | Shell output compression | review |
| `lib/cost-reporter.js` | Token usage analytics | costs skill |

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
3. `finalize` clears state when the branch ships

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

## LITM-Aware Prompts

Based on "Lost in the Middle" (Liu et al., 2023). LLMs attend most to the beginning and end of context, with a U-shaped dip in the middle.

**Claude attention profile:** begin=0.92, middle=0.50, end=0.88

`buildAgentPrompt()` orders sections for this curve:

| Position | Attention | Content |
|----------|-----------|---------|
| Beginning | 0.92 | Objective, constraints |
| Middle | 0.50 | Reference material, stack profiles, scratchpad |
| End | 0.88 | Acceptance criteria, known patterns |

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

## Relevance Scoring

Walks import/dependency chains from changed files and scores related files via heat diffusion.

**Algorithm:**
1. Parse imports from changed files (supports TS, JS, C#, Python)
2. Resolve to absolute paths, build dependency graph (max 3 hops)
3. Run heat diffusion (4 iterations, alpha=0.5) from seed files
4. Score accumulates through import edges

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

Used by `review` (pre-scored guidance for iterative retrieval) and `pickup` (agent context).

## Output Compression

Pattern-based compression for verbose CLI output. 11 patterns:

| Pattern | Compresses |
|---------|-----------|
| `dotnet-build` | Build output → success line + errors/warnings |
| `dotnet-test` | Test output → failures + summary counts |
| `npm-install` | Install output → "added N packages" + audit |
| `npm-build` | Build output → compiled line + errors |
| `jest-vitest` | Test output → FAIL blocks + summary |
| `git-status` | Status → strip verbose headers |
| `git-log` | Log → compact commit + message lines |
| `docker-compose` | Strip pull progress bars and layer output |
| `playwright` | Test output → failures + summary |
| `cargo` | Build/test → errors + summary |

**Safeguard ratio:** If compression removes >85% of content, returns the original to prevent information loss.

```javascript
const { compress } = require('../../lib/output-compressor');
const result = compress(rawOutput, 'dotnet test');
// result.compressed — noise stripped
// result.savings — { ratio: 85, pattern: 'dotnet-test' }
```

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
