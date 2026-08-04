#!/usr/bin/env node
/**
 * SessionStart Hook Output Shape — Test Suite
 *
 * Run: node tests/hooks/session-start-output.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOOK = path.join(REPO_ROOT, 'hooks', 'session-start.sh');

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

function runHook() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'session-start-'));
  try {
    return execFileSync('bash', [HOOK], {
      cwd,
      encoding: 'utf8',
      timeout: 30000,
      input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'test', cwd }),
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: REPO_ROOT }
    });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

test('hook emits valid JSON', () => {
  const parsed = JSON.parse(runHook());
  assert.ok(parsed && typeof parsed === 'object');
});

test('hookSpecificOutput is the required object shape, not a string', () => {
  const parsed = JSON.parse(runHook());
  const hso = parsed.hookSpecificOutput;
  assert.strictEqual(typeof hso, 'object', 'hookSpecificOutput must be an object');
  assert.ok(!Array.isArray(hso), 'hookSpecificOutput must not be an array');
  assert.strictEqual(hso.hookEventName, 'SessionStart');
});

test('additionalContext carries the bootstrap content', () => {
  const parsed = JSON.parse(runHook());
  const ctx = parsed.hookSpecificOutput.additionalContext;
  assert.strictEqual(typeof ctx, 'string');
  assert.ok(ctx.includes('EXTREMELY_IMPORTANT'), 'bootstrap wrapper must be present');
  assert.ok(ctx.includes('Envoy'), 'bootstrap must mention Envoy');
});

test('output stays lean (<=2000 bytes) when there is no active workflow', () => {
  // Budget raised from 1200 -> 2000 bytes: the old 12-char routing-table
  // truncation cut descriptions down to useless boilerplate stubs (e.g.
  // "babysit: Use when you..."), defeating the purpose of the table. The
  // per-description cap was raised to 42 chars post-lead-in-strip so
  // entries are actually distinguishing. This still cuts the original
  // ~4.7KB (full using-envoy body inlined) by more than half.
  const raw = runHook();
  assert.ok(
    raw.length <= 2000,
    `expected SessionStart output <= 2000 bytes with no active workflow, got ${raw.length}`
  );
});

test('additionalContext routes to skills via the Skill tool rather than inlining the full using-envoy body', () => {
  const parsed = JSON.parse(runHook());
  const ctx = parsed.hookSpecificOutput.additionalContext;
  assert.ok(!ctx.includes('## Red Flags'), 'full using-envoy body (Red Flags section) must not be inlined');
  assert.ok(ctx.includes('using-envoy'), 'routing table must reference using-envoy');
});

test('routing table entries are not all near-identical truncated boilerplate', () => {
  const parsed = JSON.parse(runHook());
  const ctx = parsed.hookSpecificOutput.additionalContext;
  const lines = ctx.split('\n').filter((l) => /^[a-z0-9-]+: /.test(l));
  assert.ok(lines.length >= 5, `expected several routing-table lines, got ${lines.length}`);
  // Strip the "name: " prefix and common generic lead-ins, then require
  // meaningful (differentiating) content to remain — not a stub cut off
  // mid lead-in like "Use when you...".
  const stripLeadIn = (desc) =>
    desc.replace(/^(ALWAYS\s+)?(invoke\s+)?(use\s+(when|before|after|this)|before|when)\b[.:]?\s*/i, '');
  const meaningful = lines.map((l) => {
    const desc = l.slice(l.indexOf(': ') + 2);
    return stripLeadIn(desc).replace(/\.\.\.$/, '');
  });
  for (const m of meaningful) {
    assert.ok(
      m.trim().length >= 15,
      `expected meaningful content (>=15 chars after stripping lead-in), got "${m}"`
    );
  }
  // Entries should actually differ from each other, not collapse into the
  // same generic stub.
  const unique = new Set(meaningful.map((m) => m.trim().toLowerCase()));
  assert.ok(unique.size >= Math.min(5, meaningful.length) - 1, 'routing-table entries must be differentiated, not near-identical stubs');
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
