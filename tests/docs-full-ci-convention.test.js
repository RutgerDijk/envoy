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
for (const n of ['ci-gate', 'ENVOY_CI_GATE_CHECK', 'gh pr view', '--json labels', 'needs.changes.outputs.full', 'gh run rerun', '--failed', 'annotation', '/FULL SUITE NOT RUN/i', '::error::FULL SUITE NOT RUN']) {
  test(`mentions ${n}`, () => has(n));
}
test('no labeled trigger example', () => assert.ok(!/types:.*labeled/.test(doc)));
test('no SKIPPED markers text', () => assert.ok(!/skipped markers/i.test(doc)));
test('doc under 80 lines', () => assert.ok(doc.split('\n').length < 80));
test('documents loop-safeguards cleanup', () => has('loop-safeguards.js cleanup full-ci-'));
test('does not use consumer-relative node lib/ paths', () => assert.ok(!/node lib\//.test(doc)));
test('documents the 3 cycle cap', () => has('3 cycles'));

test('example gate fails when the changes job did not succeed', () => has('needs.changes.result'));
test('documents that the gate check name must match exactly', () => assert.ok(/exact/i.test(doc) && /ci-gate/.test(doc)));
test('documents that the helper reruns the run owning the failed gate job', () => assert.ok(/run that owns the failed .?ci-gate.? job/i.test(doc)));
test('documents per-PR cycle lifetime', () => assert.ok(/per PR/i.test(doc)));

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
