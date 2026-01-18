---
name: writing-skills
description: Use when creating new skills for Envoy, editing existing skills, or verifying skills work before deployment
---

# Writing Skills for Envoy

## Overview

Skills are reference guides for proven techniques, patterns, or workflows. This skill teaches you how to create new skills for the Envoy plugin.

**Core principle:** Skills should be tested before deployment, just like code.

**Announce at start:** "I'm using envoy:writing-skills to create/edit this skill."

## Directory Structure

```
envoy/
  skills/
    skill-name/
      SKILL.md              # Main reference (required)
      supporting-file.*     # Only if needed (templates, scripts)
  commands/
    skill-name.md          # Optional: slash command shortcut
```

## SKILL.md Structure

```markdown
---
name: skill-name-with-hyphens
description: Use when [specific triggering conditions]
---

# Skill Name

## Overview
What is this? Core principle in 1-2 sentences.

**Announce at start:** "I'm using envoy:skill-name to [purpose]."

## When to Use
- Bullet list with SYMPTOMS and use cases
- When NOT to use

## Process / Pattern
The actual technique or workflow

## Quick Reference
Table or bullets for scanning

## Common Mistakes
What goes wrong + fixes

## Integration with Envoy
How this skill relates to other envoy skills
```

## Frontmatter Rules

- **name:** Use only letters, numbers, hyphens (no spaces, no special chars)
- **description:** Start with "Use when..." - describe triggering conditions only
- Max 1024 characters total

```yaml
# ❌ BAD: Describes workflow
description: Use for debugging - trace root cause, form hypothesis, test fix

# ✅ GOOD: Just triggering conditions
description: Use when encountering any bug, test failure, or unexpected behavior
```

## Adding a Slash Command

Create `commands/skill-name.md`:

```markdown
---
description: Short description for /envoy:skill-name
---

Use and follow the skill-name skill exactly as written
```

## Testing Skills

Before deploying a new skill:

1. **Run a scenario WITHOUT the skill** - document baseline behavior
2. **Run the same scenario WITH the skill** - verify it helps
3. **Find loopholes** - update skill to close them

## Skill Types

| Type | Examples | Test Approach |
|------|----------|---------------|
| **Discipline** | TDD, debugging | Pressure scenarios - does agent comply under stress? |
| **Technique** | Visual review, worktrees | Application scenarios - can agent apply it? |
| **Reference** | Stack profiles | Retrieval scenarios - can agent find right info? |

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Too long | Keep under 500 words, link to supporting files |
| No "When to Use" | Add clear triggering conditions |
| Missing "Announce at start" | Add standard announcement |
| No integration section | Show how it connects to other skills |
| Narrative instead of reference | Write scannable patterns, not stories |

## Checklist

- [ ] Name uses only letters, numbers, hyphens
- [ ] Description starts with "Use when..."
- [ ] Has "Announce at start" directive
- [ ] Has "When to Use" section
- [ ] Has "Integration with Envoy" section
- [ ] Tested with sample scenario
- [ ] Under 500 words (or has supporting files)
- [ ] Command file created if user-invocable
