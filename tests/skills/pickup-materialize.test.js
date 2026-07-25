#!/usr/bin/env node
/**
 * Pickup preflight — materialize-from-issue + drift warning.
 *
 * Run: node tests/skills/pickup-materialize.test.js
 *
 * When the committed .envoy-tasks/<n>.json is missing, preflight recovers the
 * payload from the issue's embedded block (degraded tier — reconstructed state
 * needs confirmation). When present but the issue block disagrees, it warns
 * (non-fatal). gh is stubbed via ENVOY_ISSUE_BODY_FILE.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

let passed = 0;
let failed = 0;

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

const REPO_ROOT = path.join(__dirname, '..', '..');
const PREFLIGHT = path.join(REPO_ROOT, 'skills', 'pickup', 'preflight.js');
const { renderEmbeddedBlock } = require(path.join(REPO_ROOT, 'lib', 'tasks-embed'));

const tmpRoots = [];
function makeCwd() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pickup-preflight-'));
  tmpRoots.push(d);
  return d;
}

function payload(issueNumber, tasks) {
  return { $schemaVersion: '1', issueNumber, strategy: 'sequential', tasks };
}

const TASKS = [
  { id: 'task-1', title: 'Do the thing', intent: 'because', behavior: ['g/w/t'], files: ['a.js'], acceptance: ['ok'] },
];

// Run preflight in a temp cwd; returns { status, out }.
function runPreflight(cwd, issueNumber, bodyFile) {
  const env = { ...process.env, ENVOY_ISSUE_NUMBER: String(issueNumber), ENVOY_REPO_ROOT: REPO_ROOT };
  if (bodyFile) env.ENVOY_ISSUE_BODY_FILE = bodyFile;
  else env.ENVOY_ISSUE_BODY_FILE = path.join(cwd, '__none__'); // force null (no gh)
  const out = execFileSync('node', [PREFLIGHT], { cwd, env, encoding: 'utf8' });
  const status = (out.match(/## STATUS: (\w+)/) || [])[1];
  return { status, out };
}

test('committed file present → ok, session seeded', () => {
  const cwd = makeCwd();
  fs.mkdirSync(path.join(cwd, '.envoy-tasks'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.envoy-tasks', '77.json'), JSON.stringify(payload(77, TASKS)));
  const { status } = runPreflight(cwd, 77);
  assert.strictEqual(status, 'ok');
  assert.ok(fs.existsSync(path.join(cwd, '.envoy', 'pickup', 'session.json')), 'session seeded');
});

test('file missing + issue has block → materialized at ok, no reconstruction warning', () => {
  const cwd = makeCwd();
  const bodyFile = path.join(cwd, 'body.md');
  fs.writeFileSync(bodyFile, 'Issue text\n' + renderEmbeddedBlock(payload(78, TASKS)));
  const { status, out } = runPreflight(cwd, 78, bodyFile);
  assert.strictEqual(status, 'ok');
  assert.ok(!/reconstructed/i.test(out), 'materializing is the normal path, not a recovery');
  assert.ok(fs.existsSync(path.join(cwd, '.envoy-tasks', '78.json')), 'materialized file written');
});

test('file missing + no recoverable block → fatal', () => {
  const cwd = makeCwd();
  const bodyFile = path.join(cwd, 'body.md');
  fs.writeFileSync(bodyFile, 'Issue text with no embedded block');
  const { status } = runPreflight(cwd, 79, bodyFile);
  assert.strictEqual(status, 'fatal');
});

test('committed file present but issue block disagrees → warns (still ok)', () => {
  const cwd = makeCwd();
  fs.mkdirSync(path.join(cwd, '.envoy-tasks'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.envoy-tasks', '80.json'), JSON.stringify(payload(80, TASKS)));
  const drifted = [{ id: 'task-9', title: 'Different', intent: 'x', behavior: ['y'], files: ['b.js'], acceptance: ['z'] }];
  const bodyFile = path.join(cwd, 'body.md');
  fs.writeFileSync(bodyFile, renderEmbeddedBlock(payload(80, drifted)));
  const { status, out } = runPreflight(cwd, 80, bodyFile);
  assert.strictEqual(status, 'ok');
  assert.ok(/WARNING:.*differs/i.test(out), 'emits a drift warning');
});

for (const d of tmpRoots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
