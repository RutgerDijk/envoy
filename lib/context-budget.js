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
 * @returns {typeof COMPLEXITY[keyof typeof COMPLEXITY]}
 */
function classifyComplexity(signals) {
  if (signals.isMechanical) return COMPLEXITY.mechanical;
  if (signals.hasArchDecision || signals.isNewSubsystem) return COMPLEXITY.architectural;
  if (signals.servicesAffected > 2) return COMPLEXITY.complex;
  if (signals.filesChanged > 5 || signals.servicesAffected > 1) return COMPLEXITY.standard;
  if (signals.filesChanged <= 2) return COMPLEXITY.simple;

  // Keyword-based fallback
  const keywords = (signals.keywords || []).join(' ').toLowerCase();
  if (/rename|move|format|delete unused/.test(keywords)) return COMPLEXITY.mechanical;
  if (/architect|design|rfc|migration strategy/.test(keywords)) return COMPLEXITY.architectural;
  if (/refactor|cross-cutting|multi-service/.test(keywords)) return COMPLEXITY.complex;

  return COMPLEXITY.standard;
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

module.exports = {
  COMPLEXITY,
  classifyComplexity,
  orderForAttention,
  buildAgentPrompt,
  checkBudget,
};

/**
 * @typedef {Object} PromptSection
 * @property {string} name
 * @property {string} content
 * @property {number} priority - Higher = more important (placed at attention peaks)
 */
