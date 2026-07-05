#!/usr/bin/env node
/**
 * Version Lockstep Script — Test Suite
 *
 * Run: node tests/scripts/sync-versions.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { resolveTargets, check, apply } = require(path.join(__dirname, '..', '..', 'scripts', 'sync-versions'));

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

function makeRepo(pluginVersion, marketplaceMetaVersion, entryVersions) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-versions-'));
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'envoy', version: pluginVersion }, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(root, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'envoy-marketplace',
      metadata: { description: 'test', version: marketplaceMetaVersion },
      plugins: entryVersions.map((v, i) => ({ name: `entry-${i}`, version: v }))
    }, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(root, '.version-bump.json'),
    JSON.stringify({
      manifests: [
        { path: '.claude-plugin/plugin.json', fields: ['version'] },
        { path: '.claude-plugin/marketplace.json', fields: ['metadata.version', 'plugins[*].version'] }
      ]
    }, null, 2) + '\n'
  );
  return root;
}

// --- resolveTargets ---

test('resolveTargets expands dot paths and [*] wildcards to concrete targets', () => {
  const root = makeRepo('2.4.0', '2.1.3', ['2.1.3', '2.1.3']);
  const targets = resolveTargets(root);
  const fields = targets.map(t => `${t.file}#${t.fieldPath}`);
  assert.deepStrictEqual(fields, [
    '.claude-plugin/plugin.json#version',
    '.claude-plugin/marketplace.json#metadata.version',
    '.claude-plugin/marketplace.json#plugins[0].version',
    '.claude-plugin/marketplace.json#plugins[1].version'
  ]);
  assert.deepStrictEqual(targets.map(t => t.value), ['2.4.0', '2.1.3', '2.1.3', '2.1.3']);
});

test('resolveTargets throws when a listed manifest is missing', () => {
  const root = makeRepo('2.4.0', '2.1.3', []);
  fs.rmSync(path.join(root, '.claude-plugin', 'plugin.json'));
  assert.throws(() => resolveTargets(root), /plugin\.json/);
});

// --- check ---

test('check returns ok with the common version when all targets agree', () => {
  const root = makeRepo('2.4.1', '2.4.1', ['2.4.1', '2.4.1']);
  const result = check(root);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.version, '2.4.1');
  assert.deepStrictEqual(result.mismatches, []);
});

test('check reports every mismatching target when versions drift', () => {
  const root = makeRepo('2.4.0', '2.1.3', ['2.1.3']);
  const result = check(root);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.mismatches.length, 3);
  const described = result.mismatches.map(m => `${m.file}#${m.fieldPath}=${m.value}`);
  assert.ok(described.some(d => d.includes('plugin.json#version=2.4.0')));
  assert.ok(described.some(d => d.includes('metadata.version=2.1.3')));
});

// --- apply ---

test('apply rewrites every target to the given version and preserves other fields', () => {
  const root = makeRepo('2.4.0', '2.1.3', ['2.1.3', '2.1.3']);
  apply(root, '2.4.1');
  const plugin = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  const marketplace = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.strictEqual(plugin.version, '2.4.1');
  assert.strictEqual(plugin.name, 'envoy');
  assert.strictEqual(marketplace.metadata.version, '2.4.1');
  assert.strictEqual(marketplace.metadata.description, 'test');
  assert.deepStrictEqual(marketplace.plugins.map(p => p.version), ['2.4.1', '2.4.1']);
  assert.strictEqual(check(root).ok, true);
});

test('apply rejects versions that are not plain semver', () => {
  const root = makeRepo('2.4.0', '2.4.0', []);
  assert.throws(() => apply(root, 'not-a-version'), /semver/i);
  assert.throws(() => apply(root, '2.4'), /semver/i);
});

test('apply writes files with two-space indent and trailing newline', () => {
  const root = makeRepo('2.4.0', '2.1.3', ['2.1.3']);
  apply(root, '2.4.1');
  const raw = fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8');
  assert.ok(raw.endsWith('}\n'), 'file must end with a trailing newline');
  assert.ok(raw.includes('\n  "version"'), 'file must use two-space indent');
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
