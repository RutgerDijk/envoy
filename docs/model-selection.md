# Worker Model Selection

`pickup` and `review` dispatch subagents — implementers in pickup, the
cleanup and AI-review layers in review — through
[`lib/model-dispatch.js`](../lib/model-dispatch.js). Once per run you pick
**one** model every worker in that run uses: an Anthropic tier (`fable`,
`opus`, `sonnet`, `haiku`) or `kimi`, a headless [Moonshot](https://www.moonshot.ai/)
worker running Kimi K2.5 through Moonshot's Anthropic-compatible API.

This page covers the one env var Kimi needs, how it's installed, and the
security boundary that keeps Moonshot traffic scoped to worker processes
only — never your own Claude Code session.

## Choosing a model

Both skills ask the same question, once, the same way:

- **pickup** — Step 12.5 (`skills/pickup/steps/tdd.md`), before Step 13
  dispatches the first implementer.
- **review** — "6. Worker Model Selection" (`skills/review/SKILL.md`),
  before Layer 0.5 (cleanup) or Layer 1 (AI review) dispatch anything.

Both read and write the same `workerModel` field in
`.envoy-session.json` (`lib/session-state.js`'s `setWorkerModel()`), so:

- The choice is asked **once per branch**, not once per skill. If
  `pickup` already chose a model earlier in the branch's session,
  `review` inherits it and does not ask again.
- A session resumed after context compaction or a restart is **not
  re-asked** — it reads the stored choice back instead.

The menu, via `AskUserQuestion`:

| Option | Label |
|--------|-------|
| `fable` | Fable |
| `opus` | Opus |
| `sonnet` | Sonnet |
| `haiku` | Haiku |
| `kimi` | Kimi — or **"Kimi (needs setup)"** if `MOONSHOT_API_KEY` isn't configured yet |

Picking an Anthropic tier changes nothing about how dispatch works today
— the Agent tool is called with an explicit `model` override, same as
before. Kimi is opt-in: `checkKimi()` (see below) short-circuits with no
network call whenever `MOONSHOT_API_KEY` is unset, so a run that never
touches Kimi produces zero Moonshot traffic.

## Setting up Kimi

Kimi needs exactly one thing: a Moonshot API key.

1. **Get a key** at [platform.moonshot.ai](https://platform.moonshot.ai).
2. **Pick "Kimi (needs setup)"** from the model menu above. You're
   prompted: "Get a key at https://platform.moonshot.ai — paste it
   here, or type `skip` to pick a different model."
   - `skip` returns you to the model menu — no model is dispatched with
     nothing chosen.
3. **Paste the key.** This calls `installKimi(key)`
   (`lib/model-dispatch.js`), which:
   - writes it as `MOONSHOT_API_KEY` into the `env` block of
     `~/.claude/settings.json` (creating the file/block if needed), and
   - re-runs the auth probe to confirm the key actually works before
     handing control back.
   - If the probe fails (`probe.ok === false`), you see `probe.reason`
     and land back on the model menu — Envoy never silently substitutes
     a different model for you.

You can also export `MOONSHOT_API_KEY` as a plain shell environment
variable instead of writing it to `settings.json` — `checkKimi()` reads
whichever one is present in the process environment; it doesn't care
which route put it there.

**Validated on every selection, not just at install time.** Every time
you (or a resumed session) select Kimi, `checkKimi()` re-probes the key
against Moonshot's endpoint before trusting it — a revoked or expired
key surfaces as "needs setup" again rather than failing deep inside a
worker dispatch.

## How dispatch works

`dispatch({ model, prompt, taskId })` turns the chosen model into one of
two descriptors:

| Model | `descriptor.kind` | What happens |
|-------|--------------------|---------------|
| `fable` / `opus` / `sonnet` / `haiku` | `agent` | Caller calls the `Agent` tool directly with `model: descriptor.model` and the unmodified prompt. |
| `kimi` | `bash` | Caller runs `descriptor.command` via `Bash` with `run_in_background: true`. |

For `kimi`, `dispatch()` writes the prompt to a scratch file
(`.envoy/agent-prompts/<task-id>.md`) *before* building the command, and
the command reads it back via **stdin redirection**
(`claude -p < "<promptFile>" > "<outputFile>" 2>&1`). The command string
itself never contains the task prompt — only fixed,
orchestrator-controlled tokens (paths, env var names, the model id).
This is a deliberate command-injection guard: task prompts can contain
arbitrary text (quotes, `$vars`, shell metacharacters), and none of it
is ever interpolated into a shell command that gets executed. Once the
background process exits, its report is read back from
`descriptor.outputFile` (`.envoy/agent-output/<task-id>.md`) in place of
an `Agent`-tool return value.

The kimi command sets three environment variables, scoped to that one
child process only:

| Var | Value |
|-----|-------|
| `ANTHROPIC_BASE_URL` | `https://api.moonshot.ai/anthropic` |
| `ANTHROPIC_MODEL` | `kimi-k2.5` |
| `ANTHROPIC_AUTH_TOKEN` | `$MOONSHOT_API_KEY` (read from the environment at run time, never a literal secret baked into the command string) |

## Security boundary: Moonshot never touches your main session

**`ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` must never be set globally** — not in the `env` block of `~/.claude/settings.json`, not in your shell profile. Setting either one globally would redirect your own Claude Code session's traffic to Moonshot instead of Anthropic.

This boundary is enforced by `installKimi()`, not just documented:

- It writes **only** `MOONSHOT_API_KEY` into `settings.json`.
- If `ANTHROPIC_BASE_URL` or `ANTHROPIC_AUTH_TOKEN` are already present
  in `settings.json` (e.g. left over from manual experimentation), it
  deletes them on every install.
- `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` are only ever injected
  into the environment of the one background `claude -p` process a kimi
  dispatch starts (see the table above) — never the parent session, and
  never written to disk anywhere.

## Reference

- [`lib/model-dispatch.js`](../lib/model-dispatch.js) — `dispatch()`,
  `checkKimi()`, `installKimi()`, and the `ANTHROPIC_TIERS` / `KIMI_TIER`
  / `KIMI_MODEL_ID` / `KIMI_BASE_URL` / `KIMI_API_KEY_ENV` constants.
- [`lib/session-state.js`](../lib/session-state.js) — the `workerModel`
  field and `setWorkerModel()`.
- `skills/pickup/steps/tdd.md` — Step 12.5 (pickup's selection step) and
  Step 13 (implementer dispatch).
- `skills/review/SKILL.md` — "6. Worker Model Selection", and
  `skills/review/layers/ai-review.md` / `layers/cleanup.md` for how the
  AI layers dispatch through the same mechanism.
