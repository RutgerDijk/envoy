#!/usr/bin/env node
/**
 * Pickup complexity + budgeted implementer prompt — Test Suite (#83 task-4).
 *
 * Run: node tests/skills/pickup-preflight-complexity.test.js
 *
 * Covers:
 *   - lib/context-budget.js classifyComplexity's behaviorCount / crossesLayers
 *     signals (backward compatible with the original signal set)
 *   - signalsFromTask(task): files count, behavior count, backend/frontend
 *   - pickup preflight's `### Complexity` table (fail-soft)
 *   - the `node lib/context-budget.js build` CLI: builds the implementer
 *     prompt with buildAgentPrompt, checks it with checkBudget (Constraints —
 *     the verbatim Iron Laws — excluded from the count), trims Reference then
 *     Context when over budget, and records the trim in the ledger
 *   - prompts.md / tdd.md express the implementer prompt via the builder
 *
 * Every run uses a temp cwd (the CLI and preflight both write .envoy/).
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

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
const BUDGET_LIB = path.join(REPO_ROOT, 'lib', 'context-budget.js');
const budget = require(BUDGET_LIB);

const tmpRoots = [];
function makeTmpDir(prefix = 'pickup-complexity-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(d);
  return d;
}

function writeTasksFile(dir, issueNumber, tasks) {
  const payload = { $schemaVersion: '1', issueNumber, strategy: 'batch', tasks };
  fs.mkdirSync(path.join(dir, '.envoy-tasks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.envoy-tasks', `${issueNumber}.json`), JSON.stringify(payload));
}

function runPreflight(cwd, extraEnv = {}) {
  const home = makeTmpDir('pickup-complexity-home-');
  const env = {
    ...process.env,
    ENVOY_REPO_ROOT: REPO_ROOT,
    ENVOY_ISSUE_BODY_FILE: path.join(cwd, 'no-such-issue-body.md'),
    ENVOY_ISSUE_NUMBER: '41',
    HOME: home,
    USERPROFILE: home,
    ...extraEnv,
  };
  let out;
  try {
    out = execFileSync('node', [PREFLIGHT], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    out = (err.stdout || '') + (err.stderr || '');
  }
  const status = (out.match(/## STATUS: (\w+)/) || [])[1];
  return { status, out };
}

function complexitySection(out) {
  const m = out.match(/### Complexity\n([\s\S]*?)(?=\n### |\nNext:|$)/);
  return m ? m[1] : null;
}

function runCli(cwd, args) {
  const r = spawnSync('node', [BUDGET_LIB, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function readLedger(dir) {
  const f = path.join(dir, '.envoy', 'ledger.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function lines(n, label) {
  return Array.from({ length: n }, (_, i) => `${label} line ${i + 1}`).join('\n');
}

function writeParams(dir, params) {
  const f = path.join(dir, 'params.json');
  fs.writeFileSync(f, JSON.stringify(params));
  return f;
}

// ---------------------------------------------------------------------------
console.log('\n  classifyComplexity — new signals, backward compatible');

test('original fixtures unchanged: {filesChanged: 2} → simple, {filesChanged: 6} → standard', () => {
  assert.strictEqual(budget.classifyComplexity({ filesChanged: 2 }).label, 'simple');
  assert.strictEqual(budget.classifyComplexity({ filesChanged: 6 }).label, 'standard');
  assert.strictEqual(budget.classifyComplexity({ servicesAffected: 3 }).label, 'complex');
});

test('crossesLayers lifts a small task to at least standard', () => {
  assert.strictEqual(budget.classifyComplexity({ filesChanged: 2, crossesLayers: true }).label, 'standard');
});

test('behaviorCount >= 3 lifts a small task to standard', () => {
  assert.strictEqual(budget.classifyComplexity({ filesChanged: 1, behaviorCount: 3 }).label, 'standard');
});

test('behaviorCount <= 2 on a small task stays simple', () => {
  assert.strictEqual(budget.classifyComplexity({ filesChanged: 1, behaviorCount: 2 }).label, 'simple');
});

test('many behaviors → complex', () => {
  assert.strictEqual(budget.classifyComplexity({ filesChanged: 3, behaviorCount: 7 }).label, 'complex');
});

console.log('\n  signalsFromTask');

test('counts files and behaviors', () => {
  const s = budget.signalsFromTask({ files: ['a.js', 'b.js', 'c.js'], behavior: ['x', 'y'] });
  assert.strictEqual(s.filesChanged, 3);
  assert.strictEqual(s.behaviorCount, 2);
  assert.strictEqual(s.crossesLayers, false);
});

test('backend .cs + frontend .tsx → crossesLayers', () => {
  const s = budget.signalsFromTask({ files: ['src/Api/Foo.cs', 'web/src/App.tsx'] });
  assert.strictEqual(s.crossesLayers, true);
});

test('backend/ + frontend/ path segments → crossesLayers', () => {
  const s = budget.signalsFromTask({ files: ['backend/handler.ts', 'frontend/src/page.ts'] });
  assert.strictEqual(s.crossesLayers, true);
});

test('all .cs → no crossing', () => {
  const s = budget.signalsFromTask({ files: ['src/A.cs', 'src/B.cs'] });
  assert.strictEqual(s.crossesLayers, false);
});

test('plain .js / .md → no crossing', () => {
  const s = budget.signalsFromTask({ files: ['lib/a.js', 'docs/b.md'] });
  assert.strictEqual(s.crossesLayers, false);
});

test('missing files/behavior do not throw', () => {
  const s = budget.signalsFromTask({});
  assert.strictEqual(s.filesChanged, 0);
  assert.strictEqual(s.behaviorCount, 0);
});

// ---------------------------------------------------------------------------
console.log('\n  pickup preflight — ### Complexity table');

test('prints a Complexity table with task id, tier and model tier for every task', () => {
  const dir = makeTmpDir();
  writeTasksFile(dir, 41, [
    { id: 'task-1', title: 'Small', files: ['lib/a.js'], acceptance: ['ok'] },
    { id: 'task-2', title: 'Full stack', files: ['src/Api/Foo.cs', 'web/src/App.tsx'], behavior: ['a'], acceptance: ['ok'] },
    { id: 'task-3', title: 'Many', files: ['a.js', 'b.js', 'c.js'], behavior: ['1', '2', '3', '4', '5', '6', '7'], acceptance: ['ok'] },
  ]);
  const { status, out } = runPreflight(dir);
  assert.strictEqual(status, 'ok', out);
  const sec = complexitySection(out);
  assert.ok(sec, `expected ### Complexity section:\n${out}`);
  assert.ok(/\| Task \| Tier \| Model tier \|/.test(sec), sec);
  assert.ok(/\| task-1 \| simple \| sonnet \|/.test(sec), sec);
  assert.ok(/\| task-2 \| standard \| sonnet \|/.test(sec), sec);
  assert.ok(/\| task-3 \| complex \| opus \|/.test(sec), sec);
  assert.ok(/advisory/i.test(sec), 'model tier must be labelled advisory');
});

test('Complexity sits before ### Test Command and Known patterns stays intact', () => {
  const dir = makeTmpDir();
  writeTasksFile(dir, 41, [{ id: 'task-1', title: 'Small', files: ['lib/a.js'], acceptance: ['ok'] }]);
  const { out } = runPreflight(dir);
  const c = out.indexOf('### Complexity');
  const t = out.indexOf('### Test Command');
  const k = out.indexOf('### Known patterns');
  assert.ok(c > -1 && t > c && k > t, out);
});

test('fail-soft: a classification error prints a note and STATUS stays ok', () => {
  const dir = makeTmpDir();
  writeTasksFile(dir, 41, [{ id: 'task-1', title: 'Small', files: ['lib/a.js'], acceptance: ['ok'] }]);
  const fakeRoot = makeTmpDir('pickup-complexity-root-');
  fs.cpSync(path.join(REPO_ROOT, 'lib'), path.join(fakeRoot, 'lib'), { recursive: true });
  fs.writeFileSync(
    path.join(fakeRoot, 'lib', 'context-budget.js'),
    "module.exports = { COMPLEXITY: {}, classifyComplexity() { throw new Error('boom'); }, signalsFromTask() { return {}; } };\n",
  );
  const { status, out } = runPreflight(dir, { ENVOY_REPO_ROOT: fakeRoot });
  assert.strictEqual(status, 'ok', out);
  const sec = complexitySection(out);
  assert.ok(sec && /could not be classified/i.test(sec), out);
  assert.ok(out.includes('### Test Command'), 'rest of the briefing still printed');
});

// ---------------------------------------------------------------------------
console.log('\n  context-budget build CLI');

const IRON_LAWS = lines(118, 'law');

test('within budget: prompt printed unchanged, no ledger event', () => {
  const dir = makeTmpDir();
  const f = writeParams(dir, {
    objective: 'Do X', constraints: IRON_LAWS, acceptance: '- works',
    learnings: '(none recorded)', context: 'ctx', reference: 'ref',
  });
  const r = runCli(dir, ['build', f, '--tier', 'standard']);
  assert.strictEqual(r.code, 0, r.err);
  assert.ok(/^BUDGET: within/m.test(r.out), r.out);
  assert.ok(/constraints excluded \(118 fixed lines\)/.test(r.out), r.out);
  assert.ok(r.out.includes('## Reference') && r.out.includes('## Context'), r.out);
  assert.ok(r.out.includes('law line 118'), 'Iron Laws kept verbatim');
  assert.strictEqual(readLedger(dir).length, 0);
});

test('over budget: Reference trimmed first and recorded in the ledger', () => {
  const dir = makeTmpDir();
  const f = writeParams(dir, {
    objective: 'Do X', constraints: IRON_LAWS, acceptance: '- works',
    context: lines(10, 'ctx'), reference: lines(150, 'ref'),
  });
  const r = runCli(dir, ['build', f, '--tier', 'standard', '--task', 'task-9', '--issue', '83']);
  assert.strictEqual(r.code, 0, r.err);
  assert.ok(/^BUDGET: within/m.test(r.out), r.out);
  assert.ok(/^Trimmed: Reference$/m.test(r.out), r.out);
  assert.ok(!r.out.includes('## Reference'), 'Reference section dropped');
  assert.ok(r.out.includes('## Context'), 'Context kept');
  assert.ok(r.out.includes('law line 118'), 'Iron Laws never trimmed');
  const events = readLedger(dir);
  assert.strictEqual(events.length, 1, JSON.stringify(events));
  const e = events[0];
  assert.strictEqual(e.type, 'prompt-budget-trimmed');
  assert.deepStrictEqual(e.trimmed, ['Reference']);
  assert.strictEqual(e.tier, 'standard');
  assert.strictEqual(e.task, 'task-9');
  assert.strictEqual(e.issue, 83);
  assert.strictEqual(e.maxLines, 120);
  assert.strictEqual(typeof e.lines, 'number');
});

test('still over after Reference: Context trimmed next; still over is reported, exit 0', () => {
  const dir = makeTmpDir();
  const f = writeParams(dir, {
    objective: lines(80, 'obj'), constraints: IRON_LAWS, acceptance: '- works',
    learnings: 'L', scratchpad: 'S', context: lines(40, 'ctx'), reference: lines(40, 'ref'),
  });
  const r = runCli(dir, ['build', f, '--tier', 'simple']);
  assert.strictEqual(r.code, 0, r.err);
  assert.ok(/^BUDGET: over/m.test(r.out), r.out);
  assert.ok(/^Trimmed: Reference, Context$/m.test(r.out), r.out);
  assert.ok(r.out.includes('## Known Patterns') && r.out.includes('## Shared State'), 'learnings and scratchpad never trimmed');
  assert.ok(r.out.includes('obj line 80'), 'objective never trimmed');
  const e = readLedger(dir)[0];
  assert.deepStrictEqual(e.trimmed, ['Reference', 'Context']);
  assert.strictEqual(e.withinBudget, false);
});

test('architectural tier never trims', () => {
  const dir = makeTmpDir();
  const f = writeParams(dir, {
    objective: 'X', constraints: IRON_LAWS, acceptance: 'A', reference: lines(500, 'ref'),
  });
  const r = runCli(dir, ['build', f, '--tier', 'architectural']);
  assert.strictEqual(r.code, 0, r.err);
  assert.ok(r.out.includes('## Reference'));
  assert.strictEqual(readLedger(dir).length, 0);
});

test('constraintsFiles are read verbatim and appended to constraints', () => {
  const dir = makeTmpDir();
  fs.writeFileSync(path.join(dir, 'law-a.md'), '# Law A\nrule a');
  fs.writeFileSync(path.join(dir, 'law-b.md'), '# Law B\nrule b');
  const f = writeParams(dir, {
    objective: 'X', constraintsFiles: ['law-a.md', 'law-b.md'], constraints: 'Req 1', acceptance: 'A',
  });
  const r = runCli(dir, ['build', f, '--tier', 'standard']);
  assert.strictEqual(r.code, 0, r.err);
  assert.ok(/# Law A\nrule a\n\n# Law B\nrule b\n\nReq 1/.test(r.out), r.out);
});

test('unknown tier or missing required params → non-zero exit', () => {
  const dir = makeTmpDir();
  const f = writeParams(dir, { objective: 'X', constraints: 'C', acceptance: 'A' });
  assert.notStrictEqual(runCli(dir, ['build', f, '--tier', 'bogus']).code, 0);
  const g = writeParams(dir, { objective: 'X' });
  assert.notStrictEqual(runCli(dir, ['build', g, '--tier', 'standard']).code, 0);
});

// ---------------------------------------------------------------------------
console.log('\n  orderForAttention — monotonic U');

function secs(n) {
  return Array.from({ length: n }, (_, i) => ({ name: `p${10 - i}`, content: 'x', priority: 10 - i }));
}

for (let n = 3; n <= 7; n++) {
  test(`n=${n}: highest first, second last, lowest in the middle, monotonic U`, () => {
    const ordered = budget.orderForAttention(secs(n)).map((x) => x.priority);
    assert.strictEqual(ordered[0], 10);
    assert.strictEqual(ordered[n - 1], 9);
    const lowIdx = ordered.indexOf(Math.min(...ordered));
    assert.ok([Math.floor((n - 1) / 2), Math.ceil((n - 1) / 2)].includes(lowIdx), `lowest at ${lowIdx}: ${ordered}`);
    for (let i = 1; i <= lowIdx; i++) assert.ok(ordered[i] < ordered[i - 1], `descending to the dip: ${ordered}`);
    for (let i = lowIdx + 1; i < n; i++) assert.ok(ordered[i] > ordered[i - 1], `ascending after the dip: ${ordered}`);
  });
}

test('default 6-section implementer layout: Reference (lowest) in the middle, Constraints at the end', () => {
  const p = budget.buildAgentPrompt({
    objective: 'o', constraints: 'c', acceptance: 'a', learnings: 'l', context: 'x', reference: 'r',
  });
  const order = (p.match(/^## .+$/gm) || []).map((h) => h.slice(3));
  assert.deepStrictEqual(order, ['Objective', 'Acceptance Criteria', 'Context', 'Reference', 'Known Patterns', 'Constraints']);
});

// ---------------------------------------------------------------------------
console.log('\n  signalsFromTask — per-file layers');

test('a single file never crosses layers (src/Web/Controllers/X.cs)', () => {
  assert.strictEqual(budget.signalsFromTask({ files: ['src/Web/Controllers/X.cs'] }).crossesLayers, false);
});

test('pure Next.js (app/api/route.ts + components/ui/button.tsx) does not cross', () => {
  assert.strictEqual(budget.signalsFromTask({ files: ['app/api/route.ts', 'components/ui/button.tsx'] }).crossesLayers, false);
});

test('docs-only (docs/api/*.md + docs/ui/*.md) does not cross', () => {
  assert.strictEqual(budget.signalsFromTask({ files: ['docs/api/endpoints.md', 'docs/ui/screens.md'] }).crossesLayers, false);
});

test('true positive: backend/Api/X.cs + frontend/src/App.tsx crosses', () => {
  assert.strictEqual(budget.signalsFromTask({ files: ['backend/Api/X.cs', 'frontend/src/App.tsx'] }).crossesLayers, true);
});

// ---------------------------------------------------------------------------
console.log('\n  build CLI — section files and --out');

test('per-section *File fields are read as plain markdown (no JSON escaping)', () => {
  const dir = makeTmpDir();
  fs.writeFileSync(path.join(dir, 'objective.md'), 'Implement "quoted" thing\nline 2\n');
  fs.writeFileSync(path.join(dir, 'constraints.md'), '**Test command:** npm test -- -t "{{test}}"\n');
  fs.writeFileSync(path.join(dir, 'acceptance.md'), '- works\n');
  fs.writeFileSync(path.join(dir, 'learnings.md'), 'LEARN\n');
  fs.writeFileSync(path.join(dir, 'context.md'), 'CTX\n');
  fs.writeFileSync(path.join(dir, 'reference.md'), 'REF\n');
  fs.writeFileSync(path.join(dir, 'law.md'), '# Law\n');
  const f = writeParams(dir, {
    objectiveFile: 'objective.md', constraintsFiles: ['law.md'], constraintsFile: 'constraints.md',
    acceptanceFile: 'acceptance.md', learningsFile: 'learnings.md', contextFile: 'context.md', referenceFile: 'reference.md',
  });
  const r = runCli(dir, ['build', f, '--tier', 'standard']);
  assert.strictEqual(r.code, 0, r.err);
  assert.ok(r.out.includes('Implement "quoted" thing\nline 2'), r.out);
  assert.ok(r.out.includes('# Law\n\n**Test command:** npm test -- -t "{{test}}"'), r.out);
  for (const m of ['LEARN', 'CTX', 'REF', '- works']) assert.ok(r.out.includes(m), m);
});

test('--out writes the final prompt to a file and stdout carries only the verdict', () => {
  const dir = makeTmpDir();
  const f = writeParams(dir, { objective: 'OBJ', constraints: 'CON', acceptance: 'ACC' });
  const out = path.join(dir, 'prompt.md');
  const r = runCli(dir, ['build', f, '--tier', 'standard', '--out', out]);
  assert.strictEqual(r.code, 0, r.err);
  assert.ok(/^BUDGET: within/m.test(r.out), r.out);
  assert.ok(!r.out.includes('## Objective'), 'prompt not echoed to stdout');
  assert.ok(r.out.includes(out), 'names the output file');
  const written = fs.readFileSync(out, 'utf8');
  assert.ok(written.includes('## Objective\n\nOBJ') && written.includes('## Constraints\n\nCON'), written);
});

test('missing section file → non-zero exit', () => {
  const dir = makeTmpDir();
  const f = writeParams(dir, { objectiveFile: 'nope.md', constraints: 'C', acceptance: 'A' });
  assert.notStrictEqual(runCli(dir, ['build', f, '--tier', 'standard']).code, 0);
});

// ---------------------------------------------------------------------------
console.log('\n  fitToBudget — library validation');

test('fitToBudget throws when objective/constraints/acceptance are missing', () => {
  for (const missing of ['objective', 'constraints', 'acceptance']) {
    const p = { objective: 'o', constraints: 'c', acceptance: 'a' };
    delete p[missing];
    assert.throws(() => budget.fitToBudget(p, budget.COMPLEXITY.standard), new RegExp(missing));
  }
});

// ---------------------------------------------------------------------------
console.log('\n  prompts.md / tdd.md');

const PROMPTS = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'pickup', 'steps', 'prompts.md'), 'utf8');
const TDD = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'pickup', 'steps', 'tdd.md'), 'utf8');

test('prompts.md expresses the implementer prompt as buildAgentPrompt parameters', () => {
  const impl = PROMPTS.split('## Spec Compliance Reviewer Prompt')[0];
  assert.ok(impl.includes('buildAgentPrompt'), 'names buildAgentPrompt');
  assert.ok(impl.includes('checkBudget'), 'names checkBudget');
  assert.ok(impl.includes('lib/context-budget.js build'), 'uses the build CLI');
  for (const key of ['objectiveFile', 'constraintsFiles', 'constraintsFile', 'acceptanceFile', 'learningsFile', 'contextFile', 'referenceFile']) {
    assert.ok(new RegExp(`"${key}"`).test(impl), `params include "${key}"`);
  }
  for (const inj of ['${SCOPE_LAW}', '${TDD_LAW}', '${BLOCKER_PROTOCOL}', '${TASK_GRANULARITY}',
    '${EXECUTION_ANNOUNCE}', '${KNOWN_PATTERNS}', '${SIBLING_INDEX}', '${RESOLVED_TEST_COMMAND}']) {
    assert.ok(impl.includes(inj), `maps ${inj}`);
  }
  assert.ok(/Reference.*first/i.test(impl) && /ledger/i.test(impl), 'states the trim order and the ledger record');
  assert.ok(/advisory/i.test(impl), 'model tier is advisory');
});

test('the test command lives in a never-trimmed section (constraints), not context/reference', () => {
  const impl = PROMPTS.split('## Spec Compliance Reviewer Prompt')[0];
  const row = (file) => (impl.match(new RegExp(`^\\| \`${file}\`.*$`, 'm')) || [''])[0];
  assert.ok(row('constraints.md').includes('${RESOLVED_TEST_COMMAND}'), 'constraints.md carries the test command');
  assert.ok(row('context.md') && !row('context.md').includes('${RESOLVED_TEST_COMMAND}'), 'context is trimmable');
  assert.ok(row('reference.md') && !row('reference.md').includes('${RESOLVED_TEST_COMMAND}'), 'reference is trimmable');
});

test('prompts.md gives one concrete, escape-free recipe', () => {
  const impl = PROMPTS.split('## Spec Compliance Reviewer Prompt')[0];
  assert.ok(impl.includes('D=$(mktemp -d)'), 'temp dir recipe');
  assert.ok(impl.includes('${CLAUDE_SKILL_DIR}/../../contexts/discipline-tdd.md'), 'constraintsFiles via CLAUDE_SKILL_DIR');
  assert.ok(!impl.includes('<absolute path to the plugin>'), 'no vague plugin path placeholder');
  assert.ok(impl.includes('--out'), 'writes the prompt to a file');
  assert.ok(impl.includes('Your full instructions are in'), 'short dispatch prompt pointing at the file');
  assert.ok(/worktree root/i.test(impl), 'CLI runs from the worktree root');
});

test('tdd.md Step 13 item 2 points at the budgeted build', () => {
  const step13 = TDD.split('### Step 13')[1] || '';
  assert.ok(step13.includes('buildAgentPrompt') && step13.includes('context-budget.js build'), step13.slice(0, 400));
  assert.ok(step13.includes('### Complexity'), 'uses the preflight tier');
});

// ---------------------------------------------------------------------------
for (const d of tmpRoots) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
