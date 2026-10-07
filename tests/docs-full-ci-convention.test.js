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

// Issue #87: the label goes on LAST, once the PR is ready.
test('documents the owed state', () => assert.ok(/fast run green, full run owed/i.test(doc) && /fullSuiteOwed/.test(doc)));
test('documents that a marker-red ci-gate is not a failure', () => assert.ok(/not a failure/i.test(doc)));
test('real failure / non-success status keeps it not owed (sentence near fullSuiteOwed)', () => assert.ok(/real job failure[^.]*commit status[^.]*keeps `fullSuiteOwed` false/i.test(doc)))
test('documents last-step timing', () => assert.ok(/last step/i.test(doc) && /no more pushes/i.test(doc)));
test('documents readiness: unresolved threads and rate limit', () => assert.ok(/unresolved review threads/i.test(doc) && /rate.?limit/i.test(doc)));
test('documents readiness: CodeRabbit status success, absent is not done', () => assert.ok(/statusState/.test(doc) && /absent/i.test(doc)));
test('exit 3 maps to NOT READY / re-poll in the same clause', () => assert.ok(/(?:^|[,:] )3 NOT READY: re-poll/.test(doc)));
test('exit 3 is no writes, never a failure or escalation', () => assert.ok(/no writes/i.test(doc) && /never a failure or escalation/i.test(doc)));
test('exit 2 / 3 cycles wording still exists', () => assert.ok(/2 blocked after 3 cycles/.test(doc)))
test('documents ENVOY_CODERABBIT on|off|auto', () => assert.ok(/ENVOY_CODERABBIT/.test(doc) && /on\|off\|auto/.test(doc)));
test('documents .coderabbit.yaml/.yml auto-detection', () => assert.ok(/\.coderabbit\.yaml/.test(doc) && /\.coderabbit\.yml/.test(doc)));
test('documents SHA-pinned reads', () => assert.ok(/head SHA/i.test(doc) && /latest check run per name/i.test(doc)));
test('documents a push after the label is fine and the label is never removed', () => assert.ok(/push after the label/i.test(doc) && /never removes the label/i.test(doc)));
test('head SHA re-read happens immediately before the writes', () => assert.ok(/re-read right before the writes/i.test(doc)))
test('fix-ci is report-only and hands off; not a helper caller', () => assert.ok(/`fix-ci`[^.]*(report|hand)/i.test(doc) && !/`finalize`, `fix-ci`/.test(doc) && !/`fix-ci` and `babysit`/.test(doc)));
test('only finalize and babysit run the helper', () => assert.ok(/`finalize` and `babysit` run the helper/.test(doc)));
test('exit 3 tells maintainers where the reason is and what to do', () => assert.ok(/NOT READY: <reason>/.test(doc) && /stderr/.test(doc) && /nothing to do manually/i.test(doc)));
test('gate exits red (not "fails") on the marker', () => assert.ok(/exits red/.test(doc)));
test('no-more-pushes is enforced by callers, not the helper', () => assert.ok(/not by the helper itself/i.test(doc)));
test('no stale "On ci.fullSuiteSkipped" trigger', () => assert.ok(!/On `ci\.fullSuiteSkipped`/.test(doc)));

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
