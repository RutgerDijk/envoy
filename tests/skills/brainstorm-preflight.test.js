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

test('a topic that starts with a number ("10 ways to speed up CI") -> not existing-issue mode', () => {
  const cwd = makeCwd();
  const { status, out } = runPreflight(cwd, {
    ENVOY_GH_AUTH_STATUS_FAKE: 'ok',
    ENVOY_GH_ISSUE_VIEW_FILE: writeIssueView(cwd, OPEN_82),
  }, ['10 ways to speed up CI']);
  assert.strictEqual(status, 'ok', out);
  assert.ok(!/MODE: existing-issue/.test(out), 'leading number in a topic is not an issue ref');
  assert.ok(!fs.existsSync(path.join(cwd, '.envoy', 'brainstorm', 'session.json')));
});

test('existing-issue mode links the session to the issue in the ledger (so /envoy:start drops it from open brainstorms)', () => {
  const cwd = makeCwd();
  runPreflight(cwd, {
    ENVOY_GH_AUTH_STATUS_FAKE: 'ok',
    ENVOY_GH_ISSUE_VIEW_FILE: writeIssueView(cwd, OPEN_82),
    CLAUDE_SESSION_ID: 'sess-existing-82',
  }, ['#82']);
  const events = fs.readFileSync(path.join(cwd, '.envoy', 'ledger.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(
    events.some((e) => e.sessionId === 'sess-existing-82' && e.issue === 82),
    `a ledger event carries both sessionId and issue 82: ${JSON.stringify(events)}`,
  );
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
