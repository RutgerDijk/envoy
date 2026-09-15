#!/usr/bin/env node
/**
 * stack-loader — frontend detection — Test Suite.
 *
 * Run: node tests/lib/stack-loader-frontend.test.js
 *
 * Task 13: the review skill's visual layer must be forced on whenever the
 * diff touches frontend-stack files, independent of complexity tier. That
 * requires a pure "is this detected stack a frontend one" predicate,
 * `isFrontendStack`, exported from lib/stack-loader.js alongside the
 * existing `detectStacksFromDiff`. This suite is written before the export
 * exists (RED), per Task 13's TDD requirement.
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

const stackLoader = require(path.join(__dirname, '..', '..', 'lib', 'stack-loader'));

test('exports isFrontendStack', () => {
  assert.strictEqual(typeof stackLoader.isFrontendStack, 'function');
});

test('react is a frontend stack', () => {
  assert.strictEqual(stackLoader.isFrontendStack('react'), true);
});

test('tailwind is a frontend stack', () => {
  assert.strictEqual(stackLoader.isFrontendStack('tailwind'), true);
});

test('shadcn-radix is a frontend stack', () => {
  assert.strictEqual(stackLoader.isFrontendStack('shadcn-radix'), true);
});

test('react-query is a frontend stack', () => {
  assert.strictEqual(stackLoader.isFrontendStack('react-query'), true);
});

test('react-hook-form is a frontend stack', () => {
  assert.strictEqual(stackLoader.isFrontendStack('react-hook-form'), true);
});

test('dotnet is not a frontend stack', () => {
  assert.strictEqual(stackLoader.isFrontendStack('dotnet'), false);
});

test('postgresql is not a frontend stack', () => {
  assert.strictEqual(stackLoader.isFrontendStack('postgresql'), false);
});

test('unknown stack name is not a frontend stack', () => {
  assert.strictEqual(stackLoader.isFrontendStack('made-up-stack'), false);
});

test('typescript alone (tsconfig.json) is not treated as frontend — too broad (backend TS/node also uses it)', () => {
  assert.strictEqual(stackLoader.isFrontendStack('typescript'), false);
});

test('anyFrontendStack: true when detected stacks include a frontend one', () => {
  assert.strictEqual(stackLoader.anyFrontendStack(['dotnet', 'react']), true);
});

test('anyFrontendStack: false when no detected stacks are frontend', () => {
  assert.strictEqual(stackLoader.anyFrontendStack(['dotnet', 'postgresql']), false);
});

test('anyFrontendStack: false on empty array', () => {
  assert.strictEqual(stackLoader.anyFrontendStack([]), false);
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
