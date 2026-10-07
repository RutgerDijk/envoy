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
  for (const needle of ['FULL SUITE NOT RUN', 'lib/full-ci.js', 'report only, do not loop']) {
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
check('babysit marker row comes BEFORE failing-ci row', () => {
  const b = read(FILES[2]);
  const fail = b.indexOf('| `ci.state` is failing');
  const marker = b.indexOf('| `ci.fullSuiteSkipped`');
  assert.ok(fail >= 0 && marker >= 0 && marker < fail);
});
for (const rel of FILES) {
  check(`${rel} drops name/SKIPPED/latest-per-name wording`, () => {
    const b = read(rel);
    assert.ok(!/SKIPPED|NEUTRAL|latest per name|name matches/.test(b));
    assert.ok(/gate/i.test(b) && /annotation/i.test(b));
  });
}
check('fix-ci checks fullSuiteSkipped before classifying failures', () => {
  const b = read(FILES[1]);
  assert.ok(b.indexOf('fullSuiteSkipped') < b.indexOf('### Step 3: Classify'));
});
check('fix-ci passes the Step 1 $PR_NUMBER (not unset $PR) to pr-status.js', () => {
  const b = read(FILES[1]);
  assert.ok(b.includes('pr-status.js "$PR_NUMBER"'));
  assert.ok(!/pr-status\.js "\$PR"/.test(b));
});
check('fix-ci Step 8 state machine routes fullSuiteSkipped to a remediation state before FIX', () => {
  const b = read(FILES[1]);
  const step8 = b.slice(b.indexOf('### Step 8'));
  const remediate = step8.indexOf('REMEDIATE_FULL_CI');
  const fix = step8.indexOf('state = FIX');
  assert.ok(remediate >= 0 && fix >= 0 && remediate < fix);
  assert.ok(/REMEDIATE_FULL_CI:[\s\S]*full-ci\.js[\s\S]*not increment FIX_CYCLE/i.test(step8));
});
check('finalize checks fullSuiteSkipped in a bash block BEFORE computing FAILED', () => {
  const b = read(FILES[0]);
  const skipped = b.indexOf('FULL_SUITE_SKIPPED=$(');
  const failedAt = b.indexOf('FAILED=$(');
  assert.ok(skipped >= 0 && failedAt >= 0 && skipped < failedAt);
  assert.ok(b.includes('PR_STATUS="node ${CLAUDE_SKILL_DIR}/../../lib/pr-status.js"'));
});
check('babysit snapshot shape lists .ci.fullSuiteSkipped', () => {
  const b = read(FILES[2]);
  const shape = b.slice(b.indexOf('The snapshot shape'), b.indexOf('### Step 3'));
  assert.ok(shape.includes('.ci.fullSuiteSkipped'));
});
for (const rel of FILES.filter((f) => f.endsWith('SKILL.md'))) {
  check(`${rel} under 500 lines`, () => assert.ok(read(rel).split('\n').length < 500));
}
process.exit(failed ? 1 : 0);
