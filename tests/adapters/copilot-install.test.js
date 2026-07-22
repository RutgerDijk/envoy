#!/usr/bin/env node
/**
 * Copilot Adapter Install — Test Suite
 *
 * Execs adapters/copilot/install.sh against fixture template dirs in temp
 * projects, covering the manifest-based managed sync behavior.
 *
 * Run: node tests/adapters/copilot-install.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const INSTALL_SH = path.join(__dirname, '..', '..', 'adapters', 'copilot', 'install.sh');
const MANIFEST_REL = path.join('.github', '.envoy-copilot-manifest.json');

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

const tempRoots = [];

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-install-'));
  tempRoots.push(root);

  const templates = path.join(root, 'envoy', 'adapters', 'copilot', 'templates');
  fs.mkdirSync(path.join(templates, 'prompts'), { recursive: true });
  fs.mkdirSync(path.join(templates, 'instructions'), { recursive: true });
  fs.mkdirSync(path.join(templates, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(templates, 'copilot-instructions.md'), 'core v1\n');
  fs.writeFileSync(path.join(templates, 'prompts', 'pickup.prompt.md'), 'pickup v1\n');
  fs.writeFileSync(path.join(templates, 'instructions', 'typescript.instructions.md'), 'ts v1\n');
  fs.writeFileSync(path.join(templates, 'agents', 'reviewer.agent.md'), 'reviewer v1\n');

  const project = path.join(root, 'project');
  fs.mkdirSync(project);

  return { envoyDir: path.join(root, 'envoy'), project };
}

function runInstall(fixture, extraArgs = []) {
  return execFileSync('bash', [INSTALL_SH, '--envoy-dir', fixture.envoyDir, ...extraArgs], {
    cwd: fixture.project,
    encoding: 'utf8',
  });
}

function readProjectFile(fixture, rel) {
  return fs.readFileSync(path.join(fixture.project, rel), 'utf8');
}

function readManifest(fixture) {
  return JSON.parse(readProjectFile(fixture, MANIFEST_REL));
}

// ─── Fresh install ───────────────────────────────────────────────────────────

test('fresh install copies all templates and writes a manifest with per-file hashes', () => {
  const fixture = makeFixture();
  runInstall(fixture);

  assert.strictEqual(readProjectFile(fixture, path.join('.github', 'copilot-instructions.md')), 'core v1\n');
  assert.strictEqual(readProjectFile(fixture, path.join('.github', 'prompts', 'pickup.prompt.md')), 'pickup v1\n');
  assert.strictEqual(readProjectFile(fixture, path.join('.github', 'instructions', 'typescript.instructions.md')), 'ts v1\n');
  assert.strictEqual(readProjectFile(fixture, path.join('.github', 'agents', 'reviewer.agent.md')), 'reviewer v1\n');

  const manifest = readManifest(fixture);
  const keys = Object.keys(manifest.files);
  assert.strictEqual(keys.length, 4, `expected 4 manifest entries, got ${keys.length}: ${keys.join(', ')}`);
  for (const key of keys) {
    assert.match(manifest.files[key], /^[0-9a-f]{16,}$/, `hash for ${key} should be hex`);
  }
});

// ─── No-op re-run ────────────────────────────────────────────────────────────

test('re-run with no changes leaves files untouched and exits 0', () => {
  const fixture = makeFixture();
  runInstall(fixture);
  const before = readProjectFile(fixture, path.join('.github', 'copilot-instructions.md'));
  runInstall(fixture);
  assert.strictEqual(readProjectFile(fixture, path.join('.github', 'copilot-instructions.md')), before);
});

// ─── Upstream update ─────────────────────────────────────────────────────────

test('re-run after an upstream template change updates the unmodified local copy and the manifest', () => {
  const fixture = makeFixture();
  runInstall(fixture);
  const manifestBefore = readManifest(fixture);

  fs.writeFileSync(
    path.join(fixture.envoyDir, 'adapters', 'copilot', 'templates', 'copilot-instructions.md'),
    'core v2\n'
  );
  const output = runInstall(fixture);

  assert.strictEqual(readProjectFile(fixture, path.join('.github', 'copilot-instructions.md')), 'core v2\n');
  const manifestAfter = readManifest(fixture);
  assert.notStrictEqual(
    manifestAfter.files['copilot-instructions.md'],
    manifestBefore.files['copilot-instructions.md'],
    'manifest hash should change with the template'
  );
  assert.match(output, /[Uu]pdated/, 'summary should report the update');
});

// ─── User edit preserved ─────────────────────────────────────────────────────

test('re-run preserves a locally-edited managed file and warns', () => {
  const fixture = makeFixture();
  runInstall(fixture);

  const localPath = path.join(fixture.project, '.github', 'prompts', 'pickup.prompt.md');
  fs.writeFileSync(localPath, 'pickup v1 + my tweaks\n');
  fs.writeFileSync(
    path.join(fixture.envoyDir, 'adapters', 'copilot', 'templates', 'prompts', 'pickup.prompt.md'),
    'pickup v2\n'
  );
  const output = runInstall(fixture);

  assert.strictEqual(fs.readFileSync(localPath, 'utf8'), 'pickup v1 + my tweaks\n');
  assert.match(output, /locally modified, skipped/i);
  assert.match(output, /pickup\.prompt\.md/, 'warning should name the file');
});

// ─── Pre-manifest adoption ───────────────────────────────────────────────────

test('pre-manifest install: identical files are adopted as managed, differing files treated as user-edited', () => {
  const fixture = makeFixture();
  runInstall(fixture);
  // Simulate a pre-manifest install by deleting the manifest.
  fs.rmSync(path.join(fixture.project, MANIFEST_REL));
  // One file diverges locally (user-edited), the rest are identical to templates.
  fs.writeFileSync(
    path.join(fixture.project, '.github', 'agents', 'reviewer.agent.md'),
    'reviewer v1 + my tweaks\n'
  );

  runInstall(fixture);
  const manifest = readManifest(fixture);
  assert.ok(manifest.files['copilot-instructions.md'], 'identical file should be adopted into the manifest');
  assert.strictEqual(
    manifest.files[path.join('agents', 'reviewer.agent.md')],
    undefined,
    'user-edited file must not be adopted as managed'
  );

  // An upstream change now flows into the adopted file but not the user-edited one.
  fs.writeFileSync(
    path.join(fixture.envoyDir, 'adapters', 'copilot', 'templates', 'copilot-instructions.md'),
    'core v2\n'
  );
  fs.writeFileSync(
    path.join(fixture.envoyDir, 'adapters', 'copilot', 'templates', 'agents', 'reviewer.agent.md'),
    'reviewer v2\n'
  );
  runInstall(fixture);
  assert.strictEqual(readProjectFile(fixture, path.join('.github', 'copilot-instructions.md')), 'core v2\n');
  assert.strictEqual(
    readProjectFile(fixture, path.join('.github', 'agents', 'reviewer.agent.md')),
    'reviewer v1 + my tweaks\n'
  );
});

// ─── Symlink mode ────────────────────────────────────────────────────────────

test('symlink mode creates symlinks and does not manifest-track them', () => {
  const fixture = makeFixture();
  runInstall(fixture, ['--symlink']);

  const linkPath = path.join(fixture.project, '.github', 'copilot-instructions.md');
  assert.ok(fs.lstatSync(linkPath).isSymbolicLink(), 'should be a symlink');

  if (fs.existsSync(path.join(fixture.project, MANIFEST_REL))) {
    const manifest = readManifest(fixture);
    assert.strictEqual(Object.keys(manifest.files).length, 0, 'symlinks must not be manifest-tracked');
  }

  // Re-run must not rewrite the symlink.
  runInstall(fixture, ['--symlink']);
  assert.ok(fs.lstatSync(linkPath).isSymbolicLink(), 'symlink should survive a re-run');
});

// ─── Cleanup + summary ───────────────────────────────────────────────────────

for (const root of tempRoots) {
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
