# Hooks

Envoy uses Claude Code's native hook system for automation without polluting the context window.

## How Hooks Work

Claude Code fires events at specific lifecycle points. Hooks are scripts that run in response:

```
User types prompt
  → PreToolUse fires (can BLOCK the tool call)
    → Tool executes
      → PostToolUse fires
        → Claude finishes responding
          → Stop fires
```

Hooks receive JSON on stdin describing the event. They control behavior via exit code:
- **Exit 0** — Allow (stdout text gets injected into Claude's context)
- **Exit 2** — Block the tool call (stderr explains why)

## Envoy's Hooks

| Hook | Event | Purpose |
|------|-------|---------|
| `session-start.sh` | SessionStart | Loads Envoy skills, detects tech stacks, restores session state |
| `config-protection.js` | PreToolUse (Edit/Write) | Blocks linter/formatter config modifications |
| `post-edit-accumulator.js` | PostToolUse (Edit/Write) | Tracks edited files for batched processing |
| `post-pr-poll.js` | PostToolUse (Bash) | Triggers CodeRabbit polling after `gh pr create` |
| `stop-batch-lint.js` | Stop | Runs lint once across all session edits |
| `learning-extractor.js` | Stop (async) | Saves recurring review patterns to memory |

## Config Protection

The most impactful hook. When Claude is in an autonomous review-fix loop, it might try to weaken linter rules instead of fixing code. The config-protection hook blocks this:

**Blocked files:** `.eslintrc*`, `eslint.config.*`, `.prettierrc*`, `prettier.config.*`, `biome.json`, `.editorconfig`

**Warned files (not blocked):** `tsconfig.json`

When Claude tries to edit `.eslintrc.js`, it sees: "BLOCKED: Fix source code instead of weakening linter config." and adjusts its approach.

## Batch Lint

Without hooks: Claude runs `npm run lint` after every edit → N lint outputs in context.

With hooks:
1. `post-edit-accumulator` silently tracks each edited file to a temp file
2. `stop-batch-lint` reads the accumulated list, deduplicates, runs lint once
3. One lint output instead of N → significant context savings

## Hook Profiles

All hooks route through `hook-runner.js` which checks `ENVOY_HOOK_PROFILE`:

| Profile | Hooks | Use Case |
|---------|-------|----------|
| `minimal` | session-start, config-protection | Lowest overhead |
| `standard` | All hooks (default) | Full automation |
| `strict` | All hooks + future verification gates | Maximum safety |

Set profile: `export ENVOY_HOOK_PROFILE=minimal`

Override individual hooks: `export ENVOY_DISABLED_HOOKS=learning-extractor`

## Session State Restoration

When `session-start.sh` runs, it checks for `.envoy-session.json` in the working directory. If found, it surfaces task progress, recent decisions, and next steps — enabling seamless continuation across context compactions and session restarts. See [[Context Efficiency]] for details.

## Cost Tracking

Use `/envoy:costs` to view token usage and estimated costs. The command reads Claude Code's native session JSONL files directly and breaks down costs by:
- **Activity** (which skill/agent consumed tokens)
- **Model** (opus vs sonnet vs haiku)
- **Branch** (cost per feature)

See [[Context Efficiency#Cost Reporter]] for details.

## Learning Loop

The learning-extractor hook creates a feedback loop:

1. After review sessions, it extracts findings
2. Patterns seen 2+ times become "known patterns" in `memory/review-learnings.md`
3. Next review loads known patterns first (cheap local check before AI review)
4. Patterns not seen in 5+ reviews get archived (the team learned)

## Adding Custom Hooks

Add to `.claude/settings.json` or the plugin's `hooks/hooks.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node my-hook.js"
          }
        ]
      }
    ]
  }
}
```
