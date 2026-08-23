#!/usr/bin/env node
/**
 * Stack detection exclusions — Test Suite (#78 hotfix).
 *
 * Run: node tests/lib/stack-detection-exclusions.test.js
 *
 * Detection must probe the project's own files, not its dependencies or
 * runtime debris: nothing may resolve from node_modules/, .git/, bin/,
 * obj/ or .worktrees/, and the application-insights probe must match the
 * lowercase `@microsoft/applicationinsights-web` a real manifest carries.
 *
 * All three implementations are exercised against one fixture tree:
 *  - lib/stack-loader.js detectStacks() — runs through execSync, i.e.
 *    /bin/sh, so these assertions also prove the exclusion flags survive
 *    sh (brace expansion like --exclude-dir={a,b} silently does NOT).
 *  - stacks/detect-stacks.sh --json
 *  - hooks/session-start.sh (SessionStart hook output)
 *
 * Written before the fix exists (RED), per TDD.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

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
const { detectStacks } = require(path.join(REPO_ROOT, 'lib', 'stack-loader'));

// --- Fixture: a project whose ONLY real manifest is package.json with a
// lowercase applicationinsights dependency and a root docker-compose.yml.
// Every other probe-able file sits inside a directory detection must skip.
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'envoy-detect-fixture-'));

function writeFixtureFile(rel, content) {
  const abs = path.join(fixture, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

writeFixtureFile('package.json', JSON.stringify({
  name: 'fixture-app',
  dependencies: {
    '@microsoft/applicationinsights-web': '^3.3.11',
    // Second alternative of the shadcn-radix pattern
    // (@radix-ui|class-variance-authority): alternation only works when
    // grep runs in ERE mode, so this guards the -E flag on the JS path.
    'class-variance-authority': '^0.7.0',
  },
}, null, 2));
writeFixtureFile('docker-compose.yml', 'services: {}\n');
// api-patterns (task-8): the shell path historically hardcoded
// --include="*.csproj" --include="package.json" --include="*.bicep" for
// EVERY content rule, so a rule whose files: list is *.cs (api-patterns)
// never resolved via stacks/detect-stacks.sh or hooks/session-start.sh —
// only via the JS path. This file must be picked up by all three.
writeFixtureFile('Controllers/WidgetsController.cs',
  'namespace App.Controllers { public class WidgetsController : ApiController { } }\n');
// github-actions (code-review fix): `find -name ".github/workflows/*.yml"`
// never matches — -name compares basenames only, a pattern containing a
// slash can never equal one. Needs -path. Caught only now that
// lib/stack-loader.js's `find` invocation is the sole implementation.
writeFixtureFile('.github/workflows/ci.yml', 'on: push\njobs: {}\n');

// Dependency / debris files that must NOT drive detection:
writeFixtureFile('node_modules/use-callback-ref/package.json', JSON.stringify({
  name: 'use-callback-ref',
  peerDependencies: { react: '^16.8.0 || ^17.0.0 || ^18.0.0' },
}, null, 2));
writeFixtureFile('node_modules/some-pkg/tsconfig.json', '{}\n');
writeFixtureFile('.worktrees/12-topic/site.csproj', '<Project Sdk="Microsoft.NET.Sdk" />\n');
writeFixtureFile('.worktrees/12-topic/backend/app.csproj',
  '<Project><ItemGroup><PackageReference Include="Microsoft.EntityFrameworkCore" Version="8.0.0" /></ItemGroup></Project>\n');
writeFixtureFile('bin/package.json', JSON.stringify({
  dependencies: { '@tanstack/react-query': '^5.0.0' },
}, null, 2));
writeFixtureFile('obj/publish/package.json', JSON.stringify({
  dependencies: { 'react-hook-form': '^7.0.0' },
}, null, 2));
writeFixtureFile('.git/package.json', JSON.stringify({
  dependencies: { orval: '^7.0.0' },
}, null, 2));

// --- Run all three implementations once against the fixture.
function runDetectStacksJs() {
  return detectStacks(fixture);
}

function runDetectStacksSh() {
  const script = path.join(REPO_ROOT, 'stacks', 'detect-stacks.sh');
  const out = execSync(`bash "${script}" --json < /dev/null`, {
    encoding: 'utf8', cwd: fixture, timeout: 60000,
  });
  // The human-readable list above the JSON block uses ANSI colors whose
  // escape sequences contain '[' — strip them before locating the array.
  const plain = out.replace(/\x1b\[[0-9;]*m/g, '');
  return JSON.parse(plain.slice(plain.indexOf('\n[') + 1));
}

function runSessionStartHook() {
  const script = path.join(REPO_ROOT, 'hooks', 'session-start.sh');
  const out = execSync(`bash "${script}" < /dev/null`, {
    encoding: 'utf8', cwd: fixture, timeout: 60000,
  });
  const context = JSON.parse(out).hookSpecificOutput.additionalContext;
  const m = context.match(/\*\*Detected stacks:\*\* ([^\n]*)/);
  return m ? m[1].trim().split(/\s+/) : [];
}

let results;
try {
  results = {
    'lib/stack-loader.js detectStacks() [via /bin/sh]': runDetectStacksJs(),
    'stacks/detect-stacks.sh': runDetectStacksSh(),
    'hooks/session-start.sh': runSessionStartHook(),
  };
} finally {
  if (Object.keys(results || {}).length !== 3) {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

const MUST_NOT_DETECT = [
  ['react', 'node_modules/ dependency manifest'],
  ['typescript', 'node_modules/ tsconfig.json'],
  ['dotnet', '.worktrees/ csproj'],
  ['entity-framework', '.worktrees/ csproj content'],
  ['react-query', 'bin/ manifest'],
  ['react-hook-form', 'obj/ manifest'],
  ['orval', '.git/ manifest'],
];

const MUST_DETECT = [
  ['application-insights', 'lowercase @microsoft/applicationinsights-web in the project manifest'],
  ['docker-compose', 'root docker-compose.yml (exclusions must not over-prune)'],
  ['shadcn-radix', 'class-variance-authority via | alternation (requires ERE grep)'],
  ['api-patterns', 'AddControllers|ApiController in a *.cs file (files: list, not hardcoded csproj/package.json/bicep)'],
  ['github-actions', '.github/workflows/ci.yml (find -name never matches a path pattern)'],
  // Both shell scripts unconditionally appended "security" before task-8's
  // consolidation, independent of any other detected stack. Consolidating
  // onto detectStacks()'s conditional gate (dotnet/react/api-patterns only)
  // silently dropped that guarantee for repos matching none of the three —
  // regression caught by code review, not by this fixture (which happens
  // to trip the api-patterns gate). Asserted here regardless of fixture
  // shape so it can't regress silently again.
  ['security', 'always applicable, independent of every other detected stack'],
];

for (const [impl, detected] of Object.entries(results)) {
  for (const [stack, why] of MUST_NOT_DETECT) {
    test(`${impl}: does not detect ${stack} from ${why}`, () => {
      assert.ok(!detected.includes(stack),
        `expected ${stack} to be excluded, detected: [${detected.join(', ')}]`);
    });
  }
  for (const [stack, why] of MUST_DETECT) {
    test(`${impl}: detects ${stack} from ${why}`, () => {
      assert.ok(detected.includes(stack),
        `expected ${stack} to be detected, detected: [${detected.join(', ')}]`);
    });
  }
}

// --- Single-source-of-truth invariant (task-8): the three entry points
// must agree by construction, not by three independently-maintained copies
// happening to list the same stacks. Compare sorted output sets pairwise.
const [jsResult, shResult, hookResult] = Object.values(results);
test('detectStacks() and stacks/detect-stacks.sh --json produce identical results', () => {
  assert.deepStrictEqual([...jsResult].sort(), [...shResult].sort());
});
test('detectStacks() and hooks/session-start.sh produce identical results', () => {
  assert.deepStrictEqual([...jsResult].sort(), [...hookResult].sort());
});

// --- "security" is unconditional (code-review fix), isolated from a
// fixture that matches none of dotnet/react/api-patterns, so this can't
// pass by accident the way MUST_DETECT's shared fixture could.
const bareFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'envoy-detect-bare-'));
fs.writeFileSync(path.join(bareFixture, 'README.md'), '# just a readme, no stack signals\n');
test('detectStacks() includes "security" even with no dotnet/react/api-patterns match', () => {
  const { detectStacks } = require(path.join(REPO_ROOT, 'lib', 'stack-loader'));
  const detected = detectStacks(bareFixture);
  assert.ok(!detected.some(s => ['dotnet', 'react', 'api-patterns'].includes(s)),
    `fixture should not have tripped the old conditional gate: [${detected.join(', ')}]`);
  assert.ok(detected.includes('security'),
    `expected security to be unconditionally detected, got: [${detected.join(', ')}]`);
});
fs.rmSync(bareFixture, { recursive: true, force: true });

// --- A probe that times out must not vanish silently (#78 defect A3 /
// fix item 5). Now that traversal is bounded a timeout should never fire;
// if it does, that is a signal worth surfacing, not a silently dropped
// stack. Warnings go to stderr so the CLI's stdout JSON stays parseable.
test('warnOnProbeFailure() warns on a timeout error', () => {
  const { warnOnProbeFailure } = require(path.join(REPO_ROOT, 'lib', 'stack-loader'));
  const original = console.warn;
  const seen = [];
  console.warn = (...args) => seen.push(args.join(' '));
  try {
    const err = new Error('spawnSync /bin/sh ETIMEDOUT');
    err.code = 'ETIMEDOUT';
    warnOnProbeFailure(err, 'dotnet');
  } finally {
    console.warn = original;
  }
  assert.strictEqual(seen.length, 1, `expected exactly one warning, got ${seen.length}`);
  assert.ok(/dotnet/.test(seen[0]), `warning should name the rule: ${seen[0]}`);
  assert.ok(/timed out/i.test(seen[0]), `warning should say it timed out: ${seen[0]}`);
});

test('warnOnProbeFailure() stays silent for an ordinary non-zero exit', () => {
  const { warnOnProbeFailure } = require(path.join(REPO_ROOT, 'lib', 'stack-loader'));
  const original = console.warn;
  const seen = [];
  console.warn = (...args) => seen.push(args.join(' '));
  try {
    // `find ... | head -1` exits non-zero when nothing matched — the
    // overwhelmingly common "stack simply not present" case. Warning on
    // that would make every run noisy and drown out real timeouts.
    const err = new Error('Command failed');
    err.status = 1;
    warnOnProbeFailure(err, 'react');
  } finally {
    console.warn = original;
  }
  assert.strictEqual(seen.length, 0, `expected no warning, got: ${seen.join(' | ')}`);
});

// --- projectDir shell injection (code-review fix): detectStacks() builds
// execSync command strings with projectDir interpolated unescaped. The
// new CLI entry point (task-8) makes this externally reachable — verified
// `node lib/stack-loader.js '/tmp/"; touch /tmp/envoy-pwned-marker; "'`
// actually creates the marker file.
const injectionMarker = path.join(os.tmpdir(), `envoy-pwned-marker-${process.pid}`);
fs.rmSync(injectionMarker, { force: true });
test('detectStacks() does not execute shell syntax embedded in projectDir', () => {
  const maliciousDir = `/tmp/"; touch ${injectionMarker}; "`;
  detectStacks(maliciousDir);
  assert.ok(!fs.existsSync(injectionMarker),
    `projectDir was interpreted as shell syntax — marker file was created: ${injectionMarker}`);
});
fs.rmSync(injectionMarker, { force: true });

fs.rmSync(fixture, { recursive: true, force: true });

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
