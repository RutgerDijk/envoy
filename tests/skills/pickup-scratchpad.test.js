#!/usr/bin/env node
/**
 * Pickup parallel implementers share a scratchpad — Test Suite (#83 task-5).
 *
 * Run: node tests/skills/pickup-scratchpad.test.js
 *
 * Covers:
 *   - pickup preflight's `### Scratchpad` section: printed only under
 *     strategy parallel, lists file-overlap conflicts, never writes the pad
 *   - `preflight.js --init-scratchpad`: under parallel writes
 *     .envoy-scratchpad.json with one agent per task scoped to its files and
 *     a posted 'conflict' per overlap (so getConflicts reports it); under
 *     sequential/batch creates nothing; never touches .envoy/ session state
 *   - `preflight.js --scratchpad-briefing <task-id>`: prints
 *     formatBriefing(pad, taskId), rejects unknown ids, and its output lands
 *     in the implementer prompt's Shared State section via the build CLI
 *   - tdd.md Step 12/13 and prompts.md document the flow; cleanup still
 *     removes .envoy-scratchpad.json
 *
 * Every run uses a temp cwd with an isolated HOME.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

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
const scratchpad = require(path.join(REPO_ROOT, 'lib', 'agent-scratchpad.js'));
const { renderEmbeddedBlock } = require(path.join(REPO_ROOT, 'lib', 'tasks-embed'));
const PAD = scratchpad.SCRATCHPAD_FILE;

const tmpRoots = [];
function makeTmpDir(prefix = 'pickup-scratchpad-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(d);
  return d;
}

function task(id, files) {
  return { id, title: `Title ${id}`, files, acceptance: ['works'] };
}

const DISJOINT = [task('task-1', ['lib/a.js']), task('task-2', ['lib/b.js'])];
const OVERLAP = [
  task('task-1', ['lib/a.js', 'lib/shared.js']),
  task('task-2', ['lib/b.js']),
  task('task-3', ['lib/shared.js']),
];

function setup(strategy, tasks) {
  const dir = makeTmpDir();
  const payload = { $schemaVersion: '1', issueNumber: 41, tasks };
  if (strategy) payload.strategy = strategy;
  fs.mkdirSync(path.join(dir, '.envoy-tasks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.envoy-tasks', '41.json'), JSON.stringify(payload));
  return dir;
}

function run(cwd, args = [], extraEnv = {}) {
  const home = makeTmpDir('pickup-scratchpad-home-');
  const env = {
    ...process.env,
    ENVOY_REPO_ROOT: REPO_ROOT,
    ENVOY_ISSUE_BODY_FILE: path.join(cwd, 'no-such-issue-body.md'),
    ENVOY_ISSUE_NUMBER: '41',
    HOME: home,
    USERPROFILE: home,
    ...extraEnv,
  };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  const r = spawnSync('node', [PREFLIGHT, ...args], { cwd, env, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  return { code: r.status, out, stdout: r.stdout || '', status: (out.match(/## STATUS: (\w+)/) || [])[1] };
}

function scratchpadSection(out) {
  const m = out.match(/### Scratchpad\n([\s\S]*?)(?=\n### |\nNext:|$)/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
console.log('\n  preflight briefing — ### Scratchpad');

test('parallel: prints ### Scratchpad and does NOT create the pad', () => {
  const dir = setup('parallel', DISJOINT);
  const r = run(dir);
  assert.strictEqual(r.status, 'ok', r.out);
  const sec = scratchpadSection(r.out);
  assert.ok(sec !== null, `no ### Scratchpad section:\n${r.out}`);
  assert.ok(/no file overlaps/i.test(sec), sec);
  assert.ok(!fs.existsSync(path.join(dir, PAD)), 'briefing run must not write the pad');
});

test('parallel with a shared file: conflict list names both task ids and the file', () => {
  const dir = setup('parallel', OVERLAP);
  const r = run(dir);
  assert.strictEqual(r.status, 'ok', r.out);
  const sec = scratchpadSection(r.out);
  assert.ok(sec, r.out);
  const line = sec.split('\n').find((l) => l.includes('lib/shared.js'));
  assert.ok(line, `conflict line for lib/shared.js missing:\n${sec}`);
  assert.ok(line.includes('task-1') && line.includes('task-3'), line);
  assert.ok(!sec.split('\n').some((l) => l.startsWith('- ') && l.includes('task-2')), 'task-2 has no overlap');
  assert.ok(/batch/i.test(sec), 'section tells Step 12 to fall back to batch');
  assert.ok(!fs.existsSync(path.join(dir, PAD)), 'briefing run must not write the pad');
});

for (const strategy of ['sequential', 'batch', null]) {
  test(`strategy ${strategy || '(unset)'}: overlap list still printed (Step 12 may choose parallel), no pad`, () => {
    const dir = setup(strategy, OVERLAP);
    const r = run(dir);
    assert.strictEqual(r.status, 'ok', r.out);
    const sec = scratchpadSection(r.out);
    assert.ok(sec, r.out);
    assert.ok(/only if[^\n]*parallel/i.test(sec), `labelled as needed only if parallel:\n${sec}`);
    assert.ok(sec.split('\n').some((l) => l.includes('lib/shared.js') && l.includes('task-1') && l.includes('task-3')), sec);
    assert.ok(!fs.existsSync(path.join(dir, PAD)));
  });
}

test('single task: no ### Scratchpad section', () => {
  const dir = setup('parallel', [task('task-1', ['lib/a.js'])]);
  const r = run(dir);
  assert.strictEqual(r.status, 'ok', r.out);
  assert.strictEqual(scratchpadSection(r.out), null, r.out);
});

// ---------------------------------------------------------------------------
console.log('\n  --init-scratchpad');

test('parallel: writes one agent per task scoped to its files', () => {
  const dir = setup('parallel', OVERLAP);
  const r = run(dir, ['--init-scratchpad']);
  assert.strictEqual(r.code, 0, r.out);
  assert.ok(fs.existsSync(path.join(dir, PAD)), r.out);
  const pad = scratchpad.load(dir);
  assert.deepStrictEqual(Object.keys(pad.agents).sort(), ['task-1', 'task-2', 'task-3']);
  assert.deepStrictEqual(pad.agents['task-1'].scope, ['lib/a.js', 'lib/shared.js']);
  assert.deepStrictEqual(pad.agents['task-3'].scope, ['lib/shared.js']);
  assert.strictEqual(pad.agents['task-2'].role, 'Title task-2');
});

test('parallel overlap: getConflicts reports it, naming both tasks and the file', () => {
  const dir = setup('parallel', OVERLAP);
  run(dir, ['--init-scratchpad']);
  const conflicts = scratchpad.getConflicts(scratchpad.load(dir));
  assert.strictEqual(conflicts.length, 1, JSON.stringify(conflicts));
  const c = conflicts[0];
  assert.strictEqual(c.agentId, 'task-3', 'posted under the later task');
  assert.deepStrictEqual(c.affectedFiles, ['lib/shared.js']);
  assert.ok(c.message.includes('task-1') && c.message.includes('task-3'), c.message);
});

test('parallel disjoint: no conflicts', () => {
  const dir = setup('parallel', DISJOINT);
  run(dir, ['--init-scratchpad']);
  assert.ok(fs.existsSync(path.join(dir, PAD)), 'pad written');
  assert.strictEqual(scratchpad.getConflicts(scratchpad.load(dir)).length, 0);
});

test('directory scope overlaps a file beneath it; name prefixes do not', () => {
  const dir = setup('parallel', [
    task('task-1', ['lib/']),
    task('task-2', ['lib/x.js']),
    task('task-3', ['src/a.js']),
    task('task-4', ['src/a.jsx']),
  ]);
  run(dir, ['--init-scratchpad']);
  const conflicts = scratchpad.getConflicts(scratchpad.load(dir));
  assert.strictEqual(conflicts.length, 1, JSON.stringify(conflicts));
  assert.strictEqual(conflicts[0].agentId, 'task-2');
});

test('init does not touch .envoy/ session state', () => {
  const dir = setup('parallel', DISJOINT);
  run(dir, ['--init-scratchpad']);
  assert.ok(!fs.existsSync(path.join(dir, '.envoy', 'pickup', 'session.json')));
  assert.ok(!fs.existsSync(path.join(dir, '.envoy', 'active-skill.json')));
});

for (const strategy of ['batch', 'sequential', null]) {
  test(`tasks file strategy ${strategy || '(unset)'}: --init-scratchpad still creates the pad (orchestrator chose parallel)`, () => {
    const dir = setup(strategy, OVERLAP);
    const r = run(dir, ['--init-scratchpad']);
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(fs.existsSync(path.join(dir, PAD)), r.out);
    assert.deepStrictEqual(Object.keys(scratchpad.load(dir).agents).sort(), ['task-1', 'task-2', 'task-3']);
  });
}

test('no ENVOY_ISSUE_NUMBER: issue number comes from .envoy/pickup/session.json', () => {
  const dir = setup('parallel', DISJOINT);
  fs.mkdirSync(path.join(dir, '.envoy', 'pickup'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.envoy', 'pickup', 'session.json'), JSON.stringify({ issueNumber: 41 }));
  const r = run(dir, ['--init-scratchpad'], { ENVOY_ISSUE_NUMBER: undefined });
  assert.strictEqual(r.code, 0, r.out);
  assert.deepStrictEqual(Object.keys(scratchpad.load(dir).agents).sort(), ['task-1', 'task-2']);
});

test('session.json issueNumber wins over ENVOY_ISSUE_NUMBER', () => {
  const dir = setup('parallel', DISJOINT);
  fs.mkdirSync(path.join(dir, '.envoy', 'pickup'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.envoy', 'pickup', 'session.json'), JSON.stringify({ issueNumber: 41 }));
  const r = run(dir, ['--init-scratchpad'], { ENVOY_ISSUE_NUMBER: '99' });
  assert.strictEqual(r.code, 0, r.out);
  assert.ok(fs.existsSync(path.join(dir, PAD)), r.out);
});

test('tasks file absent in cwd: falls back to the issue\'s embedded block', () => {
  const dir = makeTmpDir();
  const body = path.join(dir, 'issue-body.md');
  fs.writeFileSync(body, `Issue text\n\n${renderEmbeddedBlock({ $schemaVersion: '1', issueNumber: 41, tasks: OVERLAP })}\n`);
  const r = run(dir, ['--init-scratchpad'], { ENVOY_ISSUE_BODY_FILE: body });
  assert.strictEqual(r.code, 0, r.out);
  assert.deepStrictEqual(Object.keys(scratchpad.load(dir).agents).sort(), ['task-1', 'task-2', 'task-3']);
});

test('--exclude keeps batched tasks out of the pad (no CONFLICTS noise)', () => {
  const dir = setup('parallel', OVERLAP);
  const r = run(dir, ['--init-scratchpad', '--exclude', 'task-3']);
  assert.strictEqual(r.code, 0, r.out);
  const pad = scratchpad.load(dir);
  assert.deepStrictEqual(Object.keys(pad.agents).sort(), ['task-1', 'task-2']);
  assert.strictEqual(scratchpad.getConflicts(pad).length, 0);
  assert.ok(!scratchpad.formatBriefing(pad, 'task-1').includes('CONFLICTS'));
});

test('--exclude with an unknown task id is rejected, no pad', () => {
  const dir = setup('parallel', OVERLAP);
  const r = run(dir, ['--init-scratchpad', '--exclude', 'task-9']);
  assert.notStrictEqual(r.code, 0, r.out);
  assert.ok(!fs.existsSync(path.join(dir, PAD)));
});

test('paths are normalized: ./, trailing /, case, bare directory', () => {
  const dir = setup('parallel', [
    task('task-1', ['./Lib/A.js']),
    task('task-2', ['lib/a.js']),
    task('task-3', ['src']),
    task('task-4', ['src/x.js']),
    task('task-5', ['docs/']),
    task('task-6', ['docs']),
  ]);
  run(dir, ['--init-scratchpad']);
  const ids = scratchpad.getConflicts(scratchpad.load(dir)).map((c) => c.agentId).sort();
  assert.deepStrictEqual(ids, ['task-2', 'task-4', 'task-6']);
});

test('task id unsafe for shell use: init refuses, no pad', () => {
  const dir = setup('parallel', [task('task 1;rm', ['a.js']), task('task-2', ['b.js'])]);
  const r = run(dir, ['--init-scratchpad']);
  assert.notStrictEqual(r.code, 0, r.out);
  assert.ok(!fs.existsSync(path.join(dir, PAD)));
});

console.log('\n  argument handling');

for (const args of [['--init-scratchpd'], ['--init-scratchpad', '--bogus'], ['--nope']]) {
  test(`unknown argument ${args.join(' ')} → exit 2, no session reset`, () => {
    const dir = setup('parallel', DISJOINT);
    const r = run(dir, args);
    assert.strictEqual(r.code, 2, r.out);
    assert.ok(/unknown argument/i.test(r.out), r.out);
    assert.ok(!fs.existsSync(path.join(dir, '.envoy', 'pickup', 'session.json')), 'main() must not run');
    assert.ok(!fs.existsSync(path.join(dir, PAD)));
  });
}

test('missing tasks file and no issue block: prints a note, creates no pad, non-zero exit', () => {
  const dir = makeTmpDir();
  const r = run(dir, ['--init-scratchpad']);
  assert.notStrictEqual(r.code, 0);
  assert.ok(/scratchpad not created/i.test(r.out), r.out);
  assert.ok(!fs.existsSync(path.join(dir, PAD)));
});

// ---------------------------------------------------------------------------
console.log('\n  --scratchpad-briefing → implementer prompt');

test('prints formatBriefing(pad, taskId) verbatim', () => {
  const dir = setup('parallel', OVERLAP);
  run(dir, ['--init-scratchpad']);
  const r = run(dir, ['--scratchpad-briefing', 'task-1']);
  assert.strictEqual(r.code, 0, r.out);
  const expected = scratchpad.formatBriefing(scratchpad.load(dir), 'task-1');
  assert.ok(expected.length > 0);
  assert.strictEqual(r.stdout.trim(), expected.trim());
  assert.ok(r.stdout.includes('task-2') && r.stdout.includes('CONFLICTS'), r.stdout);
});

test('rejects a task id that is not a registered agent', () => {
  const dir = setup('parallel', DISJOINT);
  run(dir, ['--init-scratchpad']);
  for (const bad of ['task-9', '$(touch pwned)']) {
    const r = run(dir, ['--scratchpad-briefing', bad]);
    assert.notStrictEqual(r.code, 0, r.out);
    assert.ok(!r.stdout.includes('## Shared Scratchpad'), r.out);
  }
  assert.ok(!fs.existsSync(path.join(dir, 'pwned')));
});

test('no pad on disk: briefing exits non-zero with a note', () => {
  const dir = setup('parallel', DISJOINT);
  const r = run(dir, ['--scratchpad-briefing', 'task-1']);
  assert.notStrictEqual(r.code, 0);
  assert.ok(/no scratchpad/i.test(r.out), r.out);
});

test('built implementer prompt carries the briefing under Shared State', () => {
  const dir = setup('parallel', OVERLAP);
  run(dir, ['--init-scratchpad']);
  const brief = run(dir, ['--scratchpad-briefing', 'task-3']).stdout;
  assert.ok(brief.includes('## Shared Scratchpad'), `briefing empty: ${brief}`);
  const D = makeTmpDir('pickup-scratchpad-params-');
  fs.writeFileSync(path.join(D, 'scratchpad.md'), brief);
  fs.writeFileSync(path.join(D, 'params.json'), JSON.stringify({
    objective: 'Implement Task 3: shared',
    constraints: 'Stage only your own files and commit serially.',
    acceptance: 'works',
    scratchpadFile: 'scratchpad.md',
  }));
  const r = spawnSync('node', [BUDGET_LIB, 'build', path.join(D, 'params.json'), '--tier', 'standard'], { cwd: D, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const prompt = r.stdout.split('===== PROMPT =====')[1] || '';
  assert.ok(prompt.includes('Shared State'), prompt);
  assert.ok(prompt.includes(scratchpad.formatBriefing(scratchpad.load(dir), 'task-3')), prompt);
});

// ---------------------------------------------------------------------------
console.log('\n  --scratchpad-post / --scratchpad-done');

test('post records a discovery other agents see in their briefing', () => {
  const dir = setup('parallel', DISJOINT);
  run(dir, ['--init-scratchpad']);
  const r = run(dir, ['--scratchpad-post', 'task-1', 'discovery', 'Renamed helper foo to bar', 'lib/a.js', 'lib/c.js']);
  assert.strictEqual(r.code, 0, r.out);
  const pad = scratchpad.load(dir);
  const m = pad.messages.find((x) => x.agentId === 'task-1');
  assert.ok(m, JSON.stringify(pad.messages));
  assert.strictEqual(m.category, 'discovery');
  assert.strictEqual(m.message, 'Renamed helper foo to bar');
  assert.deepStrictEqual(m.affectedFiles, ['lib/a.js', 'lib/c.js']);
  const brief = run(dir, ['--scratchpad-briefing', 'task-2']).stdout;
  assert.ok(brief.includes('Renamed helper foo to bar'), brief);
});

for (const [label, args] of [
  ['invalid category', ['--scratchpad-post', 'task-1', 'gossip', 'hi']],
  ['unknown agent', ['--scratchpad-post', 'task-9', 'discovery', 'hi']],
  ['missing message', ['--scratchpad-post', 'task-1', 'discovery']],
  ['unsafe id', ['--scratchpad-post', '$(id)', 'discovery', 'hi']],
]) {
  test(`post rejects ${label}`, () => {
    const dir = setup('parallel', DISJOINT);
    run(dir, ['--init-scratchpad']);
    const before = fs.readFileSync(path.join(dir, PAD), 'utf8');
    const r = run(dir, args);
    assert.notStrictEqual(r.code, 0, r.out);
    assert.strictEqual(fs.readFileSync(path.join(dir, PAD), 'utf8'), before, 'pad unchanged');
  });
}

test('done marks the agent finished; others no longer see it as active', () => {
  const dir = setup('parallel', DISJOINT);
  run(dir, ['--init-scratchpad']);
  const r = run(dir, ['--scratchpad-done', 'task-1']);
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(scratchpad.load(dir).agents['task-1'].status, 'done');
  const brief = run(dir, ['--scratchpad-briefing', 'task-2']).stdout;
  assert.ok(!brief.includes('task-1: '), brief);
});

test('done rejects an unknown agent', () => {
  const dir = setup('parallel', DISJOINT);
  run(dir, ['--init-scratchpad']);
  assert.notStrictEqual(run(dir, ['--scratchpad-done', 'task-9']).code, 0);
});

// ---------------------------------------------------------------------------
console.log('\n  docs');

const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');
const PROMPTS = read('skills', 'pickup', 'steps', 'prompts.md');
const TDD = read('skills', 'pickup', 'steps', 'tdd.md');
const CLEANUP = read('skills', 'cleanup', 'SKILL.md');

function stepBody(md, n) {
  const m = md.match(new RegExp(`### Step ${n}:[\\s\\S]*?(?=\\n### Step |$)`));
  return m ? m[0] : '';
}

test('prompts.md: parallel scratchpad.md comes from --scratchpad-briefing', () => {
  assert.ok(PROMPTS.includes('--scratchpad-briefing'), 'names the briefing command');
  assert.ok(PROMPTS.includes('formatBriefing'), 'names formatBriefing');
  assert.ok(PROMPTS.includes('"scratchpadFile": "scratchpad.md"'));
});

test('prompts.md: parallel constraints commit with pathspecs on the shared index', () => {
  assert.ok(PROMPTS.includes('git add -- <your files> && git commit -m'), 'pathspec add + commit');
  assert.ok(/git commit -m "[^"]*" -- <your files>/.test(PROMPTS), 'commit limited by pathspec');
  assert.ok(/never `?git add -A/i.test(PROMPTS), 'forbids git add -A');
  assert.ok(/never a bare `?git commit/i.test(PROMPTS), 'forbids a bare git commit');
});

test('prompts.md: implementers post, re-read the briefing before committing, and mark done', () => {
  assert.ok(PROMPTS.includes('--scratchpad-post'), 'post command');
  assert.ok(PROMPTS.includes('--scratchpad-done'), 'done command');
  assert.ok(/before (each )?commit/i.test(PROMPTS), 're-read before committing');
  assert.ok(PROMPTS.includes('${CLAUDE_SKILL_DIR}/preflight.js --scratchpad-post'), 'via CLAUDE_SKILL_DIR');
});

test('tdd.md Step 12: overlapping files force batch, citing ### Scratchpad', () => {
  const s12 = stepBody(TDD, 12);
  assert.ok(s12.includes('### Scratchpad'), 'cites the preflight conflict list');
  assert.ok(/overlap/i.test(s12) && /batch/i.test(s12), s12);
  assert.ok(s12.includes('--exclude'), 'batched tasks are excluded from the pad');
  assert.ok(!/section means the tasks file's strategy is not parallel/.test(s12), 'no backwards wording');
});

test('tdd.md Step 13: parallel creates the pad first; sequential/batch do not', () => {
  const s13 = stepBody(TDD, 13);
  assert.ok(s13.includes('--init-scratchpad'), 'documents the init command');
  assert.ok(/sequential or batch/i.test(s13) && /no scratchpad/i.test(s13), 'no pad for sequential/batch');
  assert.ok(/parallel chosen/i.test(s13), 'keyed on the strategy Step 12 chose');
  assert.ok(s13.includes('--exclude'), 'documents --exclude');
});

test('tdd.md keeps all its Step headings', () => {
  for (const n of [9, 10, 11, 12, 13]) assert.ok(TDD.includes(`### Step ${n}:`), `Step ${n}`);
});

test('cleanup residue check still removes .envoy-scratchpad.json', () => {
  const clean = CLEANUP.split('\n').find((l) => l.includes('clean -fdx'));
  assert.ok(clean && clean.includes('.envoy-scratchpad.json'), clean);
  const verify = CLEANUP.split('\n').find((l) => l.includes('status --porcelain --ignored'));
  assert.ok(verify && verify.includes('.envoy-scratchpad.json'), verify);
});

// ---------------------------------------------------------------------------
for (const d of tmpRoots) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
