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

'use strict';

const fs = require('fs');
const path = require('path');
const { validate } = require('./validate-schema');

const SESSION_FILE = path.join('.envoy', 'pickup', 'session.json');

/**
 * Resolve the session file path: <dir or cwd>/.envoy/pickup/session.json.
 * @param {string} [dir] - Base directory (defaults to process.cwd())
 * @returns {string}
 */
function sessionPath(dir) {
  return path.resolve(dir || process.cwd(), SESSION_FILE);
}

/**
 * Load session state.
 *
 * A missing file is not an error: returns a fresh createEmpty() state.
 * A file that exists but is not valid JSON, or does not match
 * lib/schemas/session.json, throws an Error naming the path and the problem —
 * never silently falls back to an empty state that a later save() would use
 * to overwrite the preflight seed.
 * @param {string} [dir]
 * @returns {SessionState}
 */
function load(dir) {
  const filePath = sessionPath(dir);
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return createEmpty();
    throw new Error(`cannot read session state ${filePath}: ${err.message}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`corrupt session state ${filePath}: invalid JSON (${err.message})`);
  }
  const result = validate('session', data);
  if (!result.valid) {
    throw new Error(`invalid session state ${filePath}: ${result.errors.join('; ')}`);
  }
  return data;
}

/**
 * Save session state to disk. Validates a copy against lib/schemas/session.json
 * first; on an invalid shape it throws, writes nothing and leaves `state`
 * untouched. On success, `state.updatedAt` is set to the saved timestamp.
 * @param {SessionState} state
 * @param {string} [dir]
 */
function save(state, dir) {
  const updatedAt = new Date().toISOString();
  const candidate = { ...state, updatedAt };
  const filePath = sessionPath(dir);
  const result = validate('session', candidate);
  if (!result.valid) {
    throw new Error(`invalid session state for ${filePath}: ${result.errors.join('; ')}`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(candidate, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
  state.updatedAt = updatedAt;
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
