#!/usr/bin/env node
/**
 * Async Stop hook: Cross-PR CodeRabbit pattern aggregation.
 *
 * After finalize sessions, tracks which CodeRabbit comment categories
 * recur across PRs. Patterns graduate through the same levels as
 * review-learnings (detected → confirmed → automated → archived).
 *
 * Storage: memory/coderabbit-patterns.md
 * Tagged with stack for selective loading by implementing agents.
 */

const fs = require('fs');
const path = require('path');

const PATTERNS_PATH = 'memory/coderabbit-patterns.md';

/**
 * Map file extensions to stack names.
 */
const EXT_TO_STACK = {
  '.cs': 'dotnet',
  '.csproj': 'dotnet',
  '.sln': 'dotnet',
  '.tsx': 'react',
  '.jsx': 'react',
  '.ts': 'typescript',
  '.js': 'javascript',
  '.bicep': 'bicep',
  '.css': 'css',
  '.scss': 'css',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
};

/**
 * Determine graduated level from PR count.
 * @param {number} prCount
 * @returns {'detected' | 'confirmed' | 'automated'}
 */
function getLevel(prCount) {
  if (prCount >= 5) return 'automated';
  if (prCount >= 3) return 'confirmed';
  return 'detected';
}

/**
 * Hook entry point. Aggregates CodeRabbit comment categories across PRs
 * and graduates them through detection levels.
 * @param {string|object} rawInput - Session data from Claude Code (JSON string or object)
 */
function run(rawInput) {
  try {
    const input = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;

    // Only run after finalize sessions
    if (!isFinalizeSession(input)) return;

    const findings = extractCodeRabbitFindings(input);
    if (findings.length === 0) return;

    // Load existing patterns
    const data = loadPatterns();

    // Aggregate findings by category
    const categoriesInThisSession = new Set();
    for (const finding of findings) {
      const key = finding.category.toLowerCase();
      categoriesInThisSession.add(key);

      // Check if this was archived — re-promote it
      const archivedIdx = (data.archived || []).findIndex(a => a.key === key);
      if (archivedIdx !== -1) {
        const archived = data.archived[archivedIdx];
        data.archived.splice(archivedIdx, 1);
        data.patterns[key] = {
          category: archived.category || finding.category,
          description: archived.description || finding.category,
          prCount: 1,
          level: 'detected',
          firstSeen: archived.firstSeen || new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          stacks: archived.stacks || (finding.stack ? [finding.stack] : ['general']),
          stack: archived.stack || finding.stack || 'general',
          example: finding.example || archived.example || '',
          reviewsSinceLastSeen: 0,
        };
      } else if (data.patterns[key]) {
        data.patterns[key].prCount++;
        data.patterns[key].lastSeen = new Date().toISOString();
        data.patterns[key].reviewsSinceLastSeen = 0;
        data.patterns[key].level = getLevel(data.patterns[key].prCount);
        // Update example if we have one
        if (finding.example) {
          data.patterns[key].example = finding.example;
        }
        // Add stack if not already present
        if (finding.stack && !data.patterns[key].stacks.includes(finding.stack)) {
          data.patterns[key].stacks.push(finding.stack);
        }
      } else {
        data.patterns[key] = {
          category: finding.category,
          description: finding.description || finding.category,
          prCount: 1,
          level: 'detected',
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          stacks: finding.stack ? [finding.stack] : ['general'],
          stack: finding.stack || 'general',
          example: finding.example || '',
          reviewsSinceLastSeen: 0,
        };
      }
    }

    // Age out patterns not seen in this session
    for (const [key, pattern] of Object.entries(data.patterns)) {
      if (!categoriesInThisSession.has(key)) {
        pattern.reviewsSinceLastSeen++;
      }
    }

    // Archive patterns not seen in 5+ sessions (confirmed+ only)
    for (const [key, pattern] of Object.entries(data.patterns)) {
      if (pattern.reviewsSinceLastSeen >= 5 && pattern.prCount >= 3) {
        data.archived = data.archived || [];
        data.archived.push({ key, ...pattern, archivedAt: new Date().toISOString() });
        delete data.patterns[key];
      }
    }

    data.totalSessions++;
    savePatterns(data);
  } catch (err) {
    // Async hook — never block
  }
}

function isFinalizeSession(input) {
  const text = (input.conversation || input.output || input.tool_name || '').toLowerCase();
  return text.includes('finalize') ||
         text.includes('gh pr create') ||
         text.includes('coderabbit');
}

function extractCodeRabbitFindings(input) {
  const findings = [];
  const text = input.conversation || input.output || '';

  // Match CodeRabbit comment patterns — category extraction
  const { extractCategory } = require('../lib/coderabbit-parser');

  // Look for CodeRabbit comment blocks in session output
  const commentBlocks = text.match(/(?:coderabbit|CR)[\s\S]*?(?:suggestion|warning|nitpick|critical)[\s\S]*?(?:\n\n|\n-)/gi) || [];

  for (const block of commentBlocks) {
    const { category } = extractCategory(block);
    const fileMatch = block.match(/(\w+\.\w+)(?::(\d+))?/);
    const ext = fileMatch ? path.extname(fileMatch[1]) : '';
    const stack = EXT_TO_STACK[ext] || 'general';

    findings.push({
      category,
      description: category,
      stack,
      example: block.slice(0, 100).trim(),
    });
  }

  // Also parse structured findings (from coderabbit-pr-review output)
  const structuredPattern = /\|\s*(.+?)\s*\|\s*(\d+)\s*\|\s*(\w+)\s*\|/g;
  let match;
  while ((match = structuredPattern.exec(text)) !== null) {
    const category = match[1].trim().toLowerCase();
    if (category === 'category' || category === '---') continue; // skip header
    findings.push({
      category,
      description: category,
      stack: match[3].trim().toLowerCase() || 'general',
      example: '',
    });
  }

  return findings;
}

function loadPatterns() {
  try {
    if (fs.existsSync(PATTERNS_PATH)) {
      const content = fs.readFileSync(PATTERNS_PATH, 'utf8');
      const jsonMatch = content.match(/<!--\s*DATA:\s*({[\s\S]*?})\s*-->/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
    }
  } catch (err) {
    // Start fresh
  }

  return { totalSessions: 0, patterns: {}, archived: [] };
}

function savePatterns(data) {
  const dir = path.dirname(PATTERNS_PATH);
  fs.mkdirSync(dir, { recursive: true });

  // Group by level
  const byLevel = { confirmed: [], detected: [], automated: [] };
  for (const [, pattern] of Object.entries(data.patterns)) {
    const level = pattern.level || getLevel(pattern.prCount);
    if (byLevel[level]) {
      byLevel[level].push(pattern);
    }
  }

  for (const level of Object.keys(byLevel)) {
    byLevel[level].sort((a, b) => b.prCount - a.prCount);
  }

  let md = '# CodeRabbit Patterns (Cross-PR)\n\n';
  md += `Total finalize sessions: ${data.totalSessions}\n\n`;

  if (byLevel.confirmed.length > 0) {
    md += '## Confirmed\n\n';
    md += '| Category | PRs Seen | Stack | Example |\n';
    md += '|----------|---------|-------|---------|\n';
    for (const p of byLevel.confirmed) {
      md += `| ${p.category} | ${p.prCount} | ${p.stack} | ${(p.example || '-').slice(0, 60)} |\n`;
    }
    md += '\n';
  }

  if (byLevel.detected.length > 0) {
    md += '## Detected\n\n';
    md += '| Category | PRs Seen | Stack | Example |\n';
    md += '|----------|---------|-------|---------|\n';
    for (const p of byLevel.detected) {
      md += `| ${p.category} | ${p.prCount} | ${p.stack} | ${(p.example || '-').slice(0, 60)} |\n`;
    }
    md += '\n';
  }

  if (byLevel.automated.length > 0) {
    md += '## Automated\n\n';
    md += '| Category | PRs Seen | Stack | Suggestion |\n';
    md += '|----------|---------|-------|------------|\n';
    for (const p of byLevel.automated) {
      md += `| ${p.category} | ${p.prCount} | ${p.stack} | pending |\n`;
    }
    md += '\n';
  }

  if (data.archived && data.archived.length > 0) {
    md += '## Archived\n\n';
    for (const p of data.archived.slice(-10)) {
      md += `- ~~${p.category}~~ (${p.prCount} PRs, archived)\n`;
    }
    md += '\n';
  }

  md += `\n<!-- DATA: ${JSON.stringify(data)} -->\n`;

  fs.writeFileSync(PATTERNS_PATH, md, 'utf8');
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
