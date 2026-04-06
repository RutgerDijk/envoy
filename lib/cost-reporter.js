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

  return 'general';
}

/**
 * Extract token usage from a session JSONL file.
 * Tracks usage per model AND per Envoy activity (skill, agent, hook).
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

      const u = msg.usage;
      const model = msg.model || 'unknown';
      const activity = detectActivity(msg);
      const turnTokens = sumTokens(u);

      usage.totalTokens += turnTokens;
      usage.turns += 1;

      // Track per-model
      if (!usage.models[model]) {
        usage.models[model] = { totalTokens: 0, turns: 0 };
      }
      const m = usage.models[model];
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
      if (!a.models[model]) a.models[model] = 0;
      a.models[model] += 1;
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
 * Format aggregated usage as a readable report (placeholder — replaced in Task 3).
 * @param {AggregatedUsage} data
 * @returns {string}
 */
function formatReport(data) {
  const lines = [];
  lines.push(`Token Usage — last ${data.period} (${data.sessions.length} sessions)`);
  lines.push(`Total: ${formatTokens(data.totals.totalTokens)} tokens, ${data.totals.turns} turns`);
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
  detectActivity,
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
