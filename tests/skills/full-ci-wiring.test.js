#!/usr/bin/env node
/**
 * full-ci wiring — finalize, fix-ci and babysit must treat a
 * "FULL SUITE NOT RUN" check as not-green and remediate via lib/full-ci.js.
 *
 * Run: node tests/skills/full-ci-wiring.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const FILES = [
  'skills/finalize/steps/ci.md',
  'skills/fix-ci/SKILL.md',
  'skills/babysit/SKILL.md',
];

let failed = 0;
for (const rel of FILES) {
  const body = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  for (const needle of ['FULL SUITE NOT RUN', 'lib/full-ci.js']) {
    try {
      assert.ok(body.includes(needle), `${rel} must mention ${needle}`);
      console.log(`  PASS ${rel} mentions ${needle}`);
    } catch (e) {
      failed++;
      console.log(`  FAIL ${e.message}`);
    }
  }
}
for (const rel of FILES.filter((f) => f.endsWith('SKILL.md'))) {
  const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n').length;
  if (lines >= 500) {
    failed++;
    console.log(`  FAIL ${rel} is ${lines} lines (limit 500)`);
  }
}
process.exit(failed ? 1 : 0);
