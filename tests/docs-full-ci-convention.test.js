#!/usr/bin/env node
/**
 * full-ci convention doc — contract test.
 *
 * Run: node tests/docs-full-ci-convention.test.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const docPath = path.join(__dirname, '..', 'docs', 'full-ci-convention.md');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
}

console.log('docs/full-ci-convention.md');
test('doc exists', () => assert.ok(fs.existsSync(docPath)));
const doc = fs.existsSync(docPath) ? fs.readFileSync(docPath, 'utf8') : '';
const has = (s) => assert.ok(doc.includes(s), `missing: ${s}`);
test('mentions marker FULL SUITE NOT RUN', () => has('FULL SUITE NOT RUN'));
test('mentions label full-ci', () => has('full-ci'));
test('mentions lib/full-ci.js', () => has('lib/full-ci.js'));
test('example sets name: FULL SUITE NOT RUN', () => has('name: FULL SUITE NOT RUN'));
test('example uses labeled trigger', () => has('labeled'));
test('states the matching regex', () => has('/FULL SUITE NOT RUN/i'));
test('documents loop-safeguards cleanup', () => has('loop-safeguards.js cleanup full-ci-'));
test('documents the 3 cycle cap', () => has('3 cycles'));
test('documents skipped marker is ignored', () => assert.ok(/skipped/i.test(doc)));

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
