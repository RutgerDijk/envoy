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
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  PASS ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
}

console.log('docs/full-ci-convention.md');
test('doc exists', () => assert.ok(fs.existsSync(docPath)));
const doc = fs.existsSync(docPath) ? fs.readFileSync(docPath, 'utf8') : '';
test('mentions marker FULL SUITE NOT RUN', () => assert.ok(doc.includes('FULL SUITE NOT RUN')));
test('mentions label full-ci', () => assert.ok(doc.includes('full-ci')));
test('mentions lib/full-ci.js', () => assert.ok(doc.includes('lib/full-ci.js')));

process.exit(failed ? 1 : 0);
