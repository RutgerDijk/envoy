# Cost Reporter Redesign

> **For Claude:** Use envoy:executing-plans to implement this spec task-by-task.

## Overview

Redesign the cost reporter to focus on actionable token usage visibility rather than dollar estimates. Replace approximate pricing with token counts and percentages, add phase-inference for unlabeled turns, support cross-project and team-aggregated views, and switch to compact plain-text bar-chart output.

## Architecture

Three scoped changes:

1. **`lib/cost-reporter.js`** — Core rework: remove pricing, add phase inference, bar-chart formatter, cross-project discovery, team aggregation
2. **`commands/costs.md`** — Update command description and flags
3. **`hooks/cost-summary-export.js`** — New hook: export session summary JSON on session end

No new dependencies.

### Activity Classification (Two-Tier)

**Tier 1 — Explicit (checked first):**
- Turn has `Skill` tool call → `skill:<name>`
- Turn has `Agent` tool call → `agent:<type>`

**Tier 2 — Inferred from tool patterns in a sliding window (5 turns before, 5 after):**

| Condition (tool counts in window) | Label |
|---|---|
| Edit + Write > 5 and Bash > 3 | `implementation` |
| Bash > 5 and Grep > 2 and Edit < 3 | `debugging` |
| Read > 5 and Edit < 2 and Agent > 0 | `review` |
| AskUserQuestion > 3 | `interactive` |
| TaskCreate > 1 or Agent > 1 and Edit < 3 | `planning` |
| fallback | `other` |

Evaluated top-to-bottom, first match wins. Window smoothing prevents single tool calls from flipping the label.

### Token Counting

All token types (input, output, cache_write, cache_read) summed into one number per turn. No separate columns — simpler to reason about relative cost.

### Output Format

Compact plain-text with 20-char bar charts:

```
Token Usage — last 7 days (12 sessions)

 BY ACTIVITY
 skill:finishing-branch  ████████████████░░░░  38.2%  4.8M tokens
 implementation          ██████████░░░░░░░░░░  24.1%  3.0M tokens
 skill:review            ██████░░░░░░░░░░░░░░  14.7%  1.8M tokens
 debugging               ████░░░░░░░░░░░░░░░░   9.3%  1.2M tokens
 agent:Explore           ███░░░░░░░░░░░░░░░░░   6.1%  768K tokens
 skill:brainstorm        ██░░░░░░░░░░░░░░░░░░   4.2%  524K tokens
 planning                █░░░░░░░░░░░░░░░░░░░   2.0%  251K tokens
 other                   ░░░░░░░░░░░░░░░░░░░░   1.4%  175K tokens

 BY MODEL
 opus-4-6               █████████████████░░░  83.4%  10.5M tokens
 sonnet-4-6             ███░░░░░░░░░░░░░░░░░  14.2%   1.8M tokens
 haiku-4-5              ░░░░░░░░░░░░░░░░░░░░   2.4%   302K tokens

 BY BRANCH
 feature/14-self-learn  ████████████░░░░░░░░  58.1%   7.3M tokens
 feature/12-fix-ci      ██████░░░░░░░░░░░░░░  28.3%   3.6M tokens
 main                   ███░░░░░░░░░░░░░░░░░  13.6%   1.7M tokens
```

### Cross-Project (`--all`)

Scans all subdirectories under `~/.claude/projects/`. Project name derived from last two segments of the encoded directory name (e.g., `-Users-rutgerdijkstra-Projects-EnvoyProject-envoy` → `EnvoyProject/envoy`).

Adds a **BY PROJECT** section at the top. Other sections aggregate across all projects.

### Team Visibility (`--team`)

**Export (hook):** On session end, `hooks/cost-summary-export.js` writes a minimal JSON summary to `docs/costs/reports/<date>-<username>.json` containing:
- Activity breakdown (label → token count)
- Model breakdown (model → token count)
- Branch breakdown (branch → token count)
- Session metadata (date, turns, total tokens)

**Aggregation:** `/envoy:costs --team` reads all JSON files from `docs/costs/reports/`, merges them, and renders the same bar-chart format with an added **BY CONTRIBUTOR** section.

**Individual files are committed** to the repo for team transparency. They're small (< 1KB each), contain no prompts or content — just token breakdowns.

## Acceptance Criteria

- [ ] No dollar estimates anywhere in output
- [ ] Tier 1 (explicit skill/agent) detection works as today
- [ ] Tier 2 (phase inference) classifies turns using tool-pattern windows
- [ ] Token counts summed as single number (input + output + cache combined)
- [ ] Bar-chart plain-text output, sorted by token count descending
- [ ] `--all` flag discovers all projects and adds BY PROJECT section
- [ ] `--team` flag aggregates from committed JSON files in `docs/costs/reports/`
- [ ] `--days N` and `--branch` filters still work
- [ ] Session-end hook exports summary JSON to `docs/costs/reports/`
- [ ] Existing `formatTokens()` reused for human-readable numbers

---

## Implementation Plan

**Execution Strategy:** `sequential`

Tasks are tightly coupled — the formatter depends on the new data shape, the hook depends on the new export format, and the command depends on all of them.

### Task 1: Strip Dollar Pricing and Rework Token Aggregation

**Files:**
- Modify: `lib/cost-reporter.js`
- Create: `tests/lib/cost-reporter.test.js`

**Step 1: Write failing test**

```javascript
const { extractSessionUsage } = require('../../lib/cost-reporter');
// Test that usage returns combined token count, no costUSD
test('extractSessionUsage returns totalTokens, no costUSD', () => {
  const usage = extractSessionUsage('/tmp/test-session.jsonl');
  expect(usage).toHaveProperty('totalTokens');
  expect(usage).not.toHaveProperty('estimatedCostUSD');
});
```

**Step 2: Run test (expect FAIL)**

**Step 3: Implement**

- Remove `PRICING` constant, `calculateCost()`, `findPricing()`
- Remove all `costUSD` and `estimatedCostUSD` fields from aggregation
- Add `totalTokens` field: `input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens`
- Update `getRecentUsage()` to aggregate `totalTokens` instead of `costUSD`
- Sort all breakdowns by `totalTokens` descending (was `costUSD`)

**Step 4: Run test (expect PASS)**

**Step 5: Commit**

```bash
git add lib/cost-reporter.js tests/lib/cost-reporter.test.js
git commit -m "refactor(costs): strip dollar pricing, use combined token counts"
```

### Task 2: Add Phase Inference to Activity Detection

**Files:**
- Modify: `lib/cost-reporter.js`
- Modify: `tests/lib/cost-reporter.test.js`

**Step 1: Write failing test**

```javascript
test('classifyPhase detects implementation from tool window', () => {
  const window = [
    { tools: ['Edit', 'Edit', 'Bash', 'Write', 'Edit', 'Bash', 'Edit', 'Bash', 'Edit'] },
  ];
  expect(classifyPhase(window)).toBe('implementation');
});

test('classifyPhase detects debugging from grep-heavy window', () => {
  const window = [
    { tools: ['Bash', 'Bash', 'Grep', 'Read', 'Bash', 'Grep', 'Bash', 'Grep'] },
  ];
  expect(classifyPhase(window)).toBe('debugging');
});
```

**Step 2: Run test (expect FAIL)**

**Step 3: Implement**

- Add `classifyPhase(toolWindow)` function with the decision tree:
  - Edit + Write > 5 and Bash > 3 → `implementation`
  - Bash > 5 and Grep > 2 and Edit < 3 → `debugging`
  - Read > 5 and Edit < 2 and Agent > 0 → `review`
  - AskUserQuestion > 3 → `interactive`
  - TaskCreate > 1 or (Agent > 1 and Edit < 3) → `planning`
  - fallback → `other`
- Modify `extractSessionUsage()` to:
  1. First pass: collect all turns with their tool names
  2. Second pass: for each turn, build a window (5 before, 5 after), apply Tier 1 then Tier 2 classification
- Export `classifyPhase` for testing

**Step 4: Run test (expect PASS)**

**Step 5: Commit**

```bash
git add lib/cost-reporter.js tests/lib/cost-reporter.test.js
git commit -m "feat(costs): add phase inference for unlabeled turns"
```

### Task 3: Replace Report Formatter with Bar-Chart Output

**Files:**
- Modify: `lib/cost-reporter.js`
- Modify: `tests/lib/cost-reporter.test.js`

**Step 1: Write failing test**

```javascript
test('formatReport produces bar-chart output with no dollar signs', () => {
  const report = formatReport(mockData);
  expect(report).toContain('BY ACTIVITY');
  expect(report).toContain('████');
  expect(report).toContain('%');
  expect(report).not.toContain('$');
});
```

**Step 2: Run test (expect FAIL)**

**Step 3: Implement**

- Replace `formatReport()` entirely
- Add `renderBar(fraction, width=20)` helper using `█` (filled) and `░` (empty)
- Add `renderSection(title, entries)` that produces aligned rows:
  - Left-pad labels to longest label width
  - Bar + percentage + formatted token count
- Sections: BY ACTIVITY, BY MODEL, BY BRANCH
- Header line: `Token Usage — last {N} days ({M} sessions)`

**Step 4: Run test (expect PASS)**

**Step 5: Commit**

```bash
git add lib/cost-reporter.js tests/lib/cost-reporter.test.js
git commit -m "feat(costs): bar-chart plain-text output format"
```

### Task 4: Add Cross-Project Discovery (`--all`)

**Files:**
- Modify: `lib/cost-reporter.js`
- Modify: `tests/lib/cost-reporter.test.js`

**Step 1: Write failing test**

```javascript
test('decodeProjectName extracts last two path segments', () => {
  expect(decodeProjectName('-Users-rutger-Projects-EnvoyProject-envoy'))
    .toBe('EnvoyProject/envoy');
});

test('discoverAllProjects returns array of project dirs', () => {
  const projects = discoverAllProjects();
  expect(Array.isArray(projects)).toBe(true);
});
```

**Step 2: Run test (expect FAIL)**

**Step 3: Implement**

- Add `decodeProjectName(encodedDir)` — splits on `-`, takes last two meaningful segments
- Add `discoverAllProjects()` — scans `~/.claude/projects/`, returns array of `{ name, projectDir }`
- Modify `getRecentUsage()` to accept `options.all` flag
  - When true: iterate all project dirs, aggregate with a `byProject` breakdown
- Add BY PROJECT section to `formatReport()` when `byProject` data exists

**Step 4: Run test (expect PASS)**

**Step 5: Commit**

```bash
git add lib/cost-reporter.js tests/lib/cost-reporter.test.js
git commit -m "feat(costs): cross-project discovery with --all flag"
```

### Task 5: Add Team Export Hook

**Files:**
- Create: `hooks/cost-summary-export.js`
- Modify: `hooks/hooks.json`
- Create: `tests/hooks/cost-summary-export.test.js`

**Step 1: Write failing test**

```javascript
test('buildSummaryJson produces valid team-export JSON', () => {
  const summary = buildSummaryJson(mockSessionUsage, 'rutger', 'main');
  expect(summary).toHaveProperty('date');
  expect(summary).toHaveProperty('user', 'rutger');
  expect(summary).toHaveProperty('activities');
  expect(summary).toHaveProperty('models');
  expect(summary).toHaveProperty('totalTokens');
  expect(summary).not.toHaveProperty('costUSD');
});
```

**Step 2: Run test (expect FAIL)**

**Step 3: Implement**

- `hooks/cost-summary-export.js`:
  - Export `run(rawInput)` function (standard hook interface)
  - On session end: extract usage for current session
  - Build minimal JSON: `{ date, user, branch, totalTokens, turns, activities: {label: tokens}, models: {model: tokens}, branches: {branch: tokens} }`
  - Write to `docs/costs/reports/<YYYY-MM-DD>-<username>.json`
  - Get username from `os.userInfo().username`
- Register in `hooks/hooks.json` with event `session_end`, profile `standard`

**Step 4: Run test (expect PASS)**

**Step 5: Commit**

```bash
git add hooks/cost-summary-export.js hooks/hooks.json tests/hooks/cost-summary-export.test.js
git commit -m "feat(costs): session-end hook exports team summary JSON"
```

### Task 6: Add Team Aggregation (`--team`)

**Files:**
- Modify: `lib/cost-reporter.js`
- Modify: `tests/lib/cost-reporter.test.js`

**Step 1: Write failing test**

```javascript
test('aggregateTeamReports merges multiple JSON files', () => {
  const result = aggregateTeamReports('/tmp/test-costs/reports');
  expect(result.byContributor).toBeDefined();
  expect(Object.keys(result.byContributor).length).toBeGreaterThan(0);
});
```

**Step 2: Run test (expect FAIL)**

**Step 3: Implement**

- Add `aggregateTeamReports(reportsDir, options)`:
  - Scan `docs/costs/reports/*.json`
  - Filter by `--days` and `--branch` if provided
  - Merge into same structure as `getRecentUsage` output, with added `byContributor` breakdown
- Add BY CONTRIBUTOR section to `formatReport()` when `byContributor` data exists
- Wire `--team` flag through command

**Step 4: Run test (expect PASS)**

**Step 5: Commit**

```bash
git add lib/cost-reporter.js tests/lib/cost-reporter.test.js
git commit -m "feat(costs): team aggregation from committed JSON reports"
```

### Task 7: Update Command Definition

**Files:**
- Modify: `commands/costs.md`

**Steps:**
1. Update description to reflect token-focused purpose
2. Add `--all` and `--team` flags to usage
3. Remove any references to dollar estimates
4. Commit:

```bash
git add commands/costs.md
git commit -m "docs(costs): update command for token-focused redesign"
```

---

*Generated by Envoy*
