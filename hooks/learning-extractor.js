#!/usr/bin/env node
/**
 * Async Stop hook: Learning extractor
 *
 * After review sessions, extracts recurring patterns from findings
 * and saves them to memory/review-learnings.md. Patterns that stop
 * appearing after 5 reviews get archived.
 */

const fs = require('fs');
const path = require('path');

const LEARNINGS_PATH = 'memory/review-learnings.md';

function run(rawInput) {
  try {
    const input = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;

    // Only run after review sessions
    if (!isReviewSession(input)) return;

    const findings = extractFindings(input);
    if (findings.length === 0) return;

    // Load existing learnings
    const learnings = loadLearnings();

    // Update patterns
    for (const finding of findings) {
      const key = normalizePattern(finding);
      if (learnings.patterns[key]) {
        learnings.patterns[key].count++;
        learnings.patterns[key].lastSeen = new Date().toISOString();
        learnings.patterns[key].reviewsSinceLastSeen = 0;
      } else {
        learnings.patterns[key] = {
          description: finding.description,
          count: 1,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          stack: finding.stack || 'general',
          fileType: finding.fileType || '*',
          fixTemplate: finding.fix || '',
          reviewsSinceLastSeen: 0,
        };
      }
    }

    // Age out patterns not seen in this review
    for (const [key, pattern] of Object.entries(learnings.patterns)) {
      const wasSeen = findings.some(f => normalizePattern(f) === key);
      if (!wasSeen) {
        pattern.reviewsSinceLastSeen++;
      }
    }

    // Archive patterns not seen in 5+ reviews
    const archived = [];
    for (const [key, pattern] of Object.entries(learnings.patterns)) {
      if (pattern.reviewsSinceLastSeen >= 5 && pattern.count >= 2) {
        archived.push({ key, ...pattern });
        delete learnings.patterns[key];
      }
    }

    learnings.totalReviews++;
    if (archived.length > 0) {
      learnings.archived = learnings.archived || [];
      learnings.archived.push(...archived);
    }

    // Save updated learnings
    saveLearnings(learnings);
  } catch (err) {
    // Async hook — never block
  }
}

function isReviewSession(input) {
  const conversation = (input.conversation || input.tool_name || '').toLowerCase();
  return conversation.includes('review') ||
         conversation.includes('layered-review') ||
         conversation.includes('coderabbit');
}

function extractFindings(input) {
  // Parse findings from review output
  const findings = [];
  const text = input.conversation || input.output || '';

  // Match common finding patterns
  const patterns = [
    /⚠\s+(?:Concern|Warning):\s*(.+?)(?:\n|$)/g,
    /✗\s+(?:Issue|Error):\s*(.+?)(?:\n|$)/g,
    /🔴\s+(.+?)(?:\n|$)/g,
    /🟡\s+(.+?)(?:\n|$)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const desc = match[1].trim();
      const fileMatch = desc.match(/(\w+\.\w+):(\d+)/);
      findings.push({
        description: desc,
        fileType: fileMatch ? path.extname(fileMatch[1]) : '*',
        stack: 'general',
        fix: '',
      });
    }
  }

  return findings;
}

function normalizePattern(finding) {
  // Normalize to a reusable pattern key (strip file-specific info)
  return finding.description
    .replace(/[\w/]+\.\w+:\d+/g, '<file>:<line>')
    .replace(/`[^`]+`/g, '<code>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function loadLearnings() {
  try {
    if (fs.existsSync(LEARNINGS_PATH)) {
      const content = fs.readFileSync(LEARNINGS_PATH, 'utf8');
      // Parse markdown table into structured data
      const jsonMatch = content.match(/<!--\s*DATA:\s*({[\s\S]*?})\s*-->/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
    }
  } catch (err) {
    // Start fresh
  }

  return { totalReviews: 0, patterns: {}, archived: [] };
}

function saveLearnings(learnings) {
  // Ensure directory exists
  const dir = path.dirname(LEARNINGS_PATH);
  fs.mkdirSync(dir, { recursive: true });

  // Build markdown with embedded JSON data
  const recurring = Object.entries(learnings.patterns)
    .filter(([, p]) => p.count >= 2)
    .sort((a, b) => b[1].count - a[1].count);

  let md = '# Review Learnings\n\n';
  md += `Total reviews: ${learnings.totalReviews}\n\n`;

  if (recurring.length > 0) {
    md += '## Recurring Patterns\n\n';
    md += '| Pattern | Times Seen | Stack | Fix Template |\n';
    md += '|---------|-----------|-------|--------------|\n';

    for (const [, pattern] of recurring) {
      md += `| ${pattern.description} | ${pattern.count} | ${pattern.stack} | ${pattern.fixTemplate || '-'} |\n`;
    }
    md += '\n';
  }

  if (learnings.archived && learnings.archived.length > 0) {
    md += '## Archived (Team Learned)\n\n';
    for (const pattern of learnings.archived.slice(-10)) {
      md += `- ~~${pattern.description}~~ (seen ${pattern.count}x, archived)\n`;
    }
    md += '\n';
  }

  // Embed structured data for reliable parsing
  md += `\n<!-- DATA: ${JSON.stringify(learnings)} -->\n`;

  fs.writeFileSync(LEARNINGS_PATH, md, 'utf8');
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
