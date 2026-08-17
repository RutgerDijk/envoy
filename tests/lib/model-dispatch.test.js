#!/usr/bin/env node
/**
 * model-dispatch — Test Suite.
 *
 * Run: node tests/lib/model-dispatch.test.js
 *
 * Backs per-step worker model selection in pickup and review (#76): one
 * shared mechanism that turns a (task prompt, model choice) pair into a
 * running worker, for both Anthropic Agent-tool dispatch and headless
 * Kimi (Moonshot) background processes.
 *
 * dispatch() for Anthropic tiers is pure (no fs). dispatch() for kimi
 * writes a prompt file to a scratch .envoy directory (never a shell
 * string built from untrusted prompt text — command-injection guard) and
 * is tested against real temp dirs. checkKimi()/installKimi() never hit
 * the network in this suite — a fake `probe` is injected, matching how
 * dev-server.test.js and repo-hygiene.test.js favor real-but-scoped
 * integration over deep mocking.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

let passed = 0;
let failed = 0;
// Sync test(), async testAsync(), and section() headers are all queued in
// file order and drained together in main() — otherwise section() (which
// used to print immediately) would print ahead of any testAsync() results
// declared under it, since those only run once main() awaits them.
const queue = [];

function test(name, fn) {
  queue.push({ type: 'test', name, fn: async () => fn() });
}

function testAsync(name, fn) {
  queue.push({ type: 'test', name, fn });
}

function section(name) {
  queue.push({ type: 'section', name });
}

const LIB = path.join(__dirname, '..', '..', 'lib');
const {
  ANTHROPIC_TIERS,
  KIMI_TIER,
  KIMI_MODEL_ID,
  KIMI_BASE_URL,
  KIMI_API_KEY_ENV,
  DEFAULT_ALLOWED_TOOLS,
  SETTINGS_FILE_MODE,
  sanitizeTaskId,
  dispatch,
  defaultProbe,
  isKimiConfigured,
  checkKimi,
  installKimi,
} = require(path.join(LIB, 'model-dispatch'));

const tmpRoots = [];
function makeTmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'model-dispatch-'));
  tmpRoots.push(d);
  return d;
}

// ---------------------------------------------------------------------------
// dispatch() — Anthropic tiers (fable/opus/sonnet/haiku)
// ---------------------------------------------------------------------------

section('dispatch() — Anthropic tiers');

test('returns an Agent-tool descriptor for a known Anthropic tier', () => {
  const cwd = makeTmpDir();
  const result = dispatch({ model: 'sonnet', prompt: 'do the thing', taskId: 'task-1' }, { cwd });
  assert.strictEqual(result.kind, 'agent');
  assert.strictEqual(result.model, 'sonnet');
  assert.strictEqual(result.prompt, 'do the thing');
  assert.strictEqual(result.taskId, 'task-1');
});

test('carries the prompt unmodified (no wrapping/mutation)', () => {
  const raw = 'Line one.\nLine two with "quotes" and $vars.';
  const result = dispatch({ model: 'opus', prompt: raw, taskId: 'task-2' });
  assert.strictEqual(result.prompt, raw);
});

for (const tier of ['fable', 'opus', 'sonnet', 'haiku']) {
  test(`accepts Anthropic tier "${tier}"`, () => {
    const result = dispatch({ model: tier, prompt: 'p', taskId: 'task-x' });
    assert.strictEqual(result.kind, 'agent');
    assert.strictEqual(result.model, tier);
  });
}

test('exposes the recognized Anthropic tier list', () => {
  assert.deepStrictEqual(ANTHROPIC_TIERS, ['fable', 'opus', 'sonnet', 'haiku']);
});

test('does not touch the filesystem for an Anthropic dispatch', () => {
  const cwd = makeTmpDir();
  dispatch({ model: 'sonnet', prompt: 'p', taskId: 'task-3' }, { cwd });
  assert.strictEqual(fs.existsSync(path.join(cwd, '.envoy')), false);
});

test('throws when model is missing', () => {
  assert.throws(() => dispatch({ prompt: 'p', taskId: 'task-1' }));
});

test('throws when prompt is missing', () => {
  assert.throws(() => dispatch({ model: 'sonnet', taskId: 'task-1' }));
});

test('throws when taskId is missing', () => {
  assert.throws(() => dispatch({ model: 'sonnet', prompt: 'p' }));
});

test('throws on an unrecognized model string', () => {
  assert.throws(() => dispatch({ model: 'gpt-5', prompt: 'p', taskId: 'task-1' }));
});

// ---------------------------------------------------------------------------
// dispatch() — kimi (headless background claude -p)
// ---------------------------------------------------------------------------

section('dispatch() — kimi');

test('returns a background bash command descriptor for kimi', () => {
  const cwd = makeTmpDir();
  const result = dispatch({ model: KIMI_TIER, prompt: 'investigate the bug', taskId: 'task-9' }, { cwd });
  assert.strictEqual(result.kind, 'bash');
  assert.strictEqual(result.run_in_background, true);
  assert.strictEqual(typeof result.command, 'string');
});

test('command sets ANTHROPIC_BASE_URL to the Moonshot Anthropic-compatible endpoint', () => {
  const cwd = makeTmpDir();
  const result = dispatch({ model: 'kimi', prompt: 'p', taskId: 'task-10' }, { cwd });
  assert.ok(result.command.includes(KIMI_BASE_URL));
  assert.strictEqual(KIMI_BASE_URL, 'https://api.moonshot.ai/anthropic');
});

test('command sets ANTHROPIC_MODEL to kimi-k2.5', () => {
  const cwd = makeTmpDir();
  const result = dispatch({ model: 'kimi', prompt: 'p', taskId: 'task-11' }, { cwd });
  assert.ok(new RegExp(`ANTHROPIC_MODEL=["']?${KIMI_MODEL_ID}["']?`).test(result.command));
  assert.strictEqual(KIMI_MODEL_ID, 'kimi-k2.5');
});

test('command sets ANTHROPIC_AUTH_TOKEN from $MOONSHOT_API_KEY, never a literal secret', () => {
  const cwd = makeTmpDir();
  const result = dispatch({ model: 'kimi', prompt: 'p', taskId: 'task-12' }, { cwd });
  assert.ok(result.command.includes('$' + KIMI_API_KEY_ENV));
  assert.strictEqual(KIMI_API_KEY_ENV, 'MOONSHOT_API_KEY');
});

test('command invokes `claude -p`', () => {
  const cwd = makeTmpDir();
  const result = dispatch({ model: 'kimi', prompt: 'p', taskId: 'task-13' }, { cwd });
  assert.ok(/\bclaude -p\b/.test(result.command));
});

test('output is written to a run-unique .md under .envoy/agent-output, named after the task id', () => {
  const cwd = makeTmpDir();
  const result = dispatch({ model: 'kimi', prompt: 'p', taskId: 'task-14' }, { cwd });
  assert.strictEqual(path.dirname(result.outputFile), path.join(cwd, '.envoy', 'agent-output'));
  assert.ok(path.basename(result.outputFile).startsWith('task-14-'));
  assert.ok(result.outputFile.endsWith('.md'));
  assert.ok(result.command.includes(result.outputFile));
});

test('does NOT interpolate the raw prompt text into the command string (injection guard)', () => {
  const cwd = makeTmpDir();
  const dangerous = 'do the task"; rm -rf / #';
  const result = dispatch({ model: 'kimi', prompt: dangerous, taskId: 'task-15' }, { cwd });
  assert.ok(!result.command.includes(dangerous));
  assert.ok(!result.command.includes('rm -rf'));
});

test('writes the prompt content to a file the command reads via redirection', () => {
  const cwd = makeTmpDir();
  const promptText = 'Full task spec.\nWith multiple lines.\nAnd "quotes".';
  const result = dispatch({ model: 'kimi', prompt: promptText, taskId: 'task-16' }, { cwd });
  assert.ok(fs.existsSync(result.promptFile));
  assert.strictEqual(fs.readFileSync(result.promptFile, 'utf8'), promptText);
  assert.ok(result.command.includes(result.promptFile));
});

test('sanitizes a taskId with path-traversal characters so it cannot escape .envoy', () => {
  const cwd = makeTmpDir();
  const result = dispatch({ model: 'kimi', prompt: 'p', taskId: '../../etc/passwd' }, { cwd });
  const envoyRoot = path.join(cwd, '.envoy');
  assert.ok(result.promptFile.startsWith(envoyRoot + path.sep));
  assert.ok(result.outputFile.startsWith(envoyRoot + path.sep));
});

test('writes prompt/output dirs under the provided cwd option, not real process.cwd()', () => {
  const cwd = makeTmpDir();
  const result = dispatch({ model: 'kimi', prompt: 'p', taskId: 'task-18' }, { cwd });
  assert.ok(result.promptFile.startsWith(cwd));
  assert.ok(result.outputFile.startsWith(cwd));
});

test('building a kimi dispatch does not require MOONSHOT_API_KEY to be set', () => {
  const cwd = makeTmpDir();
  const savedKey = process.env.MOONSHOT_API_KEY;
  delete process.env.MOONSHOT_API_KEY;
  try {
    assert.doesNotThrow(() => dispatch({ model: 'kimi', prompt: 'p', taskId: 'task-19' }, { cwd }));
  } finally {
    if (savedKey !== undefined) process.env.MOONSHOT_API_KEY = savedKey;
  }
});

test('kimi dispatch never mutates the parent process env', () => {
  const cwd = makeTmpDir();
  dispatch({ model: 'kimi', prompt: 'p', taskId: 'task-20' }, { cwd });
  assert.strictEqual(process.env.ANTHROPIC_BASE_URL, undefined);
  assert.strictEqual(process.env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.strictEqual(process.env.ANTHROPIC_MODEL, undefined);
});

// ---------------------------------------------------------------------------
// checkKimi() — env presence + injected auth probe (no real network calls)
// ---------------------------------------------------------------------------

section('checkKimi()');

testAsync('short-circuits with ok:false when no key is configured anywhere, no probe call', async () => {
  let probeCalled = false;
  const result = await checkKimi({
    env: {},
    keyFile: path.join(makeTmpDir(), 'no-key-file'),
    probe: async () => { probeCalled = true; return { ok: true }; },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(typeof result.reason, 'string');
  assert.strictEqual(probeCalled, false);
});

testAsync('short-circuits with ok:false when MOONSHOT_API_KEY is an empty string', async () => {
  let probeCalled = false;
  const result = await checkKimi({
    env: { MOONSHOT_API_KEY: '' },
    keyFile: path.join(makeTmpDir(), 'no-key-file'),
    probe: async () => { probeCalled = true; return { ok: true }; },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(probeCalled, false);
});

testAsync('falls back to the key file and probes with its contents', async () => {
  const dir = makeTmpDir();
  const keyFile = path.join(dir, 'moonshot-api-key');
  fs.writeFileSync(keyFile, 'sk-from-file\n');
  const result = await checkKimi({
    env: {},
    keyFile,
    probe: async (key) => {
      assert.strictEqual(key, 'sk-from-file');
      return { ok: true };
    },
  });
  assert.strictEqual(result.ok, true);
});

testAsync('the env var wins over the key file when both are present', async () => {
  const dir = makeTmpDir();
  const keyFile = path.join(dir, 'moonshot-api-key');
  fs.writeFileSync(keyFile, 'sk-from-file');
  const result = await checkKimi({
    env: { MOONSHOT_API_KEY: 'sk-from-env' },
    keyFile,
    probe: async (key) => {
      assert.strictEqual(key, 'sk-from-env');
      return { ok: true };
    },
  });
  assert.strictEqual(result.ok, true);
});

testAsync('returns ok:true when the key is set and the probe succeeds', async () => {
  const result = await checkKimi({
    env: { MOONSHOT_API_KEY: 'sk-test-key' },
    probe: async (key) => {
      assert.strictEqual(key, 'sk-test-key');
      return { ok: true };
    },
  });
  assert.strictEqual(result.ok, true);
});

testAsync('returns ok:false with a reason when the probe reports failed auth', async () => {
  const result = await checkKimi({
    env: { MOONSHOT_API_KEY: 'sk-bad-key' },
    probe: async () => ({ ok: false, reason: 'auth rejected (HTTP 401)' }),
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'auth rejected (HTTP 401)');
});

testAsync('does not throw when the probe throws/rejects', async () => {
  const result = await checkKimi({
    env: { MOONSHOT_API_KEY: 'sk-test-key' },
    probe: async () => { throw new Error('network unreachable'); },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.reason.includes('network unreachable'));
});

// ---------------------------------------------------------------------------
// installKimi() — writes MOONSHOT_API_KEY into settings.json env block
// ---------------------------------------------------------------------------

section('installKimi()');

testAsync('writes the key to a 0600 key file, never into the settings env block', async () => {
  const dir = makeTmpDir();
  const settingsPath = path.join(dir, 'settings.json');
  const keyFile = path.join(dir, 'moonshot-api-key');
  fs.writeFileSync(settingsPath, JSON.stringify({ env: { SOME_OTHER_VAR: 'keep-me' } }));

  await installKimi('sk-new-key', {
    settingsPath,
    keyFile,
    probe: async () => ({ ok: true }),
  });

  assert.strictEqual(fs.readFileSync(keyFile, 'utf8').trim(), 'sk-new-key');
  assert.strictEqual(fs.statSync(keyFile).mode & 0o077, 0, 'the key file must be owner-only');
  const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.strictEqual(written.env.MOONSHOT_API_KEY, undefined,
    'the settings env block exports to EVERY subprocess — the key must not live there');
  assert.strictEqual(written.env.SOME_OTHER_VAR, 'keep-me');
});

testAsync('migrates a key out of the settings env block on install', async () => {
  const dir = makeTmpDir();
  const settingsPath = path.join(dir, 'settings.json');
  const keyFile = path.join(dir, 'moonshot-api-key');
  fs.writeFileSync(settingsPath, JSON.stringify({ env: { MOONSHOT_API_KEY: 'sk-old', SOME_OTHER_VAR: 'keep-me' } }));

  await installKimi('sk-new-key', { settingsPath, keyFile, probe: async () => ({ ok: true }) });

  const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.strictEqual(written.env.MOONSHOT_API_KEY, undefined);
  assert.strictEqual(written.env.SOME_OTHER_VAR, 'keep-me');
});

testAsync('never writes ANTHROPIC_BASE_URL or ANTHROPIC_AUTH_TOKEN into settings.json', async () => {
  const dir = makeTmpDir();
  const settingsPath = path.join(dir, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({
    env: { ANTHROPIC_BASE_URL: 'stale', ANTHROPIC_AUTH_TOKEN: 'stale-token' },
  }));

  await installKimi('sk-new-key', {
    settingsPath,
    keyFile: path.join(dir, 'moonshot-api-key'),
    probe: async () => ({ ok: true }),
  });

  const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.strictEqual(written.env.ANTHROPIC_BASE_URL, undefined);
  assert.strictEqual(written.env.ANTHROPIC_AUTH_TOKEN, undefined);
});

testAsync('does not create settings.json when it is absent — the key file is the only write', async () => {
  const dir = makeTmpDir();
  const settingsPath = path.join(dir, 'nested', 'settings.json');
  const keyFile = path.join(dir, 'nested', 'moonshot-api-key');

  await installKimi('sk-fresh-key', {
    settingsPath,
    keyFile,
    probe: async () => ({ ok: true }),
  });

  assert.strictEqual(fs.existsSync(settingsPath), false);
  assert.strictEqual(fs.readFileSync(keyFile, 'utf8').trim(), 'sk-fresh-key');
});

testAsync('re-runs the probe after writing to confirm auth', async () => {
  const dir = makeTmpDir();
  const settingsPath = path.join(dir, 'settings.json');
  let probeCalledWithKey = null;

  const result = await installKimi('sk-confirm-key', {
    settingsPath,
    keyFile: path.join(dir, 'moonshot-api-key'),
    probe: async (key) => { probeCalledWithKey = key; return { ok: true }; },
  });

  assert.strictEqual(probeCalledWithKey, 'sk-confirm-key');
  assert.strictEqual(result.probe.ok, true);
});

testAsync('surfaces probe failure after install without throwing', async () => {
  const dir = makeTmpDir();
  const settingsPath = path.join(dir, 'settings.json');

  const result = await installKimi('sk-bad-key', {
    settingsPath,
    keyFile: path.join(dir, 'moonshot-api-key'),
    probe: async () => ({ ok: false, reason: 'auth rejected (HTTP 401)' }),
  });

  assert.strictEqual(result.probe.ok, false);
  assert.strictEqual(result.probe.reason, 'auth rejected (HTTP 401)');
});

testAsync('throws when apiKey is missing or empty', async () => {
  const dir = makeTmpDir();
  const settingsPath = path.join(dir, 'settings.json');
  await assert.rejects(() => installKimi('', {
    settingsPath,
    keyFile: path.join(dir, 'moonshot-api-key'),
    probe: async () => ({ ok: true }),
  }));
});

testAsync('leaves a rewritten settings.json readable only by its owner', async () => {
  const dir = makeTmpDir();
  const settingsPath = path.join(dir, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ env: { MOONSHOT_API_KEY: 'sk-old' } }), { mode: 0o644 });

  await installKimi('sk-secret-key', {
    settingsPath,
    keyFile: path.join(dir, 'moonshot-api-key'),
    probe: async () => ({ ok: true }),
  });

  const mode = fs.statSync(settingsPath).mode & 0o777;
  assert.strictEqual(mode, SETTINGS_FILE_MODE);
  assert.strictEqual(mode & 0o077, 0, 'group/other must have no access to the settings file');
});

testAsync('refuses to clobber a settings.json that is not valid JSON', async () => {
  const dir = makeTmpDir();
  const settingsPath = path.join(dir, 'settings.json');
  const corrupt = '{ "env": { "SOME_OTHER_VAR": "keep-me" ';
  fs.writeFileSync(settingsPath, corrupt);

  await assert.rejects(
    () => installKimi('sk-key', {
      settingsPath,
      keyFile: path.join(dir, 'moonshot-api-key'),
      probe: async () => ({ ok: true }),
    }),
    /not valid JSON/,
  );
  assert.strictEqual(fs.readFileSync(settingsPath, 'utf8'), corrupt, 'the unparseable file must be left untouched');
});

testAsync('refuses to clobber a settings.json whose top level is not an object', async () => {
  const dir = makeTmpDir();
  const settingsPath = path.join(dir, 'settings.json');
  fs.writeFileSync(settingsPath, '[1, 2, 3]');

  await assert.rejects(
    () => installKimi('sk-key', {
      settingsPath,
      keyFile: path.join(dir, 'moonshot-api-key'),
      probe: async () => ({ ok: true }),
    }),
    /does not contain a JSON object/,
  );
});

// ---------------------------------------------------------------------------
// Tool scoping — the kimi worker runs unsupervised, so its tool surface is
// bounded by the command, not just by prompt text.
// ---------------------------------------------------------------------------

section('tool scoping');

test('kimi command passes --allowed-tools so the headless worker is mechanically bounded', () => {
  const cwd = makeTmpDir();
  const result = dispatch(
    { model: 'kimi', prompt: 'p', taskId: 'task-21', allowedTools: ['Read', 'Grep', 'Glob'] },
    { cwd },
  );
  assert.ok(result.command.includes('--allowed-tools'));
  assert.ok(result.command.includes('Read,Grep,Glob'));
  assert.strictEqual(result.allowedTools, 'Read,Grep,Glob');
});

test('omitting allowedTools fails CLOSED — the worker is read-only, not unrestricted', () => {
  const cwd = makeTmpDir();
  const result = dispatch({ model: 'kimi', prompt: 'p', taskId: 'task-22' }, { cwd });
  assert.strictEqual(result.allowedTools, DEFAULT_ALLOWED_TOOLS.join(','));
  for (const writable of ['Edit', 'Write', 'Bash']) {
    assert.ok(!result.allowedTools.split(',').includes(writable), `${writable} must not be granted by default`);
  }
});

test('the Agent path carries the same tool surface for the caller to apply', () => {
  const result = dispatch({ model: 'sonnet', prompt: 'p', taskId: 'task-24', allowedTools: ['Read', 'Grep', 'Glob'] });
  assert.strictEqual(result.kind, 'agent');
  assert.strictEqual(result.allowedTools, 'Read,Grep,Glob');
});

test('a malformed tool spec is rejected rather than injected into the command', () => {
  const cwd = makeTmpDir();
  assert.throws(
    () => dispatch({ model: 'kimi', prompt: 'p', taskId: 'task-25', allowedTools: ['Read; rm -rf /'] }, { cwd }),
    /invalid tool spec/,
  );
  assert.throws(
    () => dispatch({ model: 'kimi', prompt: 'p', taskId: 'task-26', allowedTools: [] }, { cwd }),
    /at least one tool/,
  );
});

// ---------------------------------------------------------------------------
// Shell-quoting and task-id collisions
// ---------------------------------------------------------------------------

section('command construction hardening');

test('a cwd containing shell metacharacters cannot break out of the command', () => {
  const parent = makeTmpDir();
  const canary = path.join(parent, 'pwned');
  const cwd = path.join(parent, `weird $(touch ${canary}) 'dir'`);
  fs.mkdirSync(cwd, { recursive: true });

  const result = dispatch({ model: 'kimi', prompt: 'hello', taskId: 'task-27' }, { cwd });

  // Run the command through a real shell with `claude` shadowed by a stub
  // that copies stdin to stdout — if quoting were broken, the directory
  // name's command substitution would execute and drop the canary file.
  const binDir = path.join(parent, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'claude'), '#!/bin/sh\ncat\n', { mode: 0o755 });
  execFileSync('/bin/sh', ['-c', result.command], {
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, MOONSHOT_API_KEY: 'sk-test' },
  });

  assert.ok(!fs.existsSync(canary), 'command substitution in a path must never execute');
  assert.strictEqual(fs.readFileSync(result.outputFile, 'utf8').trim(), 'hello');
});

test('the dispatched command refuses to run when no key is configured anywhere (fails closed)', () => {
  const parent = makeTmpDir();
  const cwd = path.join(parent, 'repo');
  fs.mkdirSync(cwd, { recursive: true });
  const canary = path.join(parent, 'claude-ran');

  const result = dispatch(
    { model: 'kimi', prompt: 'hello', taskId: 'task-28' },
    { cwd, keyFile: path.join(parent, 'no-key-file') },
  );

  // Stub `claude` so we can prove it is never reached: without the guard,
  // an empty MOONSHOT_API_KEY would still start the CLI with
  // ANTHROPIC_BASE_URL already pointed at Moonshot.
  const binDir = path.join(parent, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'claude'), `#!/bin/sh\ntouch ${canary}\ncat\n`, { mode: 0o755 });

  const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}` };
  delete env.MOONSHOT_API_KEY;

  let status = 0;
  try {
    execFileSync('/bin/sh', ['-c', result.command], { env, stdio: 'pipe' });
  } catch (err) {
    status = err.status;
  }

  assert.strictEqual(status, 1, 'a kimi dispatch with no key must exit non-zero');
  assert.ok(!fs.existsSync(canary), '`claude` must never be reached without a key');
});

test('the dispatched command still runs when MOONSHOT_API_KEY is present', () => {
  const parent = makeTmpDir();
  const cwd = path.join(parent, 'repo');
  fs.mkdirSync(cwd, { recursive: true });

  const result = dispatch({ model: 'kimi', prompt: 'hello', taskId: 'task-29' }, { cwd });

  const binDir = path.join(parent, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'claude'), '#!/bin/sh\ncat\n', { mode: 0o755 });

  execFileSync('/bin/sh', ['-c', result.command], {
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, MOONSHOT_API_KEY: 'sk-test' },
  });

  assert.strictEqual(fs.readFileSync(result.outputFile, 'utf8').trim(), 'hello');
});

test('the dispatched command resolves the key from the key file when the env var is unset', () => {
  const parent = makeTmpDir();
  const cwd = path.join(parent, 'repo');
  fs.mkdirSync(cwd, { recursive: true });
  const keyFile = path.join(parent, 'moonshot-api-key');
  fs.writeFileSync(keyFile, 'sk-file-key\n', { mode: 0o600 });

  const result = dispatch({ model: 'kimi', prompt: 'hello', taskId: 'task-29b' }, { cwd, keyFile });

  const binDir = path.join(parent, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'claude'), '#!/bin/sh\necho "token=$ANTHROPIC_AUTH_TOKEN"\ncat > /dev/null\n', { mode: 0o755 });

  const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}` };
  delete env.MOONSHOT_API_KEY;
  execFileSync('/bin/sh', ['-c', result.command], { env });

  assert.strictEqual(fs.readFileSync(result.outputFile, 'utf8').trim(), 'token=sk-file-key');
});

test('task ids that sanitize to the same string do not collide on disk', () => {
  assert.strictEqual(sanitizeTaskId('task-1'), 'task-1', 'already-safe ids stay verbatim');
  assert.notStrictEqual(sanitizeTaskId('task/1'), sanitizeTaskId('task-1'));
  assert.notStrictEqual(sanitizeTaskId('a b'), sanitizeTaskId('a-b'));
});

// ---------------------------------------------------------------------------
// Kimi child hardening — the worker env is an allowlist, its tool set is a
// hard bound, and a runaway worker is stopped by budget and wall clock.
// ---------------------------------------------------------------------------

section('kimi child hardening');

function stubClaude(parent, script) {
  const binDir = path.join(parent, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'claude'), script, { mode: 0o755 });
  return binDir;
}

test('the child env is built with env -i — an allowlist, not inherited-minus-blocklist', () => {
  const cwd = makeTmpDir();
  const result = dispatch({ model: 'kimi', prompt: 'p', taskId: 'task-30' }, { cwd });
  assert.ok(/\benv -i\b/.test(result.command), 'command must start the child via env -i');
});

test('the child never sees parent credentials — only allowlisted vars survive', () => {
  const parent = makeTmpDir();
  const cwd = path.join(parent, 'repo');
  fs.mkdirSync(cwd, { recursive: true });
  const result = dispatch({ model: 'kimi', prompt: 'hello', taskId: 'task-31' }, { cwd });

  const binDir = stubClaude(parent, '#!/bin/sh\nenv\ncat > /dev/null\n');
  execFileSync('/bin/sh', ['-c', result.command], {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      MOONSHOT_API_KEY: 'sk-moon',
      ANTHROPIC_API_KEY: 'sk-ant-real-key',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_USE_VERTEX: '1',
      SECRET_CANARY: 'must-not-leak',
      HTTPS_PROXY: 'http://proxy.example:8080',
    },
  });

  const childEnv = fs.readFileSync(result.outputFile, 'utf8');
  assert.ok(!childEnv.includes('sk-ant-real-key'), 'ANTHROPIC_API_KEY must not reach the child');
  assert.ok(!childEnv.includes('CLAUDE_CODE_USE_BEDROCK'), 'Bedrock routing must not reach the child');
  assert.ok(!childEnv.includes('CLAUDE_CODE_USE_VERTEX'), 'Vertex routing must not reach the child');
  assert.ok(!childEnv.includes('must-not-leak'), 'arbitrary parent vars must not reach the child');
  assert.ok(childEnv.includes(`ANTHROPIC_AUTH_TOKEN=sk-moon`), 'the Moonshot key must reach the child as ANTHROPIC_AUTH_TOKEN');
  assert.ok(childEnv.includes(`ANTHROPIC_BASE_URL=${KIMI_BASE_URL}`));
  assert.ok(/^PATH=/m.test(childEnv), 'PATH must survive');
  assert.ok(/^HOME=/m.test(childEnv), 'HOME must survive');
  assert.ok(childEnv.includes('HTTPS_PROXY=http://proxy.example:8080'), 'proxy config must pass through');
});

test('the child tool set is hard-bounded with --tools, not just pre-approved with --allowed-tools', () => {
  const cwd = makeTmpDir();
  const result = dispatch(
    { model: 'kimi', prompt: 'p', taskId: 'task-32', allowedTools: ['Read', 'Grep'] },
    { cwd },
  );
  assert.ok(result.command.includes('--tools'), 'command must pass --tools');
  assert.ok(/--tools\s+'Read,Grep'/.test(result.command), '--tools must carry the same list as --allowed-tools');
});

test('the child gets no MCP servers (--strict-mcp-config with no --mcp-config)', () => {
  const cwd = makeTmpDir();
  const result = dispatch({ model: 'kimi', prompt: 'p', taskId: 'task-33' }, { cwd });
  assert.ok(result.command.includes('--strict-mcp-config'));
  assert.ok(!result.command.includes('--mcp-config '), 'no MCP config may be supplied');
});

test('the worker is capped by --max-budget-usd with a sensible default', () => {
  const cwd = makeTmpDir();
  const result = dispatch({ model: 'kimi', prompt: 'p', taskId: 'task-34' }, { cwd });
  assert.ok(result.command.includes('--max-budget-usd'), 'command must pass --max-budget-usd');
});

test('a caller can override the budget cap', () => {
  const cwd = makeTmpDir();
  const result = dispatch(
    { model: 'kimi', prompt: 'p', taskId: 'task-35', maxBudgetUsd: 2 },
    { cwd },
  );
  assert.ok(/--max-budget-usd\s+'2'/.test(result.command));
});

test('a hung worker is killed by the wall-clock watchdog', () => {
  const parent = makeTmpDir();
  const cwd = path.join(parent, 'repo');
  fs.mkdirSync(cwd, { recursive: true });
  const result = dispatch(
    { model: 'kimi', prompt: 'p', taskId: 'task-36', timeoutSeconds: 1 },
    { cwd },
  );

  const binDir = stubClaude(parent, '#!/bin/sh\nsleep 30\n');
  const started = Date.now();
  let status = 0;
  try {
    execFileSync('/bin/sh', ['-c', result.command], {
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, MOONSHOT_API_KEY: 'sk-test' },
      stdio: 'pipe',
      timeout: 15000,
    });
  } catch (err) {
    status = err.status;
  }
  const elapsed = Date.now() - started;
  assert.notStrictEqual(status, 0, 'a timed-out worker must exit non-zero');
  assert.ok(elapsed < 10000, `watchdog must fire near the timeout, took ${elapsed}ms`);
});

test('the watchdog default appears in the command without a caller override', () => {
  const cwd = makeTmpDir();
  const result = dispatch({ model: 'kimi', prompt: 'p', taskId: 'task-37' }, { cwd });
  assert.ok(/sleep\s+'?1800'?/.test(result.command), 'default wall-clock bound must be 1800s');
});

test('the prompt file is not group/other readable (it carries issue and diff text)', () => {
  const cwd = makeTmpDir();
  const result = dispatch({ model: 'kimi', prompt: 'secret spec', taskId: 'task-38' }, { cwd });
  assert.strictEqual(fs.statSync(result.promptFile).mode & 0o077, 0);
});

test('the output file is precreated without group/other access', () => {
  const cwd = makeTmpDir();
  const result = dispatch({ model: 'kimi', prompt: 'p', taskId: 'task-39' }, { cwd });
  assert.ok(fs.existsSync(result.outputFile), 'output file must be precreated to pin its mode');
  assert.strictEqual(fs.statSync(result.outputFile).mode & 0o077, 0);
});

test('two dispatches of the same taskId never share prompt/output files (concurrent runs)', () => {
  const cwd = makeTmpDir();
  const a = dispatch({ model: 'kimi', prompt: 'run A', taskId: 'ai-review' }, { cwd });
  const b = dispatch({ model: 'kimi', prompt: 'run B', taskId: 'ai-review' }, { cwd });
  assert.notStrictEqual(a.promptFile, b.promptFile);
  assert.notStrictEqual(a.outputFile, b.outputFile);
  assert.strictEqual(fs.readFileSync(a.promptFile, 'utf8'), 'run A');
  assert.strictEqual(fs.readFileSync(b.promptFile, 'utf8'), 'run B');
});

// ---------------------------------------------------------------------------
// defaultProbe() — must exercise the same transport the dispatched child
// uses, so a passing probe actually predicts a working dispatch.
// ---------------------------------------------------------------------------

section('defaultProbe()');

async function withFetchStub(stub, fn) {
  const saved = global.fetch;
  global.fetch = stub;
  try {
    return await fn();
  } finally {
    global.fetch = saved;
  }
}

testAsync('authenticates like the child: Authorization Bearer, never x-api-key', async () => {
  let seen = null;
  await withFetchStub(async (url, init) => {
    seen = { url, headers: init.headers };
    return { ok: true, status: 200 };
  }, () => defaultProbe('sk-probe-key'));

  assert.ok(seen, 'probe must call fetch');
  assert.strictEqual(seen.headers.authorization, 'Bearer sk-probe-key');
  assert.strictEqual(seen.headers['x-api-key'], undefined,
    'x-api-key is not the transport the dispatched child uses');
});

testAsync('probes with the exact model id the dispatch will use', async () => {
  let body = null;
  await withFetchStub(async (url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, status: 200 };
  }, () => defaultProbe('sk-probe-key'));

  assert.strictEqual(body.model, KIMI_MODEL_ID);
});

testAsync('surfaces an unknown model id by name instead of a bare HTTP status', async () => {
  const result = await withFetchStub(async () => ({
    ok: false,
    status: 404,
    json: async () => ({ error: { type: 'not_found_error', message: 'model not found' } }),
  }), () => defaultProbe('sk-probe-key'));

  assert.strictEqual(result.ok, false);
  assert.ok(result.reason.includes(KIMI_MODEL_ID),
    `a model-id failure must name the id, got: ${result.reason}`);
});

testAsync('still reports auth rejection distinctly', async () => {
  const result = await withFetchStub(async () => ({ ok: false, status: 401 }),
    () => defaultProbe('sk-bad'));
  assert.strictEqual(result.ok, false);
  assert.ok(/auth rejected/.test(result.reason));
});

// ---------------------------------------------------------------------------
// isKimiConfigured() — offline label check, no Moonshot traffic
// ---------------------------------------------------------------------------

section('isKimiConfigured()');

test('reports configured/unconfigured offline, with no network call', () => {
  const missing = path.join(makeTmpDir(), 'no-key-file');
  assert.strictEqual(isKimiConfigured({ env: {}, keyFile: missing }), false);
  assert.strictEqual(isKimiConfigured({ env: { MOONSHOT_API_KEY: '   ' }, keyFile: missing }), false);
  assert.strictEqual(isKimiConfigured({ env: { MOONSHOT_API_KEY: 'sk-key' }, keyFile: missing }), true);
});

test('is synchronous — a menu label can never await a Moonshot round-trip', () => {
  const result = isKimiConfigured({ env: { MOONSHOT_API_KEY: 'sk-key' }, keyFile: path.join(makeTmpDir(), 'none') });
  assert.strictEqual(typeof result, 'boolean');
  assert.ok(!(result instanceof Promise));
});

test('reads the key file when the env var is absent', () => {
  const dir = makeTmpDir();
  const keyFile = path.join(dir, 'moonshot-api-key');
  fs.writeFileSync(keyFile, 'sk-from-file\n');
  assert.strictEqual(isKimiConfigured({ env: {}, keyFile }), true);
  assert.strictEqual(isKimiConfigured({ env: {}, keyFile: path.join(dir, 'other') }), false);
});

async function main() {
  for (const item of queue) {
    if (item.type === 'section') {
      process.stdout.write(`\n${item.name}\n`);
      continue;
    }
    try {
      await item.fn();
      passed++;
      process.stdout.write(`  \x1b[32m✓\x1b[0m ${item.name}\n`);
    } catch (err) {
      failed++;
      process.stdout.write(`  \x1b[31m✗\x1b[0m ${item.name}\n    ${err.message}\n`);
    }
  }

  for (const d of tmpRoots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }

  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
