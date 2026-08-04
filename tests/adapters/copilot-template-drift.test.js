#!/usr/bin/env node
/**
 * Canonical ↔ Copilot Template Drift Guard — Test Suite
 *
 * Asserts every canonical source has its Copilot adapter counterpart:
 * stacks ↔ instruction templates (bidirectional 1:1), agents ↔ agent
 * templates (bidirectional, with an explicit name mapping), and skills →
 * prompt templates via a decision list (every skill either has a prompt or
 * is explicitly claude-code-only), so nothing can drift silently.
 *
 * Run: node tests/adapters/copilot-template-drift.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const STACKS_DIR = path.join(ROOT, 'stacks');
const INSTRUCTIONS_DIR = path.join(ROOT, 'adapters', 'copilot', 'templates', 'instructions');

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

const stackNames = fs
  .readdirSync(STACKS_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''));

const instructionNames = fs
  .readdirSync(INSTRUCTIONS_DIR)
  .filter((f) => f.endsWith('.instructions.md'))
  .map((f) => f.replace(/\.instructions\.md$/, ''));

test('every stack profile has a Copilot instruction template', () => {
  const missing = stackNames.filter((s) => !instructionNames.includes(s));
  assert.deepStrictEqual(
    missing,
    [],
    `stacks without an instruction template: ${missing.join(', ')}`
  );
});

test('every instruction template has a stack profile', () => {
  const orphaned = instructionNames.filter((i) => !stackNames.includes(i));
  assert.deepStrictEqual(
    orphaned,
    [],
    `instruction templates without a stack profile: ${orphaned.join(', ')}`
  );
});

test('every instruction template has applyTo frontmatter and no Detection block', () => {
  const problems = [];
  for (const name of instructionNames) {
    const content = fs.readFileSync(path.join(INSTRUCTIONS_DIR, `${name}.instructions.md`), 'utf8');
    if (!/^---\napplyTo: /.test(content)) {
      problems.push(`${name}: missing applyTo frontmatter`);
    }
    if (/^## Detection$/m.test(content)) {
      problems.push(`${name}: contains a stack Detection block`);
    }
  }
  assert.deepStrictEqual(problems, [], problems.join('; '));
});

// ─── Agents ↔ agent templates ────────────────────────────────────────────────

const AGENTS_DIR = path.join(ROOT, 'agents');
const AGENT_TEMPLATES_DIR = path.join(ROOT, 'adapters', 'copilot', 'templates', 'agents');

// Canonical agent name → Copilot agent template name, where they differ.
const AGENT_NAME_MAP = { 'security-audit': 'security-auditor' };

const agentNames = fs
  .readdirSync(AGENTS_DIR)
  .filter((f) => f.endsWith('.md') && f !== 'README.md')
  .map((f) => f.replace(/\.md$/, ''));

const agentTemplateNames = fs
  .readdirSync(AGENT_TEMPLATES_DIR)
  .filter((f) => f.endsWith('.agent.md'))
  .map((f) => f.replace(/\.agent\.md$/, ''));

test('every canonical agent has a Copilot agent template', () => {
  const missing = agentNames.filter((a) => !agentTemplateNames.includes(AGENT_NAME_MAP[a] || a));
  assert.deepStrictEqual(missing, [], `agents without a Copilot template: ${missing.join(', ')}`);
});

test('every Copilot agent template has a canonical agent', () => {
  const mapped = agentNames.map((a) => AGENT_NAME_MAP[a] || a);
  const orphaned = agentTemplateNames.filter((t) => !mapped.includes(t));
  assert.deepStrictEqual(orphaned, [], `agent templates without a canonical agent: ${orphaned.join(', ')}`);
});

// ─── Skills → prompt templates (decision list) ───────────────────────────────

const SKILLS_DIR = path.join(ROOT, 'skills');
const PROMPTS_DIR = path.join(ROOT, 'adapters', 'copilot', 'templates', 'prompts');

// Every skill must appear on exactly one side of this decision: it either
// ships as a Copilot prompt, or it is claude-code-only (harness-specific
// mechanics, techniques embedded in other prompts, or meta-skills).
// Adding a skill without deciding fails this guard on purpose.
const CLAUDE_CODE_ONLY_SKILLS = [
  'babysit',
  'coderabbit-pr-review',
  'costs',
  'dispatching-parallel-agents',
  'doctor',
  'envoy-authoring',
  'eval-harness',
  'pressure-test-scenarios',
  'prs',
  'receiving-code-review',
  'requesting-code-review',
  'search-first',
  'systematic-debugging',
  'test-driven-development',
  'using-envoy',
  'using-git-worktrees',
  'verification',
  'writing-skills',
];

// Prompts with no standalone skill (variants of another skill's flow).
const PROMPT_ONLY = ['quick-review'];

const skillNames = fs
  .readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

const promptNames = fs
  .readdirSync(PROMPTS_DIR)
  .filter((f) => f.endsWith('.prompt.md'))
  .map((f) => f.replace(/\.prompt\.md$/, ''));

test('every skill either has a Copilot prompt or is explicitly claude-code-only', () => {
  const undecided = skillNames.filter(
    (s) => !promptNames.includes(s) && !CLAUDE_CODE_ONLY_SKILLS.includes(s)
  );
  assert.deepStrictEqual(
    undecided,
    [],
    `skills with no prompt and no claude-code-only decision: ${undecided.join(', ')}`
  );
});

test('claude-code-only entries and prompts do not overlap or go stale', () => {
  const overlapping = CLAUDE_CODE_ONLY_SKILLS.filter((s) => promptNames.includes(s));
  assert.deepStrictEqual(overlapping, [], `claude-code-only skills that DO have a prompt: ${overlapping.join(', ')}`);
  const stale = CLAUDE_CODE_ONLY_SKILLS.filter((s) => !skillNames.includes(s));
  assert.deepStrictEqual(stale, [], `claude-code-only entries with no such skill: ${stale.join(', ')}`);
});

test('every prompt template maps to a skill or is a known variant', () => {
  const orphaned = promptNames.filter((p) => !skillNames.includes(p) && !PROMPT_ONLY.includes(p));
  assert.deepStrictEqual(orphaned, [], `prompts with no skill and no variant note: ${orphaned.join(', ')}`);
});

test('prompt-only entries and the agent name map do not go stale', () => {
  const missingPrompt = PROMPT_ONLY.filter((p) => !promptNames.includes(p));
  assert.deepStrictEqual(missingPrompt, [], `prompt-only entries with no such prompt: ${missingPrompt.join(', ')}`);
  const grewSkill = PROMPT_ONLY.filter((p) => skillNames.includes(p));
  assert.deepStrictEqual(grewSkill, [], `prompt-only entries that now have a skill: ${grewSkill.join(', ')}`);
  const staleMapped = Object.keys(AGENT_NAME_MAP).filter((a) => !agentNames.includes(a));
  assert.deepStrictEqual(staleMapped, [], `agent name mappings with no such agent: ${staleMapped.join(', ')}`);
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
