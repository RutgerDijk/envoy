#!/usr/bin/env node
/**
 * full-ci wiring — finalize, fix-ci and babysit must treat a
 * "FULL SUITE NOT RUN" check as not-green. The full-ci label is the LAST step
 * before merge: finalize and babysit call lib/full-ci.js only when
 * ci.fullSuiteOwed is true and everything else is done (exit 3 = re-poll);
 * fix-ci never adds the label.
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

const CALLERS = [FILES[0], FILES[2]]; // finalize + babysit own the last-step call
for (const rel of FILES) {
  check(`${rel} mentions FULL SUITE NOT RUN`, () => assert.ok(read(rel).includes('FULL SUITE NOT RUN')));
  check(`${rel} mentions fullSuiteOwed`, () => assert.ok(read(rel).includes('fullSuiteOwed')));
  check(`${rel} no bare node lib/ paths`, () => {
    const b = read(rel);
    assert.ok(!b.includes('node lib/full-ci.js'));
    assert.ok(!b.includes('node lib/loop-safeguards.js'));
  });
}
for (const rel of CALLERS) {
  const body = read(rel);
  for (const needle of ['lib/full-ci.js', 'report only, do not loop', 're-poll on the next pass', 'NOT READY']) {
    check(`${rel} mentions ${needle}`, () => assert.ok(body.includes(needle)));
  }
  check(`${rel} uses plugin-root full-ci.js path`, () =>
    assert.ok(body.includes('${CLAUDE_SKILL_DIR}/../../lib/full-ci.js')));
  check(`${rel} states exit 3 is never a failure or escalation`, () =>
    assert.ok(/exit 3[^\n]*never a failure[^\n]*escalation/i.test(body) ||
              /3\)[^\n]*never a failure[^\n]*escalation/i.test(body)));
}
check(`${FILES[0]} mentions loop-safeguards.js cleanup full-ci-`, () =>
  assert.ok(read(FILES[0]).includes('loop-safeguards.js cleanup full-ci-')));
check('finalize ci.md mentions fullSuiteSkipped', () => assert.ok(read(FILES[0]).includes('fullSuiteSkipped')));
check('babysit mentions loop-safeguards.js cleanup full-ci-', () =>
  assert.ok(read(FILES[2]).includes('loop-safeguards.js cleanup full-ci-')));
check('babysit snapshot uses plugin-root pr-status.js', () => {
  const b = read(FILES[2]);
  assert.ok(b.includes('${CLAUDE_SKILL_DIR}/../../lib/pr-status.js'));
  assert.ok(!b.includes('node lib/pr-status.js'));
});
check('babysit mentions fullSuiteSkipped', () =>
  assert.ok(read(FILES[2]).includes('fullSuiteSkipped')));
check('babysit marker row is the LAST action row, after every other row', () => {
  const b = read(FILES[2]);
  const rate = b.indexOf('| `shouldReTrigger` returns');
  const fail = b.indexOf('| `ci.state` is failing');
  const threads = b.indexOf('| `coderabbit.unresolvedThreads > 0`');
  const marker = b.indexOf('| `ci.fullSuiteOwed`');
  const ready = b.indexOf('| all green, nothing outstanding');
  assert.ok(rate >= 0 && fail > rate && threads > fail && marker > threads && ready > marker);
});
check('babysit failing-ci row excludes the owed marker-only state', () => {
  const row = read(FILES[2]).split('\n').find((l) => l.startsWith('| `ci.state` is failing'));
  assert.ok(row && row.includes('`ci.fullSuiteOwed` is false'));
});
check('babysit never reports ready to merge while fullSuiteOwed', () => {
  const row = read(FILES[2]).split('\n').find((l) => l.startsWith('| all green, nothing outstanding'));
  assert.ok(row && row.includes('fullSuiteOwed'));
});
for (const rel of FILES) {
  check(`${rel} drops name/SKIPPED/latest-per-name wording`, () => {
    const b = read(rel);
    assert.ok(!/SKIPPED|NEUTRAL|latest per name|name matches/.test(b));
    assert.ok(/gate/i.test(b) && /annotation/i.test(b));
  });
}
check('fix-ci checks fullSuiteOwed before classifying failures', () => {
  const b = read(FILES[1]);
  assert.ok(b.indexOf('fullSuiteOwed') >= 0 && b.indexOf('fullSuiteOwed') < b.indexOf('### Step 3: Classify'));
});
check('fix-ci no longer invokes full-ci.js or the REMEDIATE_FULL_CI state', () => {
  const b = read(FILES[1]);
  assert.ok(!b.includes('full-ci.js'));
  assert.ok(!b.includes('REMEDIATE_FULL_CI'));
  assert.ok(!b.includes('loop-safeguards.js cleanup full-ci-'));
});
check('fix-ci reports "fast run green, full run owed" and never adds the label', () => {
  const b = read(FILES[1]);
  assert.ok(b.includes('fast run green, full run owed'));
  assert.ok(/never add(s)? the `?full-ci`? label/i.test(b));
});
check('fix-ci with marker plus real failures still classifies them (owed false)', () => {
  const b = read(FILES[1]);
  assert.ok(b.includes('fullSuiteSkipped'));
  assert.ok(/fullSuiteOwed[^\n]*false/.test(b));
});
check('fix-ci passes the Step 1 $PR_NUMBER (not unset $PR) to pr-status.js', () => {
  const b = read(FILES[1]);
  assert.ok(b.includes('pr-status.js "$PR_NUMBER"'));
  assert.ok(!/pr-status\.js "\$PR"/.test(b));
});
check('fix-ci Step 8 state machine routes fullSuiteOwed to a report-only terminal state before FIX', () => {
  const b = read(FILES[1]);
  const step8 = b.slice(b.indexOf('### Step 8'));
  const owed = step8.indexOf('REPORT_OWED');
  const fix = step8.indexOf('state = FIX');
  assert.ok(owed >= 0 && fix >= 0 && owed < fix);
  assert.ok(/REPORT_OWED:[\s\S]*fast run green, full run owed[\s\S]*DONE/.test(step8));
});
check('finalize ci.md calls full-ci.js only AFTER the FAILED computation (last step)', () => {
  const b = read(FILES[0]);
  const failedAt = b.indexOf('FAILED=$(');
  const call = b.indexOf('lib/full-ci.js "$PR_NUMBER"');
  assert.ok(failedAt >= 0 && call > failedAt);
  assert.ok(b.includes('fullSuiteOwed'));
});
check('finalize coderabbit.md Step 8 cross-references the last-step full-ci call', () => {
  const b = read('skills/finalize/steps/coderabbit.md');
  assert.ok(b.slice(b.indexOf('### Step 8')).includes('fullSuiteOwed'));
});
check('finalize checks fullSuiteSkipped in a bash block BEFORE computing FAILED', () => {
  const b = read(FILES[0]);
  const skipped = b.indexOf('SUITE_NOT_RUN=$(');
  const failedAt = b.indexOf('FAILED=$(');
  assert.ok(skipped >= 0 && failedAt >= 0 && skipped < failedAt);
  assert.ok(b.includes('PR_STATUS="node ${CLAUDE_SKILL_DIR}/../../lib/pr-status.js"'));
});
check('babysit snapshot shape lists .ci.fullSuiteSkipped and .ci.fullSuiteOwed', () => {
  const b = read(FILES[2]);
  const shape = b.slice(b.indexOf('The snapshot shape'), b.indexOf('### Step 3'));
  assert.ok(shape.includes('.ci.fullSuiteSkipped'));
  assert.ok(shape.includes('.ci.fullSuiteOwed'));
});
for (const rel of FILES.filter((f) => f.endsWith('SKILL.md'))) {
  check(`${rel} under 500 lines`, () => assert.ok(read(rel).split('\n').length < 500));
}
process.exit(failed ? 1 : 0);
