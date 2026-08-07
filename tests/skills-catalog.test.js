#!/usr/bin/env node
/**
 * skills-catalog — contract test for the real envoy-authoring consolidation.
 *
 * Run: node tests/skills-catalog.test.js
 *
 * Five meta/authoring skills (writing-skills, eval-harness,
 * pressure-test-scenarios, dispatching-parallel-agents, search-first) are
 * MERGED into a single skill directory, `skills/envoy-authoring`, whose
 * content lives in `steps/*.md` (lazy-loaded, one file per concern). The
 * five original directories are deleted. Net skill-directory count must go
 * DOWN, not up.
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

function section(name) {
  process.stdout.write(`\n${name}\n`);
}

const ROOT = path.join(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const MERGED_DIR = path.join(SKILLS_DIR, 'envoy-authoring');
const MERGED_SKILL = path.join(MERGED_DIR, 'SKILL.md');
const MERGED_STEPS = path.join(MERGED_DIR, 'steps');

const ORIGINALS = [
  'writing-skills',
  'eval-harness',
  'pressure-test-scenarios',
  'dispatching-parallel-agents',
  'search-first',
];

// Concerns that must each be covered by some steps/*.md file's content.
const CONCERN_MARKERS = {
  'search-first': /search-first|Adopt.*Extend.*Compose.*Build|Decision Matrix/i,
  'writing-skills': /RED-GREEN-REFACTOR|Writing Skills for Envoy|Iron Law/i,
  'eval-harness': /pass@1|pass@3|Eval Harness/i,
  'pressure-test-scenarios': /Pressure Test Scenarios|Quick Fix Urgency/i,
  'dispatching-parallel-agents': /Dispatching Parallel Agents|agent-scratchpad/i,
};

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

function allStepsContent() {
  if (!fs.existsSync(MERGED_STEPS)) return '';
  return fs
    .readdirSync(MERGED_STEPS)
    .filter((f) => f.endsWith('.md'))
    .map((f) => fs.readFileSync(path.join(MERGED_STEPS, f), 'utf8'))
    .join('\n\n');
}

section('skills/ directory count went DOWN (real merge, not a wrapper)');
test('exactly 5 original directories are gone', () => {
  for (const name of ORIGINALS) {
    assert.ok(
      !fs.existsSync(path.join(SKILLS_DIR, name)),
      `expected skills/${name}/ to be deleted (merged into envoy-authoring)`
    );
  }
});

test('skills/ directory count is 23 (27 baseline - 5 originals + 1 merged)', () => {
  const count = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory()).length;
  assert.strictEqual(count, 23, `expected 23 skill directories, found ${count}`);
});

section('skills/envoy-authoring is the real merged skill');
test('skills/envoy-authoring/SKILL.md exists', () => {
  assert.ok(fs.existsSync(MERGED_SKILL), 'expected skills/envoy-authoring/SKILL.md to exist');
});

test('has valid name + description frontmatter', () => {
  const content = fs.readFileSync(MERGED_SKILL, 'utf8');
  const fm = readFrontmatter(content);
  assert.ok(fm, 'expected YAML frontmatter block');
  assert.strictEqual(fm.name, 'envoy-authoring');
  assert.ok(fm.description && fm.description.length > 0, 'expected non-empty description');
});

test('SKILL.md is a routing entry point, not a content dump (stays lean)', () => {
  const content = fs.readFileSync(MERGED_SKILL, 'utf8');
  const lines = content.split('\n').length;
  assert.ok(lines < 250, `expected SKILL.md under 250 lines (lazy-loading pattern), got ${lines}`);
});

test('skills/envoy-authoring/steps/ exists with one file per original concern', () => {
  assert.ok(fs.existsSync(MERGED_STEPS), 'expected skills/envoy-authoring/steps/ to exist');
  const files = fs.readdirSync(MERGED_STEPS).filter((f) => f.endsWith('.md'));
  assert.ok(files.length >= 5, `expected at least 5 step files, found ${files.length}`);
});

section('all 5 original concerns are fully preserved in steps/ content');
for (const [concern, marker] of Object.entries(CONCERN_MARKERS)) {
  test(`steps/ content covers "${concern}"`, () => {
    const combined = allStepsContent();
    assert.ok(marker.test(combined), `expected steps/ content to match ${marker} for ${concern}`);
  });
}

section('SKILL.md routes to each steps/ file');
test('SKILL.md references all step files by path', () => {
  const content = fs.readFileSync(MERGED_SKILL, 'utf8');
  const stepFiles = fs.existsSync(MERGED_STEPS)
    ? fs.readdirSync(MERGED_STEPS).filter((f) => f.endsWith('.md'))
    : [];
  assert.ok(stepFiles.length > 0, 'no step files found to check routing against');
  for (const f of stepFiles) {
    assert.ok(content.includes(`steps/${f}`), `expected SKILL.md to reference steps/${f}`);
  }
});

section('cross-references updated: no dangling mentions of the 5 deleted skill names');
const CROSS_REF_FILES = [
  'skills/using-envoy/SKILL.md',
  'skills/test-driven-development/SKILL.md',
  'skills/systematic-debugging/SKILL.md',
  'skills/receiving-code-review/SKILL.md',
  'lib/agent-scratchpad.js',
];

const OLD_NAME_PATTERN = new RegExp(
  `envoy:(${ORIGINALS.join('|')})\\b`
);

for (const rel of CROSS_REF_FILES) {
  test(`${rel} no longer references a deleted skill by name`, () => {
    const p = path.join(ROOT, rel);
    assert.ok(fs.existsSync(p), `expected ${rel} to exist`);
    const content = fs.readFileSync(p, 'utf8');
    assert.ok(
      !OLD_NAME_PATTERN.test(content),
      `expected no envoy:<deleted-skill> reference remaining in ${rel}`
    );
  });
}

section('repo-wide: no dangling references to deleted skill names');
test('no skills/, hooks/, lib/, docs/wiki/, tests/, README.md, CLAUDE.md file references a deleted skill name', () => {
  const searchRoots = ['skills', 'hooks', 'lib', 'docs/wiki', 'tests'];
  const extraFiles = ['README.md', 'CLAUDE.md', path.join('.claude-plugin', 'plugin.json')];
  const offenders = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(md|js|json)$/.test(entry.name)) {
        const content = fs.readFileSync(full, 'utf8');
        if (OLD_NAME_PATTERN.test(content)) {
          offenders.push(path.relative(ROOT, full));
        }
      }
    }
  }

  for (const root of searchRoots) {
    const full = path.join(ROOT, root);
    if (fs.existsSync(full)) walk(full);
  }
  for (const f of extraFiles) {
    const full = path.join(ROOT, f);
    if (fs.existsSync(full)) {
      const content = fs.readFileSync(full, 'utf8');
      if (OLD_NAME_PATTERN.test(content)) offenders.push(f);
    }
  }

  assert.deepStrictEqual(offenders, [], `dangling references found in: ${offenders.join(', ')}`);
});

section('README.md and plugin.json report the corrected skill count');
test('README.md says "23 skills"', () => {
  const content = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.ok(/23 skills/.test(content), 'expected README.md to say "23 skills"');
});

test('.claude-plugin/plugin.json description says "23 skills"', () => {
  const content = fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8');
  assert.ok(/23 skills/.test(content), 'expected plugin.json description to say "23 skills"');
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
