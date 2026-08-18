/**
 * Model Dispatch — shared worker dispatch abstraction (Anthropic + Kimi).
 *
 * One place that turns a (task prompt, model choice) pair into a running
 * worker, so pickup (parallel implementers) and review (AI layers) share
 * the same mechanism for both:
 *
 *   - Anthropic tiers (fable/opus/sonnet/haiku): the Agent tool can name
 *     these directly, so dispatch() returns a descriptor carrying the
 *     model override and the unmodified prompt for the caller to hand to
 *     the Agent tool.
 *
 *   - kimi: the Agent tool cannot name non-Anthropic models, so dispatch()
 *     returns a background Bash command that runs a headless
 *     `claude -p` process against Moonshot's Anthropic-compatible
 *     endpoint. The prompt is written to a scratch file first and read by
 *     the child process via stdin redirection — the command string itself
 *     never contains prompt text, only fixed orchestrator-controlled
 *     tokens (paths, env var names, model id). This avoids building a
 *     shell command out of untrusted/dynamic content.
 *
 * A kimi worker runs outside this session's supervision, so its tool
 * surface is bounded mechanically (`--allowed-tools`), not just by
 * prompt text, and it fails closed: a caller that names no tools gets a
 * read-only worker.
 *
 * isKimiConfigured() answers "is a key present?" offline; checkKimi()
 * probes whether Kimi is actually usable (key present + auth accepted)
 * without ever throwing. installKimi() stores MOONSHOT_API_KEY in a
 * dedicated 0600 key file (KIMI_KEY_FILE) — never in settings.json's
 * `env` block, which exports to every subprocess, and never
 * ANTHROPIC_BASE_URL or ANTHROPIC_AUTH_TOKEN, which are injected into
 * the kimi child process command only, per dispatch() above — and
 * re-probes to confirm auth.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { evaluateWorkerPrompt } = require('./contract-guard');
const { readActiveSkill } = require('./active-skill');

const PLUGIN_ROOT = path.resolve(__dirname, '..');

/** Anthropic model tiers the Agent tool can dispatch directly. */
const ANTHROPIC_TIERS = ['fable', 'opus', 'sonnet', 'haiku'];

/** The model-selection value that routes to the headless Kimi path. */
const KIMI_TIER = 'kimi';

/** ANTHROPIC_MODEL value sent to Moonshot's Anthropic-compatible endpoint. */
const KIMI_MODEL_ID = 'kimi-k2.5';

/** ANTHROPIC_BASE_URL for Moonshot's Anthropic-compatible endpoint. */
const KIMI_BASE_URL = 'https://api.moonshot.ai/anthropic';

/** Env var name holding the Moonshot API key (never ANTHROPIC_AUTH_TOKEN). */
const KIMI_API_KEY_ENV = 'MOONSHOT_API_KEY';

/**
 * Where installKimi() stores the key: a dedicated owner-only file, NOT the
 * settings.json `env` block — that block is exported into every subprocess
 * the session starts, which would hand the credential to processes that
 * have nothing to do with kimi. The env var still wins when set.
 */
const KIMI_KEY_FILE = path.join(os.homedir(), '.claude', 'moonshot-api-key');

/**
 * Tool surface a kimi worker gets when the caller names none. The
 * headless path runs outside this session's supervision, so it fails
 * CLOSED: a caller that forgets to declare its tools gets a read-only
 * worker rather than an unrestricted one.
 */
const DEFAULT_ALLOWED_TOOLS = ['Read', 'Grep', 'Glob'];

/** Mode for ~/.claude/settings.json — it holds an API key after install. */
const SETTINGS_FILE_MODE = 0o600;

/** Wall-clock bound on a kimi worker; the watchdog kills it after this. */
const KIMI_DEFAULT_TIMEOUT_SECONDS = 1800;

/** Spend cap handed to the worker via `--max-budget-usd`. */
const KIMI_DEFAULT_MAX_BUDGET_USD = 5;

/**
 * Environment the kimi child is allowed to inherit from the parent. The
 * child env is built with `env -i` — an allowlist — so a credential or
 * routing var this list does not name (ANTHROPIC_API_KEY,
 * CLAUDE_CODE_USE_BEDROCK, cloud SDK keys, ...) cannot reach a process
 * whose base URL points at a third party. PATH/HOME keep the CLI and its
 * tools working; the proxy and CA vars keep corporate networks working;
 * everything defaulted (`:-`) tolerates being unset in the parent.
 */
const KIMI_CHILD_ENV = [
  'PATH="$PATH"',
  'HOME="$HOME"',
  'TERM="${TERM:-dumb}"',
  'SHELL="${SHELL:-/bin/sh}"',
  'TMPDIR="${TMPDIR:-/tmp}"',
  'LANG="${LANG:-}"',
  'LC_ALL="${LC_ALL:-}"',
  'USER="${USER:-}"',
  'LOGNAME="${LOGNAME:-}"',
  'HTTP_PROXY="${HTTP_PROXY:-}"',
  'HTTPS_PROXY="${HTTPS_PROXY:-}"',
  'NO_PROXY="${NO_PROXY:-}"',
  'http_proxy="${http_proxy:-}"',
  'https_proxy="${https_proxy:-}"',
  'no_proxy="${no_proxy:-}"',
  'NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-}"',
];

/**
 * @param {string} model
 * @returns {boolean}
 */
function isAnthropicTier(model) {
  return ANTHROPIC_TIERS.includes(model);
}

/**
 * Read the stored Moonshot key, or null when the file is absent/empty.
 * @param {string} keyFile
 * @returns {string|null}
 */
function readKimiKeyFile(keyFile) {
  try {
    const raw = fs.readFileSync(keyFile, 'utf8').trim();
    return raw || null;
  } catch (_err) {
    return null;
  }
}

/**
 * Atomic owner-only write: unique temp name (a fixed `.tmp` suffix races
 * concurrent writers), 0600 pinned with chmod (open(2) masks the mode with
 * the umask), rename into place (replaces a symlink rather than writing a
 * secret through it into whatever it points at — commonly a dotfiles repo).
 * @param {string} targetPath
 * @param {string} content
 */
function writePrivateFileAtomic(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, content, { encoding: 'utf8', mode: SETTINGS_FILE_MODE });
  fs.chmodSync(tmpPath, SETTINGS_FILE_MODE);
  fs.renameSync(tmpPath, targetPath);
}

/**
 * Reduce a task id to safe path characters so it cannot escape the
 * .envoy scratch directories (e.g. via "../" segments).
 *
 * Because the substitution is many-to-one ("task/1" and "task-1" both
 * collapse to "task-1"), any id that actually had to be rewritten gets a
 * short digest of the original appended — otherwise two live workers
 * could silently share one prompt/output file.
 *
 * @param {string} taskId
 * @returns {string}
 */
function sanitizeTaskId(taskId) {
  const raw = String(taskId == null ? '' : taskId);
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, '-');
  if (!safe || /^\.+$/.test(safe)) {
    throw new Error(`model-dispatch: invalid taskId "${taskId}"`);
  }
  if (safe === raw) return safe;
  const digest = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 8);
  return `${safe}-${digest}`;
}

/**
 * Wrap a value in single quotes for safe use inside a shell command.
 * Single quotes suppress every form of shell expansion, so an embedded
 * `$(...)`, backtick or `"` in (say) a directory name cannot break out.
 * @param {string} value
 * @returns {string}
 */
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Normalize the caller's tool allowlist into a single `--allowed-tools`
 * argument. Tool specs are orchestrator-authored (never task text), but
 * they are validated anyway so a malformed spec fails loudly here rather
 * than becoming shell syntax in the dispatched command.
 * @param {string[]|string} allowedTools
 * @returns {string} comma-joined, shell-quoted list
 */
function normalizeAllowedTools(allowedTools) {
  const list = Array.isArray(allowedTools)
    ? allowedTools
    : String(allowedTools).split(',');
  const cleaned = list.map((t) => String(t).trim()).filter(Boolean);

  if (cleaned.length === 0) {
    throw new Error('model-dispatch: "allowedTools" must name at least one tool');
  }
  for (const tool of cleaned) {
    if (!/^[A-Za-z][A-Za-z0-9_]*(\([A-Za-z0-9_ ./:*-]*\))?$/.test(tool)) {
      throw new Error(`model-dispatch: invalid tool spec "${tool}"`);
    }
  }
  return cleaned.join(',');
}

/**
 * Refuse to build a kimi worker whose prompt violates the dispatching
 * skill's contract. The PreToolUse[Agent] observe gate only sees Agent
 * tool calls, so this is the ONLY invariant check the headless path gets
 * — and unlike the hook's observe mode it is a hard refusal: the worker
 * runs unsupervised and billed, so a prompt that lost its discipline text
 * must never launch. The skill is resolved from the same
 * .envoy/active-skill.json marker the hook uses (fail-open when absent:
 * nothing owns the session, nothing to guard).
 * @param {string} prompt
 * @param {string} taskId dispatch identity the invariant is selected by
 * @param {{cwd?: string, contractPath?: string|null}} options
 */
function enforceWorkerContract(prompt, taskId, options) {
  let contractPath = options.contractPath;
  if (contractPath === undefined) {
    const active = readActiveSkill(options.cwd || process.cwd());
    if (!active) return;
    contractPath = path.join(PLUGIN_ROOT, 'skills', active.skill, 'contract.json');
  }
  if (!contractPath) return;

  const decision = evaluateWorkerPrompt(contractPath, prompt, taskId);
  if (decision.block) {
    throw new Error(
      `model-dispatch: kimi worker prompt violates the "${decision.skill}" contract — ${decision.reason}`,
    );
  }
}

/**
 * Build the background bash-command descriptor for a kimi worker. The
 * prompt is written to disk and the command reads it via stdin
 * redirection — no prompt text is ever interpolated into the command
 * string itself.
 * @param {{prompt: string, taskId: string, allowedTools?: string[]|string}} params
 * @param {{cwd?: string}} [options]
 * @returns {object}
 */
function buildKimiDispatch({ prompt, taskId, allowedTools, timeoutSeconds, maxBudgetUsd }, options = {}) {
  const cwd = options.cwd || process.cwd();
  enforceWorkerContract(prompt, taskId, options);
  const safeId = sanitizeTaskId(taskId);

  const timeout = timeoutSeconds === undefined ? KIMI_DEFAULT_TIMEOUT_SECONDS : timeoutSeconds;
  const budget = maxBudgetUsd === undefined ? KIMI_DEFAULT_MAX_BUDGET_USD : maxBudgetUsd;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(`model-dispatch: invalid timeoutSeconds "${timeoutSeconds}"`);
  }
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new Error(`model-dispatch: invalid maxBudgetUsd "${maxBudgetUsd}"`);
  }

  const promptDir = path.resolve(cwd, '.envoy', 'agent-prompts');
  const outputDir = path.resolve(cwd, '.envoy', 'agent-output');
  fs.mkdirSync(promptDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  // The task id alone is not unique across concurrent runs (two review runs
  // both dispatch 'ai-review'), so every dispatch gets its own files; the
  // orchestrator reads the paths from the descriptor, never reconstructs
  // them. Both files carry issue/diff/worker text, so neither may be left
  // group/other-readable by the ambient umask (open(2) masks the mode, so
  // chmod pins it) — the output file is precreated empty for the same
  // reason, since the shell redirection reuses its mode.
  const fileId = `${safeId}-${crypto.randomBytes(3).toString('hex')}`;
  const promptFile = path.join(promptDir, `${fileId}.md`);
  const outputFile = path.join(outputDir, `${fileId}.md`);

  fs.writeFileSync(promptFile, prompt, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(promptFile, 0o600);
  fs.writeFileSync(outputFile, '', { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(outputFile, 0o600);

  const tools = normalizeAllowedTools(
    allowedTools === undefined ? DEFAULT_ALLOWED_TOOLS : allowedTools,
  );

  // Fail closed at RUN time, not just build time. `ANTHROPIC_AUTH_TOKEN`
  // below is a variable reference, so an unset/empty MOONSHOT_API_KEY would
  // otherwise start `claude` with an empty token but ANTHROPIC_BASE_URL
  // already pointed at Moonshot — inviting the CLI to fall back on whatever
  // Anthropic credential the machine has and send it to a third party.
  // Building the descriptor stays pure (no env/key read), so the only gate
  // that matters is this one, and it cannot be skipped by an orchestrator
  // that forgot to call checkKimi() first. The env var wins; the key file
  // installKimi() writes is the fallback.
  const keyFile = options.keyFile || KIMI_KEY_FILE;
  const keyGuard =
    `${KIMI_API_KEY_ENV}="\${${KIMI_API_KEY_ENV}:-$(cat ${shellQuote(keyFile)} 2>/dev/null)}"; ` +
    `if [ -z "\${${KIMI_API_KEY_ENV}:-}" ]; then ` +
    `echo "model-dispatch: no Moonshot key — set ${KIMI_API_KEY_ENV} or run the Kimi setup (writes ${shellQuote(keyFile)})" >&2; ` +
    `exit 1; fi;`;

  // `env -i` + KIMI_CHILD_ENV is the allowlist; `--tools` hard-bounds which
  // built-in tools exist in the child (the user's permissions.allow cannot
  // approve a tool that is not available), `--allowed-tools` pre-approves
  // that same set so headless mode does not stall on permission prompts, and
  // `--strict-mcp-config` with no `--mcp-config` leaves the child without
  // MCP servers regardless of user/project settings.
  const launch = [
    'env -i',
    ...KIMI_CHILD_ENV,
    `ANTHROPIC_BASE_URL=${shellQuote(KIMI_BASE_URL)}`,
    `ANTHROPIC_AUTH_TOKEN="$${KIMI_API_KEY_ENV}"`,
    `ANTHROPIC_MODEL=${shellQuote(KIMI_MODEL_ID)}`,
    `claude -p --allowed-tools ${shellQuote(tools)} --tools ${shellQuote(tools)}`,
    `--strict-mcp-config --max-budget-usd ${shellQuote(String(budget))}`,
    `< ${shellQuote(promptFile)} > ${shellQuote(outputFile)} 2>&1`,
  ].join(' ');

  // Wall-clock watchdog: a worker that hangs (network stall, runaway loop
  // the budget cap cannot see) is killed after `timeout` seconds. The
  // watchdog subshell detaches from stdio — inherited pipes would keep the
  // caller waiting on it — and is killed on normal exit; its `sleep` may
  // linger until the timeout elapses, which is harmless.
  const command = [
    keyGuard,
    `${launch} &`,
    'CLAUDE_PID=$!;',
    `( sleep ${shellQuote(String(timeout))}; kill "$CLAUDE_PID" 2>/dev/null ) < /dev/null > /dev/null 2>&1 &`,
    'WATCHDOG_PID=$!;',
    'wait "$CLAUDE_PID"; STATUS=$?;',
    'kill "$WATCHDOG_PID" 2>/dev/null;',
    'exit "$STATUS"',
  ].join(' ');

  return {
    kind: 'bash',
    command,
    run_in_background: true,
    description: `Kimi worker: ${taskId}`,
    taskId,
    allowedTools: tools,
    promptFile,
    outputFile,
    timeoutSeconds: timeout,
    maxBudgetUsd: budget,
  };
}

/**
 * Turn a (model, prompt, taskId) triple into a dispatchable worker
 * descriptor.
 *
 * @param {{model: string, prompt: string, taskId: string, allowedTools?: string[]|string,
 *   timeoutSeconds?: number, maxBudgetUsd?: number}} params
 *   allowedTools bounds the worker's tool surface. It is mechanically
 *   enforced only on the kimi path (`claude -p --tools --allowed-tools`).
 *   On the Agent path the Agent tool exposes no per-call tool allowlist,
 *   so the normalized list is returned for documentation/assertion
 *   purposes only — the real bound there remains the `subagent_type`'s
 *   own tool surface plus the PreToolUse[Agent] contract gate. Omitted
 *   means read-only (DEFAULT_ALLOWED_TOOLS). timeoutSeconds and
 *   maxBudgetUsd bound a kimi worker's wall clock and spend
 *   (KIMI_DEFAULT_TIMEOUT_SECONDS / KIMI_DEFAULT_MAX_BUDGET_USD when
 *   omitted); both are ignored on the Agent path, where the session
 *   supervises the worker directly.
 * @param {{cwd?: string, contractPath?: string|null, keyFile?: string}} [options] - cwd
 *   override for the kimi scratch directories (.envoy/agent-prompts,
 *   .envoy/agent-output); defaults to process.cwd(). contractPath
 *   overrides the contract used for the kimi prompt gate (resolved from
 *   the active-skill marker when omitted; null disables the gate).
 *   keyFile overrides the stored-key fallback path (KIMI_KEY_FILE).
 * @returns {{kind: 'agent', model: string, prompt: string, taskId: string, allowedTools: string}
 *   | {kind: 'bash', command: string, run_in_background: true, description: string,
 *      taskId: string, allowedTools: string, promptFile: string, outputFile: string}}
 */
function dispatch({ model, prompt, taskId, allowedTools, timeoutSeconds, maxBudgetUsd } = {}, options = {}) {
  if (!model) {
    throw new Error('model-dispatch: "model" is required');
  }
  if (typeof prompt !== 'string' || prompt.length === 0) {
    throw new Error('model-dispatch: "prompt" is required');
  }
  if (!taskId) {
    throw new Error('model-dispatch: "taskId" is required');
  }

  if (isAnthropicTier(model)) {
    return {
      kind: 'agent',
      model,
      prompt,
      taskId,
      allowedTools: normalizeAllowedTools(
        allowedTools === undefined ? DEFAULT_ALLOWED_TOOLS : allowedTools,
      ),
    };
  }

  if (model === KIMI_TIER) {
    return buildKimiDispatch({ prompt, taskId, allowedTools, timeoutSeconds, maxBudgetUsd }, options);
  }

  throw new Error(`model-dispatch: unknown model "${model}"`);
}

/**
 * Default auth probe: a minimal POST against Moonshot's Anthropic-compatible
 * messages endpoint. It authenticates exactly like the dispatched child —
 * `Authorization: Bearer` (what ANTHROPIC_AUTH_TOKEN becomes), never
 * `x-api-key` — and sends KIMI_MODEL_ID, so a passing probe means both the
 * key and the model id the dispatch will use are accepted.
 * @param {string} apiKey
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function defaultProbe(apiKey) {
  const res = await fetch(`${KIMI_BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: KIMI_MODEL_ID,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: `auth rejected (HTTP ${res.status})` };
  }
  if (res.status === 404) {
    let detail = '';
    try {
      const body = await res.json();
      if (body && body.error && body.error.message) detail = ` — ${body.error.message}`;
    } catch (_err) {
      // body unreadable; the model id alone is enough to act on
    }
    return {
      ok: false,
      reason: `model "${KIMI_MODEL_ID}" not recognized by Moonshot (HTTP 404${detail})`,
    };
  }
  if (!res.ok) {
    return { ok: false, reason: `unexpected response (HTTP ${res.status})` };
  }
  return { ok: true };
}

/**
 * Resolve the Moonshot key: the env var wins, the key file installKimi()
 * writes is the fallback. Returns null when neither holds a key.
 * @param {{env?: NodeJS.ProcessEnv, keyFile?: string}} options
 * @returns {string|null}
 */
function resolveKimiKey(options) {
  const env = options.env || process.env;
  const envKey = env[KIMI_API_KEY_ENV];
  if (envKey && String(envKey).trim()) return String(envKey).trim();
  return readKimiKeyFile(options.keyFile || KIMI_KEY_FILE);
}

/**
 * Cheap, offline answer to "has this machine been set up for Kimi?" —
 * key presence only (env var or key file), no network. Used to label the
 * model menu, so a run that never selects kimi produces zero Moonshot
 * traffic even on a machine where the key IS configured. The real probe
 * (checkKimi) runs when kimi is actually selected.
 * @param {{env?: NodeJS.ProcessEnv, keyFile?: string}} [options]
 * @returns {boolean}
 */
function isKimiConfigured(options = {}) {
  return resolveKimiKey(options) !== null;
}

/**
 * Check whether Kimi is usable: a key present (env var or key file) and
 * the auth probe accepts it. Never throws.
 * @param {{env?: NodeJS.ProcessEnv, keyFile?: string, probe?: (apiKey: string) => Promise<{ok: boolean, reason?: string}>}} [options]
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function checkKimi(options = {}) {
  const apiKey = resolveKimiKey(options);

  if (!apiKey) {
    return {
      ok: false,
      reason: `${KIMI_API_KEY_ENV} is not set and no key file exists at ${options.keyFile || KIMI_KEY_FILE}`,
    };
  }

  const probe = options.probe || defaultProbe;
  try {
    const result = await probe(apiKey);
    if (result && result.ok) {
      return { ok: true };
    }
    return { ok: false, reason: (result && result.reason) || 'auth probe failed' };
  } catch (err) {
    return { ok: false, reason: (err && err.message) || 'auth probe failed' };
  }
}

/**
 * Store the Moonshot key in the dedicated 0600 key file (KIMI_KEY_FILE)
 * and re-run the auth probe to confirm it works. The settings.json `env`
 * block is never a destination — it is exported into every subprocess —
 * so a key found there (from an earlier install) is migrated out, and
 * ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN are stripped if somehow
 * present; those are injected into the kimi child process command only
 * (see dispatch()). settings.json is rewritten only when one of those
 * removals applies, and never created.
 *
 * @param {string} apiKey
 * @param {{keyFile?: string, settingsPath?: string, probe?: (apiKey: string) => Promise<{ok: boolean, reason?: string}>}} [options]
 * @returns {Promise<{written: true, keyFile: string, settingsPath: string, probe: {ok: boolean, reason?: string}}>}
 */
async function installKimi(apiKey, options = {}) {
  if (!apiKey || !String(apiKey).trim()) {
    throw new Error('model-dispatch: installKimi requires a non-empty apiKey');
  }

  const keyFile = options.keyFile || KIMI_KEY_FILE;
  const settingsPath = options.settingsPath || path.join(os.homedir(), '.claude', 'settings.json');

  let settings = null;
  let raw = null;
  try {
    raw = fs.readFileSync(settingsPath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  if (raw !== null) {
    try {
      settings = JSON.parse(raw);
    } catch (err) {
      // Never clobber a settings file we cannot parse — the user would
      // silently lose every other setting in it.
      throw new Error(
        `model-dispatch: ${settingsPath} is not valid JSON (${err.message}) — fix it manually, then re-run the Kimi setup`,
      );
    }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new Error(
        `model-dispatch: ${settingsPath} does not contain a JSON object — fix it manually, then re-run the Kimi setup`,
      );
    }
  }

  writePrivateFileAtomic(keyFile, `${String(apiKey).trim()}\n`);

  if (settings && settings.env && typeof settings.env === 'object') {
    const stale = [KIMI_API_KEY_ENV, 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN']
      .filter((name) => name in settings.env);
    if (stale.length > 0) {
      for (const name of stale) delete settings.env[name];
      writePrivateFileAtomic(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    }
  }

  const probeResult = await checkKimi({
    env: { [KIMI_API_KEY_ENV]: apiKey },
    probe: options.probe,
  });

  return {
    written: true,
    keyFile,
    settingsPath,
    probe: probeResult,
  };
}

module.exports = {
  ANTHROPIC_TIERS,
  KIMI_TIER,
  KIMI_MODEL_ID,
  KIMI_BASE_URL,
  KIMI_API_KEY_ENV,
  KIMI_KEY_FILE,
  DEFAULT_ALLOWED_TOOLS,
  SETTINGS_FILE_MODE,
  KIMI_DEFAULT_TIMEOUT_SECONDS,
  KIMI_DEFAULT_MAX_BUDGET_USD,
  isAnthropicTier,
  sanitizeTaskId,
  dispatch,
  defaultProbe,
  isKimiConfigured,
  checkKimi,
  installKimi,
};
