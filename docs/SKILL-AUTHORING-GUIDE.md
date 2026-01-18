# Skill Authoring Guide

How to write effective Envoy skills that Claude will follow correctly.

---

## Core Principles

### 1. Claude Search Optimization (CSO)

**The skill description triggers discovery, NOT workflow execution.**

```yaml
# BAD: Summarizes workflow (Claude follows description, ignores skill body)
description: Write test first, watch it fail, write code, refactor, repeat

# GOOD: Triggers discovery only
description: Use when implementing any feature or bugfix, before writing implementation code
```

**Why this matters:** When descriptions summarize workflow, Claude reads the description and follows it literally instead of reading the full skill content.

**Description checklist:**
- [ ] Starts with "Use when..."
- [ ] Describes WHEN to use, not HOW it works
- [ ] Under 100 characters
- [ ] No workflow steps in description

---

## Skill Structure

### Standard Template

```markdown
---
name: skill-name
description: Use when [condition], before [action]
---

# Skill Title

## Overview

Brief explanation of purpose. 2-3 sentences max.

**Announce at start:** "I'm using envoy:skill-name to [purpose]."

## The Iron Law (for discipline skills)

**THE NON-NEGOTIABLE RULE IN ALL CAPS**

No exceptions. Absolute language.

### Rationalization Table

| Excuse | Reality |
|--------|---------|
| "Common excuse 1" | Why it's wrong |
| "Common excuse 2" | Why it's wrong |

## Process

Step-by-step instructions...

## Verification

How to verify the skill was followed correctly...
```

---

## Persuasion Principles

Research shows 7 principles double LLM compliance (33% → 72%). Use these for discipline-enforcing skills:

### Authority (Most Effective)

Use absolute, imperative language:

```markdown
# WEAK (ignored under pressure)
"Consider testing before deploying"
"You might want to verify first"

# STRONG (followed under pressure)
"NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST"
"STOP. Complete investigation first."
"Delete means delete."
```

### Commitment (Track Progress)

Force progress tracking with TodoWrite:

```markdown
Use TodoWrite to track:
- [ ] Test written
- [ ] Test fails (verified)
- [ ] Implementation written
- [ ] Test passes (verified)

Mark COMPLETE only when ALL boxes checked.
```

### Social Proof (Universal Pattern)

Show the pattern is universal:

```markdown
"Skipping tests = failure. Every time."
"All successful projects follow this pattern."
"This is how professional teams work."
```

### What to Avoid

- **Liking/Reciprocity** → Creates sycophancy
- **Too many principles** → Contradictory, confusing

**Best combination for discipline skills:** Authority + Commitment + Social Proof

---

## Iron Laws Pattern

For non-negotiable practices, use the Iron Law pattern:

```markdown
## The Iron Law

**RULE IN ALL CAPS WITH ABSOLUTE LANGUAGE**

Consequence stated clearly.

No exceptions:
- Exception people try
- Another exception
- **Delete means delete**

### Rationalization Table

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. |
| "I'll test after" | Tests passing immediately prove nothing. |
| "Time pressure" | Skipping costs MORE time. Always. |
| "Just this once" | No. The answer is always no. |

### Violations = Start Over

- Violation 1 → Delete and restart
- Violation 2 → Delete and restart
```

---

## Skill Types

### Discipline Skills (Rigid)

Follow EXACTLY. No adaptation. Examples:
- TDD in executing-plans
- systematic-debugging
- verification

Use: Iron Laws, Rationalization Tables, Authority language

### Process Skills (Flexible)

Adapt principles to context. Examples:
- brainstorming
- writing-plans

Use: Guidelines, examples, options

**The skill itself should declare which type it is:**

```markdown
**Skill Type:** Rigid — Follow exactly. Don't adapt away discipline.
```

---

## Gate Functions

For anti-patterns, provide decision gates:

```markdown
BEFORE [action]:
  Ask: "[question]"
  
  IF [condition]:
    STOP
    [alternative action]
  
  IF [other condition]:
    Proceed
```

Example:

```markdown
BEFORE writing any implementation code:
  Ask: "Do I have a failing test for this behavior?"
  
  IF no:
    STOP
    Write the test first
    Run it to confirm it fails
    THEN write implementation
```

---

## Progressive Disclosure

For complex skills, split into multiple files:

```
skill-name/
  SKILL.md           # Main entry (overview + process)
  _techniques.md     # Reference material
  _examples.md       # Code examples
  _anti-patterns.md  # What to avoid
```

Main SKILL.md references supporting files:

```markdown
See `_techniques.md` for detailed implementation patterns.
```

**Benefits:**
- Saves tokens (only loads what's needed)
- Keeps main skill focused
- Easier to maintain

---

## Testing Skills

Before deploying a skill, test it under pressure:

### Pressure Scenario Testing

Create scenarios that tempt violation:

```
Scenario: You spent 4 hours implementing. It's 6pm, dinner at 6:30.
Code review tomorrow 9am. You just realized: no tests.

What do you do?
```

**Expected answer:** Delete code, write tests tomorrow.
**If skill fails:** Add rationalization table entry for this excuse.

### Baseline Testing

1. Run task WITHOUT the skill
2. Document exact rationalizations used
3. Write skill addressing those specific rationalizations
4. Run task WITH the skill
5. Verify improvement

---

## Checklist for New Skills

- [ ] Description uses CSO pattern (trigger only, no workflow)
- [ ] Starts with "Use when..."
- [ ] Has "Announce at start" directive
- [ ] Discipline skills have Iron Law
- [ ] Discipline skills have Rationalization Table
- [ ] Uses Authority language for critical rules
- [ ] Has verification/completion criteria
- [ ] Tested under pressure scenarios
- [ ] Declares skill type (rigid/flexible)

---

## Examples

### Good Discipline Skill Opening

```markdown
---
name: verification
description: Use before committing fixes or completing tasks, to ensure evidence exists
---

# Verification Before Completion

## The Iron Law

**NO COMPLETION CLAIMS WITHOUT VERIFICATION EVIDENCE.**

Evidence before assertions. Always.

### Rationalization Table

| Excuse | Reality |
|--------|---------|
| "I'm confident this works" | Confidence is not evidence. Run the tests. |
| "It's a trivial change" | Trivial changes break things. Verify anyway. |
```

### Good Process Skill Opening

```markdown
---
name: brainstorming
description: Use when starting any new feature or when you have an idea that needs design
---

# Brainstorming Ideas Into Designs

## Overview

Turn ideas into fully formed designs through collaborative dialogue.

**Skill Type:** Flexible — Adapt to project context while following core process.

**Announce at start:** "I'm using envoy:brainstorming to design this feature."
```

---

## Resources

- Meincke et al. (2025) - Persuasion principles research
- `docs/ANTI-PATTERNS.md` - Gate functions for common violations
- `skills/writing-skills/` - Meta skill for skill creation
