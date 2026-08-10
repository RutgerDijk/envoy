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
 * checkKimi() probes whether Kimi is usable (key present + auth accepted)
 * without ever throwing. installKimi() writes MOONSHOT_API_KEY into the
 * `env` block of ~/.claude/settings.json (never ANTHROPIC_BASE_URL or
 * ANTHROPIC_AUTH_TOKEN — those are injected into the kimi child process
 * command only, per dispatch() above) and re-probes to confirm auth.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

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
 * @param {string} model
 * @returns {boolean}
 */
function isAnthropicTier(model) {
  return ANTHROPIC_TIERS.includes(model);
}

/**
 * Reduce a task id to safe path characters so it cannot escape the
 * .envoy scratch directories (e.g. via "../" segments).
 * @param {string} taskId
 * @returns {string}
 */
function sanitizeTaskId(taskId) {
  const raw = String(taskId == null ? '' : taskId);
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, '-');
  if (!safe || /^\.+$/.test(safe)) {
    throw new Error(`model-dispatch: invalid taskId "${taskId}"`);
  }
  return safe;
}

/**
 * Build the background bash-command descriptor for a kimi worker. The
 * prompt is written to disk and the command reads it via stdin
 * redirection — no prompt text is ever interpolated into the command
 * string itself.
 * @param {{prompt: string, taskId: string}} params
 * @param {{cwd?: string}} [options]
 * @returns {object}
 */
function buildKimiDispatch({ prompt, taskId }, options = {}) {
  const cwd = options.cwd || process.cwd();
  const safeId = sanitizeTaskId(taskId);

  const promptDir = path.resolve(cwd, '.envoy', 'agent-prompts');
  const outputDir = path.resolve(cwd, '.envoy', 'agent-output');
  fs.mkdirSync(promptDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const promptFile = path.join(promptDir, `${safeId}.md`);
  const outputFile = path.join(outputDir, `${safeId}.md`);

  fs.writeFileSync(promptFile, prompt, 'utf8');

  const command = [
    `ANTHROPIC_BASE_URL="${KIMI_BASE_URL}"`,
    `ANTHROPIC_AUTH_TOKEN="$${KIMI_API_KEY_ENV}"`,
    `ANTHROPIC_MODEL="${KIMI_MODEL_ID}"`,
    `claude -p < "${promptFile}" > "${outputFile}" 2>&1`,
  ].join(' ');

  return {
    kind: 'bash',
    command,
    run_in_background: true,
    description: `Kimi worker: ${taskId}`,
    taskId,
    promptFile,
    outputFile,
  };
}

/**
 * Turn a (model, prompt, taskId) triple into a dispatchable worker
 * descriptor.
 *
 * @param {{model: string, prompt: string, taskId: string}} params
 * @param {{cwd?: string}} [options] - cwd override for the kimi scratch
 *   directories (.envoy/agent-prompts, .envoy/agent-output); defaults to
 *   process.cwd().
 * @returns {{kind: 'agent', model: string, prompt: string, taskId: string}
 *   | {kind: 'bash', command: string, run_in_background: true, description: string,
 *      taskId: string, promptFile: string, outputFile: string}}
 */
function dispatch({ model, prompt, taskId } = {}, options = {}) {
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
    };
  }

  if (model === KIMI_TIER) {
    return buildKimiDispatch({ prompt, taskId }, options);
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
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    settings = JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    settings = {};
  }

  if (!settings.env || typeof settings.env !== 'object') {
    settings.env = {};
  }
  settings.env[KIMI_API_KEY_ENV] = apiKey;
  delete settings.env.ANTHROPIC_BASE_URL;
  delete settings.env.ANTHROPIC_AUTH_TOKEN;

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const tmpPath = `${settingsPath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
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
  isAnthropicTier,
  sanitizeTaskId,
  dispatch,
  checkKimi,
  installKimi,
};
