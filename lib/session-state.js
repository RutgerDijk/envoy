/**
 * Session State Continuity
 *
 * Persists task state across conversations and context compactions.
 * Inspired by lean-ctx's CCP (Context Continuity Protocol).
 *
 * Writes .envoy/pickup/session.json (schema: lib/schemas/session.json) —
 * the same file pickup's preflight seeds. save() validates before writing.
 * session-start.sh detects and surfaces this on session restore.
 *
 * Typical restore cost: ~300-500 tokens vs 10K+ cold start.
 */

const fs = require('fs');
const path = require('path');
const { validate } = require('./validate-schema');

const SESSION_FILE = path.join('.envoy', 'pickup', 'session.json');

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
 * Save session state to disk. Validates against lib/schemas/session.json
 * first and throws (writing nothing) when the shape is invalid.
 * @param {SessionState} state
 * @param {string} [dir]
 */
function save(state, dir) {
  state.updatedAt = new Date().toISOString();
  const result = validate('session', state);
  if (!result.valid) {
    throw new Error(`invalid session state: ${result.errors.join('; ')}`);
  }
  const filePath = sessionPath(dir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
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
  const now = new Date().toISOString();
  return {
    $schemaVersion: '1',
    branch: 'unknown',
    startedAt: now,
    updatedAt: now,
    tasks: [],
    decisions: [],
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
    note: decision,
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
      lines.push(`- ${d.note}`);
    }
  }

  // Next steps
  if (state.nextSteps.length > 0) {
    lines.push('**Next steps:**');
    for (const step of state.nextSteps.slice(0, 3)) {
      lines.push(`- ${step}`);
    }
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
  formatForPrompt,
  SESSION_FILE,
};

/**
 * @typedef {Object} SessionState
 * @property {'1'} $schemaVersion
 * @property {string} branch - 'unknown' until pickup sets it
 * @property {string} [plan] - e.g. "issue #94"
 * @property {number} [issueNumber]
 * @property {string} startedAt
 * @property {string} updatedAt
 * @property {Array<{id: string, name?: string, status: string, summary?: string|null, updatedAt?: string}>} tasks
 * @property {Array<{note: string, at: string}>} decisions
 * @property {string[]} nextSteps
 */
