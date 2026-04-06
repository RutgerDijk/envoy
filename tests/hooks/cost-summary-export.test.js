#!/usr/bin/env node
/**
 * Cost Summary Export Hook — Test Suite
 *
 * Run: node tests/hooks/cost-summary-export.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const HOOKS = path.join(__dirname, '..', '..', 'hooks');

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
// Load module
// ═══════════════════════════════════════════════════════════════════

const hook = require(path.join(HOOKS, 'cost-summary-export'));

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

section('cost-summary-export: buildSummaryJson');

test('buildSummaryJson is exported', () => {
  assert.strictEqual(typeof hook.buildSummaryJson, 'function');
});

test('buildSummaryJson produces valid JSON structure', () => {
  const mockUsage = {
    totalTokens: 5000,
    turns: 10,
    activities: {
      'skill:review': { totalTokens: 3000, turns: 5, models: {} },
      'implementation': { totalTokens: 2000, turns: 5, models: {} },
    },
    models: {
      'claude-opus-4-6': { totalTokens: 4000, turns: 8 },
      'claude-sonnet-4-6': { totalTokens: 1000, turns: 2 },
    },
  };

  const summary = hook.buildSummaryJson(mockUsage, 'rutger', 'feature/16-costs');

  assert.strictEqual(summary.user, 'rutger');
  assert.strictEqual(summary.branch, 'feature/16-costs');
  assert.strictEqual(summary.totalTokens, 5000);
  assert.strictEqual(summary.turns, 10);
  assert.ok(summary.date, 'Should have date');
  assert.deepStrictEqual(summary.activities, { 'skill:review': 3000, 'implementation': 2000 });
  assert.deepStrictEqual(summary.models, { 'claude-opus-4-6': 4000, 'claude-sonnet-4-6': 1000 });
});

test('buildSummaryJson has no costUSD field', () => {
  const mockUsage = {
    totalTokens: 100,
    turns: 1,
    activities: {},
    models: {},
  };
  const summary = hook.buildSummaryJson(mockUsage, 'user', 'main');
  assert.strictEqual(summary.costUSD, undefined);
});

test('getExportPath returns expected format', () => {
  assert.strictEqual(typeof hook.getExportPath, 'function');
  const exportPath = hook.getExportPath('/tmp/project', 'rutger');
  assert.ok(exportPath.includes('docs/costs/reports/'), 'Should be in docs/costs/reports/');
  assert.ok(exportPath.includes('rutger'), 'Should contain username');
  assert.ok(exportPath.endsWith('.json'), 'Should end with .json');
});

// ═══════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
