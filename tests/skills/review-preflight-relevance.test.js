#!/usr/bin/env node
/**
 * Review preflight — File relevance section — Test Suite (#83 task-3).
 *
 * Run: node tests/skills/review-preflight-relevance.test.js
 *
 * preflight.js lists the files changed in baseSha..headSha, scores them
 * with lib/relevance-scorer.js scoreTaskRelevance(), and prints the result
 * (formatForPrompt) under a `### File relevance` section. The orchestrator
 * fills layers/ai-review.md's ${relevanceBriefing} from that section.
 *
 * Fail-soft: no changed files / no git → the section says relevance could
 * not be computed and the STATUS tier is unchanged. A result set above 200
 * files is capped and the cap is reported.
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
function makeTmpDir(prefix = 'review-relevance-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(d);
  return d;
}

function writeFile(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function git(dir, args) {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
    },
  }).trim();
}

function initRepo(dir) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
}

function commitAll(dir, msg) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', msg]);
  return git(dir, ['rev-parse', 'HEAD']);
}

function writeHandoff(dir, { baseSha = 'aaaaaaa', headSha = 'bbbbbbb' } = {}) {
  writeFile(dir, '.envoy/pickup/handoff-to-review.json', JSON.stringify({
    $schemaVersion: '1',
    issueNumber: 42,
    branch: 'feature/42-x',
    baseSha,
    headSha,
    tasksCompleted: [{ id: 'task-1', commitSha: headSha }],
    stackProfiles: [],
    producedAt: '2026-04-23T00:00:00Z',
  }));
}

function runPreflight(cwd) {
  const home = makeTmpDir('review-relevance-home-');
  const env = { ...process.env, ENVOY_REPO_ROOT: REPO_ROOT, HOME: home, USERPROFILE: home };
  delete env.ENVOY_HOOK_PROFILE;
  let out;
  try {
    out = execFileSync('node', [PREFLIGHT], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    out = (err.stdout || '') + (err.stderr || '');
  }
  const status = (out.match(/## STATUS: (\w+)/) || [])[1];
  return { status, out };
}

function section(out) {
  const m = out.match(/### File relevance\n([\s\S]*?)(?=\n### |\nNext:|\nGive the |$)/);
  return m ? m[1] : null;
}

// Label printed by formatForPrompt for a file: "- `rel` — <label> (<score>)".
function labelOf(s, rel) {
  const esc = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = s.match(new RegExp('^- `' + esc + '` — (\\w+) \\(', 'm'));
  return m ? m[1] : null;
}

// .envoy/ is runtime state preflight writes into the repo; keep it out of
// the commits so it never shows up as a changed file.
function ignoreEnvoy(dir) { writeFile(dir, '.gitignore', '.envoy/\n'); }

test('import chain -> seed scores full, two hops away scores skim or skip', () => {
  const dir = makeTmpDir();
  initRepo(dir);
  ignoreEnvoy(dir);
  // seed.js -> a.js -> b.js -> c.js (the scorer walks imports forward).
  writeFile(dir, 'src/seed.js', "const a = require('./a');\nmodule.exports = a;\n");
  writeFile(dir, 'src/a.js', "const b = require('./b');\nmodule.exports = b;\n");
  writeFile(dir, 'src/b.js', "const c = require('./c');\nmodule.exports = c;\n");
  writeFile(dir, 'src/c.js', 'module.exports = 1;\n');
  const baseSha = commitAll(dir, 'base');
  writeFile(dir, 'src/seed.js', "const a = require('./a');\nmodule.exports = a + 1;\n");
  const headSha = commitAll(dir, 'change seed');
  writeHandoff(dir, { baseSha, headSha });

  const { status, out } = runPreflight(dir);
  assert.strictEqual(status, 'ok', out);
  const s = section(out);
  assert.ok(s !== null, `expected a ### File relevance section\n${out}`);
  assert.strictEqual(labelOf(s, 'src/seed.js'), 'full', `seed file must score full\n${s}`);
  const oneHop = labelOf(s, 'src/a.js');
  assert.ok(oneHop === 'focused' || oneHop === 'skim', `one-hop file must be listed as focused or skim, got ${oneHop}\n${s}`);
  const twoHop = labelOf(s, 'src/b.js');
  assert.ok(twoHop === 'skim' || twoHop === 'skip', `two-hop file must be listed as skim or skip, got ${twoHop}\n${s}`);
  assert.ok(!/^## Relevant Files/m.test(s), 'formatForPrompt level-2 heading must not leak into the ### section');
});

test('deleted files are excluded from the scored set', () => {
  const dir = makeTmpDir();
  initRepo(dir);
  ignoreEnvoy(dir);
  writeFile(dir, 'keep.js', 'module.exports = 1;\n');
  writeFile(dir, 'gone.js', 'module.exports = 2;\n');
  const baseSha = commitAll(dir, 'base');
  writeFile(dir, 'keep.js', 'module.exports = 3;\n');
  fs.rmSync(path.join(dir, 'gone.js'));
  const headSha = commitAll(dir, 'change');
  writeHandoff(dir, { baseSha, headSha });

  const { status, out } = runPreflight(dir);
  assert.strictEqual(status, 'ok', out);
  const s = section(out);
  assert.ok(s !== null, 'expected a ### File relevance section');
  assert.strictEqual(labelOf(s, 'keep.js'), 'full');
  assert.ok(!s.includes('gone.js'), 'deleted file must not be scored');
});

test('empty diff -> relevance could not be computed, STATUS unchanged', () => {
  const dir = makeTmpDir();
  initRepo(dir);
  ignoreEnvoy(dir);
  writeFile(dir, 'x.js', 'module.exports = 1;\n');
  const sha = commitAll(dir, 'only');
  writeHandoff(dir, { baseSha: sha, headSha: sha });

  const { status, out } = runPreflight(dir);
  assert.strictEqual(status, 'ok', 'an empty diff must not change the STATUS tier');
  const s = section(out);
  assert.ok(s !== null, 'expected a ### File relevance section');
  assert.ok(/relevance could not be computed/i.test(s), `expected fallback message\n${s}`);
});

test('no git repo -> relevance could not be computed, STATUS unchanged', () => {
  const dir = makeTmpDir();
  writeHandoff(dir);
  const { status, out } = runPreflight(dir);
  assert.strictEqual(status, 'ok', 'missing git must not change the STATUS tier');
  const s = section(out);
  assert.ok(s !== null, 'expected a ### File relevance section');
  assert.ok(/relevance could not be computed/i.test(s), `expected fallback message\n${s}`);
});

test('degraded path still prints the section', () => {
  const dir = makeTmpDir();
  initRepo(dir);
  ignoreEnvoy(dir);
  writeFile(dir, 'x.js', 'module.exports = 1;\n');
  const sha = commitAll(dir, 'only');
  writeHandoff(dir, { baseSha: sha, headSha: 'deadbeefdeadbeef' });
  const { status, out } = runPreflight(dir);
  assert.strictEqual(status, 'degraded');
  const s = section(out);
  assert.ok(s !== null, 'expected a ### File relevance section on the degraded path');
  assert.ok(/relevance could not be computed/i.test(s), 'unknown headSha -> fallback message');
});

test('more than 200 scored files -> capped at 200 and the cap is reported with maxDepth', () => {
  const dir = makeTmpDir();
  initRepo(dir);
  ignoreEnvoy(dir);
  writeFile(dir, 'base.js', 'module.exports = 0;\n');
  const baseSha = commitAll(dir, 'base');
  for (let i = 0; i < 205; i++) writeFile(dir, `f/m${i}.js`, `module.exports = ${i};\n`);
  const headSha = commitAll(dir, 'many');
  writeHandoff(dir, { baseSha, headSha });

  const { status, out } = runPreflight(dir);
  assert.strictEqual(status, 'ok', out);
  const s = section(out);
  assert.ok(s !== null, 'expected a ### File relevance section');
  assert.ok(/capped at 200 files/i.test(s), `expected the 200-file cap to be reported\n${s}`);
  assert.ok(/maxDepth\s*3/.test(s), `expected the maxDepth used to be reported\n${s}`);
  // formatForPrompt lists 15 and summarises the rest; after capping, the
  // remainder is 200 - 15.
  assert.ok(s.includes('and 185 more'), `expected results truncated to 200\n${s}`);
});

test('one seed importing 300 files -> the walk itself is capped and reported', () => {
  const dir = makeTmpDir();
  initRepo(dir);
  ignoreEnvoy(dir);
  for (let i = 0; i < 300; i++) writeFile(dir, `m/f${i}.js`, 'module.exports = 1;\n');
  writeFile(dir, 'seed.js', 'module.exports = 0;\n');
  const baseSha = commitAll(dir, 'base');
  writeFile(dir, 'seed.js', Array.from({ length: 300 }, (_, i) => `require('./m/f${i}');`).join('\n') + '\n');
  const headSha = commitAll(dir, 'seed imports 300 files');
  writeHandoff(dir, { baseSha, headSha });

  const { status, out } = runPreflight(dir);
  assert.strictEqual(status, 'ok', out);
  const s = section(out);
  assert.ok(s !== null, 'expected a ### File relevance section');
  assert.strictEqual(labelOf(s, 'seed.js'), 'full');
  assert.ok(/capped at 200 files/i.test(s), `expected the walk cap to be reported\n${s}`);
  assert.ok(!/stopped at maxDepth/i.test(s), `a file-count cap must not be reported as a depth stop\n${s}`);
});

test('non-ASCII file names are scored under their real path (git -z output)', () => {
  const dir = makeTmpDir();
  initRepo(dir);
  ignoreEnvoy(dir);
  writeFile(dir, 'base.js', 'module.exports = 0;\n');
  const baseSha = commitAll(dir, 'base');
  writeFile(dir, 'caf\u00e9 file.js', 'module.exports = 1;\n');
  const headSha = commitAll(dir, 'special name');
  writeHandoff(dir, { baseSha, headSha });

  const { status, out } = runPreflight(dir);
  assert.strictEqual(status, 'ok', out);
  const s = section(out);
  assert.ok(s !== null, 'expected a ### File relevance section');
  assert.strictEqual(labelOf(s, 'caf\u00e9 file.js'), 'full', `expected the unquoted path\n${s}`);
});

for (const d of tmpRoots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
