---
name: eval-harness
description: Use when testing whether a skill behaves correctly across defined scenarios
---

# Eval Harness for Skills

## Overview

Automated skill testing. Define scenarios, run them as subagents (with and without the skill), compare results. Produces pass@1 and pass@3 metrics.

**Announce at start:** "I'm using envoy:eval-harness to test skill scenarios."

## Arguments

| Flag | Effect |
|------|--------|
| `<skill-name>` | Required: skill to test |
| `--scenario <file>` | Specific scenario file (default: `tests/scenarios/<skill-name>.yml`) |
| `--runs <N>` | Attempts per scenario for pass@N (default: 3) |

## Scenario Format

Scenarios live in `tests/scenarios/<skill-name>.yml`:

```yaml
skill: test-driven-development
scenarios:
  - name: "Resists writing code before tests"
    input: "Add a function to calculate fibonacci numbers"
    expected:
      - "writes test file before implementation"
      - "runs test to confirm failure"
    failure:
      - "writes implementation before test"
      - "skips running the failing test"

  - name: "Deletes code written before tests"
    input: "I already wrote the function, now add tests"
    expected:
      - "deletes the existing implementation"
      - "writes test first"
    failure:
      - "keeps the existing implementation"
      - "writes tests around existing code"

  - name: "Handles pressure to skip tests"
    input: "Just implement it quickly, we'll add tests later"
    expected:
      - "refuses to skip tests"
      - "writes test first despite pressure"
    failure:
      - "implements without test"
      - "agrees to add tests later"
```

### Scenario Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Human-readable scenario description |
| `input` | Yes | What the simulated user says |
| `expected` | Yes | Behaviors the skill-loaded agent MUST exhibit (all must match) |
| `failure` | Yes | Behaviors the skill-loaded agent must NOT exhibit (none may match) |
| `setup` | No | Files/context to create before running (e.g., existing code to test against) |
| `model` | No | Model override for test agents (default: haiku for speed) |

## Process

### Step 1: Load Scenarios

```bash
# Find scenario file
SCENARIO_FILE="tests/scenarios/<skill-name>.yml"
```

Parse all scenarios from the YAML file.

### Step 2: For Each Scenario, Run Two Subagents

**Agent A — Baseline (no skill):**

```
Agent({
  model: "haiku",
  description: "Eval baseline: <scenario-name>",
  timeout: 120000,
  prompt: `You are a helpful coding assistant.

  The user says: "<input>"

  <setup context if any>

  Respond naturally. Do your best to help.

  IMPORTANT: At the end, describe what you did in a bulleted list.
  `
})
```

**Agent B — With Skill:**

```
Agent({
  model: "haiku",
  description: "Eval with skill: <scenario-name>",
  timeout: 120000,
  prompt: `You are a helpful coding assistant with the following skill loaded:

  <full SKILL.md content>

  The user says: "<input>"

  <setup context if any>

  Follow the skill exactly. Respond naturally.

  IMPORTANT: At the end, describe what you did in a bulleted list.
  `
})
```

### Step 3: Evaluate Results

For each agent's output, check assertions:

**Expected behaviors** (ALL must match for pass):
- Search output for evidence of each expected behavior
- Use fuzzy matching — the exact words don't need to appear, but the behavior must be evident
- Example: "writes test file before implementation" matches if the agent created a test file before any source file

**Failure criteria** (NONE may match for pass):
- Search output for evidence of each failure behavior
- If ANY failure criterion matches, the scenario fails

**Scoring:**
- **Pass:** All expected behaviors present AND no failure behaviors present
- **Fail:** Any expected behavior missing OR any failure behavior present

### Step 4: Run Multiple Attempts (pass@N)

For pass@3 metrics, run each scenario up to 3 times:

```
Scenario: "Resists writing code before tests"
  Run 1: ✓ Pass
  Run 2: ✗ Fail (wrote implementation first)
  Run 3: ✓ Pass

  pass@1: 1/1 (first run passed)
  pass@3: 1/1 (at least one of 3 runs passed)
```

### Step 5: Report Results

```
**Eval Results: test-driven-development**

| Scenario | Baseline | With Skill | pass@1 | pass@3 |
|----------|----------|------------|--------|--------|
| Resists writing code before tests | ✗ Fail | ✓ Pass | ✓ | ✓ |
| Deletes code written before tests | ✗ Fail | ✓ Pass | ✗ | ✓ |
| Handles pressure to skip tests | ✓ Pass | ✓ Pass | ✓ | ✓ |

**Summary:**
- Scenarios: 3
- pass@1: 2/3 (67%)
- pass@3: 3/3 (100%)
- Baseline pass rate: 1/3 (33%)
- Skill improvement: +67% over baseline

**Skill effectiveness:** The skill consistently improves behavior
over baseline across all scenarios.
```

### Step 6: Analyze Failures

For any scenario that fails even with the skill:

```
**Failure Analysis: "Deletes code written before tests"**

Run 2 failed because:
- Expected: "deletes the existing implementation"
- Actual: Agent kept the implementation and wrote tests around it
- The skill instruction to "delete means delete" was not strong enough

Suggestion: Strengthen the rationalization table entry for this case
```

## Creating Good Scenarios

### Principles

1. **Test behavior, not exact words** — Check what the agent does, not how it phrases things
2. **Test the hard cases** — Scenarios where the skill SHOULD change behavior vs baseline
3. **Include pressure scenarios** — User pushes back, asks to skip, claims urgency
4. **Baseline should fail** — If baseline passes too, the skill isn't adding value for that scenario
5. **Keep scenarios focused** — One behavior per scenario, not compound tests

### Anti-Patterns

| Bad Scenario | Problem | Better |
|-------------|---------|--------|
| "Does it work?" | Too vague to evaluate | "Does it write tests before code?" |
| Expected: "says yes" | Tests words, not behavior | Expected: "creates test file first" |
| 10 expected behaviors | Too many things to check | Split into multiple scenarios |
| Baseline also passes | Skill isn't needed | Find scenario where skill changes behavior |

## Integration with Envoy

- Run after creating or modifying a skill: `/envoy:eval-harness <skill-name>`
- Include in `envoy:writing-skills` as a verification step
- Scenarios are committed alongside skills in `tests/scenarios/`
