#!/usr/bin/env node
/**
 * Async Stop hook: Learning extractor with graduated levels.
 *
 * After review sessions, extracts recurring patterns from findings
 * and saves them to memory/review-learnings.md with graduated levels:
 *   - detected (1-2x): logged only
 *   - confirmed (3-4x): injected into implementation prompts
 *   - automated (5+x): suggest hook/lint rule to user
 *   - archived: not seen in 5+ reviews, team has learned it
 *
 * Archived patterns get re-promoted if they reappear.
 */

const fs = require('fs');
const path = require('path');

const LEARNINGS_PATH = 'memory/review-learnings.md';

/**
 * Determine the graduated level for a pattern based on its count.
 * @param {number} count - Times the pattern has been seen
 * @returns {'detected' | 'confirmed' | 'automated'}
 */
function getLevel(count) {
  if (count >= 5) return 'automated';
  if (count >= 3) return 'confirmed';
  return 'detected';
}

/**
 * Hook entry point. Extracts review findings, updates graduated pattern
 * levels, archives stale patterns, and emits automation suggestions.
 * @param {string|object} rawInput - Session data from Claude Code (JSON string or object)
 */
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

      // Check if this was archived — re-promote it
      const archivedIdx = (learnings.archived || []).findIndex(a => a.key === key);
      if (archivedIdx !== -1) {
        // Re-promote: move back to active with count 1
        const archived = learnings.archived[archivedIdx];
        learnings.archived.splice(archivedIdx, 1);
        learnings.patterns[key] = {
          description: archived.description || finding.description,
          count: 1,
          level: 'detected',
          firstSeen: archived.firstSeen || new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          stack: finding.stack || archived.stack || 'general',
          fileType: finding.fileType || archived.fileType || '*',
          fixTemplate: finding.fix || archived.fixTemplate || '',
          reviewsSinceLastSeen: 0,
        };
        continue;
      }

      if (learnings.patterns[key]) {
        learnings.patterns[key].count++;
        learnings.patterns[key].lastSeen = new Date().toISOString();
        learnings.patterns[key].reviewsSinceLastSeen = 0;
        learnings.patterns[key].level = getLevel(learnings.patterns[key].count);
      } else {
        learnings.patterns[key] = {
          description: finding.description,
          count: 1,
          level: 'detected',
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

    // Archive patterns not seen in 5+ reviews (only confirmed+ patterns)
    const newlyArchived = [];
    for (const [key, pattern] of Object.entries(learnings.patterns)) {
      if (pattern.reviewsSinceLastSeen >= 5 && pattern.count >= 3) {
        newlyArchived.push({ key, ...pattern, archivedAt: new Date().toISOString() });
        delete learnings.patterns[key];
      }
    }

    learnings.totalReviews++;
    if (newlyArchived.length > 0) {
      learnings.archived = learnings.archived || [];
      learnings.archived.push(...newlyArchived);
    }

    // Check for newly automated patterns (for hookSpecificOutput)
    const newlyAutomated = Object.entries(learnings.patterns)
      .filter(([, p]) => p.level === 'automated' && p.count === 5);

    // Save updated learnings
    saveLearnings(learnings);

    // Output suggestions for newly automated patterns
    if (newlyAutomated.length > 0) {
      try {
        const { suggestAutomation, formatSuggestion } = require('../lib/automation-suggester');
        for (const [, pattern] of newlyAutomated) {
          const suggestion = suggestAutomation(pattern);
          if (suggestion) {
            pattern.automationSuggestion = suggestion;
            // Surface to user via hookSpecificOutput
            const message = formatSuggestion(pattern, suggestion);
            console.log(JSON.stringify({ hookSpecificOutput: message }));
          }
        }
        // Re-save with suggestions
        saveLearnings(learnings);
      } catch (err) {
        // automation-suggester not available yet — skip
      }
    }
  } catch (err) {
    // Async hook — never block
  }
}

function isReviewSession(input) {
  const conversation = (input.conversation || input.tool_name || '').toLowerCase();
  return conversation.includes('review') ||
         conversation.includes('review') ||
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
      // Parse embedded JSON data
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

  // Group patterns by level
  const byLevel = { confirmed: [], detected: [], automated: [] };
  for (const [, pattern] of Object.entries(learnings.patterns)) {
    const level = pattern.level || getLevel(pattern.count);
    if (byLevel[level]) {
      byLevel[level].push(pattern);
    }
  }

  // Sort each group by count descending
  for (const level of Object.keys(byLevel)) {
    byLevel[level].sort((a, b) => b.count - a.count);
  }

  let md = '# Review Learnings\n\n';
  md += `Total reviews: ${learnings.totalReviews}\n\n`;

  // Confirmed — loaded into implementation
  if (byLevel.confirmed.length > 0) {
    md += '## Confirmed (loaded into implementation)\n\n';
    md += '| Pattern | Times Seen | Stack |\n';
    md += '|---------|-----------|-------|\n';
    for (const pattern of byLevel.confirmed) {
      md += `| ${pattern.description} | ${pattern.count} | ${pattern.stack} |\n`;
    }
    md += '\n';
  }

  // Detected — monitoring
  if (byLevel.detected.length > 0) {
    md += '## Detected (monitoring)\n\n';
    md += '| Pattern | Times Seen | Stack |\n';
    md += '|---------|-----------|-------|\n';
    for (const pattern of byLevel.detected) {
      md += `| ${pattern.description} | ${pattern.count} | ${pattern.stack} |\n`;
    }
    md += '\n';
  }

  // Automated — hook/rule suggested
  if (byLevel.automated.length > 0) {
    md += '## Automated (hook/rule suggested)\n\n';
    md += '| Pattern | Times Seen | Suggestion |\n';
    md += '|---------|-----------|------------|\n';
    for (const pattern of byLevel.automated) {
      const suggestion = pattern.automationSuggestion
        ? `${pattern.automationSuggestion.type}: ${pattern.automationSuggestion.description}`
        : 'pending';
      md += `| ${pattern.description} | ${pattern.count} | ${suggestion} |\n`;
    }
    md += '\n';
  }

  // Archived — team learned
  if (learnings.archived && learnings.archived.length > 0) {
    md += '## Archived (team learned)\n\n';
    for (const pattern of learnings.archived.slice(-20)) {
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

module.exports = { run, loadLearnings, getLevel };
