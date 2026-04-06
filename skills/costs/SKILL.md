---
name: costs
description: Use when you want to see token usage breakdown by activity, model, and branch
---

# Token Usage Report

## Overview

Show where tokens go — which skills, phases, models, and branches consume the most. Reads Claude Code's native JSONL session files with phase inference for unlabeled turns. No dollar estimates — just token counts and percentages.

**Announce at start:** "I'm using envoy:costs to generate a token usage report."

## Process

### Step 1: Load Cost Reporter

```javascript
const { findProjectDir, getRecentUsage, formatReport, aggregateTeamReports, discoverAllProjects } = require('../../lib/cost-reporter');
const projectDir = findProjectDir(process.cwd());
```

If `projectDir` is null, report: "No Claude Code session data found for this project."

### Step 2: Generate Report

**Default (last 7 days):**
```javascript
const data = getRecentUsage(projectDir);
console.log(formatReport(data));
```

**With arguments:**

| Argument | Effect |
|----------|--------|
| `--days N` | Look back N days (default: 7) |
| `--branch <name>` | Filter to a specific branch |
| `--session` | Show current session only |
| `--all` | Aggregate across all projects |
| `--team` | Aggregate team reports from `docs/costs/reports/` |

```javascript
// Cross-project
const projects = discoverAllProjects();
// aggregate across all project dirs...

// Team view
const teamData = aggregateTeamReports('docs/costs/reports/', { days: 30 });
console.log(formatReport(teamData));
```

For `--session`, use the current session ID:
```javascript
const { getSessionUsage } = require('../../lib/cost-reporter');
const usage = getSessionUsage(projectDir, process.env.CLAUDE_SESSION_ID);
```

### Step 3: Display Report

Output is compact plain-text with bar charts. Sections include:
- **BY PROJECT** — only with `--all` flag
- **BY CONTRIBUTOR** — only with `--team` flag
- **BY ACTIVITY** — skills, agents, and inferred phases (implementation, debugging, review, etc.)
- **BY MODEL** — token distribution across opus/sonnet/haiku
- **BY BRANCH** — token usage per feature branch

All sorted by token count descending.

### Step 4: Insights (optional)

If the user asks for optimization suggestions, analyze the data:

- **Most tokens on a single skill** — check if that skill can be streamlined
- **High opus usage** — check if some tasks could use sonnet (mechanical/simple tasks)
- **Expensive branches** — flag branches with disproportionate token usage vs. code changes
- **Many short sessions** — session restarts incur cache write costs; longer sessions are cheaper

## Integration with Envoy

**Libraries used:**
- `lib/cost-reporter.js` — Reads Claude Code session JSONL, aggregates usage with phase inference

**Data source:** `~/.claude/projects/<project-id>/<session>.jsonl` (Claude Code native format)
**Team data:** `docs/costs/reports/*.json` (committed by session-end hook)
