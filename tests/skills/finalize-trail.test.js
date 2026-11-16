#!/usr/bin/env node
/**
 * ABOUTME: Finalize + hotfix append the compliance trail ("## Envoy trail") to the PR body.
 * ABOUTME: Runs the exact documented command in temp dirs and checks both SKILL.md files carry it.
 *
 * Run: node tests/skills/finalize-trail.test.js
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

function section(name) {
  process.stdout.write(`\n\x1b[1m${name}\x1b[0m\n`);
}

const ROOT = path.join(__dirname, '..', '..');
const FINALIZE_SKILL = path.join(ROOT, 'skills', 'finalize', 'SKILL.md');
const HOTFIX_SKILL = path.join(ROOT, 'skills', 'hotfix', 'SKILL.md');

/** The one copy-pasteable command both skills document. */
const CMD = 'node "${CLAUDE_SKILL_DIR}/../../lib/compliance.js" --pr-body "$(git rev-parse --show-toplevel)"';

function makeTmp(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  execFileSync('git', ['init', '-q', dir]);
  return dir;
}

function writeLedger(dir, events) {
  fs.mkdirSync(path.join(dir, '.envoy'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.envoy', 'ledger.jsonl'),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n'
  );
}

/** Run CMD via sh in `cwd` (a git repo) with CLAUDE_SKILL_DIR pointing at the given skill. */
function runCmd(cwd, skill = 'finalize') {
  const r = spawnSync('sh', ['-c', CMD], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_SKILL_DIR: path.join(ROOT, 'skills', skill) },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Extract the fenced block body that follows the heading. */
function fencedBody(out) {
  const m = out.match(/^(`{3,})\n([\s\S]*?)\n\1$/m);
  return m ? { fence: m[1], body: m[2] } : null;
}

function withTmp(prefix, fn) {
  const dir = makeTmp(prefix);
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const B = 'feature/83-trail';
function finalizeLedger() {
  return [
    { ts: '2026-09-20T10:00:00.000Z', branch: B, issue: 83, type: 'skill-started', skill: 'pickup' },
    { ts: '2026-09-20T10:30:00.000Z', branch: B, issue: 83, type: 'handoff-written', from: 'pickup', to: 'review' },
    { ts: '2026-09-20T11:00:00.000Z', branch: B, issue: 83, type: 'skill-started', skill: 'review' },
    { ts: '2026-09-20T11:30:00.000Z', branch: B, issue: 83, type: 'handoff-written', from: 'review', to: 'finalize' },
    { ts: '2026-09-20T12:00:00.000Z', branch: B, issue: 83, type: 'skill-started', skill: 'finalize' },
  ];
}

// ═══════════════════════════════════════════════════════════════════

section('SKILL.md documents the exact command');

test('finalize SKILL.md contains the exact trail command', () => {
  assert.ok(fs.readFileSync(FINALIZE_SKILL, 'utf8').includes(CMD), `missing: ${CMD}`);
});

test('hotfix SKILL.md contains the exact trail command', () => {
  assert.ok(fs.readFileSync(HOTFIX_SKILL, 'utf8').includes(CMD), `missing: ${CMD}`);
});

function stepText(file, from) {
  const md = fs.readFileSync(file, 'utf8');
  return md.slice(md.indexOf(from), md.indexOf('## Integration with Envoy'));
}

/** Assert the body-file flow is per-worktree, chained with &&, and never uses /tmp. */
function assertChainedBodyFile(step, bodyPath) {
  assert.ok(!/\/tmp\/envoy-pr-body/.test(step), 'no shared /tmp body file');
  assert.ok(step.includes(`mkdir -p ${path.dirname(bodyPath)} &&`), `mkdir -p ${path.dirname(bodyPath)} first, chained`);
  assert.ok(step.includes(`${CMD} >> ${bodyPath} &&`), 'trail append chained into PR creation');
  assert.ok(step.includes(`--body-file ${bodyPath}`), `gh pr create --body-file ${bodyPath}`);
  assert.ok(step.indexOf(CMD) < step.indexOf('gh pr create'), 'trail appended before the PR is created');
}

test('finalize Step 2 builds a per-worktree, chained body file ending with the trail', () => {
  const step2 = stepText(FINALIZE_SKILL, '### Step 2');
  assertChainedBodyFile(step2, '.envoy/finalize/pr-body.md');
  assert.ok(/## Envoy trail/.test(step2), 'mentions the ## Envoy trail section');
});

test('hotfix Step 5 builds a per-worktree, chained body file and keeps Closes #', () => {
  const step5 = stepText(HOTFIX_SKILL, '### Step 5');
  assertChainedBodyFile(step5, '.envoy/hotfix/pr-body.md');
  assert.ok(/Closes #/.test(step5), 'body closes the issue');
});

test('hotfix heredoc is quoted (no command substitution from Claude-filled text)', () => {
  const step5 = stepText(HOTFIX_SKILL, '### Step 5');
  const heredocs = step5.match(/<<\s*['"]?\w+['"]?/g) || [];
  assert.ok(heredocs.length > 0, 'has a heredoc');
  for (const h of heredocs) assert.ok(/<<\s*'\w+'/.test(h), `heredoc must be quoted: ${h}`);
  assert.ok(/printf[^\n]*Closes #%s[^\n]*"\$ISSUE_NUMBER"/.test(step5), 'issue number injected via printf');
});

section('(a) finalize ledger → ## Envoy trail, code block, cleanup pending');

test('prints the heading and a fenced trail with cleanup pending', () => {
  withTmp('trail-finalize-', (dir) => {
    writeLedger(dir, finalizeLedger());
    const r = runCmd(dir);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(/^\n?## Envoy trail\n/.test(r.stdout), `heading first: ${JSON.stringify(r.stdout.slice(0, 40))}`);
    assert.strictEqual((r.stdout.match(/## Envoy trail/g) || []).length, 1, 'heading not doubled');
    const block = fencedBody(r.stdout);
    assert.ok(block, `fenced block present:\n${r.stdout}`);
    assert.ok(/✓\s+pickup/.test(block.body));
    assert.ok(/✓\s+finalize/.test(block.body));
    assert.ok(/cleanup\s+pending/.test(block.body), block.body);
    assert.ok(!/✗\s+cleanup/.test(block.body), 'cleanup not rendered as skipped');
  });
});

test('works identically when run from the hotfix skill dir', () => {
  withTmp('trail-finalize-h-', (dir) => {
    writeLedger(dir, finalizeLedger());
    const r = runCmd(dir, 'hotfix');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('## Envoy trail'));
  });
});

test('run from a subdirectory still finds the worktree ledger', () => {
  withTmp('trail-subdir-', (dir) => {
    writeLedger(dir, finalizeLedger());
    const sub = path.join(dir, 'src', 'deep');
    fs.mkdirSync(sub, { recursive: true });
    const r = runCmd(sub);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(/✓\s+finalize/.test(r.stdout), r.stdout);
    assert.ok(!/nothing recorded/i.test(r.stdout));
  });
});

section('(b) hotfix ledger → brainstorm + review sanctioned skips');

test('hotfix trail shows brainstorm and review as sanctioned skips', () => {
  withTmp('trail-hotfix-', (dir) => {
    writeLedger(dir, [
      { ts: '2026-09-21T08:00:00.000Z', branch: 'hotfix/99-crash', issue: 99, type: 'skill-started', skill: 'hotfix' },
    ]);
    const r = runCmd(dir, 'hotfix');
    assert.strictEqual(r.status, 0, r.stderr);
    const block = fencedBody(r.stdout);
    assert.ok(block, r.stdout);
    assert.ok(/brainstorm\s+skipped \(sanctioned/.test(block.body), block.body);
    assert.ok(/review\s+skipped \(sanctioned/.test(block.body), block.body);
    assert.ok(/cleanup\s+pending/.test(block.body), block.body);
    const plain = block.body.split('\n').filter((l) => /✗/.test(l) && /skipped\s*$/.test(l));
    assert.deepStrictEqual(plain, [], 'no unsanctioned skips on a hotfix trail');
  });
});

section('(c) no ledger → nothing recorded, exit 0');

test('empty dir prints nothing-recorded section and exits 0', () => {
  withTmp('trail-empty-', (dir) => {
    const r = runCmd(dir);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('## Envoy trail'));
    assert.ok(fencedBody(r.stdout), 'still a fenced block');
    assert.ok(/nothing recorded/i.test(r.stdout), r.stdout);
  });
});

test('corrupt ledger still exits 0', () => {
  withTmp('trail-corrupt-', (dir) => {
    fs.mkdirSync(path.join(dir, '.envoy'));
    fs.writeFileSync(path.join(dir, '.envoy', 'ledger.jsonl'), '{ not json\n');
    const r = runCmd(dir);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('## Envoy trail'));
  });
});

section('public PR body safety');

test('ledger content with ``` cannot break out of the code block', () => {
  withTmp('trail-fence-', (dir) => {
    writeLedger(dir, [
      { ts: '2026-09-20T10:00:00.000Z', branch: 'evil```\n## injected', issue: 1, type: 'skill-started', skill: 'pickup' },
    ]);
    const r = runCmd(dir);
    assert.strictEqual(r.status, 0, r.stderr);
    const block = fencedBody(r.stdout);
    assert.ok(block, r.stdout);
    assert.ok(block.fence.length > 3, 'fence longer than any backtick run in the content');
    assert.ok(block.body.includes('evil```'), 'content kept inside the block');
    const outside = r.stdout.replace(block.body, '');
    assert.ok(!/## injected/.test(outside), 'no injected heading outside the block');
  });
});

test('absolute home paths are redacted to ~', () => {
  withTmp('trail-home-', (dir) => {
    const home = os.homedir();
    writeLedger(dir, [
      { ts: '2026-09-20T10:00:00.000Z', branch: B, issue: 83, type: 'skill-started', skill: 'pickup' },
      { ts: '2026-09-20T10:30:00.000Z', branch: B, issue: 83, type: 'handoff-written', from: `${home}/secret/pickup`, to: 'review' },
    ]);
    const r = runCmd(dir);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes(home), 'home dir must not leak');
    assert.ok(r.stdout.includes('~/secret/pickup'), r.stdout);
  });
});

test('plain `node lib/compliance.js [dir]` usage still works', () => {
  withTmp('trail-plain-', (dir) => {
    writeLedger(dir, finalizeLedger());
    const out = execFileSync('node', [path.join(ROOT, 'lib', 'compliance.js'), dir], { encoding: 'utf8' });
    assert.ok(out.startsWith('Compliance trail'), out);
    assert.ok(!out.includes('## Envoy trail'));
  });
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
