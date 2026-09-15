#!/usr/bin/env node
/**
 * commands/ directory — contract test.
 *
 * Run: node tests/commands-directory.test.js
 *
 * Claude Code now merges custom commands into skills: a skill's `name:`
 * frontmatter alone produces the same /envoy:<name> command a
 * commands/<name>.md wrapper used to register. The commands/ wrapper
 * directory is therefore retired — each former wrapper's command surface
 * must now be produced solely by skills/<name>/SKILL.md's `name:`
 * frontmatter.
 *
 * The only sanctioned exception is documented inline below.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

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

const ROOT = path.join(__dirname, '..');
const COMMANDS_DIR = path.join(ROOT, 'commands');
const SKILLS_DIR = path.join(ROOT, 'skills');

// Former commands/ wrapper names that now must be produced by a skill's
// own `name:` frontmatter instead of a commands/<name>.md wrapper file.
const RETIRED_WRAPPERS = [
  'babysit',
  'brainstorm',
  'cleanup',
  'costs',
  'docstrings',
  'finalize',
  'fix-ci',
  'hotfix',
  'pickup',
  'prs',
  'review',
  'visual-review',
  'wiki-sync',
];

// quick-review has no skills/quick-review/ directory. Its behavior is fully
// documented as /envoy:review --quick in skills/review/SKILL.md's
// "Arguments" table, so its wrapper is retired without a replacement skill
// dir (documented replacement, not a 1:1 command).

test('commands/ directory does not exist', () => {
  assert.ok(
    !fs.existsSync(COMMANDS_DIR),
    'commands/ must be removed now that skills auto-register /envoy:<name>'
  );
});

for (const name of RETIRED_WRAPPERS) {
  test(`skills/${name}/SKILL.md name: frontmatter reproduces /envoy:${name}`, () => {
    const skillPath = path.join(SKILLS_DIR, name, 'SKILL.md');
    assert.ok(fs.existsSync(skillPath), `skills/${name}/SKILL.md must exist`);
    const content = fs.readFileSync(skillPath, 'utf8');
    const match = content.match(/^---[\s\S]*?\nname:\s*(\S+)/);
    assert.ok(match, `skills/${name}/SKILL.md must have name: frontmatter`);
    assert.strictEqual(
      match[1],
      name,
      `skills/${name}/SKILL.md name: frontmatter must equal "${name}" to reproduce /envoy:${name}`
    );
  });
}

test('quick-review has a documented replacement (no skills/quick-review dir)', () => {
  assert.ok(
    !fs.existsSync(path.join(SKILLS_DIR, 'quick-review')),
    'quick-review has no standalone skill dir by design'
  );
  const reviewSkill = fs.readFileSync(path.join(SKILLS_DIR, 'review', 'SKILL.md'), 'utf8');
  assert.ok(
    /--quick/.test(reviewSkill),
    'skills/review/SKILL.md must document --quick as the replacement for /envoy:quick-review'
  );
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
