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

`AskUserQuestion`'s `options` array caps at 4 per question, and
fable/opus/sonnet/haiku/kimi is 5 — so the menu is two
`AskUserQuestion` calls, not one table:

**Step 1 — "Which worker model?" (2 options):**

| Option | Label |
|--------|-------|
| `anthropic` | Anthropic tier — choose fable/opus/sonnet/haiku next |
| `kimi` | Kimi — or **"Kimi (needs setup)"** if `MOONSHOT_API_KEY` isn't configured yet |

**Step 2 — "Which tier?", only asked when "Anthropic tier" was picked (4 options, exactly at the cap):**

| Option | Label |
|--------|-------|
| `fable` | Fable |
| `opus` | Opus |
| `sonnet` | Sonnet |
| `haiku` | Haiku |

Picking an Anthropic tier changes nothing about how dispatch works today
— the Agent tool is called with an explicit `model` override, same as
before.

Kimi is opt-in, and "opt-in" is enforced at the menu too: the label is
computed by `isKimiConfigured()`, which reads the environment and
**never makes a network call**, whether or not a key is present. The
auth probe (`checkKimi()`, below) runs only once you actually select
Kimi. A run that never selects Kimi produces zero Moonshot traffic.

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
   - writes it to the dedicated key file `~/.claude/moonshot-api-key`
     with `0600` permissions — never into the `env` block of
     `~/.claude/settings.json`, because that block is exported into
     **every subprocess** the session starts, which would hand the
     credential to processes that have nothing to do with kimi,
   - migrates a `MOONSHOT_API_KEY` left in that `env` block by an
     earlier install out of it, and
   - re-runs the auth probe to confirm the key actually works before
     handing control back.
   - If the probe fails (`probe.ok === false`), you see `probe.reason`
     and land back on the model menu — Envoy never silently substitutes
     a different model for you.
   - If `settings.json` exists but isn't parseable JSON, `installKimi()`
     refuses to write and tells you to fix it by hand — it will not
     replace a file it can't read with one that has only the Kimi key in
     it.

**Prefer the shell if you'd rather not paste a secret into a session.**
You can export `MOONSHOT_API_KEY` as a plain shell environment variable
instead — `checkKimi()` reads whichever one is present in the process
environment; it doesn't care which route put it there. This is the
better route for shared or recorded sessions: **anything you type at the
key prompt is stored verbatim in Claude Code's plaintext session
transcript** under `~/.claude/projects/**`, which Envoy's own
`lib/cost-reporter.js` (among other tools) reads. The prompt offers
`skip` for exactly this reason.

**Validated on every selection, not just at install time.** Every time
you (or a resumed session) select Kimi, `checkKimi()` probes the key
against Moonshot's endpoint before trusting it — a revoked or expired
key surfaces immediately rather than failing deep inside a worker
dispatch. Note the split: the *menu label* is offline
(`isKimiConfigured()`), the *selection* is what probes.

## How dispatch works

`dispatch({ model, prompt, taskId, allowedTools, timeoutSeconds, maxBudgetUsd })`
turns the chosen model into one of two descriptors:

| Model | `descriptor.kind` | What happens |
|-------|--------------------|---------------|
| `fable` / `opus` / `sonnet` / `haiku` | `agent` | Caller calls the `Agent` tool directly with `model: descriptor.model` and the unmodified prompt. |
| `kimi` | `bash` | Caller runs `descriptor.command` via `Bash` with `run_in_background: true`. |

For `kimi`, `dispatch()` writes the prompt to a scratch file under
`.envoy/agent-prompts/` *before* building the command, and the command
reads it back via **stdin redirection**
(`claude -p < "<promptFile>" > "<outputFile>" 2>&1`). The command string
itself never contains the task prompt — only fixed,
orchestrator-controlled tokens (paths, env var names, the model id).
This is a deliberate command-injection guard: task prompts can contain
arbitrary text (quotes, `$vars`, shell metacharacters), and none of it
is ever interpolated into a shell command that gets executed. Every path
that *does* appear in the command is single-quoted, so a repository
checked out under a directory name containing `$(...)` or a quote is
inert too. Both scratch files are named after the task id **plus a
run-unique suffix** (two concurrent runs dispatching the same task id —
say `ai-review` — must never share files) and are created `0600`, since
they carry issue, diff and worker text; always take the paths from
`descriptor.promptFile` / `descriptor.outputFile`, never reconstruct
them.

The caller must **wait for the background process to exit** before
reading `descriptor.outputFile` (under `.envoy/agent-output/`) — poll
the background shell (`BashOutput`, or `Monitor` to block on the
condition) until it reports exit. The file is written incrementally, so
an early read returns a truncated report. Only then is it used in place
of an `Agent`-tool return value.

### The child environment is an allowlist

The child is started with **`env -i`**, so it inherits *nothing* from
the parent environment except an explicit allowlist: `PATH`/`HOME` (the
CLI and its tools), terminal/locale basics, proxy configuration
(`HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`, `NODE_EXTRA_CA_CERTS`), and the
three Moonshot values below. A credential the list does not name —
**`ANTHROPIC_API_KEY` above all**, Bedrock/Vertex routing flags, cloud
SDK keys — cannot reach a process whose base URL points at a third
party, no matter what is set on the machine.

| Var | Value |
|-----|-------|
| `ANTHROPIC_BASE_URL` | `https://api.moonshot.ai/anthropic` |
| `ANTHROPIC_MODEL` | `kimi-k2.5` |
| `ANTHROPIC_AUTH_TOKEN` | `$MOONSHOT_API_KEY` (resolved at run time from the environment, falling back to the `~/.claude/moonshot-api-key` key file — never a literal secret baked into the command string) |

### A runaway worker is bounded

The worker runs unsupervised and billed, so the command carries two hard
stops with caller-overridable defaults:

- **`--max-budget-usd`** (default 5 USD, `maxBudgetUsd`) caps API spend.
- A **wall-clock watchdog** (default 1800 s, `timeoutSeconds`) kills the
  process if it hangs on something the budget cap cannot see — a network
  stall, an idle loop.

## Tool scoping: a Kimi worker is bounded by the command, not by prose

An Anthropic-tier worker runs as an `Agent` inside your supervised
session. A Kimi worker does not — it is an independent `claude -p`
process driven end to end by a third-party model. "Tools allowed: Read,
Grep, Glob" in a prompt is an instruction the model may or may not
honour; it is not a restriction.

So `dispatch()` takes an `allowedTools` list and turns it into a real,
three-part mechanical bound on the command line:

- **`--tools`** — the hard bound: built-in tools not on the list do not
  *exist* in the child. This is what makes the user's own
  `permissions.allow` irrelevant — a broad allow rule cannot approve a
  tool that is not available.
- **`--allowed-tools`** — pre-approves that same list, so headless mode
  runs without stalling on permission prompts.
- **`--strict-mcp-config`** (with no `--mcp-config`) — the child gets
  **no MCP servers**, regardless of what user or project settings
  configure.

The per-role lists:

| Caller | Tool surface |
|--------|--------------|
| review Layer 1 (AI review) | `Read, Grep, Glob` — read-only |
| review Layer 0.5 (cleanup) | `Read, Edit, Write, Bash, Grep, Glob` |
| pickup implementers | `Read, Edit, Write, Bash, Grep, Glob` |

**It fails closed.** A caller that names no tools gets
`DEFAULT_ALLOWED_TOOLS` (`Read, Grep, Glob`), so a forgotten
`allowedTools` produces a worker that can't write — a loud failure —
rather than an unsupervised worker with a full tool surface. Malformed
tool specs are rejected by `dispatch()` instead of reaching the shell.

This matters because a worker reviewing or implementing code reads
attacker-influenceable text (a diff, an issue body). Prompt injection in
that text reaches a model whose tool discipline this project cannot
vouch for, so the bound has to be mechanical.

**On the Agent path the list is descriptive, not enforcing.** The `Agent`
tool exposes no per-call tool allowlist, so an Anthropic-tier worker is
bounded by its `subagent_type`'s own tool surface and the
`PreToolUse[Agent]` contract gate — unchanged by this feature.
`dispatch()` still returns the normalized list on that path so both
branches document the same intent.

**Contract invariants are enforced inside `dispatch()` on the Kimi
path.** Envoy's `PreToolUse[Agent]` gate (`hooks/observe-gate.js`,
driven by each rigid skill's `contract.json` `agentInvariants`) only
fires for `Agent` tool calls, and a Kimi dispatch goes out through
`Bash` — so `dispatch()` itself evaluates the worker prompt against the
active skill's `agentInvariants` (`evaluateWorkerPrompt()` in
`lib/contract-guard.js`, the same token checks the hook applies) and
**throws instead of building the command** when the prompt is missing a
required token (the Iron Laws) or the dispatch grants a tool the
invariant forbids (review's "the AI-review worker must not be granted
Edit/Write", expressed as `forbiddenTools` and checked against the
dispatch `allowedTools` by base name, so `Edit(docs/*)` counts as Edit).
A read-only invariant is never a prose scan of the prompt — the prompt
interpolates repo file paths, and a path like `MarkdownEditor.tsx`
contains a tool name as a substring; on the Agent hook path, which has
no per-call tool list, the `subagentType` assertion is the tool-surface
bound instead. The skill is
resolved from `.envoy/active-skill.json` — the marker the hook reads —
so a caller cannot forget to opt in; when no rigid skill owns the
session there is nothing to guard and dispatch proceeds. Unlike the
hook's observe mode this is a hard refusal with no override: the worker
runs unsupervised and billed, so a prompt that lost its discipline text
must never launch.

**Invariants select by dispatch identity, never by prompt prose.** Each
`agentInvariants` entry names the dispatch site it guards: `matchTaskId`
is matched against the `taskId` passed to `dispatch()` (the Kimi path),
`matchDescription` against the Agent call's `description:` (the hook
path). The prompt body is what the invariant *checks*
(`promptMustContain` / `promptMustNotContain`), not how it is *found* —
a gate keyed on prompt prose de-arms silently the moment the template is
reworded, which is invisible precisely because the gate then reports
nothing. `tests/lib/contract-invariant-reachability.test.js` pins the
other direction: every invariant must match a real dispatch site in its
skill's step files, so an unreachable invariant fails the suite instead
of sitting armed-looking and dead.

## Security boundary: Moonshot never touches your main session

**`ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` must never be set globally** — not in the `env` block of `~/.claude/settings.json`, not in your shell profile. Setting either one globally would redirect your own Claude Code session's traffic to Moonshot instead of Anthropic.

This boundary is enforced by code, not just documented:

- `installKimi()` writes the key **only** to the `0600` key file
  `~/.claude/moonshot-api-key` — never into `settings.json`'s `env`
  block (exported to every subprocess), and it migrates a key an earlier
  install left there out of it.
- If `ANTHROPIC_BASE_URL` or `ANTHROPIC_AUTH_TOKEN` are present in
  `settings.json` (e.g. left over from manual experimentation), it
  deletes them on every install.
- `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` are only ever injected
  into the environment of the one background `claude -p` process a kimi
  dispatch starts (see the table above) — never the parent session, and
  the token itself is never written into a command string.
- That child environment is built with `env -i` (see above), so the
  machine's own `ANTHROPIC_API_KEY` — or any other credential — can
  never ride along to Moonshot.
- The dispatched command itself refuses to run when no key is available
  from either the `MOONSHOT_API_KEY` env var or the key file. Without
  that guard, an empty `ANTHROPIC_AUTH_TOKEN` combined with an
  already-redirected `ANTHROPIC_BASE_URL` could let the CLI fall back on
  the machine's own Anthropic credential and send it to Moonshot.

### Residual risk: the Kimi worker holds a live Moonshot credential

Accept this knowingly before enabling Kimi for a write-capable role.

The `claude -p` child process gets your real `MOONSHOT_API_KEY` in its own
environment, and for the pickup-implementer and review-cleanup roles that
same process is granted `Bash`. A Kimi worker can therefore read its own
credential (`env`, `echo $ANTHROPIC_AUTH_TOKEN`) and, with network access,
send it anywhere — or simply repeat it into its report at
`descriptor.outputFile` (the run-unique file under `.envoy/agent-output/`),
which the orchestrator later reads and may quote onward into commits or PR
text. The worker is driven by a
third-party model reading attacker-influenceable text (issue bodies,
diffs), so prompt injection is the realistic trigger, not operator error.

`--allowed-tools` bounds *which* tools the worker has; it does not isolate
the credential from the tools it does have. Practical mitigations:

- Use a **dedicated, rate-limited Moonshot key** for Envoy — never a key
  shared with other systems — so revocation is cheap and blast radius is
  bounded.
- Prefer Kimi for the **read-only** role (review Layer 1) over the
  write-and-`Bash` roles when the diff or issue text is untrusted.
- Rotate the key if a worker's output ever contains something resembling
  it.

## Changing the worker model mid-run

The choice is stored once, in `.envoy-session.json`'s `workerModel`
field — nothing else caches it. To switch models (or be re-asked) after
it was chosen, clear that field from the repo root and the next
selection step re-runs the menu:

```bash
node -e "const s=require('<plugin>/lib/session-state'); const st=s.load(); st.workerModel=null; s.save(st);"
```

(or set it directly to a tier name with `setWorkerModel()` instead of
`null`). Workers already dispatched keep running on the old model; the
change applies from the next dispatch.

## Reference

- [`lib/model-dispatch.js`](../lib/model-dispatch.js) — `dispatch()`,
  `isKimiConfigured()`, `checkKimi()`, `installKimi()`, and the
  `ANTHROPIC_TIERS` / `KIMI_TIER` / `KIMI_MODEL_ID` / `KIMI_BASE_URL` /
  `KIMI_API_KEY_ENV` / `DEFAULT_ALLOWED_TOOLS` constants.
- [`lib/session-state.js`](../lib/session-state.js) — the `workerModel`
  field and `setWorkerModel()`.
- `skills/pickup/steps/tdd.md` — Step 12.5 (pickup's selection step) and
  Step 13 (implementer dispatch).
- `skills/review/SKILL.md` — "6. Worker Model Selection", and
  `skills/review/layers/ai-review.md` / `layers/cleanup.md` for how the
  AI layers dispatch through the same mechanism.
