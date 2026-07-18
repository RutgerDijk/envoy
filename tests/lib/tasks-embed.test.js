#!/usr/bin/env node
/**
 * Tasks embed/render helpers + spec-field enforcement — Test Suite.
 *
 * Run: node tests/lib/tasks-embed.test.js
 *
 * Single source for the spec-driven task fields (intent/behavior), the human
 * `## Tasks` section rendered from the payload, and the machine-readable block
 * embedded in the issue that pickup can recover from.
 */

const assert = require('assert');
const path = require('path');

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

const LIB = path.join(__dirname, '..', '..', 'lib');
const {
  enforceSpecFields,
  renderTasksSection,
  renderEmbeddedBlock,
  extractEmbeddedBlock,
} = require(path.join(LIB, 'tasks-embed'));
const { validate } = require(path.join(LIB, 'validate-schema'));

const specPayload = {
  $schemaVersion: '1',
  issueNumber: 99,
  strategy: 'sequential',
  tasks: [
    {
      id: 'task-1',
      title: 'Add the widget',
      intent: 'Users need a widget to do the thing.',
      behavior: ['Given no widget, when the page loads, then a widget appears'],
      files: ['src/widget.js'],
      acceptance: ['Widget renders', 'Widget is clickable'],
    },
  ],
};

const oldPayload = {
  $schemaVersion: '1',
  issueNumber: 40,
  strategy: 'sequential',
  tasks: [{ id: 'task-1', title: 'Old task', files: ['a.js'], acceptance: ['works'] }],
};

// ── schema backward compatibility ─────────────────────────────────
test('schema still accepts an old-style payload (no intent/behavior)', () => {
  const r = validate('tasks', oldPayload);
  assert.ok(r.valid, 'old-schema files must remain valid: ' + JSON.stringify(r.errors));
});

test('schema accepts the new spec-driven fields', () => {
  const r = validate('tasks', specPayload);
  assert.ok(r.valid, 'spec payload must validate: ' + JSON.stringify(r.errors));
});

// ── authoring-time enforcement ────────────────────────────────────
test('enforceSpecFields passes when intent+behavior+acceptance present', () => {
  const r = enforceSpecFields(specPayload);
  assert.ok(r.ok, 'should pass: ' + JSON.stringify(r.errors));
});

test('enforceSpecFields rejects a task missing intent', () => {
  const bad = JSON.parse(JSON.stringify(specPayload));
  delete bad.tasks[0].intent;
  const r = enforceSpecFields(bad);
  assert.ok(!r.ok, 'missing intent must fail');
  assert.ok(r.errors.join(' ').includes('intent'), 'error names intent');
});

test('enforceSpecFields rejects a task with empty behavior', () => {
  const bad = JSON.parse(JSON.stringify(specPayload));
  bad.tasks[0].behavior = [];
  const r = enforceSpecFields(bad);
  assert.ok(!r.ok, 'empty behavior must fail');
});

// ── rendering ─────────────────────────────────────────────────────
test('renderTasksSection renders intent + behavior + acceptance', () => {
  const md = renderTasksSection(specPayload);
  assert.ok(md.includes('## Tasks'), 'has a Tasks heading');
  assert.ok(md.includes('Add the widget'), 'includes task title');
  assert.ok(md.includes('Users need a widget'), 'includes intent');
  assert.ok(md.includes('Given no widget'), 'includes behavior');
});

// ── embed roundtrip ───────────────────────────────────────────────
test('extractEmbeddedBlock recovers the payload embedded by renderEmbeddedBlock', () => {
  const body = 'Some issue text\n\n' + renderEmbeddedBlock(specPayload) + '\n\nmore text';
  const recovered = extractEmbeddedBlock(body);
  assert.ok(recovered, 'a payload should be recovered');
  assert.strictEqual(recovered.issueNumber, 99);
  assert.strictEqual(recovered.tasks[0].intent, 'Users need a widget to do the thing.');
});

test('extractEmbeddedBlock returns null when no block present', () => {
  assert.strictEqual(extractEmbeddedBlock('no block here'), null);
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
