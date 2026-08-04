#!/usr/bin/env node
/**
 * skills-catalog — contract test for the envoy-authoring meta-skill consolidation.
 *
 * Run: node tests/skills-catalog.test.js
 *
 * Five meta/authoring skills (writing-skills, eval-harness,
 * pressure-test-scenarios, dispatching-parallel-agents, search-first) are
 * folded behind a single discoverable entry point, `skills/envoy-authoring`,
 * without deleting or moving any of the five originals — they remain
 * independently invocable and all existing name-based cross-references
 * keep working.
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
const META_SKILL = path.join(ROOT, 'skills', 'envoy-authoring', 'SKILL.md');
const ORIGINALS = [
  'writing-skills',
  'eval-harness',
  'pressure-test-scenarios',
  'dispatching-parallel-agents',
  'search-first',
];

function readFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = m[1];
  const name = fm.match(/^name:\s*(.+)$/m);
  const description = fm.match(/^description:\s*(.+)$/m);
  return {
    name: name ? name[1].trim() : null,
    description: description ? description[1].trim() : null,
  };
}

section('envoy-authoring meta-skill exists with valid frontmatter');
test('skills/envoy-authoring/SKILL.md exists', () => {
  assert.ok(fs.existsSync(META_SKILL), 'expected skills/envoy-authoring/SKILL.md to exist');
});

test('has valid name + description frontmatter', () => {
  const content = fs.readFileSync(META_SKILL, 'utf8');
  const fm = readFrontmatter(content);
  assert.ok(fm, 'must have YAML frontmatter block');
  assert.strictEqual(fm.name, 'envoy-authoring');
  assert.ok(fm.description && fm.description.length > 0, 'must have a description');
});

test('meta-skill body references all 5 original skills by name', () => {
  const content = fs.readFileSync(META_SKILL, 'utf8');
  for (const name of ORIGINALS) {
    assert.ok(
      content.includes(name),
      `envoy-authoring SKILL.md must reference "${name}"`
    );
  }
});

section('original skills remain unchanged in location');
for (const name of ORIGINALS) {
  test(`skills/${name}/SKILL.md still exists`, () => {
    const p = path.join(ROOT, 'skills', name, 'SKILL.md');
    assert.ok(fs.existsSync(p), `expected skills/${name}/SKILL.md to still exist`);
  });
}

section('catalog listings reference envoy-authoring');
test('README.md skills table mentions envoy-authoring', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.ok(
    readme.includes('envoy:envoy-authoring') || readme.includes('envoy-authoring'),
    'README.md should reference the new envoy-authoring meta-skill'
  );
});

test('docs/wiki/Skills-Reference.md mentions envoy-authoring', () => {
  const p = path.join(ROOT, 'docs', 'wiki', 'Skills-Reference.md');
  if (!fs.existsSync(p)) return; // not all checkouts carry the wiki mirror
  const content = fs.readFileSync(p, 'utf8');
  assert.ok(
    content.includes('envoy-authoring'),
    'docs/wiki/Skills-Reference.md should reference envoy-authoring'
  );
});

function section(title) {
  process.stdout.write(`\n\x1b[1m${title}\x1b[0m\n`);
}

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
