#!/usr/bin/env node
/**
 * ABOUTME: Verifies every rigid skill's preflight emits a `skill-started`
 * ABOUTME: ledger event, and the review→finalize handoff emits `handoff-written`.
 *
 * Run: node tests/lib/lifecycle-events.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');

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

function makeTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeJson(dir, rel, data) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(data, null, 2));
}

function readLedger(dir) {
  const p = path.join(dir, '.envoy', 'ledger.jsonl');
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (_err) {
    return [];
  }
  return raw
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

function runPreflight(skillDir, dir, env = {}) {
  const preflight = path.join(REPO_ROOT, 'skills', skillDir, 'preflight.js');
  return spawnSync('node', [preflight], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

// Seeds the state each preflight reads so it reaches its appendEvent call.
const CASES = [
  {
    skillDir: 'review',
    skill: 'review',
    issue: 41,
    seed(dir) {
      writeJson(dir, '.envoy/pickup/handoff-to-review.json', {
        $schemaVersion: '1',
        issueNumber: 41,
        branch: 'feature/41-compliance',
        baseSha: 'aaaaaaa',
        headSha: 'bbbbbbb',
        tasksCompleted: [{ id: 'task-1', commitSha: 'aaaaaaa' }],
      });
    },
  },
  {
    skillDir: 'finalize',
    skill: 'finalize',
    issue: 41,
    seed(dir) {
      writeJson(dir, '.envoy/review/handoff-to-finalize.json', {
        $schemaVersion: '1',
        issueNumber: 41,
        branch: 'feature/41-compliance',
        reviewStatus: 'approved',
        layers: [
          { name: 'lint', status: 'passed', findings: 0 },
          { name: 'tests', status: 'passed', findings: 0 },
        ],
      });
    },
  },
  {
    skillDir: 'cleanup',
    skill: 'cleanup',
    issue: undefined,
    seed() {},
  },
  {
    skillDir: 'fix-ci',
    skill: 'fix-ci',
    issue: 41,
    seed(dir) {
      writeJson(dir, '.envoy/finalize/state.json', {
        $schemaVersion: '1',
        issueNumber: 41,
        branch: 'feature/41-compliance',
        prNumber: 7,
      });
    },
  },
  {
    skillDir: 'wiki-sync',
    skill: 'wiki-sync',
    issue: undefined,
    seed(dir) {
      const wiki = path.join(dir, 'docs', 'wiki');
      fs.mkdirSync(wiki, { recursive: true });
      fs.writeFileSync(path.join(wiki, 'Home.md'), '# Home\n');
    },
  },
  {
    skillDir: 'coderabbit-pr-review',
    skill: 'coderabbit-pr-review',
    issue: 41,
    seed(dir) {
      writeJson(dir, '.envoy/finalize/state.json', {
        $schemaVersion: '1',
        issueNumber: 41,
        branch: 'feature/41-compliance',
        prNumber: 7,
      });
    },
  },
];

section('preflights emit skill-started into .envoy/ledger.jsonl');

for (const c of CASES) {
  test(`${c.skillDir} preflight appends skill-started (skill=${c.skill})`, () => {
    const dir = makeTmp(`lifecycle-${c.skillDir}-`);
    try {
      c.seed(dir);
      const res = runPreflight(c.skillDir, dir);
      const events = readLedger(dir);
      const started = events.filter((e) => e.type === 'skill-started');
      assert.strictEqual(
        started.length,
        1,
        `expected exactly one skill-started event, got ${started.length}. stdout:\n${res.stdout}\nstderr:\n${res.stderr}`
      );
      assert.strictEqual(started[0].skill, c.skill, `skill name mismatch`);
      if (c.issue !== undefined) {
        assert.strictEqual(started[0].issue, c.issue, `issue mismatch for ${c.skillDir}`);
      }
    } finally {
      cleanup(dir);
    }
  });
}

section('preflight output not regressed by the ledger write');

for (const c of CASES) {
  test(`${c.skillDir} preflight still prints a STATUS banner`, () => {
    const dir = makeTmp(`lifecycle-status-${c.skillDir}-`);
    try {
      c.seed(dir);
      const res = runPreflight(c.skillDir, dir);
      assert.ok(
        /## STATUS: (ok|degraded|fatal)/.test(res.stdout),
        `expected a STATUS banner, got:\n${res.stdout}`
      );
    } finally {
      cleanup(dir);
    }
  });
}

section('review→finalize handoff emits handoff-written');

test('review SKILL.md appends handoff-written after writing the finalize handoff', () => {
  const skill = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'review', 'SKILL.md'), 'utf8');
  const writeIdx = skill.indexOf("handoff-to-finalize.json");
  assert.ok(writeIdx !== -1, 'expected the finalize handoff write in review SKILL.md');
  assert.ok(
    /appendEvent\([\s\S]*?type:\s*'handoff-written'[\s\S]*?from:\s*'review'[\s\S]*?to:\s*'finalize'/.test(skill),
    'expected an appendEvent handoff-written(from:review,to:finalize) call'
  );
});

section('hotfix emits skill-started (sanctioned fast-path) without the NaN env bug');

test('hotfix SKILL.md emits a skill-started(hotfix) ledger event', () => {
  const skill = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'hotfix', 'SKILL.md'), 'utf8');
  assert.ok(
    /appendEvent\([\s\S]*?type:\s*'skill-started'[\s\S]*?skill:\s*'hotfix'/.test(skill),
    'expected an appendEvent skill-started(hotfix) call so compliance can flag the sanctioned fast-path'
  );
});

test('hotfix active-skill write passes ISSUE_NUMBER as an env prefix, not a node argv suffix', () => {
  const skill = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'hotfix', 'SKILL.md'), 'utf8');
  // The bug (#43 family): `node -e "..." ISSUE_NUMBER="$ISSUE_NUMBER"` -> argv, so
  // process.env.ISSUE_NUMBER is undefined -> issueNumber: NaN.
  assert.ok(
    !/node -e "[\s\S]*?"\s*ISSUE_NUMBER=/.test(skill),
    'ISSUE_NUMBER must be an env prefix before node, not a suffix after it (else NaN)'
  );
  assert.ok(
    /ISSUE_NUMBER="\$ISSUE_NUMBER"\s+node -e/.test(skill),
    'expected the env-prefix form: ISSUE_NUMBER="$ISSUE_NUMBER" node -e "..."'
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
