#!/usr/bin/env node
/**
 * Test Command override docs — contract test (#94 task-6).
 *
 * Users must learn about the `## Test Command` override from user-facing
 * docs (using-envoy skill, Stack-Profiles wiki), not only from the plugin's
 * own CLAUDE.md.
 *
 * Run: node tests/docs-test-command-override.test.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
}

function read(rel) {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

function sectionBody(content, headingRe) {
  const m = content.match(headingRe);
  if (!m) return '';
  // Stop at the next `## ` heading OUTSIDE fenced code — the format example
  // itself contains a `## Test Command` line.
  const lines = content.slice(m.index + m[0].length).split('\n');
  const out = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    else if (!inFence && /^## /.test(line)) break;
    out.push(line);
  }
  return out.join('\n');
}

console.log('skills/using-envoy/SKILL.md — Test Command override');
const skill = read('skills/using-envoy/SKILL.md');
const skillSec = sectionBody(skill, /^## Test Command override\s*$/m);
test('has a "## Test Command override" section', () => assert.ok(skillSec.trim().length > 0));
test('shows the ## Test Command format example', () => assert.ok(skillSec.includes('## Test Command')));
test('shows filtered: and full: lines', () => {
  assert.ok(/^filtered:\s*\S/m.test(skillSec), 'missing filtered: line');
  assert.ok(/^full:\s*\S/m.test(skillSec), 'missing full: line');
});
test('documents the {{test}} placeholder', () => assert.ok(skillSec.includes('{{test}}')));
test('documents precedence: project root CLAUDE.md overrides stack default', () => {
  assert.ok(skillSec.includes('CLAUDE.md'), 'missing CLAUDE.md');
  assert.ok(/overrides?/i.test(skillSec), 'missing override wording');
});
test('documents metacharacter rejection', () => {
  assert.ok(/metacharacter/i.test(skillSec), 'missing metacharacter mention');
  assert.ok(/reject/i.test(skillSec), 'missing rejection mention');
  assert.ok(/never executed/i.test(skillSec), 'missing "never executed"');
});
test('section stays short (<= 25 lines)', () => {
  const lines = skillSec.trim().split('\n').length;
  assert.ok(lines <= 25, `section is ${lines} lines`);
});

// Shared precision assertions (#94 task-6 polish): all three docs say the same.
function precisionTests(label, sec) {
  test(`${label}: override replaces all stack defaults (not merged per line)`, () =>
    assert.ok(/replaces all/i.test(sec), 'missing "replaces all"'));
  test(`${label}: unsafe override falls back to stack-profile commands`, () =>
    assert.ok(/falls back/i.test(sec), 'missing "falls back"'));
  test(`${label}: one unsafe line drops both lines`, () =>
    assert.ok(/drops both/i.test(sec), 'missing "drops both"'));
  test(`${label}: newline listed as a metacharacter`, () =>
    assert.ok(/newline/i.test(sec), 'missing newline'));
}

precisionTests('using-envoy', skillSec);
test('using-envoy: example fence tagged markdown', () => assert.ok(skillSec.includes('```markdown')));

console.log('docs/wiki/Stack-Profiles.md — Test Command subsection');
const wiki = read('docs/wiki/Stack-Profiles.md');
const wikiSec = (() => {
  const m = wiki.match(/^### Test Command \(optional\)\s*$/m);
  if (!m) return '';
  const lines = wiki.slice(m.index + m[0].length).split('\n');
  const out = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    else if (!inFence && /^#{2,3} /.test(line)) break;
    out.push(line);
  }
  return out.join('\n');
})();
test('has a "### Test Command (optional)" subsection', () => assert.ok(wikiSec.trim().length > 0));
test('mentions ## Test Command section', () => assert.ok(wikiSec.includes('## Test Command')));
test('mentions {{test}} placeholder', () => assert.ok(wikiSec.includes('{{test}}')));
test('mentions project CLAUDE.md override', () => assert.ok(/CLAUDE\.md[^\n]*overrid|overrid[^\n]*CLAUDE\.md/i.test(wikiSec)));
test('mentions metacharacter rejection', () => {
  assert.ok(/metacharacter/i.test(wikiSec), 'missing metacharacter mention');
  assert.ok(/reject/i.test(wikiSec), 'missing rejection mention');
});
test('mentions lib/test-commands.js', () => assert.ok(wikiSec.includes('lib/test-commands.js')));
test('wiki: example fence tagged markdown', () => assert.ok(wikiSec.includes('```markdown')));
precisionTests('wiki', wikiSec);

console.log('CLAUDE.md — Stack Profiles Test Command bullet');
const claude = read('CLAUDE.md');
const claudeSec = (() => {
  const i = claude.indexOf('May include an optional `## Test Command` section');
  if (i === -1) return '';
  const rest = claude.slice(i);
  const end = rest.search(/\n- Detection patterns/);
  return end === -1 ? rest : rest.slice(0, end);
})();
test('CLAUDE.md Test Command bullet found', () => assert.ok(claudeSec.length > 0));
precisionTests('CLAUDE.md', claudeSec);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
