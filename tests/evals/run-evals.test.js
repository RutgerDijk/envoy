#!/usr/bin/env node
/**
 * run-evals harness — Test Suite
 *
 * Run: node tests/evals/run-evals.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const HARNESS = path.join(__dirname, 'run-evals.js');
const REPO_ROOT = path.join(__dirname, '..', '..');

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

function section(name) {
  process.stdout.write(`\n\x1b[1m${name}\x1b[0m\n`);
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'run-evals-test-'));
}

const harness = require(HARNESS);

section('Scenario schema + loading');

test('loadScenarios loads a valid scenarios.json', () => {
  const tmp = mkTmp();
  fs.writeFileSync(path.join(tmp, 'scenarios.json'), JSON.stringify({
    skill: 'demo',
    scenarios: [
      { name: 's1', expected: { status: 'ok' } },
    ],
  }));
  const data = harness.loadScenarios(path.join(tmp, 'scenarios.json'));
  assert.strictEqual(data.skill, 'demo');
  assert.strictEqual(data.scenarios.length, 1);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('loadScenarios throws on missing file', () => {
  assert.throws(() => harness.loadScenarios('/tmp/nope-12345.json'), /not found/i);
});

test('loadScenarios throws on malformed JSON', () => {
  const tmp = mkTmp();
  fs.writeFileSync(path.join(tmp, 'scenarios.json'), '{bad');
  assert.throws(() => harness.loadScenarios(path.join(tmp, 'scenarios.json')), /JSON/i);
  fs.rmSync(tmp, { recursive: true, force: true });
});

section('PENDING when preflight script missing');

test('runScenario returns pending when preflight.js does not exist', () => {
  const tmp = mkTmp();
  const result = harness.runScenario({
    skill: 'nonexistent-skill',
    scenario: { name: 'x', expected: { status: 'ok' } },
    repoRoot: tmp,
  });
  assert.strictEqual(result.status, 'pending');
  assert.ok(/preflight\.js not found/i.test(result.message));
  fs.rmSync(tmp, { recursive: true, force: true });
});

section('Scenario setup: file creation');

test('applySetup writes files in the sandbox', () => {
  const tmp = mkTmp();
  harness.applySetup(tmp, {
    files: {
      'foo/bar.txt': 'hello',
      '.envoy-tasks/23.json': '{"$schemaVersion":"1"}',
    },
  });
  assert.ok(fs.existsSync(path.join(tmp, 'foo/bar.txt')));
  assert.strictEqual(fs.readFileSync(path.join(tmp, 'foo/bar.txt'), 'utf8'), 'hello');
  assert.ok(fs.existsSync(path.join(tmp, '.envoy-tasks/23.json')));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('applySetup with null value means the file must not exist (no-op)', () => {
  const tmp = mkTmp();
  harness.applySetup(tmp, {
    files: { 'missing.json': null },
  });
  assert.ok(!fs.existsSync(path.join(tmp, 'missing.json')));
  fs.rmSync(tmp, { recursive: true, force: true });
});

section('Expected assertions');

test('assertStatus passes when expected matches actual', () => {
  const r = harness.assertExpected(
    { status: 'ok', stdout: '## STATUS: ok\nbriefing', artifacts_created: [] },
    { status: 'ok' },
    '/tmp/x'
  );
  assert.strictEqual(r.passed, true);
});

test('assertStatus fails when expected != actual', () => {
  const r = harness.assertExpected(
    { status: 'fatal', stdout: '## STATUS: fatal\n...', artifacts_created: [] },
    { status: 'ok' },
    '/tmp/x'
  );
  assert.strictEqual(r.passed, false);
  assert.ok(/status/i.test(r.errors.join('\n')));
});

test('assertArtifactsCreated passes when path exists in sandbox', () => {
  const tmp = mkTmp();
  fs.writeFileSync(path.join(tmp, 'out.json'), '{}');
  const r = harness.assertExpected(
    { status: 'ok', stdout: '', artifacts_created: [] },
    { status: 'ok', artifacts_created: ['out.json'] },
    tmp
  );
  assert.strictEqual(r.passed, true, JSON.stringify(r.errors));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('assertArtifactsCreated fails when path missing', () => {
  const tmp = mkTmp();
  const r = harness.assertExpected(
    { status: 'ok', stdout: '', artifacts_created: [] },
    { status: 'ok', artifacts_created: ['missing.json'] },
    tmp
  );
  assert.strictEqual(r.passed, false);
  assert.ok(/missing\.json/.test(r.errors.join('\n')));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('stdout_matches regex passes when stdout contains match', () => {
  const r = harness.assertExpected(
    { status: 'fatal', stdout: '## STATUS: fatal\ntasks file not found', artifacts_created: [] },
    { status: 'fatal', stdout_matches: 'tasks file not found' },
    '/tmp/x'
  );
  assert.strictEqual(r.passed, true);
});

test('stdout_matches fails when pattern not in stdout', () => {
  const r = harness.assertExpected(
    { status: 'ok', stdout: 'ok here', artifacts_created: [] },
    { status: 'ok', stdout_matches: 'not here' },
    '/tmp/x'
  );
  assert.strictEqual(r.passed, false);
});

section('Status banner parsing');

test('parseStatus extracts status from preflight stdout', () => {
  assert.strictEqual(harness.parseStatus('## STATUS: ok\nbriefing'), 'ok');
  assert.strictEqual(harness.parseStatus('## STATUS: degraded\n'), 'degraded');
  assert.strictEqual(harness.parseStatus('## STATUS: fatal'), 'fatal');
  assert.strictEqual(harness.parseStatus('no banner'), null);
});

section('Known scenario files exist');

const rigidSkills = ['review', 'pickup', 'finalize', 'fix-ci', 'coderabbit-pr-review', 'wiki-sync'];
for (const skill of rigidSkills) {
  test(`scenarios file exists for ${skill}`, () => {
    const p = path.join(__dirname, skill, 'scenarios.json');
    assert.ok(fs.existsSync(p), `${p} should exist`);
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.strictEqual(data.skill, skill);
    assert.ok(Array.isArray(data.scenarios));
    assert.ok(data.scenarios.length >= 3, `${skill} should have >= 3 scenarios, found ${data.scenarios.length}`);
    for (const s of data.scenarios) {
      assert.ok(s.name, `scenario missing name in ${skill}`);
      assert.ok(s.expected, `scenario ${s.name} missing expected`);
      assert.ok(['ok', 'degraded', 'fatal'].includes(s.expected.status),
        `scenario ${skill}:${s.name} has invalid expected.status`);
    }
  });
}

process.stdout.write(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
