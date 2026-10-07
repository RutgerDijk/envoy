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
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const FILES = [
  'skills/finalize/steps/ci.md',
  'skills/fix-ci/SKILL.md',
  'skills/babysit/SKILL.md',
];

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

check('lib/full-ci.js exists', () => assert.ok(fs.existsSync(path.join(ROOT, 'lib/full-ci.js'))));

for (const rel of FILES) {
  const body = read(rel);
  for (const needle of ['FULL SUITE NOT RUN', 'lib/full-ci.js', 'SKIPPED', 'report only, do not loop']) {
    check(`${rel} mentions ${needle}`, () => assert.ok(body.includes(needle)));
  }
}
for (const rel of FILES.slice(0, 2)) {
  check(`${rel} mentions loop-safeguards.js cleanup full-ci-`, () =>
    assert.ok(read(rel).includes('loop-safeguards.js cleanup full-ci-')));
}
for (const rel of FILES) {
  check(`${rel} uses plugin-root full-ci.js path, no bare node lib/full-ci.js`, () => {
    const b = read(rel);
    assert.ok(b.includes('${CLAUDE_SKILL_DIR}/../../lib/full-ci.js'));
    assert.ok(!b.includes('node lib/full-ci.js'));
    assert.ok(!b.includes('node lib/loop-safeguards.js'));
  });
}
for (const rel of FILES.slice(0, 2)) {
  check(`${rel} mentions fullSuiteSkipped`, () => assert.ok(read(rel).includes('fullSuiteSkipped')));
}
check('babysit snapshot uses plugin-root pr-status.js', () => {
  const b = read(FILES[2]);
  assert.ok(b.includes('${CLAUDE_SKILL_DIR}/../../lib/pr-status.js'));
  assert.ok(!b.includes('node lib/pr-status.js'));
});
check('babysit mentions fullSuiteSkipped', () =>
  assert.ok(read(FILES[2]).includes('fullSuiteSkipped')));
check('babysit marker row comes after failing-ci row', () => {
  const b = read(FILES[2]);
  const fail = b.indexOf('| `ci.state` is failing');
  const marker = b.indexOf('| `ci.fullSuiteSkipped`');
  assert.ok(fail >= 0 && marker >= 0 && marker > fail);
});
for (const rel of FILES.filter((f) => f.endsWith('SKILL.md'))) {
  check(`${rel} under 500 lines`, () => assert.ok(read(rel).split('\n').length < 500));
}
process.exit(failed ? 1 : 0);
