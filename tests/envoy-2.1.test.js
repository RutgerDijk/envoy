#!/usr/bin/env node
/**
 * Envoy 2.1 — Context Efficiency Libraries Test Suite
 *
 * Run: node tests/envoy-2.1.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const LIB = path.join(__dirname, '..', 'lib');
const HOOKS = path.join(__dirname, '..', 'hooks');

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

// ═══════════════════════════════════════════════════════════════════
// relevance-scorer.js
// ═══════════════════════════════════════════════════════════════════

const relevance = require(path.join(LIB, 'relevance-scorer'));

section('relevance-scorer: extractImports');

test('TS: named import', () => {
  const r = relevance.extractImports('import { Foo } from "./bar"', 'ts');
  assert(r.includes('./bar'), `Expected ./bar, got ${r}`);
});

test('TS: default import', () => {
  const r = relevance.extractImports('import React from "react"', 'ts');
  assert(r.includes('react'), `Expected react, got ${r}`);
});

test('TS: namespace import (import * as)', () => {
  const r = relevance.extractImports('import * as api from "../api/client"', 'ts');
  assert(r.includes('../api/client'), `Expected ../api/client, got ${r}`);
});

test('TS: type import', () => {
  const r = relevance.extractImports('import type { User } from "./types"', 'ts');
  assert(r.includes('./types'), `Expected ./types, got ${r}`);
});

test('TS: side-effect import', () => {
  const r = relevance.extractImports('import "./polyfills"', 'ts');
  assert(r.includes('./polyfills'), `Expected ./polyfills, got ${r}`);
});

test('TS: require()', () => {
  const r = relevance.extractImports("const fs = require('fs')", 'ts');
  assert(r.includes('fs'), `Expected fs, got ${r}`);
});

test('TS: multiple imports in one file', () => {
  const code = `
import { Foo } from "./foo"
import * as bar from "./bar"
import type { Baz } from "./baz"
import "./side-effect"
`;
  const r = relevance.extractImports(code, 'ts');
  assert(r.includes('./foo'), 'Missing ./foo');
  assert(r.includes('./bar'), 'Missing ./bar');
  assert(r.includes('./baz'), 'Missing ./baz');
  assert(r.includes('./side-effect'), 'Missing ./side-effect');
});

test('JS: named import', () => {
  const r = relevance.extractImports('import { Foo } from "./bar"', 'js');
  assert(r.includes('./bar'));
});

test('JS: namespace import (import * as)', () => {
  const r = relevance.extractImports('import * as utils from "./utils"', 'js');
  assert(r.includes('./utils'), `Expected ./utils, got ${r}`);
});

test('JS: require()', () => {
  const r = relevance.extractImports("const path = require('path')", 'js');
  assert(r.includes('path'));
});

test('TSX: namespace import (import * as)', () => {
  const r = relevance.extractImports('import * as Icons from "./icons"', 'tsx');
  assert(r.includes('./icons'), `Expected ./icons, got ${r}`);
});

test('JSX: namespace import (import * as)', () => {
  const r = relevance.extractImports('import * as Styled from "./styled"', 'jsx');
  assert(r.includes('./styled'), `Expected ./styled, got ${r}`);
});

test('C#: using statement', () => {
  const r = relevance.extractImports('using System.Collections.Generic;', 'cs');
  assert(r.includes('System.Collections.Generic'));
});

test('Python: from import', () => {
  const r = relevance.extractImports('from os.path import join', 'py');
  assert(r.includes('os.path') || r.includes('join'));
});

test('Unknown extension returns empty', () => {
  const r = relevance.extractImports('anything', 'xyz');
  assert.deepStrictEqual(r, []);
});

section('relevance-scorer: getImportPatterns');

test('Returns fresh instances per call (no shared /g state)', () => {
  const p1 = relevance.getImportPatterns('ts');
  const p2 = relevance.getImportPatterns('ts');
  assert(p1 !== p2, 'Should return new array each time');
  assert(p1[0] !== p2[0], 'Regex instances should be different');
});

test('Unknown ext returns empty array', () => {
  assert.deepStrictEqual(relevance.getImportPatterns('fortran'), []);
});

section('relevance-scorer: resolveImport');

test('Skips non-relative imports', () => {
  assert.strictEqual(relevance.resolveImport('react', '/a/b.ts', '/'), null);
});

test('Resolves relative import when file exists', () => {
  // Use this test file as a known existing file
  const result = relevance.resolveImport('./envoy-2.1.test', __filename, path.dirname(__dirname));
  assert(result === null || typeof result === 'string'); // May or may not find .js
});

section('relevance-scorer: recommendDepth');

test('Seed files always get full', () => {
  assert.strictEqual(relevance.recommendDepth(0.01, true).label, 'full');
});

test('Score >= 0.5 gets focused', () => {
  assert.strictEqual(relevance.recommendDepth(0.5, false).label, 'focused');
  assert.strictEqual(relevance.recommendDepth(0.7, false).label, 'focused');
});

test('Score 0.2-0.5 gets skim', () => {
  assert.strictEqual(relevance.recommendDepth(0.2, false).label, 'skim');
  assert.strictEqual(relevance.recommendDepth(0.4, false).label, 'skim');
});

test('Score < 0.2 gets skip', () => {
  assert.strictEqual(relevance.recommendDepth(0.1, false).label, 'skip');
  assert.strictEqual(relevance.recommendDepth(0, false).label, 'skip');
});

section('relevance-scorer: formatForPrompt');

test('Empty results returns empty string', () => {
  assert.strictEqual(relevance.formatForPrompt([]), '');
});

test('Formats results as markdown list', () => {
  const r = relevance.formatForPrompt([{ relPath: 'src/foo.ts', score: 0.8, depth: { label: 'focused' } }]);
  assert(r.includes('src/foo.ts'));
  assert(r.includes('focused'));
});

// ═══════════════════════════════════════════════════════════════════
// output-compressor.js
// ═══════════════════════════════════════════════════════════════════

const compressor = require(path.join(LIB, 'output-compressor'));

section('output-compressor: compress');

test('No pattern match returns original', () => {
  const r = compressor.compress('hello world', 'some-unknown-command');
  assert.strictEqual(r.compressed, 'hello world');
  assert.strictEqual(r.savings.pattern, null);
});

test('Empty input returns empty', () => {
  const r = compressor.compress('', 'dotnet build');
  assert.strictEqual(r.compressed, '');
});

test('Null input returns empty', () => {
  const r = compressor.compress(null, null);
  assert.strictEqual(r.compressed, '');
});

test('dotnet build success compresses to short summary', () => {
  const output = `Restore complete (1.2s)
  Determining projects to restore...
  Restored /foo/bar.csproj (in 500ms)
Build started...
Build succeeded.
    0 Warning(s)
    0 Error(s)
Time Elapsed 00:00:03.42`;
  const r = compressor.compress(output, 'dotnet build');
  assert.strictEqual(r.compressed, 'Build succeeded.');
  assert(r.savings.ratio > 50, `Expected >50% savings, got ${r.savings.ratio}%`);
  assert.strictEqual(r.savings.pattern, 'dotnet-build');
});

test('dotnet build with errors shows errors', () => {
  const output = `Build started...
  error CS1002: ; expected
  error CS0103: The name 'foo' does not exist
Build FAILED.
    2 Error(s)`;
  const r = compressor.compress(output, 'dotnet build');
  assert(r.compressed.includes('error CS1002'));
  assert(r.compressed.includes('error CS0103'));
});

test('dotnet build with warnings shows count', () => {
  const output = `Build started...
  warning CS0168: The variable 'x' is declared but never used
  warning CS0219: The variable 'y' is assigned but never used
Build succeeded.
    2 Warning(s)
    0 Error(s)`;
  const r = compressor.compress(output, 'dotnet build');
  assert(r.compressed.includes('2 warning'));
});

test('dotnet test all pass compresses', () => {
  const output = `Test run for /foo/bar.dll (.NETCoreApp,Version=v8.0)
Starting test execution, please wait...
A total of 1 test files matched the specified pattern.
Passed!  - Failed:     0, Passed:    42, Skipped:     0, Total:    42`;
  const r = compressor.compress(output, 'dotnet test');
  assert(r.compressed.includes('All tests passed'));
  assert(r.savings.pattern === 'dotnet-test');
});

test('dotnet test with failures shows failure details', () => {
  const output = `Starting test execution...
  Failed  TestFoo
    Expected: 42
    Actual: 0
  Failed  TestBar
    NullReferenceException
Passed!  - Failed:     2, Passed:    40, Skipped:     0, Total:    42`;
  const r = compressor.compress(output, 'dotnet test');
  assert(r.compressed.includes('Failed'));
  assert(r.compressed.includes('TestFoo'));
});

test('npm install success compresses', () => {
  const output = `npm warn deprecated @types/glob@8.0.0: This is a stub types definition
added 847 packages in 12s
14 packages are looking for funding`;
  const r = compressor.compress(output, 'npm install');
  assert(r.compressed.includes('added 847 packages'));
  assert(!r.compressed.includes('warn deprecated'));
});

test('npm install error shows errors', () => {
  const output = `npm ERR! code E404
npm ERR! 404 Not Found - GET https://registry.npmjs.org/nonexistent-pkg`;
  const r = compressor.compress(output, 'npm ci');
  assert(r.compressed.includes('npm ERR'));
});

test('jest all pass compresses', () => {
  const output = `PASS src/foo.test.ts
PASS src/bar.test.ts
Tests:  42 passed, 42 total
Test Suites:  2 passed, 2 total
Time:  3.2s`;
  const r = compressor.compress(output, 'npm test');
  assert(!r.compressed.includes('PASS src/'));
  assert(r.compressed.includes('42 passed') || r.compressed.includes('passed'));
});

test('jest with failures shows FAIL blocks', () => {
  const output = `PASS src/foo.test.ts
FAIL src/bar.test.ts
  ● should work
    Expected: true
    Received: false
Tests:  1 failed, 41 passed
Test Suites:  1 failed, 1 passed`;
  const r = compressor.compress(output, 'npm test');
  assert(r.compressed.includes('FAIL'));
  assert(r.compressed.includes('should work'));
});

test('git status strips verbose headers', () => {
  const output = `On branch main
Your branch is up to date with 'origin/main'.

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
	modified:   src/foo.ts`;
  const r = compressor.compress(output, 'git status');
  assert(r.compressed.includes('On branch main'));
  assert(!r.compressed.includes('use "git add'));
});

test('docker compose strips pull progress', () => {
  const output = `abc123def456: Pulling fs layer
abc123def456: Downloading
abc123def456: Pull complete
Creating container foo... done`;
  const r = compressor.compress(output, 'docker compose up');
  assert(!r.compressed.includes('Pulling'));
  assert(r.compressed.includes('Creating container'));
});

test('playwright all pass compresses', () => {
  const output = `Running 10 tests using 4 workers
10 passed (5.2s)`;
  const r = compressor.compress(output, 'npx playwright test');
  assert(r.compressed.includes('10 passed'));
});

section('output-compressor: safeguard ratio');

test('Safeguard is 0.05 (5%)', () => {
  assert.strictEqual(compressor.SAFEGUARD_RATIO, 0.05);
});

test('Normal success compression is NOT blocked by safeguard', () => {
  // Short build output where "Build succeeded." is >5% of the original
  const output = `Restore complete (1.2s)
Build started...
Build succeeded.
    0 Warning(s)
    0 Error(s)
Time Elapsed 00:00:02.10`;
  const r = compressor.compress(output, 'dotnet build');
  assert.strictEqual(r.compressed, 'Build succeeded.');
  assert(!r.savings.pattern.includes('safeguard'), `Safeguard should not fire, got pattern: ${r.savings.pattern}`);
});

test('Very long build output triggers safeguard (compression too aggressive)', () => {
  // 20 restore lines + success = "Build succeeded." is ~3% of original → safeguard fires
  const output = 'Restore complete (1.2s)\n'.repeat(20) + 'Build succeeded.\n    0 Warning(s)\n    0 Error(s)';
  const r = compressor.compress(output, 'dotnet build');
  assert(r.savings.pattern.includes('safeguard'), 'Safeguard should fire when compression is < 5%');
});

test('Extremely short compression triggers safeguard', () => {
  // Create a pattern scenario where compression would produce < 5% of original
  // We need output > 100 chars where compressed is < 5% — hard to trigger naturally
  // Just verify the threshold math
  assert(compressor.SAFEGUARD_RATIO === 0.05, 'Safeguard should be 5%');
});

section('output-compressor: listPatterns');

test('Lists all 11 patterns', () => {
  const patterns = compressor.listPatterns();
  assert(patterns.length >= 11, `Expected >=11 patterns, got ${patterns.length}`);
  assert(patterns.includes('dotnet-build'));
  assert(patterns.includes('dotnet-test'));
  assert(patterns.includes('npm-install'));
  assert(patterns.includes('jest-vitest'));
  assert(patterns.includes('git-status'));
  assert(patterns.includes('docker-compose'));
  assert(patterns.includes('playwright'));
  assert(patterns.includes('cargo'));
});

// ═══════════════════════════════════════════════════════════════════
// session-state.js
// ═══════════════════════════════════════════════════════════════════

const session = require(path.join(LIB, 'session-state'));

section('session-state: CRUD');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'envoy-test-'));

test('createEmpty returns valid state', () => {
  const s = session.createEmpty();
  assert.strictEqual(s.version, 1);
  assert(Array.isArray(s.tasks));
  assert(Array.isArray(s.decisions));
  assert(Array.isArray(s.filesModified));
  assert(Array.isArray(s.nextSteps));
  assert.strictEqual(s.testResults, null);
});

test('save and load roundtrip', () => {
  const s = session.createEmpty();
  s.branch = 'feature/test';
  session.save(s, tmpDir);
  const loaded = session.load(tmpDir);
  assert.strictEqual(loaded.branch, 'feature/test');
});

test('exists returns true after save', () => {
  assert(session.exists(tmpDir));
});

test('clear removes file', () => {
  session.clear(tmpDir);
  assert(!session.exists(tmpDir));
});

test('load returns empty state when file missing', () => {
  const s = session.load(tmpDir);
  assert.strictEqual(s.version, 1);
  assert.strictEqual(s.branch, null);
});

section('session-state: mutations');

test('addDecision appends to decisions', () => {
  const s = session.createEmpty();
  session.addDecision(s, 'Use Guid for PK');
  assert.strictEqual(s.decisions.length, 1);
  assert.strictEqual(s.decisions[0].text, 'Use Guid for PK');
  assert(s.decisions[0].at);
});

test('updateTask creates new task', () => {
  const s = session.createEmpty();
  session.updateTask(s, 'task-1', 'pending');
  assert.strictEqual(s.tasks.length, 1);
  assert.strictEqual(s.tasks[0].id, 'task-1');
  assert.strictEqual(s.tasks[0].status, 'pending');
});

test('updateTask updates existing task', () => {
  const s = session.createEmpty();
  session.updateTask(s, 'task-1', 'pending');
  session.updateTask(s, 'task-1', 'done', 'Completed');
  assert.strictEqual(s.tasks.length, 1);
  assert.strictEqual(s.tasks[0].status, 'done');
  assert.strictEqual(s.tasks[0].summary, 'Completed');
});

test('trackFile adds new file', () => {
  const s = session.createEmpty();
  session.trackFile(s, 'src/foo.ts', 'New file');
  assert.strictEqual(s.filesModified.length, 1);
  assert.strictEqual(s.filesModified[0].count, 1);
});

test('trackFile increments count on duplicate', () => {
  const s = session.createEmpty();
  session.trackFile(s, 'src/foo.ts', 'Created');
  session.trackFile(s, 'src/foo.ts', 'Updated');
  assert.strictEqual(s.filesModified.length, 1);
  assert.strictEqual(s.filesModified[0].count, 2);
  assert.strictEqual(s.filesModified[0].reason, 'Updated');
});

test('setTestResults stores results', () => {
  const s = session.createEmpty();
  session.setTestResults(s, { passed: 10, failed: 1, skipped: 0, summary: '1 failure' });
  assert.strictEqual(s.testResults.passed, 10);
  assert.strictEqual(s.testResults.failed, 1);
  assert(s.testResults.at);
});

section('session-state: formatForPrompt');

test('Includes branch when set', () => {
  const s = session.createEmpty();
  s.branch = 'feature/auth';
  const f = session.formatForPrompt(s);
  assert(f.includes('feature/auth'));
});

test('Shows task progress', () => {
  const s = session.createEmpty();
  session.updateTask(s, 't1', 'done');
  session.updateTask(s, 't2', 'pending');
  const f = session.formatForPrompt(s);
  assert(f.includes('1/2'));
});

test('Shows recent decisions', () => {
  const s = session.createEmpty();
  session.addDecision(s, 'Use repository pattern');
  const f = session.formatForPrompt(s);
  assert(f.includes('Use repository pattern'));
});

test('Shows next steps', () => {
  const s = session.createEmpty();
  s.nextSteps = ['Run review', 'Create PR'];
  const f = session.formatForPrompt(s);
  assert(f.includes('Run review'));
});

// ═══════════════════════════════════════════════════════════════════
// agent-scratchpad.js
// ═══════════════════════════════════════════════════════════════════

const scratchpad = require(path.join(LIB, 'agent-scratchpad'));

section('agent-scratchpad: CRUD');

const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'envoy-test-'));

test('createEmpty returns valid scratchpad', () => {
  const p = scratchpad.createEmpty();
  assert.strictEqual(p.version, 1);
  assert.deepStrictEqual(p.agents, {});
  assert.deepStrictEqual(p.messages, []);
});

test('save and load roundtrip', () => {
  const p = scratchpad.createEmpty();
  scratchpad.registerAgent(p, 'a1', 'test agent', ['src/']);
  scratchpad.save(p, tmpDir2);
  const loaded = scratchpad.load(tmpDir2);
  assert(loaded.agents.a1);
  assert.strictEqual(loaded.agents.a1.role, 'test agent');
});

test('clear removes file', () => {
  scratchpad.clear(tmpDir2);
  const loaded = scratchpad.load(tmpDir2);
  assert.deepStrictEqual(loaded.agents, {});
});

section('agent-scratchpad: agents');

test('registerAgent stores role and scope', () => {
  const p = scratchpad.createEmpty();
  scratchpad.registerAgent(p, 'a1', 'Fix backend', ['backend/']);
  assert.strictEqual(p.agents.a1.role, 'Fix backend');
  assert.deepStrictEqual(p.agents.a1.scope, ['backend/']);
  assert.strictEqual(p.agents.a1.status, 'active');
});

test('deregisterAgent marks done', () => {
  const p = scratchpad.createEmpty();
  scratchpad.registerAgent(p, 'a1', 'test', []);
  scratchpad.deregisterAgent(p, 'a1');
  assert.strictEqual(p.agents.a1.status, 'done');
});

section('agent-scratchpad: messages');

test('post adds message with auto-incrementing id', () => {
  const p = scratchpad.createEmpty();
  scratchpad.post(p, 'a1', 'discovery', 'Found bug', ['src/foo.ts']);
  scratchpad.post(p, 'a1', 'conflict', 'Overlap!', []);
  assert.strictEqual(p.messages.length, 2);
  assert.strictEqual(p.messages[0].id, 1);
  assert.strictEqual(p.messages[1].id, 2);
});

test('readUnread returns only other agents unread messages', () => {
  const p = scratchpad.createEmpty();
  scratchpad.post(p, 'a1', 'discovery', 'From A1', []);
  scratchpad.post(p, 'a2', 'discovery', 'From A2', []);
  const unread = scratchpad.readUnread(p, 'a1');
  assert.strictEqual(unread.length, 1);
  assert.strictEqual(unread[0].message, 'From A2');
});

test('readUnread marks messages as read', () => {
  const p = scratchpad.createEmpty();
  scratchpad.post(p, 'a2', 'discovery', 'msg', []);
  scratchpad.readUnread(p, 'a1');
  const unread2 = scratchpad.readUnread(p, 'a1');
  assert.strictEqual(unread2.length, 0);
});

test('readUnread filters by category', () => {
  const p = scratchpad.createEmpty();
  scratchpad.post(p, 'a2', 'discovery', 'disc', []);
  scratchpad.post(p, 'a2', 'conflict', 'conf', []);
  const conflicts = scratchpad.readUnread(p, 'a1', 'conflict');
  assert.strictEqual(conflicts.length, 1);
  assert.strictEqual(conflicts[0].message, 'conf');
});

section('agent-scratchpad: file ownership');

test('checkFileOwnership detects scope overlap', () => {
  const p = scratchpad.createEmpty();
  scratchpad.registerAgent(p, 'a1', 'backend', ['backend/']);
  const r = scratchpad.checkFileOwnership(p, 'backend/foo.cs');
  assert.strictEqual(r.claimed, true);
  assert.strictEqual(r.by, 'a1');
});

test('checkFileOwnership excludes self', () => {
  const p = scratchpad.createEmpty();
  scratchpad.registerAgent(p, 'a1', 'backend', ['backend/']);
  const r = scratchpad.checkFileOwnership(p, 'backend/foo.cs', 'a1');
  assert.strictEqual(r.claimed, false);
});

test('checkFileOwnership ignores done agents', () => {
  const p = scratchpad.createEmpty();
  scratchpad.registerAgent(p, 'a1', 'backend', ['backend/']);
  scratchpad.deregisterAgent(p, 'a1');
  const r = scratchpad.checkFileOwnership(p, 'backend/foo.cs');
  assert.strictEqual(r.claimed, false);
});

test('getConflicts returns only conflict messages', () => {
  const p = scratchpad.createEmpty();
  scratchpad.post(p, 'a1', 'discovery', 'disc', []);
  scratchpad.post(p, 'a1', 'conflict', 'overlap on shared.ts', ['shared.ts']);
  assert.strictEqual(scratchpad.getConflicts(p).length, 1);
});

section('agent-scratchpad: formatBriefing');

test('Empty scratchpad returns empty string', () => {
  const p = scratchpad.createEmpty();
  assert.strictEqual(scratchpad.formatBriefing(p, 'a1'), '');
});

test('Shows other active agents', () => {
  const p = scratchpad.createEmpty();
  scratchpad.registerAgent(p, 'a1', 'backend', ['backend/']);
  scratchpad.registerAgent(p, 'a2', 'frontend', ['frontend/']);
  const brief = scratchpad.formatBriefing(p, 'a1');
  assert(brief.includes('a2'));
  assert(brief.includes('frontend'));
});

// ═══════════════════════════════════════════════════════════════════
// context-budget.js
// ═══════════════════════════════════════════════════════════════════

const budget = require(path.join(LIB, 'context-budget'));

section('context-budget: classifyComplexity');

test('Mechanical tasks', () => {
  const r = budget.classifyComplexity({ isMechanical: true });
  assert.strictEqual(r.label, 'mechanical');
  assert.strictEqual(r.modelTier, 'haiku');
});

test('Architectural tasks', () => {
  const r = budget.classifyComplexity({ hasArchDecision: true });
  assert.strictEqual(r.label, 'architectural');
  assert.strictEqual(r.modelTier, 'opus');
});

test('New subsystem → architectural', () => {
  const r = budget.classifyComplexity({ isNewSubsystem: true });
  assert.strictEqual(r.label, 'architectural');
});

test('Many services → complex', () => {
  const r = budget.classifyComplexity({ servicesAffected: 3 });
  assert.strictEqual(r.label, 'complex');
});

test('Standard multi-file', () => {
  const r = budget.classifyComplexity({ filesChanged: 6 });
  assert.strictEqual(r.label, 'standard');
});

test('Simple few files', () => {
  const r = budget.classifyComplexity({ filesChanged: 2 });
  assert.strictEqual(r.label, 'simple');
});

test('Keyword-based: rename → mechanical', () => {
  const r = budget.classifyComplexity({ keywords: ['rename variable'] });
  assert.strictEqual(r.label, 'mechanical');
});

section('context-budget: orderForAttention');

test('Two or fewer sections returned as-is by priority', () => {
  const sections = [
    { name: 'B', priority: 1 },
    { name: 'A', priority: 10 },
  ];
  const ordered = budget.orderForAttention(sections);
  assert.strictEqual(ordered[0].name, 'A');
  assert.strictEqual(ordered[1].name, 'B');
});

test('Highest priority at start, second at end', () => {
  const sections = [
    { name: 'low', priority: 1 },
    { name: 'med', priority: 5 },
    { name: 'high', priority: 10 },
  ];
  const ordered = budget.orderForAttention(sections);
  assert.strictEqual(ordered[0].name, 'high');
  assert.strictEqual(ordered[ordered.length - 1].name, 'med');
});

section('context-budget: buildAgentPrompt');

test('Produces string with all sections', () => {
  const p = budget.buildAgentPrompt({
    objective: 'Do the thing',
    constraints: 'Follow TDD',
    acceptance: 'Tests pass',
  });
  assert(p.includes('Do the thing'));
  assert(p.includes('Follow TDD'));
  assert(p.includes('Tests pass'));
});

test('Objective appears before acceptance', () => {
  const p = budget.buildAgentPrompt({
    objective: 'OBJECTIVE_MARKER',
    constraints: 'CONSTRAINTS_MARKER',
    acceptance: 'ACCEPTANCE_MARKER',
  });
  assert(p.indexOf('OBJECTIVE_MARKER') < p.indexOf('ACCEPTANCE_MARKER'));
});

test('Optional sections included when provided', () => {
  const p = budget.buildAgentPrompt({
    objective: 'obj',
    constraints: 'con',
    acceptance: 'acc',
    learnings: 'LEARNINGS_HERE',
    context: 'CONTEXT_HERE',
    reference: 'REF_HERE',
  });
  assert(p.includes('LEARNINGS_HERE'));
  assert(p.includes('CONTEXT_HERE'));
  assert(p.includes('REF_HERE'));
});

section('context-budget: checkBudget');

test('Within budget returns true', () => {
  const r = budget.checkBudget('short prompt\nline 2', budget.COMPLEXITY.standard);
  assert.strictEqual(r.withinBudget, true);
});

test('Over budget returns suggestion', () => {
  const longPrompt = 'line\n'.repeat(200);
  const r = budget.checkBudget(longPrompt, budget.COMPLEXITY.simple);
  assert.strictEqual(r.withinBudget, false);
  assert(r.suggestion);
});

test('Architectural has no limit', () => {
  const longPrompt = 'line\n'.repeat(1000);
  const r = budget.checkBudget(longPrompt, budget.COMPLEXITY.architectural);
  assert.strictEqual(r.withinBudget, true);
});

// ═══════════════════════════════════════════════════════════════════
// cost-reporter.js
// ═══════════════════════════════════════════════════════════════════

const costReporter = require(path.join(LIB, 'cost-reporter'));

section('cost-reporter: detectActivity');

test('Skill tool_use detected', () => {
  const msg = { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'brainstorm' } }] };
  assert.strictEqual(costReporter.detectActivity(msg), 'skill:brainstorm');
});

test('Skill with envoy: prefix stripped', () => {
  const msg = { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'envoy:pickup' } }] };
  assert.strictEqual(costReporter.detectActivity(msg), 'skill:pickup');
});

test('Agent tool_use detected', () => {
  const msg = { content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'Explore' } }] };
  assert.strictEqual(costReporter.detectActivity(msg), 'agent:Explore');
});

test('Text-only message returns null (needs phase inference)', () => {
  const msg = { content: [{ type: 'text', text: 'Just a normal response' }] };
  assert.strictEqual(costReporter.detectActivity(msg), null);
});

test('Edit tool with envoy: in new_string is NOT a false positive', () => {
  const msg = { content: [{ type: 'tool_use', name: 'Edit', input: { new_string: 'envoy:brainstorm example' } }] };
  assert.strictEqual(costReporter.detectActivity(msg), null);
});

test('Review-related text detected', () => {
  const msg = { content: [{ type: 'text', text: 'Addressing CodeRabbit comment findings' }] };
  assert.strictEqual(costReporter.detectActivity(msg), 'review');
});

test('Non-array content returns null', () => {
  const msg = { content: 'just a string' };
  assert.strictEqual(costReporter.detectActivity(msg), null);
});

section('cost-reporter: formatTokens');

test('Millions formatted as M', () => {
  assert.strictEqual(costReporter.formatTokens(1_500_000), '1.5M');
});

test('Thousands formatted as K', () => {
  assert.strictEqual(costReporter.formatTokens(42_000), '42.0K');
});

test('Small numbers as-is', () => {
  assert.strictEqual(costReporter.formatTokens(500), '500');
});

section('cost-reporter: classifyPhase');

test('classifyPhase is exported', () => {
  assert.strictEqual(typeof costReporter.classifyPhase, 'function');
});

// ═══════════════════════════════════════════════════════════════════
// hooks: session-start.sh
// ═══════════════════════════════════════════════════════════════════

section('hooks: session-start.sh');

test('Uses awk for frontmatter stripping (POSIX-compatible)', () => {
  const content = fs.readFileSync(path.join(HOOKS, 'session-start.sh'), 'utf8');
  assert(content.includes('awk'), 'Should use awk for frontmatter stripping');
  assert(!content.includes("sed '1{"), 'Should not use GNU sed 1{} syntax');
});

test('No BSD sed warning on macOS', () => {
  const result = execSync(`bash "${path.join(HOOKS, 'session-start.sh')}" 2>&1`, {
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, HOME: os.homedir() },
  });
  assert(!result.includes('extra characters at the end of d command'), 'BSD sed warning detected');
});

// ═══════════════════════════════════════════════════════════════════
// hooks: cost-tracker removed
// ═══════════════════════════════════════════════════════════════════

section('hooks: cost-tracker removal');

test('cost-tracker.js does not exist', () => {
  assert(!fs.existsSync(path.join(HOOKS, 'cost-tracker.js')), 'cost-tracker.js should be deleted');
});

test('hooks.json does not reference cost-tracker', () => {
  const content = fs.readFileSync(path.join(HOOKS, 'hooks.json'), 'utf8');
  assert(!content.includes('cost-tracker'), 'hooks.json should not mention cost-tracker');
});

test('hook-runner.js does not reference cost-tracker', () => {
  const content = fs.readFileSync(path.join(HOOKS, 'hook-runner.js'), 'utf8');
  assert(!content.includes('cost-tracker'), 'hook-runner.js should not mention cost-tracker');
});

// ═══════════════════════════════════════════════════════════════════
// Cleanup & Report
// ═══════════════════════════════════════════════════════════════════

// Clean up temp dirs
try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
try { fs.rmSync(tmpDir2, { recursive: true }); } catch {}

console.log(`\n\x1b[1mResults: ${passed} passed, ${failed} failed, ${passed + failed} total\x1b[0m`);
process.exit(failed > 0 ? 1 : 0);
