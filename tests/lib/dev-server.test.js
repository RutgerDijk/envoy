#!/usr/bin/env node
/**
 * dev-server — Test Suite.
 *
 * Run: node tests/lib/dev-server.test.js
 *
 * Backs skills/visual-review's Step 1 auto-start logic: detect how to start
 * a target repo's dev server (package.json scripts, with an
 * .envoy/visual.json override), wait for it to become ready, and manage the
 * spawned process's lifecycle.
 *
 * detectStartCommand is pure (fs reads only, fixture dirs, no process
 * spawning). waitForReady is tested against a real scratch HTTP server
 * (more reliable than mocking the http module — matches how this repo
 * favors real-but-scoped integration over deep mocking, see
 * repo-hygiene.test.js's scratch-git-repo pattern). startServer/stopServer
 * are thin process-management wrappers, exercised against a real short-lived
 * child process.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

let passed = 0;
let failed = 0;
const asyncTests = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
  } catch (err) {
    failed++;
    process.stdout.write(`  \x1b[31m✗\x1b[0m ${name}\n    ${err.message}\n`);
  }
}

function testAsync(name, fn) {
  asyncTests.push(async () => {
    try {
      await fn();
      passed++;
      process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
    } catch (err) {
      failed++;
      process.stdout.write(`  \x1b[31m✗\x1b[0m ${name}\n    ${err.message}\n`);
    }
  });
}

const LIB = path.join(__dirname, '..', '..', 'lib');
const {
  detectStartCommand,
  waitForReady,
  startServer,
  stopServer,
} = require(path.join(LIB, 'dev-server'));

const tmpRoots = [];
function makeTmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-server-'));
  tmpRoots.push(d);
  return d;
}

// ---------------------------------------------------------------------------
// detectStartCommand — pure, fixture-based
// ---------------------------------------------------------------------------

test('detectStartCommand: prefers "dev" script over "start" when both exist', () => {
  const dir = makeTmpDir();
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ scripts: { dev: 'vite', start: 'node server.js' } }),
  );
  const result = detectStartCommand(dir);
  assert.deepStrictEqual(result, { command: 'npm run dev', cwd: dir, url: null });
});

test('detectStartCommand: falls back to "start" script when no "dev" script', () => {
  const dir = makeTmpDir();
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ scripts: { start: 'node server.js' } }),
  );
  const result = detectStartCommand(dir);
  assert.deepStrictEqual(result, { command: 'npm run start', cwd: dir, url: null });
});

test('detectStartCommand: returns null when no package.json and no override', () => {
  const dir = makeTmpDir();
  const result = detectStartCommand(dir);
  assert.strictEqual(result, null);
});

test('detectStartCommand: returns null when package.json has no dev/start scripts', () => {
  const dir = makeTmpDir();
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ scripts: { test: 'jest' } }),
  );
  const result = detectStartCommand(dir);
  assert.strictEqual(result, null);
});

test('detectStartCommand: .envoy/visual.json override wins over package.json', () => {
  const dir = makeTmpDir();
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ scripts: { dev: 'vite' } }),
  );
  fs.mkdirSync(path.join(dir, '.envoy'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.envoy', 'visual.json'),
    JSON.stringify({ command: 'npm run custom-dev', url: 'http://localhost:3000', cwd: 'frontend' }),
  );
  const result = detectStartCommand(dir);
  assert.deepStrictEqual(result, {
    command: 'npm run custom-dev',
    cwd: path.join(dir, 'frontend'),
    url: 'http://localhost:3000',
  });
});

test('detectStartCommand: override without cwd defaults cwd to the given dir', () => {
  const dir = makeTmpDir();
  fs.mkdirSync(path.join(dir, '.envoy'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.envoy', 'visual.json'),
    JSON.stringify({ command: 'npm run custom-dev', url: 'http://localhost:3000' }),
  );
  const result = detectStartCommand(dir);
  assert.deepStrictEqual(result, {
    command: 'npm run custom-dev',
    cwd: dir,
    url: 'http://localhost:3000',
  });
});

// ---------------------------------------------------------------------------
// waitForReady — integration-style, real scratch HTTP server
// ---------------------------------------------------------------------------

testAsync('waitForReady: resolves true once the server starts responding', async () => {
  const port = 34567;
  let server;
  const delayMs = 300;
  setTimeout(() => {
    server = http.createServer((req, res) => { res.writeHead(200); res.end('ok'); });
    server.listen(port);
  }, delayMs);

  const ready = await waitForReady(`http://localhost:${port}`, 5000);
  assert.strictEqual(ready, true);
  if (server) await new Promise((resolve) => server.close(resolve));
});

testAsync('waitForReady: resolves false when timeout elapses with nothing listening', async () => {
  const ready = await waitForReady('http://localhost:34568', 300);
  assert.strictEqual(ready, false);
});

// ---------------------------------------------------------------------------
// startServer / stopServer — thin process-management wrappers
// ---------------------------------------------------------------------------

testAsync('startServer: spawns a detached process and returns its pid', async () => {
  const dir = makeTmpDir();
  const child = startServer('sleep 5', dir);
  assert.ok(child.pid > 0);
  stopServer(child.pid);
});

testAsync('stopServer: killing an already-dead pid does not throw', async () => {
  const dir = makeTmpDir();
  const child = startServer('true', dir);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.doesNotThrow(() => stopServer(child.pid));
});

async function main() {
  for (const t of asyncTests) await t();

  for (const d of tmpRoots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }

  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
