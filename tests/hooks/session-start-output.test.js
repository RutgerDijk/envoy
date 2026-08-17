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

function runHook(prepare) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'session-start-'));
  try {
    if (prepare) prepare(cwd);
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
  // Budget: 2000 bytes. With the lead-in strip fixed to handle BOTH
  // description shapes (rigid "<Skill> expert. ALWAYS invoke when..." and
  // flexible "Use when..."), 27 routing-table entries at a 42-char
  // per-description cap measure ~1900 bytes — this budget keeps a small
  // margin (~100 bytes) for skill-count/description drift rather than the
  // much wider slack an unfixed strip previously required. Still cuts the
  // original ~4.7KB (full using-envoy body inlined) by more than half.
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

test('routing table lines never contain raw boilerplate phrases (independent of the stripping regex)', () => {
  // Deliberately does NOT reuse the implementation's own lead-in-stripping
  // regex — it checks for the literal boilerplate substrings straight out
  // of the rigid-skill description template ("<Skill> expert. ALWAYS
  // invoke when...") and the flexible-skill template ("Use when...").
  // This is the check that a same-regex tautology cannot catch: if the
  // implementation's strip is incomplete (e.g. only anchored at position
  // 0, missing the "<Skill> expert." prefix rigid skills prepend), these
  // raw phrases leak straight into the output and this test fails.
  const parsed = JSON.parse(runHook());
  const ctx = parsed.hookSpecificOutput.additionalContext;
  const lines = ctx.split('\n').filter((l) => /^[a-z0-9-]+: /.test(l));
  assert.ok(lines.length >= 5, `expected several routing-table lines, got ${lines.length}`);
  const rawBoilerplatePhrases = ['ALWAYS invoke when', 'ALWAYS invoke before', 'expert. ALWAYS', 'Use when'];
  for (const line of lines) {
    for (const phrase of rawBoilerplatePhrases) {
      assert.ok(
        !line.includes(phrase),
        `routing-table line "${line}" still contains raw boilerplate phrase "${phrase}"`
      );
    }
  }
});

test('session restore is rendered by formatForPrompt, so it carries the chosen worker model', () => {
  // The hook used to hand-pick fields out of .envoy-session.json with its
  // own inline extraction, which silently drifted from lib/session-state's
  // formatForPrompt() (the restore surface pickup/review rely on) when
  // workerModel was added. Rendering through formatForPrompt makes the two
  // restore surfaces one.
  const raw = runHook((cwd) => {
    fs.writeFileSync(path.join(cwd, '.envoy-session.json'), JSON.stringify({
      version: 1,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      branch: 'feature/x',
      plan: 'issue #42',
      tasks: [{ id: 'task-1', status: 'done', summary: null, updatedAt: '2026-08-01T00:00:00.000Z' }],
      decisions: [{ text: 'chose kimi for workers', at: '2026-08-01T00:00:00.000Z' }],
      filesModified: [],
      testResults: null,
      nextSteps: ['finish task-2'],
      workerModel: 'kimi',
    }, null, 2));
  });
  const ctx = JSON.parse(raw).hookSpecificOutput.additionalContext;
  assert.ok(ctx.includes('## Session State (restored)'),
    'the restore block must be formatForPrompt output, not a hand-built variant');
  assert.ok(/Worker model:.*kimi/.test(ctx),
    'the restored context must surface the chosen worker model so a resumed run does not re-ask');
  assert.ok(ctx.includes('feature/x'), 'branch must survive the restore render');
  assert.ok(ctx.includes('finish task-2'), 'next steps must survive the restore render');
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
