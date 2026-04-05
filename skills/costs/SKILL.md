---
name: costs
description: Use when you want to see token usage and estimated costs for this project
---

# Token Usage & Cost Report

## Overview

Show token usage and estimated costs from Claude Code session logs for this project. Reads Claude Code's native JSONL session files — no separate tracking needed.

**Announce at start:** "I'm using envoy:costs to generate a token usage report."

## Process

### Step 1: Load Cost Reporter

```javascript
const { findProjectDir, getRecentUsage, formatReport } = require('../../lib/cost-reporter');
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

```javascript
// Examples
const data = getRecentUsage(projectDir, { days: 30 });
const data = getRecentUsage(projectDir, { branch: 'feature/auth' });
```

For `--session`, use the current session ID:
```javascript
const { getSessionUsage } = require('../../lib/cost-reporter');
const usage = getSessionUsage(projectDir, process.env.CLAUDE_SESSION_ID);
```

### Step 3: Display Report

The formatted report includes:
- **Token breakdown** — input, output, cache write, cache read
- **By model** — which models consumed what (opus vs sonnet vs haiku)
- **By branch** — cost per feature branch
- **Recent sessions** — last 10 sessions with date, summary, cost

### Step 4: Insights (optional)

If the user asks for optimization suggestions, analyze the data:

- **High cache write / low cache read ratio** — sessions not benefiting from caching, consider longer sessions
- **Most cost on opus** — check if some tasks could use sonnet (mechanical/simple tasks)
- **Expensive branches** — flag branches with disproportionate cost vs. code changes
- **Many short sessions** — session restarts incur cache write costs; longer sessions are cheaper

## Integration with Envoy

**Libraries used:**
- `lib/cost-reporter.js` — Reads Claude Code session JSONL, aggregates usage, estimates costs

**Data source:** `~/.claude/projects/<project-id>/<session>.jsonl` (Claude Code native format)
