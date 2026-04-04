#!/usr/bin/env node
/**
 * UserPromptSubmit hook: Correction detection via Haiku classification.
 *
 * When the user submits a prompt, sends it to Haiku to classify whether
 * it's a correction of Claude's behavior. If yes, saves the correction:
 *   - project-specific → memory/corrections.md (committed, team-shared)
 *   - universal → ~/.claude/learnings/corrections.md (personal)
 *
 * Deduplicates against existing corrections to avoid saving duplicates.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_CORRECTIONS_PATH = 'memory/corrections.md';
const USER_CORRECTIONS_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '~',
  '.claude', 'learnings'
);
const USER_CORRECTIONS_PATH = path.join(USER_CORRECTIONS_DIR, 'corrections.md');

function run(rawInput) {
  try {
    const input = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
    const userPrompt = input.prompt || input.message || input.content || '';

    // Skip very short prompts or common non-correction patterns
    if (userPrompt.length < 10) return;
    if (/^(yes|no|y|n|ok|thanks|continue|proceed|done|looks good|lgtm)\s*$/i.test(userPrompt.trim())) return;

    // Classify via Haiku
    const classification = classifyCorrection(userPrompt);
    if (!classification || !classification.is_correction) return;

    const today = new Date().toISOString().split('T')[0];
    const rule = classification.rule;

    if (classification.scope === 'project') {
      saveCorrection(PROJECT_CORRECTIONS_PATH, rule, today, '# Project Corrections');
    } else if (classification.scope === 'user') {
      // Ensure user learnings directory exists
      fs.mkdirSync(USER_CORRECTIONS_DIR, { recursive: true });
      saveCorrection(USER_CORRECTIONS_PATH, rule, today, '# User Corrections');
    }
  } catch (err) {
    // Hook must never block — fail silently
  }
}

/**
 * Classify a user prompt via Haiku.
 * @param {string} prompt
 * @returns {{ is_correction: boolean, scope: 'project' | 'user' | null, rule: string | null } | null}
 */
function classifyCorrection(prompt) {
  try {
    const classificationPrompt = `Classify this user message. Reply with JSON only, no markdown.
{
  "is_correction": true/false,
  "scope": "project" | "user" | null,
  "rule": "one-line rule summary" | null
}

Scope heuristic:
- References specific files, APIs, classes, or project patterns → "project"
- References a language, framework, or general coding practice → "user"

Message: "${prompt.replace(/"/g, '\\"').slice(0, 500)}"`;

    // Use Claude CLI to call Haiku
    const result = execSync(
      `echo ${JSON.stringify(classificationPrompt)} | claude -m haiku --output-format json -p 2>/dev/null`,
      { encoding: 'utf8', timeout: 10000 }
    );

    // Parse the response — look for JSON in the output
    const jsonMatch = result.match(/\{[\s\S]*?"is_correction"[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      // Normalize boolean strings
      if (typeof parsed.is_correction === 'string') {
        parsed.is_correction = parsed.is_correction.toLowerCase() === 'true';
      }
      return parsed;
    }
  } catch (err) {
    // Classification failed — skip silently
  }
  return null;
}

/**
 * Save a correction to a markdown file, with deduplication.
 * @param {string} filePath
 * @param {string} rule
 * @param {string} date
 * @param {string} header
 */
function saveCorrection(filePath, rule, date, header) {
  // Read existing corrections
  let content = '';
  try {
    if (fs.existsSync(filePath)) {
      content = fs.readFileSync(filePath, 'utf8');
    }
  } catch (err) {
    // Start fresh
  }

  // Deduplicate: check if a very similar rule already exists
  const existingRules = content.split('\n')
    .filter(line => line.startsWith('- '))
    .map(line => line.replace(/^-\s+/, '').replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, '').trim().toLowerCase());

  const normalizedRule = rule.trim().toLowerCase();
  const isDuplicate = existingRules.some(existing =>
    existing === normalizedRule ||
    levenshteinSimilarity(existing, normalizedRule) > 0.85
  );

  if (isDuplicate) return;

  // Ensure directory exists
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  // Append the correction
  if (!content) {
    content = `${header}\n\n`;
  }
  content += `- ${rule} (${date})\n`;

  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Simple Levenshtein similarity (0-1) for fuzzy deduplication.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshteinSimilarity(a, b) {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  const matrix = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return 1 - matrix[a.length][b.length] / maxLen;
}

// CLI mode
if (require.main === module) {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { data += chunk; });
  process.stdin.on('end', () => {
    run(data);
    process.exit(0);
  });
}

module.exports = { run };
