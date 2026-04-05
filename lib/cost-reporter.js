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
 * Approximate cost per token by model (USD).
 * Pricing as of 2025. Update as needed.
 */
const PRICING = {
  'claude-opus-4-6': { input: 15 / 1_000_000, output: 75 / 1_000_000, cacheWrite: 18.75 / 1_000_000, cacheRead: 1.5 / 1_000_000 },
  'claude-sonnet-4-6': { input: 3 / 1_000_000, output: 15 / 1_000_000, cacheWrite: 3.75 / 1_000_000, cacheRead: 0.3 / 1_000_000 },
  'claude-haiku-4-5': { input: 0.8 / 1_000_000, output: 4 / 1_000_000, cacheWrite: 1 / 1_000_000, cacheRead: 0.08 / 1_000_000 },
};

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
 * Calculate cost for a set of token counts and a model.
 * @param {{input_tokens?: number, output_tokens?: number, cache_creation_input_tokens?: number, cache_read_input_tokens?: number}} u
 * @param {string} model
 * @returns {number} Estimated cost in USD
 */
function calculateCost(u, model) {
  const pricing = findPricing(model);
  if (!pricing) return 0;
  return (
    (u.input_tokens || 0) * pricing.input +
    (u.output_tokens || 0) * pricing.output +
    (u.cache_creation_input_tokens || 0) * pricing.cacheWrite +
    (u.cache_read_input_tokens || 0) * pricing.cacheRead
  );
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
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    turns: 0,
    models: {},
    activities: {},
    estimatedCostUSD: 0,
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
      const turnCost = calculateCost(u, model);

      usage.inputTokens += u.input_tokens || 0;
      usage.outputTokens += u.output_tokens || 0;
      usage.cacheWriteTokens += u.cache_creation_input_tokens || 0;
      usage.cacheReadTokens += u.cache_read_input_tokens || 0;
      usage.turns += 1;
      usage.estimatedCostUSD += turnCost;

      // Track per-model
      if (!usage.models[model]) {
        usage.models[model] = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, turns: 0, costUSD: 0 };
      }
      const m = usage.models[model];
      m.input += u.input_tokens || 0;
      m.output += u.output_tokens || 0;
      m.cacheWrite += u.cache_creation_input_tokens || 0;
      m.cacheRead += u.cache_read_input_tokens || 0;
      m.turns += 1;
      m.costUSD += turnCost;

      // Track per-activity
      if (!usage.activities[activity]) {
        usage.activities[activity] = { turns: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, costUSD: 0, models: {} };
      }
      const a = usage.activities[activity];
      a.turns += 1;
      a.input += u.input_tokens || 0;
      a.output += u.output_tokens || 0;
      a.cacheWrite += u.cache_creation_input_tokens || 0;
      a.cacheRead += u.cache_read_input_tokens || 0;
      a.costUSD += turnCost;

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
 * Find pricing for a model, matching by prefix.
 * @param {string} model
 * @returns {typeof PRICING[keyof typeof PRICING] | null}
 */
function findPricing(model) {
  for (const [key, pricing] of Object.entries(PRICING)) {
    if (model.startsWith(key) || model.includes(key)) return pricing;
  }
  // Fallback heuristics
  if (model.includes('opus')) return PRICING['claude-opus-4-6'];
  if (model.includes('sonnet')) return PRICING['claude-sonnet-4-6'];
  if (model.includes('haiku')) return PRICING['claude-haiku-4-5'];
  return null;
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
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      turns: 0,
      estimatedCostUSD: 0,
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
    result.totals.inputTokens += usage.inputTokens;
    result.totals.outputTokens += usage.outputTokens;
    result.totals.cacheWriteTokens += usage.cacheWriteTokens;
    result.totals.cacheReadTokens += usage.cacheReadTokens;
    result.totals.turns += usage.turns;
    result.totals.estimatedCostUSD += usage.estimatedCostUSD;

    // By branch
    const br = session.gitBranch || 'unknown';
    if (!result.byBranch[br]) {
      result.byBranch[br] = { sessions: 0, tokens: 0, costUSD: 0 };
    }
    result.byBranch[br].sessions += 1;
    result.byBranch[br].tokens += usage.inputTokens + usage.outputTokens;
    result.byBranch[br].costUSD += usage.estimatedCostUSD;

    // By model
    for (const [model, modelUsage] of Object.entries(usage.models)) {
      if (!result.byModel[model]) {
        result.byModel[model] = { turns: 0, input: 0, output: 0, costUSD: 0 };
      }
      result.byModel[model].turns += modelUsage.turns;
      result.byModel[model].input += modelUsage.input;
      result.byModel[model].output += modelUsage.output;
      result.byModel[model].costUSD += modelUsage.costUSD;
    }

    // By activity
    for (const [activity, actUsage] of Object.entries(usage.activities)) {
      if (!result.byActivity[activity]) {
        result.byActivity[activity] = { turns: 0, input: 0, output: 0, costUSD: 0, models: {} };
      }
      const a = result.byActivity[activity];
      a.turns += actUsage.turns;
      a.input += actUsage.input;
      a.output += actUsage.output;
      a.costUSD += actUsage.costUSD;

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
 * Format cost for display.
 * @param {number} usd
 * @returns {string}
 */
function formatCost(usd) {
  if (usd >= 1) return '$' + usd.toFixed(2);
  if (usd >= 0.01) return '$' + usd.toFixed(2);
  return '$' + usd.toFixed(4);
}

/**
 * Format aggregated usage as a readable report.
 * @param {AggregatedUsage} data
 * @returns {string}
 */
function formatReport(data) {
  const lines = [];

  lines.push(`## Token Usage Report (last ${data.period})`);
  lines.push('');
  lines.push(`**Sessions:** ${data.sessions.length}`);
  lines.push(`**Total turns:** ${data.totals.turns}`);
  lines.push(`**Estimated cost:** ${formatCost(data.totals.estimatedCostUSD)}`);
  lines.push('');

  // Token breakdown
  lines.push('### Token Breakdown');
  lines.push(`| Type | Tokens |`);
  lines.push(`|------|--------|`);
  lines.push(`| Input | ${formatTokens(data.totals.inputTokens)} |`);
  lines.push(`| Output | ${formatTokens(data.totals.outputTokens)} |`);
  lines.push(`| Cache write | ${formatTokens(data.totals.cacheWriteTokens)} |`);
  lines.push(`| Cache read | ${formatTokens(data.totals.cacheReadTokens)} |`);
  lines.push('');

  // By activity (skills, agents, hooks)
  const activities = Object.entries(data.byActivity || {}).sort((a, b) => b[1].costUSD - a[1].costUSD);
  if (activities.length > 0) {
    lines.push('### By Activity');
    lines.push(`| Activity | Turns | Input | Output | Model(s) | Cost |`);
    lines.push(`|----------|-------|-------|--------|----------|------|`);
    for (const [activity, a] of activities) {
      const modelList = Object.entries(a.models)
        .sort((x, y) => y[1] - x[1])
        .map(([m, count]) => `${m.replace('claude-', '')} (${count})`)
        .join(', ');
      lines.push(`| ${activity} | ${a.turns} | ${formatTokens(a.input)} | ${formatTokens(a.output)} | ${modelList} | ${formatCost(a.costUSD)} |`);
    }
    lines.push('');
  }

  // By model
  const models = Object.entries(data.byModel).sort((a, b) => b[1].costUSD - a[1].costUSD);
  if (models.length > 0) {
    lines.push('### By Model');
    lines.push(`| Model | Turns | Input | Output | Cost |`);
    lines.push(`|-------|-------|-------|--------|------|`);
    for (const [model, m] of models) {
      const shortModel = model.replace('claude-', '');
      lines.push(`| ${shortModel} | ${m.turns} | ${formatTokens(m.input)} | ${formatTokens(m.output)} | ${formatCost(m.costUSD)} |`);
    }
    lines.push('');
  }

  // By branch
  const branches = Object.entries(data.byBranch).sort((a, b) => b[1].costUSD - a[1].costUSD);
  if (branches.length > 0) {
    lines.push('### By Branch');
    lines.push(`| Branch | Sessions | Tokens | Cost |`);
    lines.push(`|--------|----------|--------|------|`);
    for (const [branch, b] of branches.slice(0, 10)) {
      lines.push(`| ${branch} | ${b.sessions} | ${formatTokens(b.tokens)} | ${formatCost(b.costUSD)} |`);
    }
    if (branches.length > 10) {
      lines.push(`| ... ${branches.length - 10} more | | | |`);
    }
    lines.push('');
  }

  // Recent sessions
  const recent = data.sessions
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10);

  if (recent.length > 0) {
    lines.push('### Recent Sessions');
    lines.push(`| Date | Branch | Summary | Turns | Cost |`);
    lines.push(`|------|--------|---------|-------|------|`);
    for (const s of recent) {
      const date = new Date(s.date).toISOString().split('T')[0];
      const summary = (s.summary || '').slice(0, 40);
      lines.push(`| ${date} | ${s.branch} | ${summary} | ${s.turns} | ${formatCost(s.estimatedCostUSD)} |`);
    }
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
  formatCost,
  detectActivity,
  PRICING,
};

/**
 * @typedef {Object} SessionUsage
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} cacheWriteTokens
 * @property {number} cacheReadTokens
 * @property {number} turns
 * @property {Object<string, {input: number, output: number, cacheWrite: number, cacheRead: number, turns: number, costUSD: number}>} models
 * @property {Object<string, {turns: number, input: number, output: number, cacheWrite: number, cacheRead: number, costUSD: number, models: Object<string, number>}>} activities
 * @property {number} estimatedCostUSD
 */

/**
 * @typedef {Object} AggregatedUsage
 * @property {string} period
 * @property {Array} sessions
 * @property {{inputTokens: number, outputTokens: number, cacheWriteTokens: number, cacheReadTokens: number, turns: number, estimatedCostUSD: number}} totals
 * @property {Object<string, {sessions: number, tokens: number, costUSD: number}>} byBranch
 * @property {Object<string, {turns: number, input: number, output: number, costUSD: number}>} byModel
 * @property {Object<string, {turns: number, input: number, output: number, costUSD: number, models: Object<string, number>}>} byActivity
 */
