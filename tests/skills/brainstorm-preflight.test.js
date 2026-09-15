#!/usr/bin/env node
/**
 * Brainstorm preflight.
 *
 * Run: node tests/skills/brainstorm-preflight.test.js
 *
 * brainstorm is being promoted from a flexible skill (prose-only) to a
 * rigid, contract-backed one. preflight.js gates entry:
 *   - `gh auth status` failure                     -> fatal
 *   - leftover .envoy/brainstorm/ state from a
 *     prior run                                    -> degraded
 *   - an open issue with a similar title to the
 *     topic being brainstormed (when determinable) -> degraded
 *
 * gh is stubbed via env-var test seams (ENVOY_GH_AUTH_STATUS_FAKE,
 * ENVOY_GH_ISSUE_LIST_FILE) so these tests never shell out to the real gh.
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
const PREFLIGHT = path.join(REPO_ROOT, 'skills', 'brainstorm', 'preflight.js');

const tmpRoots = [];
function makeCwd() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'brainstorm-preflight-'));
  tmpRoots.push(d);
  return d;
}

// Run preflight in a temp cwd; returns { status, out }.
function runPreflight(cwd, extraEnv = {}) {
  const env = { ...process.env, ENVOY_REPO_ROOT: REPO_ROOT, ...extraEnv };
  let out;
  try {
    out = execFileSync('node', [PREFLIGHT], { cwd, env, encoding: 'utf8' });
  } catch (err) {
    out = (err.stdout || '') + (err.stderr || '');
  }
  const status = (out.match(/## STATUS: (\w+)/) || [])[1];
  return { status, out };
}

test('gh authenticated, no stale state, no topic -> ok', () => {
  const cwd = makeCwd();
  const { status } = runPreflight(cwd, { ENVOY_GH_AUTH_STATUS_FAKE: 'ok' });
  assert.strictEqual(status, 'ok');
});

test('gh auth status failing -> fatal', () => {
  const cwd = makeCwd();
  const { status, out } = runPreflight(cwd, { ENVOY_GH_AUTH_STATUS_FAKE: 'fail' });
  assert.strictEqual(status, 'fatal');
  assert.ok(/gh auth/i.test(out), 'mentions gh auth in remediation');
});

test('leftover .envoy/brainstorm/ state from a prior run -> degraded', () => {
  const cwd = makeCwd();
  fs.mkdirSync(path.join(cwd, '.envoy', 'brainstorm'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.envoy', 'brainstorm', 'state.json'), '{}');
  const { status, out } = runPreflight(cwd, { ENVOY_GH_AUTH_STATUS_FAKE: 'ok' });
  assert.strictEqual(status, 'degraded');
  assert.ok(/resume|reset/i.test(out), 'offers resume-or-reset framing');
});

test('open issue with similar title to topic -> degraded', () => {
  const cwd = makeCwd();
  const issueListFile = path.join(cwd, 'issues.json');
  fs.writeFileSync(issueListFile, JSON.stringify([
    { number: 12, title: 'Add dark mode toggle to settings' },
  ]));
  const { status, out } = runPreflight(cwd, {
    ENVOY_GH_AUTH_STATUS_FAKE: 'ok',
    ENVOY_GH_ISSUE_LIST_FILE: issueListFile,
    ENVOY_BRAINSTORM_TOPIC: 'dark mode toggle',
  });
  assert.strictEqual(status, 'degraded');
  assert.ok(/#12/.test(out), 'references the similar issue number');
});

test('no topic determinable at preflight time -> ok (dup check skipped)', () => {
  const cwd = makeCwd();
  const issueListFile = path.join(cwd, 'issues.json');
  fs.writeFileSync(issueListFile, JSON.stringify([
    { number: 12, title: 'Add dark mode toggle to settings' },
  ]));
  const { status, out } = runPreflight(cwd, {
    ENVOY_GH_AUTH_STATUS_FAKE: 'ok',
    ENVOY_GH_ISSUE_LIST_FILE: issueListFile,
  });
  assert.strictEqual(status, 'ok');
  assert.ok(!/#12/.test(out));
});

test('unrelated topic vs existing issues -> ok, no false positive', () => {
  const cwd = makeCwd();
  const issueListFile = path.join(cwd, 'issues.json');
  fs.writeFileSync(issueListFile, JSON.stringify([
    { number: 12, title: 'Add dark mode toggle to settings' },
  ]));
  const { status } = runPreflight(cwd, {
    ENVOY_GH_AUTH_STATUS_FAKE: 'ok',
    ENVOY_GH_ISSUE_LIST_FILE: issueListFile,
    ENVOY_BRAINSTORM_TOPIC: 'rewrite billing export pipeline',
  });
  assert.strictEqual(status, 'ok');
});

test('brainstorm SKILL.md drops the lettered A/B split menu', () => {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'brainstorm', 'SKILL.md'), 'utf8');
  assert.ok(!/A: one issue/.test(content), 'lettered "A: one issue" option removed');
  assert.ok(!/B: split/i.test(content) && !/B: the two-issue/i.test(content), 'lettered split option removed');
});

test('brainstorm SKILL.md has the inline preflight briefing', () => {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'brainstorm', 'SKILL.md'), 'utf8');
  assert.ok(/## Briefing/.test(content));
  assert.ok(/preflight\.js/.test(content));
});

for (const d of tmpRoots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
