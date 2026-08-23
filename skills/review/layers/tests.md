# Review — Layer 0.75: Tests (all tiers except trivial)

Announce: `Running Layer 0.75: Tests...`

This is the full-suite gate. It runs **once per review**, as its own step —
separate from the per-category test re-runs inside `layers/cleanup.md`.
Cleanup re-runs tests as a fast regression check after each category; this
layer is the authoritative full-suite result that decides `reviewStatus`.

Run after Layer 0.5 (Cleanup) and before Layer 1 (AI Review): no point
spending AI-review effort on code that doesn't even pass its own test suite.

## Resolve and run

```javascript
const { resolveTestCommands } = require('./lib/test-commands'); // CWD-relative — these snippets run with CWD at repo root
const testCommands = resolveTestCommands(process.cwd());
```

`testCommands.full` (and `.filtered`) mirror only `commands[0]` — the
*first* detected stack's command. A multi-stack repo (e.g. a .NET backend
plus a Playwright frontend) resolves one `commands[]` entry per stack, and
this gate must run **every** entry's `full` command, not just the first:

- If `testCommands.commands` has one or more entries with a non-null
  `full`: run each one (the full command, not `filtered` — this is a
  full-suite gate, not a targeted regression check).
  - All exit 0 → layer status `passed`.
  - Any non-zero exit → layer status `failed` (report which stack's suite
    failed).
- If `testCommands.commands` is empty, or every entry's `full` is `null`
  (no `CLAUDE.md` or stack profile `## Test Command` section resolved
  anything): do NOT run anything and do NOT treat this as a pass. Layer
  status is `skipped`, with `note: 'skipped — no test command resolved'`.
  This must be visibly reported in the review report (see `SKILL.md`
  Report template) — never silently green.

## Effect on reviewStatus

- `failed` → `allLayersPassed` is `false` → `reviewStatus: 'needs-fixes'`.
  Finalize does not proceed.
- `skipped` (no command resolved) → visible in the report and in the
  handoff's `note`, but does NOT by itself flip `allLayersPassed` to
  `false`. A repo with no resolvable test command isn't penalized for
  something it can't do; the point is that it can never be silently
  reported as `passed`.
- `passed` → no effect; other layers still gate normally.

**For trivial tier: this layer does not run** (matches Cleanup's "all tiers
except trivial" rule — trivial diffs stop after Lint).
