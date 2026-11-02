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

// The issue-create guard (lib/contract-guard.js) reads an approval marker
// before allowing `gh issue create`. SKILL.md must write exactly that file,
// and must write it before the issue is created (#94).
function guardApprovalPath() {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'lib', 'contract-guard.js'), 'utf8');
  const m = src.match(/path\.join\(\s*cwd\s*,([^)]*issue-plan-approved\.json[^)]*)\)/);
  assert.ok(m, 'contract-guard.js joins a path ending in issue-plan-approved.json');
  const segs = [...m[1].matchAll(/'([^']+)'/g)].map((s) => s[1]);
  return segs.join('/');
}

test('brainstorm SKILL.md names the approval marker path the guard reads', () => {
  const marker = guardApprovalPath();
  assert.strictEqual(marker, '.envoy/brainstorm/issue-plan-approved.json');
  const content = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'brainstorm', 'SKILL.md'), 'utf8');
  assert.ok(content.includes(marker), `SKILL.md mentions ${marker}`);
});

test('brainstorm SKILL.md writes the approval marker before the first issue create command', () => {
  const marker = guardApprovalPath();
  const content = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'brainstorm', 'SKILL.md'), 'utf8');
  const blocks = [...content.matchAll(/```bash\n([\s\S]*?)```/g)]
    .map((b) => ({ start: b.index, body: b[1] }));
  const writeRe = new RegExp(`>\\s*${marker.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`);
  const writeBlock = blocks.find((b) => writeRe.test(b.body));
  assert.ok(writeBlock, `a bash block redirects into ${marker}`);
  const createBlock = blocks.find((b) => /gh issue create/.test(b.body));
  assert.ok(createBlock, 'a bash block runs the issue create');
  const writeAt = writeBlock.start + writeBlock.body.search(writeRe);
  const createAt = createBlock.start + createBlock.body.search(/gh issue create/);
  assert.ok(writeAt < createAt, 'marker write precedes the issue create command');
});

test('brainstorm SKILL.md marker bash block is flush-left and produces a valid marker', () => {
  const marker = guardApprovalPath();
  const content = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'brainstorm', 'SKILL.md'), 'utf8');
  const fence = [...content.matchAll(/^([ \t]*)```bash\n([\s\S]*?)^[ \t]*```/gm)]
    .find((b) => b[2].includes(`> ${marker}`));
  assert.ok(fence, `bash block writing ${marker} found`);
  assert.strictEqual(fence[1], '', 'marker bash block is not indented (heredoc EOF must be flush left)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainstorm-marker-'));
  try {
    execFileSync('bash', ['-c', fence[2]], { cwd: dir, encoding: 'utf8' });
    const data = JSON.parse(fs.readFileSync(path.join(dir, marker), 'utf8'));
    assert.strictEqual(data.$schemaVersion, '1');
    assert.strictEqual(data.approved, true);
    assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(data.approvedAt), `approvedAt is ISO: ${data.approvedAt}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('brainstorm Phase 3.5 requires explicit confirmation and re-presents after edits', () => {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'brainstorm', 'SKILL.md'), 'utf8');
  const phase = content.split('### Phase 3.5')[1].split('### Phase 4')[0].replace(/\s+/g, ' ');
  assert.ok(!/confirms or edits/.test(phase), 'ambiguous "confirms or edits" wording removed');
  assert.ok(/explicitly confirms/i.test(phase), 'requires explicit confirmation');
  assert.ok(/re-present the revised scope/i.test(phase), 're-presents the scope after an edit');
  assert.ok(/never on an edit request/i.test(phase), 'marker is not written on an edit request alone');
});

test('brainstorm Phase 5 removes .envoy/brainstorm/ so a stale session.json does not arm the duplicate-create block', () => {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'brainstorm', 'SKILL.md'), 'utf8');
  const phase5 = content.split('### Phase 5')[1].split(/\n## /)[0];
  const fence = [...phase5.matchAll(/^([ \t]*)```bash\n([\s\S]*?)^[ \t]*```/gm)]
    .find((b) => /\.envoy\/brainstorm/.test(b[2]));
  assert.ok(fence, 'Phase 5 has a bash block that clears .envoy/brainstorm');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainstorm-phase5-'));
  try {
    fs.mkdirSync(path.join(dir, '.envoy', 'brainstorm'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.envoy', 'brainstorm', 'session.json'), '{"$schemaVersion":"1","issueNumber":1}');
    fs.writeFileSync(path.join(dir, '.envoy', 'brainstorm', 'issue-plan-approved.json'), '{}');
    fs.mkdirSync(path.join(dir, '.envoy-tasks'));
    fs.writeFileSync(path.join(dir, '.envoy-tasks', '1.json'), '{}');
    execFileSync('bash', ['-c', fence[2]], { cwd: dir, encoding: 'utf8' });
    assert.ok(!fs.existsSync(path.join(dir, '.envoy', 'brainstorm')), '.envoy/brainstorm removed');
    assert.ok(fs.existsSync(path.join(dir, '.envoy-tasks', '1.json')), 'task handoff left intact');
    const { evaluateIssueCreateGuard } = require(path.join(REPO_ROOT, 'lib', 'contract-guard.js'));
    const r = evaluateIssueCreateGuard(dir, 'gh issue create --title x');
    assert.ok(!r.unconditional, 'next brainstorm is not blocked as a duplicate create');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const d of tmpRoots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
