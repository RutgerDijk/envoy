/**
 * Learning loader — reads graduated patterns and corrections for use by skills.
 *
 * Used by executing-plans (implementation reminders) and layered-review
 * (avoid flagging team decisions).
 */

const fs = require('fs');
const path = require('path');

const REVIEW_LEARNINGS_PATH = 'memory/review-learnings.md';
const CODERABBIT_PATTERNS_PATH = 'memory/coderabbit-patterns.md';
const PROJECT_CORRECTIONS_PATH = 'memory/corrections.md';
const USER_CORRECTIONS_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || '~',
  '.claude', 'learnings', 'corrections.md'
);

/**
 * Load confirmed+ patterns from review-learnings.md and coderabbit-patterns.md.
 * Optionally filter by stack names.
 *
 * @param {string[]} [stackNames] - Stack names to filter by (e.g., ['dotnet', 'react']). Empty = all.
 * @returns {{ description: string, count: number, stack: string, source: string }[]}
 */
function loadConfirmedPatterns(stackNames) {
  const patterns = [];

  // Load from review learnings
  const reviewData = loadDataFromFile(REVIEW_LEARNINGS_PATH);
  if (reviewData && reviewData.patterns) {
    for (const [, pattern] of Object.entries(reviewData.patterns)) {
      if (pattern.level === 'confirmed' || pattern.level === 'automated') {
        if (!stackNames || stackNames.length === 0 || stackNames.includes(pattern.stack) || pattern.stack === 'general') {
          patterns.push({
            description: pattern.description,
            count: pattern.count,
            stack: pattern.stack,
            source: 'review',
          });
        }
      }
    }
  }

  // Load from CodeRabbit patterns
  const coderabbitData = loadDataFromFile(CODERABBIT_PATTERNS_PATH);
  if (coderabbitData && coderabbitData.patterns) {
    for (const [, pattern] of Object.entries(coderabbitData.patterns)) {
      if (pattern.level === 'confirmed' || pattern.level === 'automated') {
        if (!stackNames || stackNames.length === 0 || stackNames.includes(pattern.stack) || pattern.stack === 'general') {
          // Deduplicate by normalized description
          const exists = patterns.some(p =>
            p.description.toLowerCase() === pattern.description.toLowerCase()
          );
          if (!exists) {
            patterns.push({
              description: pattern.description,
              count: pattern.prCount || pattern.count,
              stack: pattern.stack,
              source: 'coderabbit',
            });
          }
        }
      }
    }
  }

  return patterns;
}

/**
 * Load corrections from project-level and user-level files.
 *
 * @param {string} [projectDir] - Project root (defaults to cwd)
 * @returns {{ rule: string, scope: 'project' | 'user', date: string }[]}
 */
function loadCorrections(projectDir) {
  const corrections = [];

  // Project-level corrections
  const projectPath = projectDir
    ? path.join(projectDir, PROJECT_CORRECTIONS_PATH)
    : PROJECT_CORRECTIONS_PATH;
  const projectCorrections = parseCorrectionsFile(projectPath);
  for (const c of projectCorrections) {
    corrections.push({ ...c, scope: 'project' });
  }

  // User-level corrections
  const userCorrections = parseCorrectionsFile(USER_CORRECTIONS_PATH);
  for (const c of userCorrections) {
    // Deduplicate against project corrections
    const exists = corrections.some(p =>
      p.rule.toLowerCase() === c.rule.toLowerCase()
    );
    if (!exists) {
      corrections.push({ ...c, scope: 'user' });
    }
  }

  return corrections;
}

/**
 * Format patterns and corrections as a concise prompt section.
 *
 * @param {{ description: string, count: number, stack: string }[]} patterns
 * @param {{ rule: string, scope: string }[]} corrections
 * @returns {string}
 */
function formatReminders(patterns, corrections) {
  const sections = [];

  if (patterns.length > 0) {
    const lines = patterns.map(p => `- [${p.stack}] ${p.description}`);
    sections.push(`**Known patterns (avoid these):**\n${lines.join('\n')}`);
  }

  if (corrections.length > 0) {
    const lines = corrections.map(c => `- ${c.rule}`);
    sections.push(`**Team corrections:**\n${lines.join('\n')}`);
  }

  return sections.join('\n\n');
}

/**
 * Load embedded JSON data from a markdown file.
 * @param {string} filePath
 * @returns {object|null}
 */
function loadDataFromFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const jsonMatch = content.match(/<!--\s*DATA:\s*({[\s\S]*?})\s*-->/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
    }
  } catch (err) {
    // File missing or corrupt — return null
  }
  return null;
}

/**
 * Parse a corrections markdown file into structured data.
 * Format: `- Rule text (YYYY-MM-DD)`
 *
 * @param {string} filePath
 * @returns {{ rule: string, date: string }[]}
 */
function parseCorrectionsFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    const corrections = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const match = line.match(/^-\s+(.+?)(?:\s*\((\d{4}-\d{2}-\d{2})\))?\s*$/);
      if (match) {
        corrections.push({
          rule: match[1].trim(),
          date: match[2] || 'unknown',
        });
      }
    }

    return corrections;
  } catch (err) {
    return [];
  }
}

module.exports = {
  loadConfirmedPatterns,
  loadCorrections,
  formatReminders,
  loadDataFromFile,
  parseCorrectionsFile,
};
