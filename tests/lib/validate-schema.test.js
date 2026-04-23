#!/usr/bin/env node
/**
 * Schema Validator — Test Suite
 *
 * Run: node tests/lib/validate-schema.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const LIB = path.join(__dirname, '..', '..', 'lib');
const SCHEMAS_DIR = path.join(LIB, 'schemas');

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

const { validate, loadSchema, validateFile } = require(path.join(LIB, 'validate-schema'));

section('Schema loading');

test('loadSchema returns a schema object for known name', () => {
  const schema = loadSchema('tasks');
  assert.ok(schema, 'schema should be returned');
  assert.strictEqual(schema.$schemaVersion, '1');
  assert.ok(schema.properties, 'schema should have properties');
});

test('loadSchema throws for unknown schema name', () => {
  assert.throws(() => loadSchema('does-not-exist'), /schema not found/i);
});

section('Required fields');

test('validate passes when all required fields are present', () => {
  const result = validate('tasks', {
    $schemaVersion: '1',
    issueNumber: 23,
    tasks: [{ id: 'task-1', title: 'x', files: [], acceptance: [] }],
  });
  assert.strictEqual(result.valid, true, JSON.stringify(result.errors));
});

test('validate fails when required top-level field is missing', () => {
  const result = validate('tasks', { tasks: [] });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => /issueNumber/.test(e)), 'should flag missing issueNumber');
});

test('validate fails when a task entry is missing required sub-field', () => {
  const result = validate('tasks', {
    $schemaVersion: '1',
    issueNumber: 23,
    tasks: [{ id: 'task-1' }],
  });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => /title/.test(e)));
});

section('Type checks');

test('validate fails when a field has wrong type', () => {
  const result = validate('tasks', {
    $schemaVersion: '1',
    issueNumber: 'not-a-number',
    tasks: [],
  });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => /issueNumber/.test(e) && /number/i.test(e)));
});

test('validate fails when array field is a scalar', () => {
  const result = validate('tasks', {
    $schemaVersion: '1',
    issueNumber: 23,
    tasks: 'not-an-array',
  });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => /tasks/.test(e)));
});

section('Schema version');

test('validate fails when $schemaVersion is missing', () => {
  const result = validate('tasks', { issueNumber: 23, tasks: [] });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => /\$schemaVersion/.test(e)));
});

test('validate fails when $schemaVersion is wrong', () => {
  const result = validate('tasks', {
    $schemaVersion: '99',
    issueNumber: 23,
    tasks: [],
  });
  assert.strictEqual(result.valid, false);
});

section('validateFile');

test('validateFile reads JSON from disk and validates', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-test-'));
  const file = path.join(tmp, 'tasks.json');
  fs.writeFileSync(file, JSON.stringify({
    $schemaVersion: '1',
    issueNumber: 23,
    tasks: [{ id: 't1', title: 'x', files: [], acceptance: [] }],
  }));
  try {
    const result = validateFile('tasks', file);
    assert.strictEqual(result.valid, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('validateFile returns invalid when file does not exist', () => {
  const result = validateFile('tasks', '/tmp/does-not-exist-12345.json');
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => /not found|ENOENT/i.test(e)));
});

test('validateFile returns invalid for malformed JSON', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-test-'));
  const file = path.join(tmp, 'bad.json');
  fs.writeFileSync(file, '{not valid json');
  try {
    const result = validateFile('tasks', file);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => /JSON/i.test(e)));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

section('Known schemas exist on disk');

const expectedSchemas = [
  'tasks',
  'session',
  'handoff-pickup-to-review',
  'handoff-review-to-finalize',
  'finalize-state',
  'search-decision',
  'active-skill',
];

for (const name of expectedSchemas) {
  test(`schema file exists: ${name}.json`, () => {
    const p = path.join(SCHEMAS_DIR, `${name}.json`);
    assert.ok(fs.existsSync(p), `${p} should exist`);
    const schema = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.strictEqual(schema.$schemaVersion, '1', `${name} should declare $schemaVersion: "1"`);
  });
}

// ═══════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════

process.stdout.write(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
