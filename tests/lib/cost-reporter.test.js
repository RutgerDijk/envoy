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
// Summary
// ═══════════════════════════════════════════════════════════════════

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
