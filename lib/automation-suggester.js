/**
 * Automation suggester — generates prevention mechanism suggestions
 * for patterns that have reached the automated level (5+ occurrences).
 *
 * Suggestions are informational only — Claude asks, the user decides.
 */

/**
 * Category patterns for matching pattern descriptions to automation types.
 */
const AUTOMATION_RULES = [
  {
    match: /\b(lint|style|format|naming|convention|indent|spacing|semicolon|quote)\b/i,
    type: 'lint-rule',
    suggest: (desc) => `Add ESLint/linter rule to catch: ${desc}`,
  },
  {
    match: /\b(unused|import|dead code|unreachable)\b/i,
    type: 'lint-rule',
    suggest: (desc) => `Enable lint rule for unused code detection: ${desc}`,
  },
  {
    match: /\b(null|undefined|missing check|optional chaining|nullable)\b/i,
    type: 'hook',
    suggest: (desc) => `Add PreToolUse hook that checks for null/undefined handling: ${desc}`,
  },
  {
    match: /\b(await|async|promise|then)\b/i,
    type: 'hook',
    suggest: (desc) => `Add PreToolUse hook that verifies async/await usage: ${desc}`,
  },
  {
    match: /\b(security|auth|injection|xss|csrf|sanitize|escape)\b/i,
    type: 'hook',
    suggest: (desc) => `Add security-focused PreToolUse hook: ${desc}`,
  },
  {
    match: /\b(type|typing|any|unknown|generic|interface)\b/i,
    type: 'lint-rule',
    suggest: (desc) => `Add TypeScript strict rule: ${desc}`,
  },
  {
    match: /\b(pattern|folder|directory|structure|location|placement)\b/i,
    type: 'template',
    suggest: (desc) => `Create code template/snippet enforcing project structure: ${desc}`,
  },
  {
    match: /\b(test|coverage|assert|mock|spec)\b/i,
    type: 'hook',
    suggest: (desc) => `Add PostToolUse hook to verify test coverage: ${desc}`,
  },
];

/**
 * Suggest an automation mechanism for a pattern that has reached 5+ occurrences.
 *
 * @param {{ description: string, stack?: string, count?: number }} pattern
 * @returns {{ type: 'lint-rule' | 'hook' | 'template', description: string, suggestion: string } | null}
 */
function suggestAutomation(pattern) {
  const desc = pattern.description || '';

  for (const rule of AUTOMATION_RULES) {
    if (rule.match.test(desc)) {
      return {
        type: rule.type,
        description: desc,
        suggestion: rule.suggest(desc),
      };
    }
  }

  // Generic fallback — suggest a hook since it's the most flexible
  return {
    type: 'hook',
    description: desc,
    suggestion: `Add PreToolUse hook to prevent: ${desc}`,
  };
}

/**
 * Format an automation suggestion as user-facing output.
 *
 * @param {{ description: string, count: number }} pattern
 * @param {{ type: string, suggestion: string }} suggestion
 * @returns {string}
 */
function formatSuggestion(pattern, suggestion) {
  return [
    `Pattern seen ${pattern.count}+ times: "${pattern.description}"`,
    `Suggested automation: ${suggestion.suggestion}`,
    `Would you like me to create this ${suggestion.type}? (The pattern will keep being checked manually until you decide)`,
  ].join('\n');
}

module.exports = { suggestAutomation, formatSuggestion };
