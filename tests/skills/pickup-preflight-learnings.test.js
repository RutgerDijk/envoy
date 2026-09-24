#!/usr/bin/env node
/**
 * Pickup preflight — Known patterns section — Test Suite (#83 task-2).
 *
 * Run: node tests/skills/pickup-preflight-learnings.test.js
 *
 * preflight.js loads confirmed patterns (memory/review-learnings.md,
 * memory/coderabbit-patterns.md) and team corrections (memory/corrections.md,
 * ~/.claude/learnings/corrections.md) via lib/learning-loader.js and prints
 * them under a `### Known patterns` section, which the orchestrator threads
 * into the implementer prompt (see skills/pickup/steps/prompts.md).
 *
 * The loader resolves the user corrections path from HOME at module load, so
 * every run spawns the preflight as a child process with HOME pointed at a
 * temp dir — results never depend on this machine's real ~/.claude.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

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

const REPO_ROOT = path.join(__dirname, '..', '..');
const PREFLIGHT = path.join(REPO_ROOT, 'skills', 'pickup', 'preflight.js');

const tmpRoots = [];
function makeTmpDir(prefix = 'pickup-learnings-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(d);
  return d;
}

function writeTasksFile(dir, issueNumber) {
  const tasks = {
    $schemaVersion: '1',
    issueNumber,
    strategy: 'batch',
    tasks: [{ id: 'task-1', title: 'Add feature', files: ['src/foo.ts'], acceptance: ['works'] }],
  };
  fs.mkdirSync(path.join(dir, '.envoy-tasks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.envoy-tasks', `${issueNumber}.json`), JSON.stringify(tasks));
}

function writeFile(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function learningsFile(patterns) {
  return `# Review learnings\n\n<!-- DATA: ${JSON.stringify({ patterns })} -->\n`;
}

function runPreflight(cwd, home, extraEnv = {}) {
  const env = {
    ...process.env,
    ENVOY_REPO_ROOT: REPO_ROOT,
    ENVOY_ISSUE_BODY_FILE: path.join(cwd, 'no-such-issue-body.md'),
    HOME: home,
    USERPROFILE: home,
    ...extraEnv,
  };
  let out;
  try {
    out = execFileSync('node', [PREFLIGHT], { cwd, env, encoding: 'utf8' });
  } catch (err) {
    out = (err.stdout || '') + (err.stderr || '');
  }
  const status = (out.match(/## STATUS: (\w+)/) || [])[1];
  return { status, out };
}

// Text of the ### Known patterns section (up to the next ### heading or "Next:").
function section(out) {
  const m = out.match(/### Known patterns\n([\s\S]*?)(?=\n### |\nNext:|$)/);
  return m ? m[1] : null;
}

test('confirmed patterns for a detected stack -> ### Known patterns rendered by formatReminders', () => {
  const dir = makeTmpDir();
  const home = makeTmpDir('pickup-home-');
  writeTasksFile(dir, 40);
  writeFile(dir, 'tsconfig.json', '{}'); // detected stack: typescript
  writeFile(dir, 'memory/review-learnings.md', learningsFile({
    ts: { description: 'Avoid any in public signatures', count: 3, stack: 'typescript', level: 'confirmed' },
    gen: { description: 'Name tests by behavior', count: 5, stack: 'general', level: 'automated' },
    dn: { description: 'Dispose DbContext explicitly', count: 4, stack: 'dotnet', level: 'confirmed' },
    new: { description: 'Only seen once', count: 1, stack: 'typescript', level: 'detected' },
  }));
  const { status, out } = runPreflight(dir, home, { ENVOY_ISSUE_NUMBER: '40' });
  assert.strictEqual(status, 'ok');
  const s = section(out);
  assert.ok(s !== null, 'expected a ### Known patterns section');
  assert.ok(s.includes('**Known patterns (avoid these):**'), 'expected formatReminders heading');
  assert.ok(s.includes('- [typescript] Avoid any in public signatures'), 'expected the typescript pattern');
  assert.ok(s.includes('- [general] Name tests by behavior'), 'expected the general pattern');
  assert.ok(!s.includes('Dispose DbContext'), 'pattern for an undetected stack must be filtered out');
  assert.ok(!s.includes('Only seen once'), 'detected-level patterns must not be listed');
});

test('project and user corrections -> listed under Team corrections', () => {
  const dir = makeTmpDir();
  const home = makeTmpDir('pickup-home-');
  writeTasksFile(dir, 41);
  writeFile(dir, 'memory/corrections.md', '# Corrections\n\n- Use pnpm, not npm (2026-01-02)\n');
  writeFile(home, '.claude/learnings/corrections.md', '- Prefer early returns (2026-02-03)\n');
  const { status, out } = runPreflight(dir, home, { ENVOY_ISSUE_NUMBER: '41' });
  assert.strictEqual(status, 'ok');
  const s = section(out);
  assert.ok(s !== null, 'expected a ### Known patterns section');
  assert.ok(s.includes('**Team corrections:**'), 'expected Team corrections subsection');
  assert.ok(s.includes('- Use pnpm, not npm'), 'expected the project correction');
  assert.ok(s.includes('- Prefer early returns'), 'expected the user correction');
});

test('no learnings and no corrections -> (none recorded)', () => {
  const dir = makeTmpDir();
  const home = makeTmpDir('pickup-home-');
  writeTasksFile(dir, 42);
  const { status, out } = runPreflight(dir, home, { ENVOY_ISSUE_NUMBER: '42' });
  assert.strictEqual(status, 'ok');
  assert.ok(/### Known patterns\n\n\(none recorded\)/.test(out), 'expected "### Known patterns" followed by "(none recorded)"');
});

test('corrupt learnings file -> STATUS unchanged, section says it could not be read, corrections still listed', () => {
  const dir = makeTmpDir();
  const home = makeTmpDir('pickup-home-');
  writeTasksFile(dir, 43);
  writeFile(dir, 'memory/review-learnings.md', '# Review learnings\n\n<!-- DATA: {"patterns": {broken json -->\n');
  writeFile(dir, 'memory/corrections.md', '- Keep preflights fail-soft (2026-03-04)\n');
  const { status, out } = runPreflight(dir, home, { ENVOY_ISSUE_NUMBER: '43' });
  assert.strictEqual(status, 'ok', 'a corrupt learnings file must not change the STATUS tier');
  const s = section(out);
  assert.ok(s !== null, 'expected a ### Known patterns section');
  assert.ok(/could not be read/i.test(s), 'expected the section to say the learnings could not be read');
  assert.ok(s.includes('memory/review-learnings.md'), 'expected the unreadable file to be named');
  assert.ok(s.includes('- Keep preflights fail-soft'), 'expected the corrections that did load');
  assert.ok(!s.includes('(none recorded)'), 'must not claim none recorded when a file was unreadable');
});

test('unreadable corrections file -> STATUS unchanged, section says it could not be read', () => {
  const dir = makeTmpDir();
  const home = makeTmpDir('pickup-home-');
  writeTasksFile(dir, 44);
  fs.mkdirSync(path.join(dir, 'memory', 'corrections.md'), { recursive: true }); // read throws EISDIR
  const { status, out } = runPreflight(dir, home, { ENVOY_ISSUE_NUMBER: '44' });
  assert.strictEqual(status, 'ok');
  const s = section(out);
  assert.ok(s !== null, 'expected a ### Known patterns section');
  assert.ok(/could not be read/i.test(s) && s.includes('memory/corrections.md'), 'expected the unreadable corrections file to be named');
});

for (const d of tmpRoots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
