/**
 * Regex-first CodeRabbit comment parser.
 *
 * Parses structured CodeRabbit PR comments using regex patterns.
 * Falls back to Haiku LLM only when confidence < 0.95.
 *
 * Target: 95%+ comments parsed by regex alone.
 */

/**
 * Severity markers used by CodeRabbit in comment bodies.
 */
const SEVERITY_PATTERNS = [
  { pattern: /🔴|❌|\[critical\]|\*\*critical\*\*/i, severity: 'critical' },
  { pattern: /🟡|⚠️|\[warning\]|\*\*warning\*\*/i, severity: 'warning' },
  { pattern: /💡|\[suggestion\]|\*\*suggestion\*\*/i, severity: 'suggestion' },
  { pattern: /🔵|ℹ️|\[nitpick\]|\*\*nitpick\*\*|\[nit\]/i, severity: 'nitpick' },
];

/**
 * Extract severity from comment body text.
 * @param {string} body - Comment body
 * @returns {{ severity: string, confidence: number }}
 */
function extractSeverity(body) {
  for (const { pattern, severity } of SEVERITY_PATTERNS) {
    if (pattern.test(body)) {
      return { severity, confidence: 1.0 };
    }
  }

  // Heuristic fallback: infer from language
  if (/\b(bug|error|crash|vulnerability|security|breaking)\b/i.test(body)) {
    return { severity: 'warning', confidence: 0.7 };
  }
  if (/\b(consider|suggest|might|could|optional|nit)\b/i.test(body)) {
    return { severity: 'suggestion', confidence: 0.7 };
  }

  return { severity: 'suggestion', confidence: 0.5 };
}

/**
 * Extract code suggestion from a ```suggestion block.
 * @param {string} body - Comment body
 * @returns {{ suggestion: string | null, confidence: number }}
 */
function extractSuggestion(body) {
  // CodeRabbit uses ```suggestion blocks
  const suggestionBlock = body.match(/```suggestion\s*\n([\s\S]*?)```/);
  if (suggestionBlock) {
    return { suggestion: suggestionBlock[1].trim(), confidence: 1.0 };
  }

  // Generic code blocks might contain the fix
  const codeBlock = body.match(/```(?:\w+)?\s*\n([\s\S]*?)```/);
  if (codeBlock) {
    return { suggestion: codeBlock[1].trim(), confidence: 0.8 };
  }

  // No code block — the suggestion is in prose
  return { suggestion: null, confidence: 0.6 };
}

/**
 * Extract category from CodeRabbit comment structure.
 * @param {string} body - Comment body
 * @returns {{ category: string, confidence: number }}
 */
function extractCategory(body) {
  const categoryPatterns = [
    { pattern: /\b(security|auth|injection|xss|csrf)\b/i, category: 'security' },
    { pattern: /\b(performance|slow|optimize|cache|memory)\b/i, category: 'performance' },
    { pattern: /\b(style|naming|convention|format)\b/i, category: 'style' },
    { pattern: /\b(bug|error|incorrect|wrong|broken)\b/i, category: 'correctness' },
    { pattern: /\b(type|typing|typescript|generic)\b/i, category: 'types' },
    { pattern: /\b(test|coverage|assert|mock)\b/i, category: 'testing' },
    { pattern: /\b(doc|comment|jsdoc|readme)\b/i, category: 'documentation' },
    { pattern: /\b(import|unused|dead code|unreachable)\b/i, category: 'cleanup' },
  ];

  for (const { pattern, category } of categoryPatterns) {
    if (pattern.test(body)) {
      return { category, confidence: 0.9 };
    }
  }

  return { category: 'general', confidence: 0.5 };
}

/**
 * Parse a single CodeRabbit PR comment.
 *
 * Uses fields from the GitHub API response:
 * - comment.path (file path)
 * - comment.line or comment.original_line (line number)
 * - comment.body (comment text)
 * - comment.id (for replying)
 *
 * @param {object} comment - GitHub API comment object
 * @returns {{ path: string, line: number|null, severity: string, suggestion: string|null, category: string, confidence: number, id: number, needsLLM: boolean }}
 */
function parseComment(comment) {
  const path = comment.path || null;
  const line = comment.line || comment.original_line || null;
  const body = comment.body || '';
  const id = comment.id;

  const severityResult = extractSeverity(body);
  const suggestionResult = extractSuggestion(body);
  const categoryResult = extractCategory(body);

  // Overall confidence is the minimum of all field confidences
  const fieldConfidences = [
    path ? 1.0 : 0.0,
    line ? 1.0 : 0.5,
    severityResult.confidence,
    suggestionResult.confidence,
    categoryResult.confidence,
  ];
  const confidence = Math.min(...fieldConfidences);

  return {
    path,
    line,
    severity: severityResult.severity,
    suggestion: suggestionResult.suggestion,
    category: categoryResult.category,
    confidence: Math.round(confidence * 100) / 100,
    id,
    needsLLM: confidence < 0.95,
  };
}

/**
 * Parse multiple CodeRabbit comments.
 * Returns parsed results and identifies which ones need LLM fallback.
 *
 * @param {object[]} comments - Array of GitHub API comment objects
 * @returns {{ parsed: object[], regexCount: number, llmCount: number, regexRate: string }}
 */
function parseComments(comments) {
  const parsed = comments.map(parseComment);
  const regexCount = parsed.filter(p => !p.needsLLM).length;
  const llmCount = parsed.filter(p => p.needsLLM).length;
  const total = parsed.length || 1;

  return {
    parsed,
    regexCount,
    llmCount,
    regexRate: `${Math.round((regexCount / total) * 100)}%`,
  };
}

module.exports = {
  parseComment,
  parseComments,
  extractSeverity,
  extractSuggestion,
  extractCategory,
};
