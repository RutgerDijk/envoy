/**
 * Context Budget — LITM-Aware Prompt Structuring
 *
 * Classifies task complexity and provides guidance on:
 * - How much context to include in agent prompts
 * - Which model tier to use
 * - How to order prompt sections for optimal attention
 *
 * Based on "Lost in the Middle" (Liu et al., 2023):
 * LLMs attend most to the beginning and end of context,
 * with a U-shaped attention curve that dips in the middle.
 *
 * Claude attention profile: begin=0.92, middle=0.50, end=0.88
 */

/**
 * Task complexity tiers.
 * Determines prompt budget, model tier, and expected output length.
 */
const COMPLEXITY = {
  mechanical: {
    label: 'mechanical',
    description: 'Rename, move, format, simple find-replace',
    promptBudget: 'minimal',
    modelTier: 'haiku',
    maxPromptLines: 30,
    expectedOutputTokens: 100,
  },
  simple: {
    label: 'simple',
    description: 'Single-file change, clear spec, no ambiguity',
    promptBudget: 'focused',
    modelTier: 'sonnet',
    maxPromptLines: 60,
    expectedOutputTokens: 300,
  },
  standard: {
    label: 'standard',
    description: 'Multi-file feature, requires understanding context',
    promptBudget: 'standard',
    modelTier: 'sonnet',
    maxPromptLines: 120,
    expectedOutputTokens: 800,
  },
  complex: {
    label: 'complex',
    description: 'Cross-cutting concern, architecture decision, new subsystem',
    promptBudget: 'full',
    modelTier: 'opus',
    maxPromptLines: 250,
    expectedOutputTokens: 2000,
  },
  architectural: {
    label: 'architectural',
    description: 'System design, major refactor, multi-service changes',
    promptBudget: 'unlimited',
    modelTier: 'opus',
    maxPromptLines: null,
    expectedOutputTokens: null,
  },
};

/**
 * Classify task complexity based on signals.
 *
 * @param {Object} signals
 * @param {number} [signals.filesChanged] - Number of files to change
 * @param {number} [signals.servicesAffected] - Number of services/projects
 * @param {boolean} [signals.hasArchDecision] - Involves architecture decision
 * @param {boolean} [signals.isNewSubsystem] - Creating something new
 * @param {boolean} [signals.isMechanical] - Pure mechanical change
 * @param {string[]} [signals.keywords] - Task description keywords
 * @param {number} [signals.behaviorCount] - Number of specified behaviors (tasks schema `behavior`)
 * @param {boolean} [signals.crossesLayers] - Files span backend and frontend (counts as 2 services)
 * @returns {typeof COMPLEXITY[keyof typeof COMPLEXITY]}
 */
function classifyComplexity(signals) {
  const services = signals.crossesLayers === true
    ? Math.max(signals.servicesAffected || 0, 2)
    : signals.servicesAffected;
  const behaviors = typeof signals.behaviorCount === 'number' ? signals.behaviorCount : 0;

  if (signals.isMechanical) return COMPLEXITY.mechanical;
  if (signals.hasArchDecision || signals.isNewSubsystem) return COMPLEXITY.architectural;
  if (services > 2 || behaviors > 6) return COMPLEXITY.complex;
  if (signals.filesChanged > 5 || services > 1 || behaviors >= 3) return COMPLEXITY.standard;
  if (signals.filesChanged <= 2) return COMPLEXITY.simple;

  // Keyword-based fallback
  const keywords = (signals.keywords || []).join(' ').toLowerCase();
  if (/rename|move|format|delete unused/.test(keywords)) return COMPLEXITY.mechanical;
  if (/architect|design|rfc|migration strategy/.test(keywords)) return COMPLEXITY.architectural;
  if (/refactor|cross-cutting|multi-service/.test(keywords)) return COMPLEXITY.complex;

  return COMPLEXITY.standard;
}

// Backend/frontend layer detection for signalsFromTask. Stack names come from
// lib/stack-loader.js detectStacksFromFiles; a path-segment heuristic covers
// files whose extension alone says nothing about the layer (plain .ts/.js).
const BACKEND_STACKS = ['dotnet', 'api-patterns', 'entity-framework', 'testing-dotnet'];
const FRONTEND_PATH = /(^|\/)(frontend|client|web|ui)\//i;
const BACKEND_PATH = /(^|\/)(backend|server|api)\//i;

/**
 * Derive classifyComplexity signals from a task object (lib/schemas/tasks.json).
 * Free text (title/intent) is deliberately NOT turned into keywords — a title
 * that merely mentions "design" must not jump a task to the architectural tier.
 *
 * @param {{files?: string[], behavior?: string[]}} task
 * @returns {{filesChanged: number, behaviorCount: number, crossesLayers: boolean}}
 */
function signalsFromTask(task) {
  const files = Array.isArray(task && task.files) ? task.files : [];
  const behavior = Array.isArray(task && task.behavior) ? task.behavior : [];
  const { detectStacksFromFiles, isFrontendStack } = require('./stack-loader');
  const stacks = detectStacksFromFiles(files);
  const frontend = stacks.some(isFrontendStack) || files.some((f) => FRONTEND_PATH.test(f));
  const backend = stacks.some((s) => BACKEND_STACKS.includes(s)) || files.some((f) => BACKEND_PATH.test(f));
  return { filesChanged: files.length, behaviorCount: behavior.length, crossesLayers: frontend && backend };
}

/**
 * LITM-aware prompt section ordering.
 *
 * Arranges prompt sections so high-priority content lands at
 * the beginning (alpha=0.92) and end (gamma=0.88) of the prompt,
 * while lower-priority reference material goes in the middle (beta=0.50).
 *
 * @param {PromptSection[]} sections - Sections with priority
 * @returns {PromptSection[]} Reordered sections
 */
function orderForAttention(sections) {
  // Sort by priority descending
  const sorted = [...sections].sort((a, b) => b.priority - a.priority);

  if (sorted.length <= 2) return sorted;

  // Interleave: highest priority at start and end, lowest in middle
  const result = [];
  const beginSlots = [];
  const endSlots = [];
  const middleSlots = [];

  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) {
      // Highest priority → beginning (alpha position)
      beginSlots.push(sorted[i]);
    } else if (i === 1) {
      // Second highest → end (gamma position)
      endSlots.push(sorted[i]);
    } else if (i % 2 === 0) {
      // Even indices → beginning (near alpha)
      beginSlots.push(sorted[i]);
    } else {
      // Odd indices → middle (beta position, lowest attention)
      middleSlots.push(sorted[i]);
    }
  }

  result.push(...beginSlots, ...middleSlots, ...endSlots);
  return result;
}

/**
 * Build a structured agent prompt with LITM-aware ordering.
 *
 * @param {Object} params
 * @param {string} params.objective - What the agent must accomplish (CRITICAL — alpha position)
 * @param {string} params.constraints - Rules, TDD requirements, etc. (HIGH — alpha position)
 * @param {string} [params.context] - Background info, plan excerpt (MEDIUM — beta position)
 * @param {string} [params.reference] - Stack profiles, examples (LOW — beta position)
 * @param {string} [params.scratchpad] - Shared scratchpad briefing (MEDIUM — beta position)
 * @param {string} params.acceptance - Done criteria, expected output (HIGH — gamma position)
 * @param {string} [params.learnings] - Patterns/corrections reminders (MEDIUM — gamma position)
 * @returns {string} Assembled prompt
 */
function buildAgentPrompt(params) {
  const sections = [
    { name: 'Objective', content: params.objective, priority: 10 },
    { name: 'Constraints', content: params.constraints, priority: 9 },
    { name: 'Acceptance Criteria', content: params.acceptance, priority: 8 },
  ];

  if (params.learnings) {
    sections.push({ name: 'Known Patterns', content: params.learnings, priority: 7 });
  }
  if (params.scratchpad) {
    sections.push({ name: 'Shared State', content: params.scratchpad, priority: 6 });
  }
  if (params.context) {
    sections.push({ name: 'Context', content: params.context, priority: 5 });
  }
  if (params.reference) {
    sections.push({ name: 'Reference', content: params.reference, priority: 3 });
  }

  const ordered = orderForAttention(sections);

  return ordered
    .map(s => `## ${s.name}\n\n${s.content}`)
    .join('\n\n---\n\n');
}

/**
 * Estimate whether a prompt is within budget for its complexity tier.
 *
 * @param {string} prompt - The assembled prompt
 * @param {typeof COMPLEXITY[keyof typeof COMPLEXITY]} tier - Complexity tier
 * @returns {{withinBudget: boolean, lines: number, maxLines: number|null, suggestion: string|null}}
 */
function checkBudget(prompt, tier) {
  const lines = prompt.split('\n').length;
  const maxLines = tier.maxPromptLines;

  if (maxLines === null) {
    return { withinBudget: true, lines, maxLines, suggestion: null };
  }

  if (lines <= maxLines) {
    return { withinBudget: true, lines, maxLines, suggestion: null };
  }

  const ratio = lines / maxLines;
  let suggestion;
  if (ratio > 3) {
    suggestion = `Prompt is ${ratio.toFixed(1)}x over budget. Remove reference material and context — keep only objective + constraints + acceptance.`;
  } else if (ratio > 1.5) {
    suggestion = `Prompt is ${ratio.toFixed(1)}x over budget. Trim context and reference sections.`;
  } else {
    suggestion = `Prompt is slightly over budget (${lines}/${maxLines} lines). Minor trimming needed.`;
  }

  return { withinBudget: false, lines, maxLines, suggestion };
}

/**
 * Build the prompt and fit it to the tier's budget.
 *
 * Constraints (the Iron Laws, injected verbatim per skills/pickup/SKILL.md)
 * are fixed overhead that must never be trimmed, so they are excluded from
 * the budgeted line count: checkBudget runs on the prompt minus the
 * Constraints content lines. When over budget, Reference is dropped first,
 * then Context; objective, constraints, acceptance, learnings and scratchpad
 * are never trimmed. A still-over prompt is returned as-is (the tier is
 * advisory).
 *
 * @param {Object} params - buildAgentPrompt params
 * @param {typeof COMPLEXITY[keyof typeof COMPLEXITY]} tier
 * @returns {{prompt: string, budget: ReturnType<typeof checkBudget>, trimmed: string[], constraintLines: number}}
 */
function fitToBudget(params, tier) {
  const p = { ...params };
  const trimmed = [];
  const constraintLines = String(p.constraints || '').split('\n').length;
  // Budget the prompt with the Constraints body blanked out (heading kept).
  const constraintsBlock = `## Constraints\n\n${p.constraints}`;
  const measure = () => {
    const prompt = buildAgentPrompt(p);
    const budgeted = prompt.replace(constraintsBlock, () => '## Constraints\n\n');
    return { prompt, budget: checkBudget(budgeted, tier) };
  };
  let r = measure();
  for (const [key, name] of [['reference', 'Reference'], ['context', 'Context']]) {
    if (r.budget.withinBudget) break;
    if (!p[key]) continue;
    delete p[key];
    trimmed.push(name);
    r = measure();
  }
  return { prompt: r.prompt, budget: r.budget, trimmed, constraintLines };
}

module.exports = {
  COMPLEXITY,
  classifyComplexity,
  signalsFromTask,
  orderForAttention,
  buildAgentPrompt,
  checkBudget,
  fitToBudget,
};

/**
 * CLI: node lib/context-budget.js build <params.json> --tier <tier> [--task <id>] [--issue <n>]
 *
 * params.json carries buildAgentPrompt params. `constraintsFiles` (paths,
 * relative to params.json's directory) are read with fs and prepended to
 * `constraints` verbatim — no shell. Prints a verdict block, then the final
 * prompt after a `===== PROMPT =====` line. When a section was trimmed, a
 * `prompt-budget-trimmed` event is appended to .envoy/ledger.jsonl in cwd.
 * Exit 0 even when over budget (advisory); exit 1 on bad input.
 */
function cli(argv) {
  const fs = require('fs');
  const path = require('path');
  const fail = (msg) => { process.stderr.write(`context-budget: ${msg}\n`); return 1; };
  const [cmd, paramsFile, ...rest] = argv;
  if (cmd !== 'build' || !paramsFile) return fail('usage: build <params.json> --tier <tier> [--task <id>] [--issue <n>]');
  const opt = (name) => { const i = rest.indexOf(`--${name}`); return i > -1 ? rest[i + 1] : undefined; };
  const tierName = opt('tier');
  const tier = Object.prototype.hasOwnProperty.call(COMPLEXITY, tierName) ? COMPLEXITY[tierName] : null;
  if (!tier) return fail(`unknown --tier "${tierName}" (expected one of ${Object.keys(COMPLEXITY).join(', ')})`);

  let params;
  try { params = JSON.parse(fs.readFileSync(paramsFile, 'utf8')); } catch (e) { return fail(`cannot read params: ${e.message}`); }
  if (Array.isArray(params.constraintsFiles)) {
    const base = path.dirname(path.resolve(paramsFile));
    try {
      const laws = params.constraintsFiles.map((f) => fs.readFileSync(path.resolve(base, f), 'utf8').replace(/\s+$/, ''));
      params.constraints = [...laws, params.constraints].filter(Boolean).join('\n\n');
    } catch (e) { return fail(`cannot read constraintsFiles: ${e.message}`); }
    delete params.constraintsFiles;
  }
  for (const k of ['objective', 'constraints', 'acceptance']) {
    if (typeof params[k] !== 'string' || !params[k].trim()) return fail(`params.${k} is required`);
  }

  const { prompt, budget, trimmed, constraintLines } = fitToBudget(params, tier);
  const max = budget.maxLines === null ? 'unlimited' : budget.maxLines;
  process.stdout.write(`BUDGET: ${budget.withinBudget ? 'within' : 'over'} (${budget.lines}/${max} lines, tier ${tier.label}, model tier ${tier.modelTier} — advisory; constraints excluded (${constraintLines} fixed lines))\n`);
  if (trimmed.length) process.stdout.write(`Trimmed: ${trimmed.join(', ')}\n`);
  if (!budget.withinBudget && budget.suggestion) process.stdout.write(`Suggestion: ${budget.suggestion}\n`);
  if (trimmed.length) {
    const { appendEvent } = require('./ledger');
    const event = {
      type: 'prompt-budget-trimmed', skill: 'pickup', tier: tier.label, trimmed,
      lines: budget.lines, maxLines: budget.maxLines, withinBudget: budget.withinBudget,
    };
    const task = opt('task');
    if (task) event.task = task;
    const issue = Number(opt('issue'));
    if (Number.isInteger(issue) && issue > 0) event.issue = issue;
    appendEvent(process.cwd(), event);
  }
  process.stdout.write(`===== PROMPT =====\n${prompt}\n`);
  return 0;
}

if (require.main === module) {
  process.exitCode = cli(process.argv.slice(2));
}

/**
 * @typedef {Object} PromptSection
 * @property {string} name
 * @property {string} content
 * @property {number} priority - Higher = more important (placed at attention peaks)
 */
