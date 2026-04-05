/**
 * Session State Continuity
 *
 * Persists task state across conversations and context compactions.
 * Inspired by lean-ctx's CCP (Context Continuity Protocol).
 *
 * Writes .envoy-session.json to the working directory root.
 * session-start.sh detects and surfaces this on session restore.
 *
 * Typical restore cost: ~300-500 tokens vs 10K+ cold start.
 */

const fs = require('fs');
const path = require('path');

const SESSION_FILE = '.envoy-session.json';

/**
 * Resolve the session file path.
 * Prefers worktree root if inside one, otherwise cwd.
 * @param {string} [dir] - Override directory
 * @returns {string}
 */
function sessionPath(dir) {
  return path.resolve(dir || process.cwd(), SESSION_FILE);
}

/**
 * Load existing session state (or return empty state).
 * @param {string} [dir]
 * @returns {SessionState}
 */
function load(dir) {
  try {
    const raw = fs.readFileSync(sessionPath(dir), 'utf8');
    return JSON.parse(raw);
  } catch {
    return createEmpty();
  }
}

/**
 * Save session state to disk.
 * @param {SessionState} state
 * @param {string} [dir]
 */
function save(state, dir) {
  state.updatedAt = new Date().toISOString();
  const filePath = sessionPath(dir);
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * Remove session file (e.g., after branch is finalized).
 * @param {string} [dir]
 */
function clear(dir) {
  try {
    fs.unlinkSync(sessionPath(dir));
  } catch {
    // Already gone
  }
}

/**
 * Check whether a session file exists.
 * @param {string} [dir]
 * @returns {boolean}
 */
function exists(dir) {
  return fs.existsSync(sessionPath(dir));
}

/**
 * Create an empty session state.
 * @returns {SessionState}
 */
function createEmpty() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    branch: null,
    plan: null,
    tasks: [],
    decisions: [],
    filesModified: [],
    testResults: null,
    nextSteps: [],
  };
}

/**
 * Record a decision made during implementation.
 * @param {SessionState} state
 * @param {string} decision - Short description of what was decided and why
 */
function addDecision(state, decision) {
  state.decisions.push({
    text: decision,
    at: new Date().toISOString(),
  });
}

/**
 * Update task status in the session.
 * @param {SessionState} state
 * @param {string} taskId - Task identifier (matches plan task number or name)
 * @param {'pending'|'in_progress'|'done'|'blocked'} status
 * @param {string} [summary] - Optional completion summary
 */
function updateTask(state, taskId, status, summary) {
  const existing = state.tasks.find(t => t.id === taskId);
  if (existing) {
    existing.status = status;
    if (summary) existing.summary = summary;
    existing.updatedAt = new Date().toISOString();
  } else {
    state.tasks.push({
      id: taskId,
      status,
      summary: summary || null,
      updatedAt: new Date().toISOString(),
    });
  }
}

/**
 * Record a file that was modified.
 * @param {SessionState} state
 * @param {string} filePath - Relative path
 * @param {string} reason - Why it was changed
 */
function trackFile(state, filePath, reason) {
  const existing = state.filesModified.find(f => f.path === filePath);
  if (existing) {
    existing.reason = reason;
    existing.count = (existing.count || 1) + 1;
  } else {
    state.filesModified.push({ path: filePath, reason, count: 1 });
  }
}

/**
 * Record test results.
 * @param {SessionState} state
 * @param {{ passed: number, failed: number, skipped: number, summary: string }} results
 */
function setTestResults(state, results) {
  state.testResults = {
    ...results,
    at: new Date().toISOString(),
  };
}

/**
 * Format session state as a compact prompt section for context injection.
 * Designed for LITM-aware positioning (place at beginning or end of prompt).
 *
 * @param {SessionState} state
 * @returns {string} Markdown section, typically 200-400 tokens
 */
function formatForPrompt(state) {
  const lines = ['## Session State (restored)'];

  if (state.branch) {
    lines.push(`**Branch:** ${state.branch}`);
  }

  if (state.plan) {
    lines.push(`**Plan:** ${state.plan}`);
  }

  // Task summary
  const done = state.tasks.filter(t => t.status === 'done').length;
  const total = state.tasks.length;
  if (total > 0) {
    lines.push(`**Progress:** ${done}/${total} tasks complete`);

    const pending = state.tasks.filter(t => t.status !== 'done');
    if (pending.length > 0) {
      lines.push('**Remaining:**');
      for (const t of pending.slice(0, 5)) {
        lines.push(`- [${t.status}] ${t.id}${t.summary ? ': ' + t.summary : ''}`);
      }
      if (pending.length > 5) {
        lines.push(`- ... and ${pending.length - 5} more`);
      }
    }
  }

  // Key decisions (last 5)
  if (state.decisions.length > 0) {
    lines.push('**Key decisions:**');
    for (const d of state.decisions.slice(-5)) {
      lines.push(`- ${d.text}`);
    }
  }

  // Test results
  if (state.testResults) {
    const tr = state.testResults;
    lines.push(`**Last tests:** ${tr.passed} passed, ${tr.failed} failed, ${tr.skipped} skipped`);
    if (tr.failed > 0 && tr.summary) {
      lines.push(`  Failures: ${tr.summary}`);
    }
  }

  // Next steps
  if (state.nextSteps.length > 0) {
    lines.push('**Next steps:**');
    for (const step of state.nextSteps.slice(0, 3)) {
      lines.push(`- ${step}`);
    }
  }

  // Modified files (count only, not full list)
  if (state.filesModified.length > 0) {
    lines.push(`**Files modified:** ${state.filesModified.length} files`);
  }

  return lines.join('\n');
}

module.exports = {
  load,
  save,
  clear,
  exists,
  createEmpty,
  addDecision,
  updateTask,
  trackFile,
  setTestResults,
  formatForPrompt,
  SESSION_FILE,
};

/**
 * @typedef {Object} SessionState
 * @property {number} version
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string|null} branch
 * @property {string|null} plan - Path to plan file
 * @property {Array<{id: string, status: string, summary: string|null, updatedAt: string}>} tasks
 * @property {Array<{text: string, at: string}>} decisions
 * @property {Array<{path: string, reason: string, count: number}>} filesModified
 * @property {{passed: number, failed: number, skipped: number, summary: string, at: string}|null} testResults
 * @property {string[]} nextSteps
 */
