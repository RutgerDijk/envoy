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

// Backend/frontend layer detection for signalsFromTask. Each file lands in
// exactly one layer (or none): docs, markdown and test files have no layer;
// otherwise the outermost layer-named path segment decides, and only then
// the stack its extension maps to (lib/stack-loader.js detectStacksFromFiles).
// `api` is deliberately not a layer segment — app/api/ is a Next.js route
// folder and docs/api/ is documentation.
const BACKEND_STACKS = ['dotnet', 'api-patterns', 'entity-framework'];
const FRONTEND_SEGMENTS = ['frontend', 'client', 'web', 'ui', 'components'];
const BACKEND_SEGMENTS = ['backend', 'server'];
const NO_LAYER_EXT = ['.md', '.mdx', '.txt', '.rst'];
const NO_LAYER_SEGMENTS = ['docs', 'doc', 'test', 'tests', '__tests__', 'spec', 'specs', 'e2e'];

function fileLayer(file) {
  const norm = String(file).replace(/\\/g, '/');
  const segments = norm.split('/');
  const base = segments.pop().toLowerCase();
  const dirs = segments.map((d) => d.toLowerCase());
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.')) : '';
  if (NO_LAYER_EXT.includes(ext)) return null;
  if (dirs.some((d) => NO_LAYER_SEGMENTS.includes(d)) || /\.(test|spec)\./.test(base)) return null;
  for (const d of dirs) {
    if (FRONTEND_SEGMENTS.includes(d)) return 'frontend';
    if (BACKEND_SEGMENTS.includes(d)) return 'backend';
  }
  const { detectStacksFromFiles, isFrontendStack } = require('./stack-loader');
  const stacks = detectStacksFromFiles([norm]);
  if (stacks.some(isFrontendStack)) return 'frontend';
  if (stacks.some((st) => BACKEND_STACKS.includes(st))) return 'backend';
  return null;
}

/**
 * Derive classifyComplexity signals from a task object (lib/schemas/tasks.json).
 * crossesLayers is true only when two different files land in different
 * layers — a single file never crosses. Free text (title/intent) is
 * deliberately NOT turned into keywords — a title that merely mentions
 * "design" must not jump a task to the architectural tier.
 *
 * @param {{files?: string[], behavior?: string[]}} task
 * @returns {{filesChanged: number, behaviorCount: number, crossesLayers: boolean}}
 */
function signalsFromTask(task) {
  const files = Array.isArray(task && task.files) ? task.files : [];
  const behavior = Array.isArray(task && task.behavior) ? task.behavior : [];
  const layers = new Set(files.map(fileLayer).filter(Boolean));
  return { filesChanged: files.length, behaviorCount: behavior.length, crossesLayers: layers.size > 1 };
}

/**
 * LITM-aware prompt section ordering — a monotonic U.
 *
 * Sections sorted by priority descending (s0 highest) are laid out as
 * [s0, s2, s4, …, s5, s3, s1]: even ranks fill the front in order, odd
 * ranks fill the back in reverse. Priority therefore falls steadily from
 * the beginning (alpha=0.92) to a single dip in the middle (beta=0.50) and
 * rises steadily to the end (gamma=0.88): the highest-priority section is
 * first, the second-highest last, and the lowest sits in the middle.
 *
 * @param {PromptSection[]} sections - Sections with priority
 * @returns {PromptSection[]} Reordered sections
 */
function orderForAttention(sections) {
  const sorted = [...sections].sort((a, b) => b.priority - a.priority);
  const front = sorted.filter((_, i) => i % 2 === 0);
  const back = sorted.filter((_, i) => i % 2 === 1).reverse();
  return [...front, ...back];
}

/**
 * Build a structured agent prompt with LITM-aware ordering.
 *
 * Priorities: Objective 10, Constraints 9, Acceptance 8, Known Patterns 7,
 * Shared State 6, Context 5, Reference 3. orderForAttention places them as
 * a monotonic U, so with all seven present the order is
 * Objective, Acceptance, Shared State, Reference, Context, Known Patterns,
 * Constraints — Objective first (alpha), Constraints last (gamma),
 * Reference in the middle (beta). The default six-section implementer
 * layout (no scratchpad) is Objective, Acceptance, Context, Reference,
 * Known Patterns, Constraints.
 *
 * @param {Object} params
 * @param {string} params.objective - What the agent must accomplish (priority 10 — first, alpha)
 * @param {string} params.constraints - Rules, TDD requirements, etc. (priority 9 — last, gamma)
 * @param {string} params.acceptance - Done criteria, expected output (priority 8 — second, near alpha)
 * @param {string} [params.learnings] - Patterns/corrections reminders (priority 7 — second-to-last, near gamma)
 * @param {string} [params.scratchpad] - Shared scratchpad briefing (priority 6 — front half)
 * @param {string} [params.context] - Background info, plan excerpt (priority 5 — toward the middle)
 * @param {string} [params.reference] - Stack profiles, examples (priority 3 — middle, beta)
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
 * @throws {TypeError} when objective, constraints or acceptance is missing or empty
 */
function fitToBudget(params, tier) {
  for (const k of ['objective', 'constraints', 'acceptance']) {
    if (!params || typeof params[k] !== 'string' || !params[k].trim()) {
      throw new TypeError(`fitToBudget: params.${k} is required (non-empty string)`);
    }
  }
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
 * CLI: node lib/context-budget.js build <params.json> --tier <tier> [--task <id>] [--issue <n>] [--out <file>]
 *
 * params.json carries buildAgentPrompt params. Each section may be given
 * inline (`objective`, `context`, …) or as a plain-markdown file
 * (`objectiveFile`, `contextFile`, …) so callers never JSON-escape
 * multi-line markdown. Constraints are assembled, in order, from
 * `constraintsFiles` (the Iron Laws), `constraintsFile`, then inline
 * `constraints`. Relative paths resolve against params.json's directory;
 * every file is read with fs — no shell. Prints a verdict block, then the
 * final prompt after a `===== PROMPT =====` line — or, with --out, writes
 * the prompt to that file and prints only the verdict. When a section was
 * trimmed, a `prompt-budget-trimmed` event is appended to
 * .envoy/ledger.jsonl under cwd (run it from the worktree root).
 * Exit 0 even when over budget (advisory); exit 1 on bad input.
 */
const SECTION_KEYS = ['objective', 'constraints', 'acceptance', 'learnings', 'scratchpad', 'context', 'reference'];

function loadParams(paramsFile) {
  const fs = require('fs');
  const path = require('path');
  const raw = JSON.parse(fs.readFileSync(paramsFile, 'utf8'));
  const base = path.dirname(path.resolve(paramsFile));
  const read = (f) => fs.readFileSync(path.resolve(base, String(f)), 'utf8').replace(/\s+$/, '');
  const params = {};
  for (const key of SECTION_KEYS) {
    const parts = [];
    if (key === 'constraints' && Array.isArray(raw.constraintsFiles)) parts.push(...raw.constraintsFiles.map(read));
    if (raw[`${key}File`]) parts.push(read(raw[`${key}File`]));
    if (typeof raw[key] === 'string' && raw[key]) parts.push(raw[key]);
    if (parts.length) params[key] = parts.join('\n\n');
  }
  return params;
}

function cli(argv) {
  const fs = require('fs');
  const fail = (msg) => { process.stderr.write(`context-budget: ${msg}\n`); return 1; };
  const [cmd, paramsFile, ...rest] = argv;
  if (cmd !== 'build' || !paramsFile) return fail('usage: build <params.json> --tier <tier> [--task <id>] [--issue <n>] [--out <file>]');
  const opt = (name) => { const i = rest.indexOf(`--${name}`); return i > -1 ? rest[i + 1] : undefined; };
  const tierName = opt('tier');
  const tier = Object.prototype.hasOwnProperty.call(COMPLEXITY, tierName) ? COMPLEXITY[tierName] : null;
  if (!tier) return fail(`unknown --tier "${tierName}" (expected one of ${Object.keys(COMPLEXITY).join(', ')})`);

  let params;
  try { params = loadParams(paramsFile); } catch (e) { return fail(`cannot read params: ${e.message}`); }
  for (const k of ['objective', 'constraints', 'acceptance']) {
    if (typeof params[k] !== 'string' || !params[k].trim()) return fail(`params.${k} is required`);
  }

  const { prompt, budget, trimmed, constraintLines } = fitToBudget(params, tier);
  const outFile = opt('out');
  if (outFile) {
    try { fs.writeFileSync(outFile, `${prompt}\n`); } catch (e) { return fail(`cannot write --out: ${e.message}`); }
  }
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
  if (outFile) process.stdout.write(`Prompt written to ${outFile}\n`);
  else process.stdout.write(`===== PROMPT =====\n${prompt}\n`);
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
