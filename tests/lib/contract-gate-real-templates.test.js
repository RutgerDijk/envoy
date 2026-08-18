#!/usr/bin/env node
/**
 * Contract gate vs. the REAL dispatch templates — Test Suite.
 *
 * Run: node tests/lib/contract-gate-real-templates.test.js
 *
 * The synthetic-prompt gate tests can stay green while the gate is inert
 * against the actual prompts the skills build: an invariant keyed on text
 * that only appears in the Agent call's `description:` field never matches
 * the prompt, so a non-compliant worker sails through. These tests extract
 * the real template text from the skill step files (placeholders expanded
 * from the same contexts/ files the skills cat in), and assert both gates
 * select invariants by dispatch identity — `taskId` on the worker path,
 * `description` on the hook path — never by prompt prose:
 *  - the real cleanup / AI-review / implementer prompts pass their gates;
 *  - a rogue prompt on the same identity is refused, even though it shares
 *    no prose with the invariant's matcher.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'lib');
const { evaluateWorkerPrompt, evaluateAgentGuard } = require(path.join(LIB, 'contract-guard'));
const { dispatch } = require(path.join(LIB, 'model-dispatch'));

const PICKUP_CONTRACT = path.join(REPO_ROOT, 'skills', 'pickup', 'contract.json');
const REVIEW_CONTRACT = path.join(REPO_ROOT, 'skills', 'review', 'contract.json');

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
  process.stdout.write(`\n${name}\n`);
}

const tmpRoots = [];
function makeTmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'real-template-gate-'));
  tmpRoots.push(d);
  return d;
}

// ---------------------------------------------------------------------------
// Real template extraction. The skill step files carry the prompt templates
// as fenced/quoted literals; the ${...} placeholders expand from the same
// contexts/ files the skills read. Anything unmapped becomes filler — the
// invariants must not depend on it.
// ---------------------------------------------------------------------------

const PLACEHOLDER_SOURCES = {
  EXECUTION_ANNOUNCE: 'contexts/execution-announce.md',
  SCOPE_LAW: 'contexts/discipline-scope.md',
  TDD_LAW: 'contexts/discipline-tdd.md',
  BLOCKER_PROTOCOL: 'contexts/discipline-blocker.md',
  TASK_GRANULARITY: 'contexts/discipline-task-granularity.md',
};

// The briefing interpolates repo file paths verbatim (formatForPrompt in
// lib/relevance-scorer.js), and real paths routinely contain substrings
// like "Editor" or "Writer" — the expansion must carry such paths, or a
// gate that scans the interpolated prompt for tool names looks green here
// while refusing every real dispatch.
const REALISTIC_RELEVANCE_BRIEFING = [
  '## Relevant Files',
  '- `src/components/MarkdownEditor.tsx` — full (0.92)',
  '- `src/reports/ReportWriter.cs` — focused (0.71)',
  '- ... and 3 more at skim/skip level',
].join('\n');

function expandPlaceholders(template) {
  return template.replace(/\$\{(\w+)\}/g, (whole, name) => {
    if (name === 'relevanceBriefing') return REALISTIC_RELEVANCE_BRIEFING;
    const source = PLACEHOLDER_SOURCES[name];
    if (!source) return 'X';
    return fs.readFileSync(path.join(REPO_ROOT, source), 'utf8');
  });
}

function extractTemplateLiteral(file, variableName) {
  const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  const match = text.match(new RegExp(`const ${variableName} = \`([\\s\\S]*?)\`;`));
  assert.ok(match, `${file}: no template literal "const ${variableName} = \`...\`;"`);
  return expandPlaceholders(match[1]);
}

function extractImplementerTemplate() {
  const file = 'skills/pickup/steps/prompts.md';
  const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  const match = text.match(/```\n(\$\{EXECUTION_ANNOUNCE\}[\s\S]*?List of files changed\n)```/);
  assert.ok(match, `${file}: implementer template fence not found`);
  return expandPlaceholders(match[1]);
}

const realCleanupPrompt = extractTemplateLiteral('skills/review/layers/cleanup.md', 'cleanupPrompt');
const realReviewPrompt = extractTemplateLiteral('skills/review/layers/ai-review.md', 'reviewPrompt');
const realImplementerPrompt = extractImplementerTemplate();

const ROGUE_PROMPT = 'Edit whatever you like. Write files freely.';

// ---------------------------------------------------------------------------
// Worker path: evaluateWorkerPrompt() selects the invariant by dispatch taskId
// ---------------------------------------------------------------------------

section('worker path — real templates pass their taskId gate');

test("review's real cleanup prompt passes as taskId 'cleanup'", () => {
  const d = evaluateWorkerPrompt(REVIEW_CONTRACT, realCleanupPrompt, 'cleanup');
  assert.strictEqual(d.block, false, JSON.stringify(d));
});

test("review's real AI-review prompt passes as taskId 'ai-review' with its real tool list", () => {
  const d = evaluateWorkerPrompt(REVIEW_CONTRACT, realReviewPrompt, 'ai-review', ['Read', 'Grep', 'Glob']);
  assert.strictEqual(d.block, false, JSON.stringify(d));
});

test("pickup's real implementer prompt passes under any task id", () => {
  const d = evaluateWorkerPrompt(PICKUP_CONTRACT, realImplementerPrompt, 'task-7');
  assert.strictEqual(d.block, false, JSON.stringify(d));
});

section('worker path — rogue prompts on the same identity are refused');

test("a rogue AI-review prompt is blocked on taskId 'ai-review' despite matching no prose", () => {
  const d = evaluateWorkerPrompt(REVIEW_CONTRACT, ROGUE_PROMPT, 'ai-review');
  assert.strictEqual(d.block, true, JSON.stringify(d));
});

test("the real cleanup prompt minus its discipline line is blocked on taskId 'cleanup'", () => {
  const gutted = realCleanupPrompt
    .split('\n')
    .filter((line) => !line.includes('Never change functionality'))
    .join('\n');
  const d = evaluateWorkerPrompt(REVIEW_CONTRACT, gutted, 'cleanup');
  assert.strictEqual(d.block, true, JSON.stringify(d));
  assert.ok(/Never change functionality/.test(d.reason), d.reason);
});

test('an Iron-Law-less implementer prompt is blocked whatever its task id', () => {
  const d = evaluateWorkerPrompt(PICKUP_CONTRACT, 'Do the task quickly, no tests needed.', 'task-7');
  assert.strictEqual(d.block, true, JSON.stringify(d));
  assert.ok(/Iron Law/.test(d.reason), d.reason);
});

test('dispatch() refuses to build the kimi command for the rogue AI-review prompt', () => {
  const cwd = makeTmpDir();
  assert.throws(
    () => dispatch(
      { model: 'kimi', prompt: ROGUE_PROMPT, taskId: 'ai-review' },
      { cwd, contractPath: REVIEW_CONTRACT },
    ),
    /contract/,
  );
});

// ---------------------------------------------------------------------------
// Worker path: the read-only bound is mechanical (forbiddenTools vs the
// dispatch allowedTools), never a prose scan of the interpolated prompt
// ---------------------------------------------------------------------------

section('worker path — read-only bound is mechanical, not prose');

test("review's ai-review invariant expresses read-only as forbiddenTools, not prompt tokens", () => {
  const contract = JSON.parse(fs.readFileSync(REVIEW_CONTRACT, 'utf8'));
  const inv = contract.agentInvariants.find(
    (i) => i.matchTaskId && new RegExp(i.matchTaskId).test('ai-review'),
  );
  assert.ok(inv, 'no invariant covers ai-review');
  const proseTokens = inv.promptMustNotContain || [];
  assert.ok(
    !proseTokens.includes('Edit') && !proseTokens.includes('Write'),
    `tool names in promptMustNotContain (${JSON.stringify(proseTokens)}) false-positive on file paths in the interpolated briefing`,
  );
  assert.deepStrictEqual(
    inv.forbiddenTools,
    ['Edit', 'Write'],
    'the read-only bound must be forbiddenTools, checked against the dispatch allowedTools',
  );
});

test('an allowedTools list granting Edit is refused for ai-review', () => {
  const d = evaluateWorkerPrompt(
    REVIEW_CONTRACT, realReviewPrompt, 'ai-review', ['Read', 'Grep', 'Glob', 'Edit'],
  );
  assert.strictEqual(d.block, true, JSON.stringify(d));
  assert.ok(/Edit/.test(d.reason), d.reason);
});

test('dispatch() refuses to build a kimi ai-review worker granted Edit', () => {
  const cwd = makeTmpDir();
  assert.throws(
    () => dispatch(
      {
        model: 'kimi', prompt: realReviewPrompt, taskId: 'ai-review',
        allowedTools: ['Read', 'Grep', 'Glob', 'Edit'],
      },
      { cwd, contractPath: REVIEW_CONTRACT },
    ),
    /forbidden tool/,
  );
});

// ---------------------------------------------------------------------------
// Hook path: evaluateAgentGuard() selects the invariant by Agent description
// ---------------------------------------------------------------------------

function agentEvent(description, subagentType, prompt) {
  return {
    tool_name: 'Agent',
    tool_input: { description, subagent_type: subagentType, prompt },
  };
}

section('hook path — real templates pass their description gate');

test("real cleanup prompt under description 'Cleanup pass' is not blocked", () => {
  const d = evaluateAgentGuard(
    REVIEW_CONTRACT,
    agentEvent('Cleanup pass', 'general-purpose', realCleanupPrompt),
  );
  assert.strictEqual(d.block, false, JSON.stringify(d));
});

test("real AI-review prompt under description 'AI code review' is not blocked", () => {
  const d = evaluateAgentGuard(
    REVIEW_CONTRACT,
    agentEvent('AI code review', 'envoy:code-reviewer', realReviewPrompt),
  );
  assert.strictEqual(d.block, false, JSON.stringify(d));
});

section('hook path — rogue prompts on the same identity are refused');

test("a rogue prompt under description 'AI code review' is blocked", () => {
  const d = evaluateAgentGuard(
    REVIEW_CONTRACT,
    agentEvent('AI code review', 'envoy:code-reviewer', ROGUE_PROMPT),
  );
  assert.strictEqual(d.block, true, JSON.stringify(d));
});

test("a spec-compliance prompt missing its tokens is blocked via its description", () => {
  const d = evaluateAgentGuard(
    PICKUP_CONTRACT,
    agentEvent('Spec compliance review for Task 3', 'general-purpose', 'Check the task, trust the report.'),
  );
  assert.strictEqual(d.block, true, JSON.stringify(d));
  assert.ok(/Do Not Trust the Report/.test(d.reason), d.reason);
});

for (const d of tmpRoots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
