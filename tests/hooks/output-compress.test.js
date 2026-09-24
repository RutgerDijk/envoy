#!/usr/bin/env node
/**
 * Output Compress Hook — Test Suite
 *
 * PostToolUse[Bash] hook that runs lib/output-compressor.js over the
 * command's stdout and hands Claude Code the compressed version via
 * hookSpecificOutput.updatedToolOutput (object form, shaped like
 * tool_response — a bare string is ignored for built-in Bash).
 *
 * Fixtures are real `dotnet build` / `dotnet test` logs (.NET 10.0.300,
 * paths normalized to /home/dev/Fx).
 *
 * Run: node tests/hooks/output-compress.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOOKS = path.join(REPO_ROOT, 'hooks');
const RUNNER = path.join(HOOKS, 'hook-runner.js');
const FIXTURES = path.join(__dirname, 'fixtures');

const { compress } = require(path.join(REPO_ROOT, 'lib', 'output-compressor'));

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

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

function bashEvent(command, stdout, extra = {}) {
  return {
    session_id: 'test-session',
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: { stdout, stderr: 'some stderr', interrupted: false, isImage: false, ...extra },
  };
}

/**
 * Invoke hook.run(rawInput) in-process, capturing everything written to stdout.
 * @returns {{ code: any, out: string }}
 */
function runHook(hook, rawInput) {
  const chunks = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  const origLog = console.log;
  const origWriteSync = fs.writeSync;
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
  console.log = (...args) => { chunks.push(args.join(' ') + '\n'); };
  fs.writeSync = (fd, data, ...rest) => {
    if (fd !== 1) return origWriteSync(fd, data, ...rest);
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    const offset = typeof rest[0] === 'number' ? rest[0] : 0;
    const length = typeof rest[1] === 'number' ? rest[1] : buf.length - offset;
    chunks.push(buf.subarray(offset, offset + length).toString());
    return length;
  };
  let code;
  try {
    code = hook.run(rawInput);
  } finally {
    process.stdout.write = origWrite;
    console.log = origLog;
    fs.writeSync = origWriteSync;
  }
  return { code, out: chunks.join('') };
}

function runViaRunner(input, env = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.ENVOY_DISABLED_HOOKS;
  delete childEnv.ENVOY_HOOK_PROFILE;
  Object.assign(childEnv, env);
  return spawnSync('node', [RUNNER, 'output-compress'], {
    input,
    env: childEnv,
    encoding: 'utf8',
  });
}

// ═══════════════════════════════════════════════════════════════════
// Load module
// ═══════════════════════════════════════════════════════════════════

let hook;
try {
  hook = require(path.join(HOOKS, 'output-compress'));
} catch (err) {
  hook = null;
}

section('output-compress: module');

test('hooks/output-compress.js exports run()', () => {
  assert.ok(hook, 'hooks/output-compress.js should exist');
  assert.strictEqual(typeof hook.run, 'function');
});

// ═══════════════════════════════════════════════════════════════════
// Real dotnet build log
// ═══════════════════════════════════════════════════════════════════

section('output-compress: dotnet build (real fixture)');

const buildLog = readFixture('dotnet-build-failed.log');
const expectedErrors = [...new Set(buildLog.split('\n').filter(l => /: error /.test(l)))];

test('fixture contains error lines to check', () => {
  assert.ok(expectedErrors.length >= 3, `expected >=3 distinct error lines, got ${expectedErrors.length}`);
});

test('emits updatedToolOutput object with compressed stdout and original other fields', () => {
  const event = bashEvent('dotnet build', buildLog, { stderr: 'build-stderr', interrupted: true, isImage: false });
  const { code, out } = runHook(hook, JSON.stringify(event));
  assert.ok(code === undefined || code === 0, `exit code should be 0, got ${code}`);
  const parsed = JSON.parse(out);
  const hso = parsed.hookSpecificOutput;
  assert.strictEqual(hso.hookEventName, 'PostToolUse');
  const u = hso.updatedToolOutput;
  assert.strictEqual(typeof u, 'object', 'updatedToolOutput must be an object, not a string');
  assert.strictEqual(u.stderr, 'build-stderr');
  assert.strictEqual(u.interrupted, true);
  assert.strictEqual(u.isImage, false);
  assert.ok(u.stdout.length < buildLog.length, `compressed (${u.stdout.length}) should be shorter than original (${buildLog.length})`);
});

test('every error line survives compression', () => {
  const { out } = runHook(hook, JSON.stringify(bashEvent('dotnet build', buildLog)));
  const stdout = JSON.parse(out).hookSpecificOutput.updatedToolOutput.stdout;
  for (const line of expectedErrors) {
    assert.ok(stdout.includes(line), `missing error line: ${line}`);
  }
});

// ═══════════════════════════════════════════════════════════════════
// Real dotnet test log
// ═══════════════════════════════════════════════════════════════════

section('output-compress: dotnet test (real fixture)');

const testLog = readFixture('dotnet-test-failed.log');
const failedNames = testLog.split('\n')
  .map(l => l.match(/^\s*Failed\s+([\w.]+)/))
  .filter(m => m && m[1].includes('.'))
  .map(m => m[1]);

test('fixture contains failed test names to check', () => {
  assert.ok(failedNames.length >= 2, `expected >=2 failed tests, got ${failedNames.length}`);
});

test('every failed test name survives compression and output is shorter', () => {
  const { out } = runHook(hook, JSON.stringify(bashEvent('dotnet test', testLog)));
  const u = JSON.parse(out).hookSpecificOutput.updatedToolOutput;
  assert.ok(u.stdout.length < testLog.length, `compressed (${u.stdout.length}) should be shorter than original (${testLog.length})`);
  for (const name of failedNames) {
    assert.ok(u.stdout.includes(name), `missing failed test: ${name}`);
  }
  assert.strictEqual(u.stderr, 'some stderr');
});

// ═══════════════════════════════════════════════════════════════════
// Pass-through cases
// ═══════════════════════════════════════════════════════════════════

section('output-compress: pass-through');

test('no matching pattern → no output, exit 0', () => {
  const cmd = 'echo hello-world-unmatched';
  const stdout = 'hello world\n'.repeat(50);
  assert.strictEqual(compress(stdout, cmd).savings.pattern, null, 'precondition: no pattern matches');
  const { code, out } = runHook(hook, JSON.stringify(bashEvent(cmd, stdout)));
  assert.ok(code === undefined || code === 0);
  assert.strictEqual(out, '');
});

test('safeguard ratio tripped → output left unchanged (no output)', () => {
  const cmd = 'dotnet build';
  const stdout = '  Restoring packages and compiling many projects...\n'.repeat(200) + 'Build succeeded.\n    0 Warning(s)\n    0 Error(s)\n';
  const pattern = compress(stdout, cmd).savings.pattern;
  assert.ok(pattern && pattern.endsWith('(safeguard)'), `precondition: safeguard trips, got ${pattern}`);
  const { code, out } = runHook(hook, JSON.stringify(bashEvent(cmd, stdout)));
  assert.ok(code === undefined || code === 0);
  assert.strictEqual(out, '');
});

test('malformed stdin → no output, exit 0 (fail-open)', () => {
  for (const raw of ['{not json', '', 'null', '42', JSON.stringify({ tool_name: 'Bash' }),
    JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'dotnet build' }, tool_response: { stdout: 123 } })]) {
    const { code, out } = runHook(hook, raw);
    assert.ok(code === undefined || code === 0, `code for ${raw}: ${code}`);
    assert.strictEqual(out, '', `output for ${raw}`);
  }
});

test('non-Bash tool → no output', () => {
  const event = { ...bashEvent('dotnet build', buildLog), tool_name: 'Read' };
  const { out } = runHook(hook, JSON.stringify(event));
  assert.strictEqual(out, '');
});

// ═══════════════════════════════════════════════════════════════════
// End-to-end through hook-runner
// ═══════════════════════════════════════════════════════════════════

section('output-compress: via hook-runner');

const buildEventJson = JSON.stringify(bashEvent('dotnet build', buildLog));

test('standard profile → emits compressed JSON', () => {
  const r = runViaRunner(buildEventJson);
  assert.strictEqual(r.status, 0, r.stderr);
  const u = JSON.parse(r.stdout).hookSpecificOutput.updatedToolOutput;
  assert.ok(u.stdout.length < buildLog.length);
});

test('ENVOY_DISABLED_HOOKS=output-compress → exit 0, no output', () => {
  const r = runViaRunner(buildEventJson, { ENVOY_DISABLED_HOOKS: 'foo, output-compress' });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
});

test('minimal profile → exit 0, no output', () => {
  const r = runViaRunner(buildEventJson, { ENVOY_HOOK_PROFILE: 'minimal' });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
});

test('malformed stdin via runner → exit 0, no output', () => {
  const r = runViaRunner('{garbage');
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
});

test('large output (>64KB) is written completely before runner exits', () => {
  const errLines = [];
  for (let i = 0; i < 2000; i++) {
    errLines.push(`/home/dev/Fx/Lib/File${i}.cs(${i},1): error CS0103: The name 'symbol${i}' does not exist in the current context [/home/dev/Fx/Lib/Lib.csproj]`);
  }
  const bigLog = '  Determining projects to restore...\n' + errLines.join('\n') + '\n\nBuild FAILED.\n    0 Warning(s)\n    2000 Error(s)\n';
  const bigStderr = 'x'.repeat(200 * 1024);
  const r = runViaRunner(JSON.stringify(bashEvent('dotnet build', bigLog, { stderr: bigStderr })));
  assert.strictEqual(r.status, 0, r.stderr);
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(r.stdout); }, `stdout must be complete JSON (got ${r.stdout.length} bytes)`);
  assert.ok(r.stdout.length > 64 * 1024, `output should exceed 64KB, got ${r.stdout.length}`);
  const u = parsed.hookSpecificOutput.updatedToolOutput;
  assert.strictEqual(u.stderr, bigStderr);
  assert.ok(u.stdout.includes(errLines[1999]), 'last error line must survive');
});

// ═══════════════════════════════════════════════════════════════════
// False-positive guards: only simple build/test runner invocations
// ═══════════════════════════════════════════════════════════════════

section('output-compress: false-positive guards');

const jestConfig = [
  "/** @type {import('jest').Config} */",
  'module.exports = {',
  "  testEnvironment: 'node',",
  "  // Tests: 3 passed, 3 total",
  "  roots: ['<rootDir>/src'],",
  "  collectCoverageFrom: ['src/**/*.js'],",
  '};',
  '',
].join('\n');

const gitLogP = [
  'commit 1091050abcdef1234567890abcdef12345678901',
  'Author: Dev <dev@example.com>',
  'Date:   Mon Sep 21 10:00:00 2026 +0200',
  '',
  '    fix(stacks): bound detection scans',
  '',
  'diff --git a/lib/stack-loader.js b/lib/stack-loader.js',
  'index 1111111..2222222 100644',
  '--- a/lib/stack-loader.js',
  '+++ b/lib/stack-loader.js',
  '@@ -10,7 +10,7 @@ const MAX_DEPTH = 4;',
  '-const LIMIT = 10000;',
  '+const LIMIT = 2000;',
  "+const DETECTION_EXCLUDES = ['node_modules', 'bin', 'obj', '.git', 'dist', 'build', 'coverage', '.next', 'target', 'vendor', 'packages', '.venv', '__pycache__', '.gradle', '.idea'];",
  ' function scan() {',
  '',
].join('\n');

const statusAndDiff = [
  'On branch feature/x',
  "Your branch is ahead of 'origin/feature/x' by 2 commits.",
  '  (use "git push" to publish your local commits)',
  '',
  'Changes not staged for commit:',
  '\tmodified:   hooks/output-compress.js',
  '',
  'diff --git a/hooks/output-compress.js b/hooks/output-compress.js',
  '--- a/hooks/output-compress.js',
  '+++ b/hooks/output-compress.js',
  '@@ -1,3 +1,3 @@',
  '-old line',
  '+new line',
  '',
].join('\n');

const negativeCases = [
  ['cat jest.config.js', jestConfig],
  ['git log -p -1', gitLogP],
  ['git status && git diff', statusAndDiff],
  ['dotnet test | tail -20', testLog],
  ['dotnet build; echo done', buildLog],
  ['dotnet build $(echo -c Release)', buildLog],
  ['echo `date` && dotnet test', testLog],
  ['dotnet test\nrm -rf x', testLog],
  ['dotnet test &', testLog],
];

for (const [cmd, stdout] of negativeCases) {
  test(`does not compress: ${JSON.stringify(cmd)}`, () => {
    const pre = compress(stdout, cmd);
    assert.ok(pre.savings.pattern && pre.compressed !== stdout,
      `precondition: raw compressor would rewrite this output (pattern=${pre.savings.pattern})`);
    const { code, out } = runHook(hook, JSON.stringify(bashEvent(cmd, stdout)));
    assert.ok(code === undefined || code === 0);
    assert.strictEqual(out, '', `hook must leave output unchanged for ${cmd}`);
  });
}

// Failing runs whose compression would hide the failure (report success or
// drop the failing item's identity). Round-2 review + allowlist audit.
const nodeTestFail = 'not ok 1 - adds\n# fail 1\n';
const mochaFail = '1 failing\n\n1) adds:\n AssertionError\n';
const cargoTestFail = [
  '   Compiling calc v0.1.0 (/home/dev/calc)',
  '    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.52s',
  '     Running unittests src/lib.rs (target/debug/deps/calc-1a2b3c4d5e6f7a8b)',
  '',
  'running 2 tests',
  'test tests::a ... ok',
  'test tests::b ... FAILED',
  '',
  'failures:',
  '',
  '---- tests::b stdout ----',
  "thread 'tests::b' panicked at src/lib.rs:12:9:",
  'assertion `left == right` failed',
  '  left: 3',
  ' right: 4',
  '',
  'failures:',
  '    tests::b',
  '',
  'test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s',
  '',
].join('\n');
const npm10InstallFail = [
  'npm error code ERESOLVE',
  'npm error ERESOLVE unable to resolve dependency tree',
  'npm error',
  'npm error While resolving: app@1.0.0',
  'npm error Found: react@18.2.0',
  'npm error A complete log of this run can be found in: /home/dev/.npm/_logs/x.log',
  '',
].join('\n');
const nextBuildFail = [
  '> app@0.1.0 build',
  '> next build',
  '',
  '   ▲ Next.js 15.0.0',
  '   Creating an optimized production build ...',
  ' ✓ Compiled successfully',
  '   Linting and checking validity of types ...',
  'Failed to compile.',
  '',
  './app/page.tsx:5:7',
  "Type error: Type 'string' is not assignable to type 'number'.",
  '',
].join('\n');
const playwrightDotFail = [
  'Running 3 tests using 1 worker',
  '·F·',
  '',
  '  1) [chromium] › tests/a.spec.ts:8:5 › has title ──────────',
  '',
  '    Error: Timed out 5000ms waiting for expect(page).toHaveTitle(expected)',
  '',
  '    Expected pattern: /Playwright/',
  '    Received string:  "Home"',
  '',
  '      at /home/dev/app/tests/a.spec.ts:10:22',
  '',
  '  1 failed',
  '    [chromium] › tests/a.spec.ts:8:5 › has title ─────────────',
  '  2 passed (8.0s)',
  '',
].join('\n');

negativeCases.push(
  ['npm test', nodeTestFail],
  ['npm test', mochaFail],
  ['npm run test', nodeTestFail],
  ['cargo test', cargoTestFail],
  ['npm install', npm10InstallFail],
  ['npm run build', nextBuildFail],
  ['npx playwright test', playwrightDotFail],
);

for (const [cmd, stdout] of negativeCases.slice(-7)) {
  test(`hides no failure: ${JSON.stringify(cmd)} / ${JSON.stringify(stdout.split('\n')[0])}`, () => {
    const pre = compress(stdout, cmd);
    assert.ok(pre.savings.pattern && !pre.savings.pattern.endsWith('(safeguard)') && pre.compressed !== stdout,
      `precondition: raw compressor would rewrite this output (pattern=${pre.savings.pattern})`);
    const { code, out } = runHook(hook, JSON.stringify(bashEvent(cmd, stdout)));
    assert.ok(code === undefined || code === 0);
    assert.strictEqual(out, '', `hook must leave failing output unchanged for ${cmd}`);
  });
}

// Loss guard: the dotnet patterns can drop code-less MSBuild errors and report
// a solution with one uncompilable test project as "All tests passed."
// (captured with .NET 10.0.300, paths normalized to /home/dev/Fx).
const hostCrash = [
  'Test run for /home/dev/Fx/Lib.Tests/bin/Debug/net10.0/Lib.Tests.dll (.NETCoreApp,Version=v10.0)',
  'The active test run was aborted. Reason: Test host process crashed : Stack overflow.',
  '   at Lib.OrderService.Recurse()',
  'Test Run Aborted with error System.Exception: One or more errors occurred.',
  'Failed!  - Failed:     0, Passed:     4, Skipped:     0, Total:     4, Duration: 84 ms - Lib.Tests.dll (net10.0)',
  '',
].join('\n');

const guardCases = [
  ['dotnet test', readFixture('dotnet-test-mixed-compile-failure.log'), 'captured mixed solution (compile error + Passed!)'],
  ['dotnet build', readFixture('dotnet-build-codeless-error.log'), 'captured code-less MSBuild error'],
  ['dotnet test', hostCrash, 'constructed test host crash'],
];

for (const [cmd, stdout, label] of guardCases) {
  test(`loss guard leaves output unchanged: ${label}`, () => {
    const pre = compress(stdout, cmd);
    assert.ok(pre.savings.pattern && !pre.savings.pattern.endsWith('(safeguard)') && pre.compressed !== stdout,
      `precondition: raw compressor would rewrite this output (pattern=${pre.savings.pattern})`);
    assert.ok(hook.ALLOWED_INVOCATIONS[pre.savings.pattern].test(cmd), 'precondition: command is allowlisted');
    const { code, out } = runHook(hook, JSON.stringify(bashEvent(cmd, stdout)));
    assert.ok(code === undefined || code === 0);
    assert.strictEqual(out, '', `hook must leave output unchanged (${label})`);
  });
}

test('loss guard applies to every allowlisted entry (cargo drops indented code-less error → unchanged)', () => {
  // The cargo pattern keeps only lines that start with "error", so an
  // indented "... error : ..." line from a build script would be lost.
  const cmd = 'cargo build';
  const stdout = [
    '   Compiling calc v0.1.0 (/home/dev/calc)',
    'error[E0425]: cannot find value `x` in this scope',
    ' --> src/main.rs:3:5',
    '  |',
    '3 |     x',
    '  |     ^ not found in this scope',
    '',
    'For more information about this error, try `rustc --explain E0425`.',
    "   = note: build.rs: error : custom build step failed",
    'error: could not compile `calc` (bin "calc") due to 1 previous error',
    '',
  ].join('\n');
  const pre = compress(stdout, cmd);
  assert.ok(pre.savings.pattern === 'cargo' && pre.compressed !== stdout, 'precondition: cargo compresses');
  assert.ok(!pre.compressed.includes('error : custom build step failed'), 'precondition: signal line dropped');
  const { out } = runHook(hook, JSON.stringify(bashEvent(cmd, stdout)));
  assert.strictEqual(out, '');
});

test('allowlist: jest-vitest only for direct jest/vitest; cargo excludes test; npm/playwright removed', () => {
  const A = hook.ALLOWED_INVOCATIONS;
  assert.ok(A['jest-vitest'].test('npx jest --ci') && A['jest-vitest'].test('vitest run'));
  assert.ok(!A['jest-vitest'].test('npm test') && !A['jest-vitest'].test('npm run test'));
  assert.ok(A.cargo.test('cargo build --release') && A.cargo.test('cargo clippy'));
  assert.ok(!A.cargo.test('cargo test'));
  for (const removed of ['npm-install', 'npm-build', 'playwright', 'git-status', 'git-log', 'git-diff-stat', 'docker-compose']) {
    assert.strictEqual(A[removed], undefined, `${removed} must not be allowlisted`);
  }
});

const positiveCases = [
  ['dotnet test 2>&1', testLog],
  ['dotnet test --no-build 2>&1', testLog],
  ['  dotnet build -c Release', buildLog],
];

for (const [cmd, stdout] of positiveCases) {
  test(`still compresses: ${JSON.stringify(cmd)}`, () => {
    const { out } = runHook(hook, JSON.stringify(bashEvent(cmd, stdout)));
    assert.ok(out.length > 0, `expected compression for ${cmd}`);
    const u = JSON.parse(out).hookSpecificOutput.updatedToolOutput;
    assert.ok(u.stdout.length < stdout.length);
  });
}

// ═══════════════════════════════════════════════════════════════════
// Registration
// ═══════════════════════════════════════════════════════════════════

section('output-compress: registration');

test('HOOK_PROFILES lists output-compress for standard and strict', () => {
  const { HOOK_PROFILES } = require(RUNNER);
  assert.deepStrictEqual(HOOK_PROFILES['output-compress'], ['standard', 'strict']);
});

test('hooks.json registers output-compress under PostToolUse matcher Bash', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(HOOKS, 'hooks.json'), 'utf8'));
  const entries = (cfg.hooks.PostToolUse || [])
    .filter(g => g.matcher === 'Bash')
    .flatMap(g => g.hooks)
    .filter(h => /hook-runner\.js"? output-compress\b/.test(h.command));
  assert.strictEqual(entries.length, 1, 'expected exactly one output-compress registration');
  assert.deepStrictEqual(entries[0]._profiles, ['standard', 'strict']);
});

// ═══════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
