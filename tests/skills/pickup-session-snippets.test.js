#!/usr/bin/env node
/**
 * Pickup session-state snippets — runnable contract test.
 *
 * steps/tdd.md (Step 9) and steps/verify.md embed shell snippets that update
 * .envoy/pickup/session.json through lib/session-state.js. They run in the
 * CONSUMER project's worktree, so they must resolve the lib from the plugin
 * root (CLAUDE_PLUGIN_ROOT / CLAUDE_SKILL_DIR), never a bare '../../lib'
 * relative require, and must not depend on undefined variables. This test
 * extracts each snippet and executes it in a temp git repo.
 *
 * Run: node tests/skills/pickup-session-snippets.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const STEPS = path.join(REPO_ROOT, 'skills', 'pickup', 'steps');

let passed = 0;
let failed = 0;
const tmpDirs = [];

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

/** Return every fenced code block (any language) mentioning session-state. */
function sessionSnippets(file) {
  const md = fs.readFileSync(path.join(STEPS, file), 'utf8');
  const blocks = [];
  const re = /```(\w*)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md))) {
    if (m[2].includes('session-state')) blocks.push({ lang: m[1], body: m[2] });
  }
  return blocks;
}

/** Temp git repo on `branch`, seeded the way pickup preflight seeds it. */
function seedRepo(branch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pickup-snippet-'));
  tmpDirs.push(dir);
  execFileSync('git', ['init', '-q', '-b', branch], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.envoy', 'pickup'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.envoy-tasks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.envoy', 'pickup', 'session.json'), JSON.stringify({
    $schemaVersion: '1',
    branch: 'unknown',
    plan: 'issue #7',
    issueNumber: 7,
    tasks: [{ id: 'task-1', name: 'First', status: 'pending' }],
    decisions: [],
    nextSteps: [],
  }));
  fs.writeFileSync(path.join(dir, '.envoy-tasks', '7.json'), JSON.stringify({
    tasks: [{ id: 'task-1', title: 'First' }, { id: 'task-2', title: 'Second' }],
  }));
  return dir;
}

function runSnippet(body, cwd) {
  return execFileSync('bash', ['-c', body], {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: REPO_ROOT },
  });
}

const readSession = dir =>
  JSON.parse(fs.readFileSync(path.join(dir, '.envoy', 'pickup', 'session.json'), 'utf8'));

for (const file of ['tdd.md', 'verify.md']) {
  test(`${file}: has a session-state snippet`, () => {
    assert.ok(sessionSnippets(file).length >= 1, `no session-state snippet in ${file}`);
  });

  test(`${file}: snippets resolve the lib from the plugin root, not a bare ../../lib`, () => {
    for (const { body } of sessionSnippets(file)) {
      assert.ok(!/require\(\s*['"`]\.\.\/\.\.\/lib/.test(body), 'bare ../../lib require found');
      assert.ok(!/require\(\s*['"`]\.\/lib/.test(body), 'bare ./lib require found');
      assert.ok(/CLAUDE_PLUGIN_ROOT|CLAUDE_SKILL_DIR/.test(body), 'snippet must use the plugin root');
    }
  });

  test(`${file}: snippets are shell blocks`, () => {
    for (const { lang } of sessionSnippets(file)) assert.strictEqual(lang, 'bash');
  });
}

test('tdd.md Step 9 snippet runs: sets branch from git and adds tasks from .envoy-tasks', () => {
  const dir = seedRepo('feature/7-snippet');
  for (const { body } of sessionSnippets('tdd.md')) runSnippet(body, dir);
  const s = readSession(dir);
  assert.strictEqual(s.branch, 'feature/7-snippet');
  assert.deepStrictEqual(s.tasks.map(t => t.id).sort(), ['task-1', 'task-2']);
});

test('verify.md snippet runs: records next steps', () => {
  const dir = seedRepo('feature/7-snippet');
  for (const { body } of sessionSnippets('verify.md')) runSnippet(body, dir);
  const s = readSession(dir);
  assert.ok(s.nextSteps.length > 0, 'nextSteps must be set');
});

test('docs do not claim finalize clears the session file (cleanup removes it)', () => {
  const files = [
    path.join(STEPS, 'verify.md'),
    path.join(REPO_ROOT, 'docs', 'wiki', 'Context-Efficiency.md'),
    path.join(REPO_ROOT, 'docs', 'wiki', 'Advanced-Patterns.md'),
  ];
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    assert.ok(!/finalize[^\n]*clears/i.test(txt) && !/clears session state/i.test(txt),
      `${path.basename(f)} still claims finalize clears session state`);
  }
});

for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
