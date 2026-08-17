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
 * without ever throwing. installKimi() writes MOONSHOT_API_KEY into the
 * `env` block of ~/.claude/settings.json (never ANTHROPIC_BASE_URL or
 * ANTHROPIC_AUTH_TOKEN — those are injected into the kimi child process
 * command only, per dispatch() above) and re-probes to confirm auth.
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
 * Tool surface a kimi worker gets when the caller names none. The
 * headless path runs outside this session's supervision, so it fails
 * CLOSED: a caller that forgets to declare its tools gets a read-only
 * worker rather than an unrestricted one.
 */
const DEFAULT_ALLOWED_TOOLS = ['Read', 'Grep', 'Glob'];

/** Mode for ~/.claude/settings.json — it holds an API key after install. */
const SETTINGS_FILE_MODE = 0o600;

/**
 * @param {string} model
 * @returns {boolean}
 */
function isAnthropicTier(model) {
  return ANTHROPIC_TIERS.includes(model);
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
 * @param {{cwd?: string, contractPath?: string|null}} options
 */
function enforceWorkerContract(prompt, options) {
  let contractPath = options.contractPath;
  if (contractPath === undefined) {
    const active = readActiveSkill(options.cwd || process.cwd());
    if (!active) return;
    contractPath = path.join(PLUGIN_ROOT, 'skills', active.skill, 'contract.json');
  }
  if (!contractPath) return;

  const decision = evaluateWorkerPrompt(contractPath, prompt);
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
function buildKimiDispatch({ prompt, taskId, allowedTools }, options = {}) {
  const cwd = options.cwd || process.cwd();
  enforceWorkerContract(prompt, options);
  const safeId = sanitizeTaskId(taskId);

  const promptDir = path.resolve(cwd, '.envoy', 'agent-prompts');
  const outputDir = path.resolve(cwd, '.envoy', 'agent-output');
  fs.mkdirSync(promptDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const promptFile = path.join(promptDir, `${safeId}.md`);
  const outputFile = path.join(outputDir, `${safeId}.md`);

  fs.writeFileSync(promptFile, prompt, 'utf8');

  const tools = normalizeAllowedTools(
    allowedTools === undefined ? DEFAULT_ALLOWED_TOOLS : allowedTools,
  );

  // Fail closed at RUN time, not just build time. `ANTHROPIC_AUTH_TOKEN`
  // below is a variable reference, so an unset/empty MOONSHOT_API_KEY would
  // otherwise start `claude` with an empty token but ANTHROPIC_BASE_URL
  // already pointed at Moonshot — inviting the CLI to fall back on whatever
  // Anthropic credential the machine has and send it to a third party.
  // Building the descriptor stays pure (no env read), so the only gate that
  // matters is this one, and it cannot be skipped by an orchestrator that
  // forgot to call checkKimi() first.
  const keyGuard =
    `if [ -z "\${${KIMI_API_KEY_ENV}:-}" ]; then ` +
    `echo "model-dispatch: ${KIMI_API_KEY_ENV} is not set — refusing to dispatch a kimi worker" >&2; ` +
    `exit 1; fi;`;

  const command = [
    keyGuard,
    `ANTHROPIC_BASE_URL=${shellQuote(KIMI_BASE_URL)}`,
    `ANTHROPIC_AUTH_TOKEN="$${KIMI_API_KEY_ENV}"`,
    `ANTHROPIC_MODEL=${shellQuote(KIMI_MODEL_ID)}`,
    `claude -p --allowed-tools ${shellQuote(tools)}`,
    `< ${shellQuote(promptFile)} > ${shellQuote(outputFile)} 2>&1`,
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
  };
}

/**
 * Turn a (model, prompt, taskId) triple into a dispatchable worker
 * descriptor.
 *
 * @param {{model: string, prompt: string, taskId: string, allowedTools?: string[]|string}} params
 *   allowedTools bounds the worker's tool surface. It is mechanically
 *   enforced only on the kimi path (`claude -p --allowed-tools`). On the
 *   Agent path the Agent tool exposes no per-call tool allowlist, so the
 *   normalized list is returned for documentation/assertion purposes
 *   only — the real bound there remains the `subagent_type`'s own tool
 *   surface plus the PreToolUse[Agent] contract gate. Omitted means
 *   read-only (DEFAULT_ALLOWED_TOOLS).
 * @param {{cwd?: string}} [options] - cwd override for the kimi scratch
 *   directories (.envoy/agent-prompts, .envoy/agent-output); defaults to
 *   process.cwd().
 * @returns {{kind: 'agent', model: string, prompt: string, taskId: string, allowedTools: string}
 *   | {kind: 'bash', command: string, run_in_background: true, description: string,
 *      taskId: string, allowedTools: string, promptFile: string, outputFile: string}}
 */
function dispatch({ model, prompt, taskId, allowedTools } = {}, options = {}) {
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
    return buildKimiDispatch({ prompt, taskId, allowedTools }, options);
  }

  throw new Error(`model-dispatch: unknown model "${model}"`);
}

/**
 * Default auth probe: a minimal POST against Moonshot's Anthropic-compatible
 * messages endpoint, used only to confirm the key is accepted.
 * @param {string} apiKey
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function defaultProbe(apiKey) {
  const res = await fetch(`${KIMI_BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
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
  if (!res.ok) {
    return { ok: false, reason: `unexpected response (HTTP ${res.status})` };
  }
  return { ok: true };
}

/**
 * Cheap, offline answer to "has this machine been set up for Kimi?" —
 * key presence only, no network. Used to label the model menu, so a run
 * that never selects kimi produces zero Moonshot traffic even on a
 * machine where the key IS configured. The real probe (checkKimi) runs
 * when kimi is actually selected.
 * @param {{env?: NodeJS.ProcessEnv}} [options]
 * @returns {boolean}
 */
function isKimiConfigured(options = {}) {
  const env = options.env || process.env;
  const apiKey = env[KIMI_API_KEY_ENV];
  return Boolean(apiKey && String(apiKey).trim());
}

/**
 * Check whether Kimi is usable: MOONSHOT_API_KEY present and the auth
 * probe accepts it. Never throws.
 * @param {{env?: NodeJS.ProcessEnv, probe?: (apiKey: string) => Promise<{ok: boolean, reason?: string}>}} [options]
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function checkKimi(options = {}) {
  const env = options.env || process.env;
  const apiKey = env[KIMI_API_KEY_ENV];

  if (!apiKey || !String(apiKey).trim()) {
    return { ok: false, reason: `${KIMI_API_KEY_ENV} is not set` };
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
 * Write MOONSHOT_API_KEY into the `env` block of ~/.claude/settings.json
 * (creating the file/block if needed) and re-run the auth probe to
 * confirm it works. ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN are never
 * written here — those are injected into the kimi child process command
 * only (see dispatch()) — and are stripped if somehow already present.
 *
 * @param {string} apiKey
 * @param {{settingsPath?: string, probe?: (apiKey: string) => Promise<{ok: boolean, reason?: string}>}} [options]
 * @returns {Promise<{written: true, settingsPath: string, probe: {ok: boolean, reason?: string}}>}
 */
async function installKimi(apiKey, options = {}) {
  if (!apiKey || !String(apiKey).trim()) {
    throw new Error('model-dispatch: installKimi requires a non-empty apiKey');
  }

  const settingsPath = options.settingsPath || path.join(os.homedir(), '.claude', 'settings.json');

  let settings = {};
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

  if (!settings.env || typeof settings.env !== 'object') {
    settings.env = {};
  }
  settings.env[KIMI_API_KEY_ENV] = apiKey;
  delete settings.env.ANTHROPIC_BASE_URL;
  delete settings.env.ANTHROPIC_AUTH_TOKEN;

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const tmpPath = `${settingsPath}.tmp`;
  // The rename gives settings.json the temp file's mode, so set it on
  // the temp file: this file now holds an API key and must not be left
  // world-readable by the ambient umask.
  fs.writeFileSync(tmpPath, `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: 'utf8',
    mode: SETTINGS_FILE_MODE,
  });
  fs.chmodSync(tmpPath, SETTINGS_FILE_MODE);
  // rename() replaces a symlink at settingsPath rather than writing through
  // it. That is deliberate: writing through would push the API key into
  // whatever the link points at — commonly a dotfiles repo, where it could
  // be committed.
  fs.renameSync(tmpPath, settingsPath);

  const probeResult = await checkKimi({
    env: { [KIMI_API_KEY_ENV]: apiKey },
    probe: options.probe,
  });

  return {
    written: true,
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
  DEFAULT_ALLOWED_TOOLS,
  SETTINGS_FILE_MODE,
  isAnthropicTier,
  sanitizeTaskId,
  dispatch,
  isKimiConfigured,
  checkKimi,
  installKimi,
};
