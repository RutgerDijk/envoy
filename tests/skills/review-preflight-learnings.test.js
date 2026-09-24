#!/usr/bin/env node
/**
 * Review preflight — Known patterns section — Test Suite (#83 task-2).
 *
 * Run: node tests/skills/review-preflight-learnings.test.js
 *
 * preflight.js loads confirmed patterns and team corrections via
 * lib/learning-loader.js and prints them under a `### Known patterns`
 * section, which the orchestrator hands to the Layer 1 reviewer (see
 * skills/review/layers/ai-review.md). Printed on both the ok and the
 * degraded path — degraded review still proceeds.
 *
 * Spawned with HOME pointed at a temp dir so the user-level corrections
 * file (resolved from HOME at loader module load) is controlled.
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
const PREFLIGHT = path.join(REPO_ROOT, 'skills', 'review', 'preflight.js');

const tmpRoots = [];
function makeTmpDir(prefix = 'review-learnings-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(d);
  return d;
}

function writeFile(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function writeHandoff(dir, { tasksCompleted = [{ id: 'task-1', commitSha: 'ccccccc' }] } = {}) {
  writeFile(dir, '.envoy/pickup/handoff-to-review.json', JSON.stringify({
    $schemaVersion: '1',
    issueNumber: 42,
    branch: 'feature/42-x',
    baseSha: 'aaaaaaa',
    headSha: 'bbbbbbb',
    tasksCompleted,
    stackProfiles: [],
    producedAt: '2026-04-23T00:00:00Z',
  }));
}

function learningsFile(patterns) {
  return `# Review learnings\n\n<!-- DATA: ${JSON.stringify({ patterns })} -->\n`;
}

function runPreflight(cwd, home, extraEnv = {}) {
  const env = { ...process.env, ENVOY_REPO_ROOT: REPO_ROOT, HOME: home, USERPROFILE: home, ...extraEnv };
  delete env.ENVOY_HOOK_PROFILE;
  let out;
  try {
    out = execFileSync('node', [PREFLIGHT], { cwd, env, encoding: 'utf8' });
  } catch (err) {
    out = (err.stdout || '') + (err.stderr || '');
  }
  const status = (out.match(/## STATUS: (\w+)/) || [])[1];
  return { status, out };
}

function section(out) {
  const m = out.match(/### Known patterns\n([\s\S]*?)(?=\n### |\nNext:|$)/);
  return m ? m[1] : null;
}

test('confirmed patterns -> ### Known patterns rendered by formatReminders', () => {
  const dir = makeTmpDir();
  const home = makeTmpDir('review-home-');
  writeHandoff(dir);
  writeFile(dir, 'memory/review-learnings.md', learningsFile({
    a: { description: 'Validate handoff before use', count: 3, stack: 'general', level: 'confirmed' },
    b: { description: 'Only seen once', count: 1, stack: 'general', level: 'detected' },
  }));
  const { status, out } = runPreflight(dir, home);
  assert.strictEqual(status, 'ok');
  const s = section(out);
  assert.ok(s !== null, 'expected a ### Known patterns section');
  assert.ok(s.includes('**Known patterns (avoid these):**'), 'expected formatReminders heading');
  assert.ok(s.includes('- [general] Validate handoff before use'), 'expected the confirmed pattern');
  assert.ok(!s.includes('Only seen once'), 'detected-level patterns must not be listed');
});

test('project and user corrections -> listed under Team corrections', () => {
  const dir = makeTmpDir();
  const home = makeTmpDir('review-home-');
  writeHandoff(dir);
  writeFile(dir, 'memory/corrections.md', '- Use pnpm, not npm (2026-01-02)\n');
  writeFile(home, '.claude/learnings/corrections.md', '- Prefer early returns (2026-02-03)\n');
  const { status, out } = runPreflight(dir, home);
  assert.strictEqual(status, 'ok');
  const s = section(out);
  assert.ok(s !== null, 'expected a ### Known patterns section');
  assert.ok(s.includes('**Team corrections:**'), 'expected Team corrections subsection');
  assert.ok(s.includes('- Use pnpm, not npm'), 'expected the project correction');
  assert.ok(s.includes('- Prefer early returns'), 'expected the user correction');
});

test('no learnings and no corrections -> (none recorded)', () => {
  const dir = makeTmpDir();
  const home = makeTmpDir('review-home-');
  writeHandoff(dir);
  const { status, out } = runPreflight(dir, home);
  assert.strictEqual(status, 'ok');
  assert.ok(/### Known patterns\n\n\(none recorded\)/.test(out), 'expected "### Known patterns" followed by "(none recorded)"');
});

test('degraded path still prints the section', () => {
  const dir = makeTmpDir();
  const home = makeTmpDir('review-home-');
  writeHandoff(dir, { tasksCompleted: [] });
  writeFile(dir, 'memory/corrections.md', '- Keep reviews read-only (2026-01-02)\n');
  const { status, out } = runPreflight(dir, home);
  assert.strictEqual(status, 'degraded');
  const s = section(out);
  assert.ok(s !== null, 'expected a ### Known patterns section on the degraded path');
  assert.ok(s.includes('- Keep reviews read-only'), 'expected the correction');
});

test('corrupt learnings file -> STATUS unchanged, section says it could not be read', () => {
  const dir = makeTmpDir();
  const home = makeTmpDir('review-home-');
  writeHandoff(dir);
  writeFile(dir, 'memory/coderabbit-patterns.md', '<!-- DATA: {not json at all} -->\n');
  writeFile(dir, 'memory/corrections.md', '- Keep preflights fail-soft (2026-03-04)\n');
  const { status, out } = runPreflight(dir, home);
  assert.strictEqual(status, 'ok', 'a corrupt learnings file must not change the STATUS tier');
  const s = section(out);
  assert.ok(s !== null, 'expected a ### Known patterns section');
  assert.ok(/could not be read/i.test(s), 'expected the section to say the learnings could not be read');
  assert.ok(s.includes('memory/coderabbit-patterns.md'), 'expected the unreadable file to be named');
  assert.ok(s.includes('- Keep preflights fail-soft'), 'expected the corrections that did load');
  assert.ok(!s.includes('(none recorded)'), 'must not claim none recorded when a file was unreadable');
});

for (const d of tmpRoots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
