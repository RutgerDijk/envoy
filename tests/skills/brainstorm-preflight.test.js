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
function runPreflight(cwd, extraEnv = {}, args = []) {
  const env = { ...process.env, ENVOY_REPO_ROOT: REPO_ROOT, ...extraEnv };
  let out;
  try {
    out = execFileSync('node', [PREFLIGHT, ...args], { cwd, env, encoding: 'utf8' });
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

// --- existing-issue mode (#97: /envoy:start dispatches `envoy:brainstorm #<n>`) ---

function writeIssueView(cwd, issue) {
  const f = path.join(cwd, 'issue-view.json');
  fs.writeFileSync(f, JSON.stringify(issue));
  return f;
}

const OPEN_82 = {
  number: 82,
  title: 'Session dashboard should show stale worktrees',
  body: 'Original problem statement from the reporter.\n\nMore context here.',
  state: 'OPEN',
  labels: [{ name: 'feature' }],
};

test('"#82" (quoted $ARGUMENTS string) on an open issue -> ok, existing-issue mode', () => {
  const cwd = makeCwd();
  const { status, out } = runPreflight(cwd, {
    ENVOY_GH_AUTH_STATUS_FAKE: 'ok',
    ENVOY_GH_ISSUE_VIEW_FILE: writeIssueView(cwd, OPEN_82),
  }, ['#82']);
  assert.strictEqual(status, 'ok', out);
  assert.ok(/MODE: existing-issue #82/.test(out), 'reports MODE: existing-issue #82');
  assert.ok(/## Existing issue/.test(out), 'prints an ## Existing issue section');
  assert.ok(/Session dashboard should show stale worktrees/.test(out), 'includes the title');
  assert.ok(/Original problem statement/.test(out), 'includes a body excerpt');
});

test('bare "82" is accepted the same as "#82"', () => {
  const cwd = makeCwd();
  const { status, out } = runPreflight(cwd, {
    ENVOY_GH_AUTH_STATUS_FAKE: 'ok',
    ENVOY_GH_ISSUE_VIEW_FILE: writeIssueView(cwd, OPEN_82),
  }, ['82']);
  assert.strictEqual(status, 'ok', out);
  assert.ok(/MODE: existing-issue #82/.test(out));
});

test('ENVOY_BRAINSTORM_ISSUE env fallback selects existing-issue mode (eval seam)', () => {
  const cwd = makeCwd();
  const { status, out } = runPreflight(cwd, {
    ENVOY_GH_AUTH_STATUS_FAKE: 'ok',
    ENVOY_GH_ISSUE_VIEW_FILE: writeIssueView(cwd, OPEN_82),
    ENVOY_BRAINSTORM_ISSUE: '#82',
  });
  assert.strictEqual(status, 'ok', out);
  assert.ok(/MODE: existing-issue #82/.test(out));
});

test('existing-issue mode arms the duplicate-create guard via .envoy/brainstorm/session.json', () => {
  const cwd = makeCwd();
  runPreflight(cwd, {
    ENVOY_GH_AUTH_STATUS_FAKE: 'ok',
    ENVOY_GH_ISSUE_VIEW_FILE: writeIssueView(cwd, OPEN_82),
  }, ['#82']);
  const session = JSON.parse(fs.readFileSync(path.join(cwd, '.envoy', 'brainstorm', 'session.json'), 'utf8'));
  assert.strictEqual(session.issueNumber, 82);
  assert.strictEqual(session.mode, 'existing-issue');
});

test('existing-issue mode skips the duplicate-title check', () => {
  const cwd = makeCwd();
  const issueListFile = path.join(cwd, 'issues.json');
  fs.writeFileSync(issueListFile, JSON.stringify([{ number: 82, title: OPEN_82.title }]));
  const { status, out } = runPreflight(cwd, {
    ENVOY_GH_AUTH_STATUS_FAKE: 'ok',
    ENVOY_GH_ISSUE_VIEW_FILE: writeIssueView(cwd, OPEN_82),
    ENVOY_GH_ISSUE_LIST_FILE: issueListFile,
    ENVOY_BRAINSTORM_TOPIC: OPEN_82.title,
  }, ['#82']);
  assert.strictEqual(status, 'ok', out);
  assert.ok(!/similar title/i.test(out));
});

test('closed issue -> fatal', () => {
  const cwd = makeCwd();
  const { status, out } = runPreflight(cwd, {
    ENVOY_GH_AUTH_STATUS_FAKE: 'ok',
    ENVOY_GH_ISSUE_VIEW_FILE: writeIssueView(cwd, { ...OPEN_82, state: 'CLOSED' }),
  }, ['#82']);
  assert.strictEqual(status, 'fatal');
  assert.ok(/closed/i.test(out));
  assert.ok(!fs.existsSync(path.join(cwd, '.envoy', 'brainstorm', 'session.json')), 'no session.json on fatal');
});

test('missing issue (gh issue view fails) -> fatal', () => {
  const cwd = makeCwd();
  const { status, out } = runPreflight(cwd, {
    ENVOY_GH_AUTH_STATUS_FAKE: 'ok',
    ENVOY_GH_ISSUE_VIEW_FILE: path.join(cwd, 'does-not-exist.json'),
  }, ['#82']);
  assert.strictEqual(status, 'fatal');
  assert.ok(/#82/.test(out) && /not found|could not/i.test(out));
});

test('issue already carrying an envoy tasks block -> fatal, points at /envoy:pickup', () => {
  const cwd = makeCwd();
  const { renderEmbeddedBlock } = require(path.join(REPO_ROOT, 'lib', 'tasks-embed'));
  const body = `${OPEN_82.body}\n\n${renderEmbeddedBlock({ $schemaVersion: '1', issueNumber: 82, tasks: [] })}`;
  const { status, out } = runPreflight(cwd, {
    ENVOY_GH_AUTH_STATUS_FAKE: 'ok',
    ENVOY_GH_ISSUE_VIEW_FILE: writeIssueView(cwd, { ...OPEN_82, body }),
  }, ['#82']);
  assert.strictEqual(status, 'fatal');
  assert.ok(/\/envoy:pickup 82/.test(out), 'remediation names /envoy:pickup 82');
});

test('no args -> unchanged behaviour (no existing-issue mode, no session.json)', () => {
  const cwd = makeCwd();
  const { status, out } = runPreflight(cwd, { ENVOY_GH_AUTH_STATUS_FAKE: 'ok' }, ['']);
  assert.strictEqual(status, 'ok');
  assert.ok(!/MODE: existing-issue/.test(out));
  assert.ok(!fs.existsSync(path.join(cwd, '.envoy', 'brainstorm', 'session.json')));
});

test('non-numeric args (a topic) -> not existing-issue mode', () => {
  const cwd = makeCwd();
  const { status, out } = runPreflight(cwd, { ENVOY_GH_AUTH_STATUS_FAKE: 'ok' }, ['dark mode toggle']);
  assert.strictEqual(status, 'ok');
  assert.ok(!/MODE: existing-issue/.test(out));
});

test('brainstorm SKILL.md forwards "$ARGUMENTS" quoted to preflight (#89)', () => {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'brainstorm', 'SKILL.md'), 'utf8');
  assert.ok(content.includes('preflight.js "$ARGUMENTS"'));
});

test('brainstorm SKILL.md: existing-issue mode edits the issue via --body-file, never creates', () => {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'brainstorm', 'SKILL.md'), 'utf8');
  assert.ok(/existing-issue/i.test(content), 'documents existing-issue mode');
  assert.ok(/gh issue edit "\$ISSUE_NUMBER" --body-file/.test(content), 'uses gh issue edit --body-file');
});

for (const d of tmpRoots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
