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
  dispatch,
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
  assert.ok(result.command.includes(`ANTHROPIC_MODEL="${KIMI_MODEL_ID}"`) || result.command.includes(`ANTHROPIC_MODEL=${KIMI_MODEL_ID}`));
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

test('output is written to .envoy/agent-output/<task-id>.md', () => {
  const cwd = makeTmpDir();
  const result = dispatch({ model: 'kimi', prompt: 'p', taskId: 'task-14' }, { cwd });
  const expected = path.join('.envoy', 'agent-output', 'task-14.md');
  assert.ok(result.outputFile.endsWith(expected));
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

testAsync('short-circuits with ok:false when MOONSHOT_API_KEY is absent, no probe call', async () => {
  let probeCalled = false;
  const result = await checkKimi({ env: {}, probe: async () => { probeCalled = true; return { ok: true }; } });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(typeof result.reason, 'string');
  assert.strictEqual(probeCalled, false);
});

testAsync('short-circuits with ok:false when MOONSHOT_API_KEY is an empty string', async () => {
  let probeCalled = false;
  const result = await checkKimi({ env: { MOONSHOT_API_KEY: '' }, probe: async () => { probeCalled = true; return { ok: true }; } });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(probeCalled, false);
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

testAsync('writes MOONSHOT_API_KEY into the env block of settings.json', async () => {
  const dir = makeTmpDir();
  const settingsPath = path.join(dir, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ env: { SOME_OTHER_VAR: 'keep-me' } }));

  await installKimi('sk-new-key', {
    settingsPath,
    probe: async () => ({ ok: true }),
  });

  const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.strictEqual(written.env.MOONSHOT_API_KEY, 'sk-new-key');
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
    probe: async () => ({ ok: true }),
  });

  const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.strictEqual(written.env.ANTHROPIC_BASE_URL, undefined);
  assert.strictEqual(written.env.ANTHROPIC_AUTH_TOKEN, undefined);
});

testAsync('creates settings.json (and its env block) when the file does not exist yet', async () => {
  const dir = makeTmpDir();
  const settingsPath = path.join(dir, 'nested', 'settings.json');

  await installKimi('sk-fresh-key', {
    settingsPath,
    probe: async () => ({ ok: true }),
  });

  const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.strictEqual(written.env.MOONSHOT_API_KEY, 'sk-fresh-key');
});

testAsync('re-runs the probe after writing to confirm auth', async () => {
  const dir = makeTmpDir();
  const settingsPath = path.join(dir, 'settings.json');
  let probeCalledWithKey = null;

  const result = await installKimi('sk-confirm-key', {
    settingsPath,
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
    probe: async () => ({ ok: false, reason: 'auth rejected (HTTP 401)' }),
  });

  assert.strictEqual(result.probe.ok, false);
  assert.strictEqual(result.probe.reason, 'auth rejected (HTTP 401)');
});

testAsync('throws when apiKey is missing or empty', async () => {
  const dir = makeTmpDir();
  const settingsPath = path.join(dir, 'settings.json');
  await assert.rejects(() => installKimi('', { settingsPath, probe: async () => ({ ok: true }) }));
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
