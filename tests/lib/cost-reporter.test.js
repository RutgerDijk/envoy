#!/usr/bin/env node
/**
 * Cost Reporter — Test Suite
 *
 * Run: node tests/lib/cost-reporter.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const LIB = path.join(__dirname, '..', '..', 'lib');

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

/**
 * Helper: write a temporary JSONL file with assistant messages.
 */
function writeTempJsonl(lines) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-reporter-test-'));
  const jsonlPath = path.join(tmpDir, 'test-session.jsonl');
  const content = lines.map(l => JSON.stringify(l)).join('\n');
  fs.writeFileSync(jsonlPath, content);
  return { tmpDir, jsonlPath };
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ═══════════════════════════════════════════════════════════════════
// Load module
// ═══════════════════════════════════════════════════════════════════

const costReporter = require(path.join(LIB, 'cost-reporter'));

// ═══════════════════════════════════════════════════════════════════
// Task 1: Token aggregation — no dollar estimates
// ═══════════════════════════════════════════════════════════════════

section('extractSessionUsage: token-based aggregation');

test('extractSessionUsage returns totalTokens field', () => {
  const { tmpDir, jsonlPath } = writeTempJsonl([
    {
      type: 'assistant',
      message: {
        model: 'claude-opus-4-6-20260301',
        usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 50, cache_read_input_tokens: 300 },
        content: [{ type: 'text', text: 'hello' }],
      },
    },
  ]);
  const usage = costReporter.extractSessionUsage(jsonlPath);
  assert.strictEqual(usage.totalTokens, 1550, `Expected totalTokens=1550, got ${usage.totalTokens}`);
  cleanup(tmpDir);
});

test('extractSessionUsage does NOT have estimatedCostUSD', () => {
  const { tmpDir, jsonlPath } = writeTempJsonl([
    {
      type: 'assistant',
      message: {
        model: 'claude-opus-4-6-20260301',
        usage: { input_tokens: 100, output_tokens: 50 },
        content: [{ type: 'text', text: 'hi' }],
      },
    },
  ]);
  const usage = costReporter.extractSessionUsage(jsonlPath);
  assert.strictEqual(usage.estimatedCostUSD, undefined, 'Should not have estimatedCostUSD');
  cleanup(tmpDir);
});

test('extractSessionUsage does NOT have costUSD on models', () => {
  const { tmpDir, jsonlPath } = writeTempJsonl([
    {
      type: 'assistant',
      message: {
        model: 'claude-sonnet-4-6-20260301',
        usage: { input_tokens: 500, output_tokens: 100 },
        content: [{ type: 'text', text: 'test' }],
      },
    },
  ]);
  const usage = costReporter.extractSessionUsage(jsonlPath);
  const modelData = usage.models['claude-sonnet-4-6-20260301'];
  assert.ok(modelData, 'Model should be tracked');
  assert.strictEqual(modelData.costUSD, undefined, 'Model should not have costUSD');
  assert.ok(typeof modelData.totalTokens === 'number', 'Model should have totalTokens');
  cleanup(tmpDir);
});

test('extractSessionUsage aggregates totalTokens across turns', () => {
  const { tmpDir, jsonlPath } = writeTempJsonl([
    {
      type: 'assistant',
      message: {
        model: 'claude-opus-4-6',
        usage: { input_tokens: 1000, output_tokens: 200 },
        content: [{ type: 'text', text: 'turn 1' }],
      },
    },
    {
      type: 'assistant',
      message: {
        model: 'claude-opus-4-6',
        usage: { input_tokens: 500, output_tokens: 100 },
        content: [{ type: 'text', text: 'turn 2' }],
      },
    },
  ]);
  const usage = costReporter.extractSessionUsage(jsonlPath);
  assert.strictEqual(usage.totalTokens, 1800, `Expected 1800, got ${usage.totalTokens}`);
  assert.strictEqual(usage.turns, 2);
  cleanup(tmpDir);
});

test('PRICING constant is not exported', () => {
  assert.strictEqual(costReporter.PRICING, undefined, 'PRICING should not be exported');
});

test('formatCost is not exported', () => {
  assert.strictEqual(costReporter.formatCost, undefined, 'formatCost should not be exported');
});

test('formatTokens is still exported', () => {
  assert.strictEqual(typeof costReporter.formatTokens, 'function', 'formatTokens should still be exported');
});

// ═══════════════════════════════════════════════════════════════════
// Task 2: Phase inference — classifyPhase
// ═══════════════════════════════════════════════════════════════════

section('classifyPhase: tool-window inference');

test('classifyPhase is exported', () => {
  assert.strictEqual(typeof costReporter.classifyPhase, 'function', 'classifyPhase should be exported');
});

test('classifyPhase detects implementation (Edit/Write heavy + Bash)', () => {
  const tools = ['Edit', 'Edit', 'Bash', 'Write', 'Edit', 'Bash', 'Edit', 'Bash', 'Edit', 'Write', 'Bash'];
  assert.strictEqual(costReporter.classifyPhase(tools), 'implementation');
});

test('classifyPhase detects debugging (Bash + Grep heavy, low Edit)', () => {
  const tools = ['Bash', 'Bash', 'Grep', 'Read', 'Bash', 'Grep', 'Bash', 'Grep', 'Bash', 'Bash'];
  assert.strictEqual(costReporter.classifyPhase(tools), 'debugging');
});

test('classifyPhase detects review (Read heavy + Agent, low Edit)', () => {
  const tools = ['Read', 'Read', 'Read', 'Read', 'Read', 'Read', 'Agent'];
  assert.strictEqual(costReporter.classifyPhase(tools), 'review');
});

test('classifyPhase detects interactive (AskUserQuestion heavy)', () => {
  const tools = ['AskUserQuestion', 'Read', 'AskUserQuestion', 'AskUserQuestion', 'AskUserQuestion'];
  assert.strictEqual(costReporter.classifyPhase(tools), 'interactive');
});

test('classifyPhase detects planning (TaskCreate + Agent, low Edit)', () => {
  const tools = ['Read', 'Agent', 'Agent', 'TaskCreate', 'TaskCreate', 'Read'];
  assert.strictEqual(costReporter.classifyPhase(tools), 'planning');
});

test('classifyPhase returns other for ambiguous tools', () => {
  const tools = ['Read', 'Read'];
  assert.strictEqual(costReporter.classifyPhase(tools), 'other');
});

test('extractSessionUsage uses phase inference for unlabeled turns', () => {
  // Build a session with Edit-heavy turns (no Skill/Agent tool calls)
  const turns = [];
  for (let i = 0; i < 11; i++) {
    const toolName = i % 3 === 0 ? 'Bash' : (i % 3 === 1 ? 'Edit' : 'Write');
    turns.push({
      type: 'assistant',
      message: {
        model: 'claude-opus-4-6',
        usage: { input_tokens: 100, output_tokens: 50 },
        content: [{ type: 'tool_use', name: toolName, input: {} }],
      },
    });
  }
  const { tmpDir, jsonlPath } = writeTempJsonl(turns);
  const usage = costReporter.extractSessionUsage(jsonlPath);
  // Most turns should be labeled 'implementation', not 'general'
  assert.ok(usage.activities['implementation'], 'Should have implementation activity');
  assert.strictEqual(usage.activities['general'], undefined, 'Should not have general activity');
  cleanup(tmpDir);
});

// ═══════════════════════════════════════════════════════════════════
// Task 3: Bar-chart formatter
// ═══════════════════════════════════════════════════════════════════

section('formatReport: bar-chart output');

test('renderBar is exported', () => {
  assert.strictEqual(typeof costReporter.renderBar, 'function', 'renderBar should be exported');
});

test('renderBar produces correct bar for 50%', () => {
  const bar = costReporter.renderBar(0.5, 20);
  assert.strictEqual(bar.length, 20, `Bar should be 20 chars, got ${bar.length}`);
  const filled = (bar.match(/\u2588/g) || []).length;
  assert.strictEqual(filled, 10, `Expected 10 filled blocks, got ${filled}`);
});

test('renderBar produces all filled for 100%', () => {
  const bar = costReporter.renderBar(1.0, 20);
  const filled = (bar.match(/\u2588/g) || []).length;
  assert.strictEqual(filled, 20);
});

test('renderBar produces all empty for 0%', () => {
  const bar = costReporter.renderBar(0, 20);
  const empty = (bar.match(/\u2591/g) || []).length;
  assert.strictEqual(empty, 20);
});

const mockAggregated = {
  period: '7 days',
  sessions: [{ id: 's1' }, { id: 's2' }],
  totals: { totalTokens: 10000, turns: 50 },
  byActivity: {
    'skill:review': { turns: 20, totalTokens: 6000, models: {} },
    'implementation': { turns: 30, totalTokens: 4000, models: {} },
  },
  byModel: {
    'claude-opus-4-6': { turns: 40, totalTokens: 8000 },
    'claude-sonnet-4-6': { turns: 10, totalTokens: 2000 },
  },
  byBranch: {
    'feature/16-costs': { sessions: 2, totalTokens: 10000 },
  },
};

test('formatReport contains BY ACTIVITY section', () => {
  const report = costReporter.formatReport(mockAggregated);
  assert.ok(report.includes('BY ACTIVITY'), 'Should contain BY ACTIVITY');
});

test('formatReport contains bar chart characters', () => {
  const report = costReporter.formatReport(mockAggregated);
  assert.ok(report.includes('\u2588'), 'Should contain filled block');
  assert.ok(report.includes('\u2591'), 'Should contain empty block');
});

test('formatReport contains percentage', () => {
  const report = costReporter.formatReport(mockAggregated);
  assert.ok(report.includes('%'), 'Should contain percentage');
});

test('formatReport does NOT contain dollar signs', () => {
  const report = costReporter.formatReport(mockAggregated);
  assert.ok(!report.includes('$'), 'Should not contain dollar sign');
});

test('formatReport contains BY MODEL section', () => {
  const report = costReporter.formatReport(mockAggregated);
  assert.ok(report.includes('BY MODEL'), 'Should contain BY MODEL');
});

test('formatReport contains BY BRANCH section', () => {
  const report = costReporter.formatReport(mockAggregated);
  assert.ok(report.includes('BY BRANCH'), 'Should contain BY BRANCH');
});

test('formatReport sorts activities by totalTokens descending', () => {
  const report = costReporter.formatReport(mockAggregated);
  const reviewIdx = report.indexOf('skill:review');
  const implIdx = report.indexOf('implementation');
  assert.ok(reviewIdx < implIdx, 'skill:review (6000) should appear before implementation (4000)');
});

// ═══════════════════════════════════════════════════════════════════
// Task 4: Cross-project discovery
// ═══════════════════════════════════════════════════════════════════

section('cross-project: decodeProjectName');

test('decodeProjectName is exported', () => {
  assert.strictEqual(typeof costReporter.decodeProjectName, 'function');
});

test('decodeProjectName extracts last two segments', () => {
  const result = costReporter.decodeProjectName('-Users-rutger-Projects-EnvoyProject-envoy');
  assert.strictEqual(result, 'EnvoyProject/envoy');
});

test('decodeProjectName handles single segment', () => {
  const result = costReporter.decodeProjectName('-Users-rutger-myproject');
  assert.strictEqual(result, 'rutger/myproject');
});

test('decodeProjectName handles deep paths', () => {
  const result = costReporter.decodeProjectName('-Users-rutger-Projects-Work-Client-api');
  assert.strictEqual(result, 'Client/api');
});

test('discoverAllProjects is exported', () => {
  assert.strictEqual(typeof costReporter.discoverAllProjects, 'function');
});

test('discoverAllProjects returns an array', () => {
  const projects = costReporter.discoverAllProjects();
  assert.ok(Array.isArray(projects), 'Should return an array');
});

test('formatReport includes BY PROJECT when byProject data exists', () => {
  const data = {
    ...mockAggregated,
    byProject: {
      'EnvoyProject/envoy': { totalTokens: 8000 },
      'Other/project': { totalTokens: 2000 },
    },
  };
  const report = costReporter.formatReport(data);
  assert.ok(report.includes('BY PROJECT'), 'Should contain BY PROJECT section');
});

// ═══════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
