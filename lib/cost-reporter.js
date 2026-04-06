/**
 * Cost Reporter — Token usage analytics from Claude Code session logs.
 *
 * Reads Claude Code's native session JSONL files to extract real
 * token usage data (input, output, cache creation, cache read).
 *
 * Data source: ~/.claude/projects/<project-id>/<session-id>.jsonl
 * Each assistant message contains message.usage with token counts.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Sum all token types into a single count.
 * @param {{input_tokens?: number, output_tokens?: number, cache_creation_input_tokens?: number, cache_read_input_tokens?: number}} u
 * @returns {number}
 */
function sumTokens(u) {
  return (u.input_tokens || 0) + (u.output_tokens || 0) +
    (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
}

/**
 * Find the Claude project directory for a given working directory.
 * @param {string} [cwd]
 * @returns {string|null}
 */
function findProjectDir(cwd) {
  const projectPath = cwd || process.cwd();
  const encoded = projectPath.replace(/\//g, '-');
  const projectsRoot = path.resolve(os.homedir(), '.claude', 'projects');
  const claudeDir = path.resolve(projectsRoot, encoded);
  // Validate resolved path stays inside ~/.claude/projects/
  if (!claudeDir.startsWith(projectsRoot + path.sep)) return null;
  if (fs.existsSync(claudeDir)) return claudeDir;
  return null;
}

/**
 * Load sessions index for a project.
 * @param {string} projectDir
 * @returns {Array<{sessionId: string, summary: string, created: string, modified: string, gitBranch: string, messageCount: number, fullPath: string}>}
 */
function loadSessionsIndex(projectDir) {
  const indexPath = path.join(projectDir, 'sessions-index.json');
  try {
    const data = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return data.entries || [];
  } catch {
    return [];
  }
}

/**
 * Detect the Envoy activity from an assistant message's content.
 * Only inspects actual tool_use blocks (not text, not Edit new_string fields).
 *
 * @param {object} msg - The assistant message object
 * @returns {string} Activity label (e.g., "skill:finalize", "agent:Explore", "general")
 */
function detectActivity(msg) {
  const blocks = Array.isArray(msg.content) ? msg.content : [];

  // Check tool_use blocks for Skill and Agent invocations
  for (const block of blocks) {
    if (block.type !== 'tool_use') continue;
    const input = block.input || {};

    // Skill tool → skill name from args or skill field
    if (block.name === 'Skill') {
      const skill = input.skill || input.args || '';
      if (skill) return 'skill:' + skill.replace(/^envoy:/, '');
    }

    // Agent tool → subagent_type
    if (block.name === 'Agent') {
      const type = input.subagent_type || 'general';
      return 'agent:' + type.replace(/^envoy:/, '');
    }
  }

  // Check text blocks for review-related content (CodeRabbit polling etc.)
  for (const block of blocks) {
    if (block.type !== 'text') continue;
    const text = block.text || '';
    if (/coderabbit|code.?review/i.test(text) && /comment|finding|address/i.test(text)) {
      return 'review';
    }
  }

  return null; // No explicit label — needs phase inference
}

/**
 * Extract tool names from an assistant message's content blocks.
 * @param {object} msg
 * @returns {string[]}
 */
function extractToolNames(msg) {
  const blocks = Array.isArray(msg.content) ? msg.content : [];
  return blocks
    .filter(b => b.type === 'tool_use')
    .map(b => b.name);
}

/**
 * Classify the phase of work from a window of tool names.
 * Evaluated top-to-bottom, first match wins.
 *
 * @param {string[]} tools - Flat array of tool names from the window
 * @returns {string} Phase label
 */
function classifyPhase(tools) {
  const counts = {};
  for (const t of tools) {
    counts[t] = (counts[t] || 0) + 1;
  }
  const editWrite = (counts['Edit'] || 0) + (counts['Write'] || 0);
  const bash = counts['Bash'] || 0;
  const grep = counts['Grep'] || 0;
  const read = counts['Read'] || 0;
  const agent = counts['Agent'] || 0;
  const ask = counts['AskUserQuestion'] || 0;
  const taskCreate = counts['TaskCreate'] || 0;

  if (editWrite > 5 && bash > 3) return 'implementation';
  if (bash > 5 && grep > 2 && editWrite < 3) return 'debugging';
  if (read > 5 && editWrite < 2 && agent > 0) return 'review';
  if (ask > 3) return 'interactive';
  if (taskCreate > 1 || (agent > 1 && editWrite < 3)) return 'planning';
  return 'other';
}

const WINDOW_RADIUS = 5;

/**
 * Extract token usage from a session JSONL file.
 * Two-pass: first collects turns, then classifies with windowed phase inference.
 *
 * @param {string} jsonlPath
 * @returns {SessionUsage}
 */
function extractSessionUsage(jsonlPath) {
  const usage = {
    totalTokens: 0,
    turns: 0,
    models: {},
    activities: {},
  };

  try {
    const content = fs.readFileSync(jsonlPath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());

    // Pass 1: collect all assistant turns with metadata
    const turns = [];
    for (const line of lines) {
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj.type !== 'assistant') continue;
      const msg = obj.message;
      if (!msg || !msg.usage) continue;

      turns.push({
        usage: msg.usage,
        model: msg.model || 'unknown',
        explicitActivity: detectActivity(msg),
        tools: extractToolNames(msg),
      });
    }

    // Pass 2: classify each turn, using window for phase inference
    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      const turnTokens = sumTokens(turn.usage);

      // Determine activity: explicit label or window-based inference
      let activity = turn.explicitActivity;
      if (!activity) {
        // Build tool window: 5 turns before, current, 5 after
        const windowTools = [];
        const start = Math.max(0, i - WINDOW_RADIUS);
        const end = Math.min(turns.length - 1, i + WINDOW_RADIUS);
        for (let j = start; j <= end; j++) {
          windowTools.push(...turns[j].tools);
        }
        activity = classifyPhase(windowTools);
      }

      usage.totalTokens += turnTokens;
      usage.turns += 1;

      // Track per-model
      if (!usage.models[turn.model]) {
        usage.models[turn.model] = { totalTokens: 0, turns: 0 };
      }
      const m = usage.models[turn.model];
      m.totalTokens += turnTokens;
      m.turns += 1;

      // Track per-activity
      if (!usage.activities[activity]) {
        usage.activities[activity] = { turns: 0, totalTokens: 0, models: {} };
      }
      const a = usage.activities[activity];
      a.turns += 1;
      a.totalTokens += turnTokens;

      // Track model within activity
      if (!a.models[turn.model]) a.models[turn.model] = 0;
      a.models[turn.model] += 1;
    }
  } catch {
    // File unreadable
  }

  return usage;
}

/**
 * Get usage for a specific session.
 * @param {string} projectDir
 * @param {string} sessionId
 * @returns {SessionUsage|null}
 */
function getSessionUsage(projectDir, sessionId) {
  const jsonlPath = path.join(projectDir, `${sessionId}.jsonl`);
  if (!fs.existsSync(jsonlPath)) return null;
  return extractSessionUsage(jsonlPath);
}

/**
 * Discover sessions from both the index AND on-disk JSONL files.
 * The sessions-index.json can be stale, so we also scan for JSONL files
 * that exist on disk but aren't in the index.
 *
 * @param {string} projectDir
 * @returns {Array<{sessionId: string, jsonlPath: string, summary: string, modified: string, gitBranch: string}>}
 */
function discoverSessions(projectDir) {
  const indexed = loadSessionsIndex(projectDir);
  const indexedIds = new Set(indexed.map(s => s.sessionId));
  const sessions = [];

  // Add indexed sessions that have JSONL files
  for (const s of indexed) {
    const jsonlPath = s.fullPath || path.join(projectDir, `${s.sessionId}.jsonl`);
    if (fs.existsSync(jsonlPath)) {
      sessions.push({
        sessionId: s.sessionId,
        jsonlPath,
        summary: s.summary || s.firstPrompt || 'No summary',
        modified: s.modified,
        gitBranch: s.gitBranch || 'unknown',
      });
    }
  }

  // Scan for JSONL files not in the index
  try {
    const files = fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      const sessionId = file.replace('.jsonl', '');
      if (indexedIds.has(sessionId)) continue;

      const jsonlPath = path.join(projectDir, file);
      const stat = fs.statSync(jsonlPath);

      // Extract branch and summary from the JSONL itself
      let gitBranch = 'unknown';
      let summary = 'No summary';
      try {
        const firstLines = fs.readFileSync(jsonlPath, 'utf8').split('\n').slice(0, 20);
        for (const line of firstLines) {
          if (!line.trim()) continue;
          const obj = JSON.parse(line);
          if (obj.gitBranch && gitBranch === 'unknown') gitBranch = obj.gitBranch;
          if (obj.type === 'user' && obj.message && summary === 'No summary') {
            const content = typeof obj.message === 'string' ? obj.message :
              (obj.message.content || '');
            if (content && typeof content === 'string') {
              summary = content.slice(0, 60);
            }
          }
        }
      } catch {
        // Best effort
      }

      sessions.push({
        sessionId,
        jsonlPath,
        summary,
        modified: stat.mtime.toISOString(),
        gitBranch,
      });
    }
  } catch {
    // Can't read directory
  }

  return sessions;
}

/**
 * Get aggregated usage for recent sessions.
 * @param {string} projectDir
 * @param {Object} [options]
 * @param {number} [options.days=7] - Look back N days
 * @param {string} [options.branch] - Filter by git branch
 * @returns {AggregatedUsage}
 */
function getRecentUsage(projectDir, options = {}) {
  const days = options.days || 7;
  const branch = options.branch || null;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const sessions = discoverSessions(projectDir);
  const result = {
    period: `${days} days`,
    sessions: [],
    totals: {
      totalTokens: 0,
      turns: 0,
    },
    byBranch: {},
    byModel: {},
    byActivity: {},
  };

  for (const session of sessions) {
    const modified = new Date(session.modified);
    if (modified < cutoff) continue;
    if (branch && session.gitBranch !== branch) continue;

    if (!fs.existsSync(session.jsonlPath)) continue;

    const usage = extractSessionUsage(session.jsonlPath);

    result.sessions.push({
      id: session.sessionId,
      summary: session.summary,
      branch: session.gitBranch,
      date: session.modified,
      ...usage,
    });

    // Accumulate totals
    result.totals.totalTokens += usage.totalTokens;
    result.totals.turns += usage.turns;

    // By branch
    const br = session.gitBranch || 'unknown';
    if (!result.byBranch[br]) {
      result.byBranch[br] = { sessions: 0, totalTokens: 0 };
    }
    result.byBranch[br].sessions += 1;
    result.byBranch[br].totalTokens += usage.totalTokens;

    // By model
    for (const [model, modelUsage] of Object.entries(usage.models)) {
      if (!result.byModel[model]) {
        result.byModel[model] = { turns: 0, totalTokens: 0 };
      }
      result.byModel[model].turns += modelUsage.turns;
      result.byModel[model].totalTokens += modelUsage.totalTokens;
    }

    // By activity
    for (const [activity, actUsage] of Object.entries(usage.activities)) {
      if (!result.byActivity[activity]) {
        result.byActivity[activity] = { turns: 0, totalTokens: 0, models: {} };
      }
      const a = result.byActivity[activity];
      a.turns += actUsage.turns;
      a.totalTokens += actUsage.totalTokens;

      for (const [model, count] of Object.entries(actUsage.models)) {
        a.models[model] = (a.models[model] || 0) + count;
      }
    }
  }

  return result;
}

/**
 * Format token count for display (e.g., 1234567 → "1.2M").
 * @param {number} n
 * @returns {string}
 */
function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

/**
 * Render a bar chart of the given fraction.
 * @param {number} fraction - 0..1
 * @param {number} [width=20]
 * @returns {string}
 */
function renderBar(fraction, width = 20) {
  const filled = Math.round(fraction * width);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
}

/**
 * Render a section of the report (BY ACTIVITY, BY MODEL, etc.).
 * Entries: array of [label, totalTokens]. Sorted descending by tokens.
 *
 * @param {string} title
 * @param {Array<[string, number]>} entries - [label, totalTokens]
 * @param {number} grandTotal
 * @returns {string}
 */
function renderSection(title, entries, grandTotal) {
  if (entries.length === 0) return '';
  const lines = [];
  lines.push(` BY ${title}`);

  // Find longest label for alignment
  const maxLabel = Math.max(...entries.map(([l]) => l.length));

  for (const [label, tokens] of entries) {
    const pct = grandTotal > 0 ? (tokens / grandTotal) * 100 : 0;
    const bar = renderBar(tokens / grandTotal);
    const padLabel = label.padEnd(maxLabel);
    const padPct = pct.toFixed(1).padStart(5) + '%';
    const padTokens = (formatTokens(tokens) + ' tokens').padStart(12);
    lines.push(` ${padLabel}  ${bar}  ${padPct}  ${padTokens}`);
  }
  return lines.join('\n');
}

/**
 * Format aggregated usage as a compact bar-chart report.
 * @param {AggregatedUsage} data
 * @returns {string}
 */
function formatReport(data) {
  const lines = [];
  const total = data.totals.totalTokens;

  lines.push(`Token Usage — last ${data.period} (${data.sessions.length} sessions)`);
  lines.push('');

  // BY ACTIVITY
  const activities = Object.entries(data.byActivity || {})
    .map(([label, a]) => [label, a.totalTokens])
    .sort((a, b) => b[1] - a[1]);
  if (activities.length > 0) {
    lines.push(renderSection('ACTIVITY', activities, total));
    lines.push('');
  }

  // BY MODEL
  const models = Object.entries(data.byModel || {})
    .map(([model, m]) => [model.replace('claude-', ''), m.totalTokens])
    .sort((a, b) => b[1] - a[1]);
  if (models.length > 0) {
    lines.push(renderSection('MODEL', models, total));
    lines.push('');
  }

  // BY BRANCH
  const branches = Object.entries(data.byBranch || {})
    .map(([branch, b]) => [branch, b.totalTokens])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  if (branches.length > 0) {
    lines.push(renderSection('BRANCH', branches, total));
  }

  return lines.join('\n');
}

module.exports = {
  findProjectDir,
  loadSessionsIndex,
  extractSessionUsage,
  getSessionUsage,
  getRecentUsage,
  formatReport,
  formatTokens,
  renderBar,
  detectActivity,
  classifyPhase,
  discoverSessions,
};

/**
 * @typedef {Object} SessionUsage
 * @property {number} totalTokens
 * @property {number} turns
 * @property {Object<string, {totalTokens: number, turns: number}>} models
 * @property {Object<string, {turns: number, totalTokens: number, models: Object<string, number>}>} activities
 */

/**
 * @typedef {Object} AggregatedUsage
 * @property {string} period
 * @property {Array} sessions
 * @property {{totalTokens: number, turns: number}} totals
 * @property {Object<string, {sessions: number, totalTokens: number}>} byBranch
 * @property {Object<string, {turns: number, totalTokens: number}>} byModel
 * @property {Object<string, {turns: number, totalTokens: number, models: Object<string, number>}>} byActivity
 */
