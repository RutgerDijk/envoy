#!/usr/bin/env node
/**
 * Pickup preflight — Test Command section — Test Suite (#78 task-5).
 *
 * Run: node tests/skills/pickup-preflight.test.js
 *
 * preflight.js resolves the repo's filtered/full test command via
 * lib/test-commands.js's resolveTestCommands() and prints it under a
 * `### Test Command` section so the orchestrator can thread it into the
 * implementer prompt (see skills/pickup/steps/prompts.md).
 *
 * - Resolved: prints the concrete filtered command.
 * - Unresolved: prints an explicit instruction to determine and report
 *   the narrowest command — never a silent full-suite fallback.
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

const tmpRoots = [];
function makeTmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pickup-preflight-'));
  tmpRoots.push(d);
  return d;
}

function writeTasksFile(dir, issueNumber) {
  const tasks = {
    $schemaVersion: '1',
    issueNumber,
    strategy: 'batch',
    tasks: [{ id: 'task-1', title: 'Add feature', files: ['src/foo.ts'], acceptance: ['works'] }],
  };
  fs.mkdirSync(path.join(dir, '.envoy-tasks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.envoy-tasks', `${issueNumber}.json`), JSON.stringify(tasks));
}

function runPreflight(cwd, extraEnv = {}) {
  const env = { ...process.env, ENVOY_REPO_ROOT: REPO_ROOT, ...extraEnv };
  let out;
  try {
    out = execFileSync('node', [PREFLIGHT], { cwd, env, encoding: 'utf8' });
  } catch (err) {
    out = (err.stdout || '') + (err.stderr || '');
  }
  const status = (out.match(/## STATUS: (\w+)/) || [])[1];
  return { status, out };
}

test('resolved test command -> prints ### Test Command section with the filtered command', () => {
  const dir = makeTmpDir();
  writeTasksFile(dir, 30);
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    '# Test project\n\n## Test Command\n\nfiltered: npm test -- -t "{{test}}"\nfull: npm test\n'
  );
  const { status, out } = runPreflight(dir, { ENVOY_ISSUE_NUMBER: '30' });
  assert.strictEqual(status, 'ok');
  assert.ok(/### Test Command/.test(out), 'expected a ### Test Command section');
  assert.ok(out.includes('npm test -- -t "{{test}}"'), 'expected the resolved filtered command in output');
});

test('no resolvable test command -> explicit instruction, never a silent full-suite fallback', () => {
  const dir = makeTmpDir();
  writeTasksFile(dir, 31);
  const { status, out } = runPreflight(dir, { ENVOY_ISSUE_NUMBER: '31' });
  assert.strictEqual(status, 'ok');
  assert.ok(/### Test Command/.test(out), 'expected a ### Test Command section');
  assert.ok(
    /determine.*narrowest|narrowest.*determine/i.test(out),
    'expected explicit instruction to determine and report the narrowest command'
  );
  assert.ok(!/^\s*npm test\s*$/m.test(out), 'must not silently default to a full-suite command');
});

for (const d of tmpRoots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
