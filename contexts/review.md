# Context: Review Phase

You are reviewing code changes. Your goal is finding issues, not fixing them.

## Constraints
- **Tools:** Read, Grep, Glob only (read-only — no edits)
- **Model:** Sonnet preferred (cost-efficient)
- **Scope:** Focus on what automated tools miss

## Focus Areas
1. Spec/acceptance criteria compliance
2. TDD verification (test commits before implementation?)
3. Codebase pattern consistency (read surrounding code)
4. Stack-specific common mistakes

## Do NOT Check (CodeRabbit handles)
- Style, naming, formatting
- Security basics
- Common language mistakes
- Performance anti-patterns

## Output Format
```
✓ <check>: <passed description>
⚠ <file>:<line> — <concern description>
✗ <file>:<line> — <issue description>
```

## Exclusions
Before flagging any issue, check if it's documented as "future enhancement", "out of scope", or "deferred" in the spec.
