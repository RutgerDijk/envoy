#!/usr/bin/env node
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
 *
 * CLI (run from the worktree root; the rigid pickup steps use this instead
 * of requiring the module inline):
 *   node lib/session-state.js sync                       # branch from git + reconcile tasks with .envoy-tasks/<issue>.json
 *   node lib/session-state.js task <id> <status> [summary]
 *   node lib/session-state.js decision <note>
 *   node lib/session-state.js next-steps <step>...
 * Exit codes: 0 ok, 1 session file unreadable/invalid (left untouched), 64 usage.
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
  // The schema requires only $schemaVersion, branch and tasks; callers rely on these arrays.
  if (!Array.isArray(data.decisions)) data.decisions = [];
  if (!Array.isArray(data.nextSteps)) data.nextSteps = [];
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

/**
 * Reconcile session tasks with the issue's current task list, by id: kept
 * tasks keep their status and summary and take the issue's title, new tasks
 * are added as pending, tasks no longer in the issue are dropped. Order
 * follows the issue.
 * @param {SessionState['tasks']} sessionTasks
 * @param {Array<{id: string, title?: string}>} issueTasks
 * @returns {{tasks: SessionState['tasks'], added: string[], removed: string[], renamed: string[], changed: boolean}}
 */
function reconcileTasks(sessionTasks, issueTasks) {
  const byId = new Map((sessionTasks || []).map((t) => [t.id, t]));
  const issueIds = new Set((issueTasks || []).map((t) => t.id));
  const added = [];
  const renamed = [];
  const tasks = (issueTasks || []).map((it) => {
    const prev = byId.get(it.id);
    if (!prev) {
      added.push(it.id);
      return { id: it.id, name: it.title, status: 'pending' };
    }
    if (it.title !== undefined && prev.name !== it.title) {
      renamed.push(it.id);
      return { ...prev, name: it.title };
    }
    return prev;
  });
  const removed = (sessionTasks || []).filter((t) => !issueIds.has(t.id)).map((t) => t.id);
  const sameOrder = tasks.length === (sessionTasks || []).length && tasks.every((t, i) => t.id === sessionTasks[i].id);
  return { tasks, added, removed, renamed, changed: added.length > 0 || removed.length > 0 || renamed.length > 0 || !sameOrder };
}

/**
 * One line describing a reconcile result, or '' when nothing changed.
 * @param {{added: string[], removed: string[], renamed: string[]}} r
 * @returns {string}
 */
function describeReconcile(r) {
  const parts = [];
  if (r.added.length) parts.push(`added ${r.added.join(', ')}`);
  if (r.removed.length) parts.push(`removed ${r.removed.join(', ')}`);
  if (r.renamed.length) parts.push(`renamed ${r.renamed.join(', ')}`);
  return parts.join('; ');
}

const TASK_STATUSES = ['pending', 'in_progress', 'done', 'blocked'];
const EXIT_USAGE = 64;

function main(argv, dir = process.cwd()) {
  const [cmd, ...args] = argv;
  const usage = (msg) => {
    process.stderr.write(`session-state: ${msg}\nUsage: node lib/session-state.js sync | task <id> <status> [summary] | decision <note> | next-steps <step>...\n`);
    return EXIT_USAGE;
  };
  if (cmd === 'task' && (args.length < 2 || !TASK_STATUSES.includes(args[1]))) return usage(`task needs <id> and a status (${TASK_STATUSES.join('|')})`);
  if (cmd === 'decision' && !args.join(' ').trim()) return usage('decision needs a note');
  if (!['sync', 'task', 'decision', 'next-steps'].includes(cmd)) return usage(`unknown command: ${cmd || '(none)'}`);

  let state;
  try {
    state = load(dir);
  } catch (err) {
    process.stderr.write(`session-state: ${err.message}\nFix the file to match lib/schemas/session.json, or remove it to start fresh.\n`);
    return 1;
  }

  if (cmd === 'sync') {
    if (state.branch === 'unknown') {
      try {
        state.branch = require('child_process').execFileSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).trim() || 'unknown';
      } catch {
        // not a git checkout: keep 'unknown'
      }
    }
    const tasksFile = path.join(dir, '.envoy-tasks', `${state.issueNumber}.json`);
    if (state.issueNumber && fs.existsSync(tasksFile)) {
      const r = reconcileTasks(state.tasks, JSON.parse(fs.readFileSync(tasksFile, 'utf8')).tasks || []);
      state.tasks = r.tasks;
      const note = describeReconcile(r);
      if (note) process.stdout.write(`Task list reconciled with the issue: ${note}\n`);
    }
    const done = state.tasks.filter((t) => t.status === 'done').length;
    process.stdout.write(`Session: ${done}/${state.tasks.length} tasks done on ${state.branch}\n`);
    for (const d of state.decisions.slice(-3)) process.stdout.write(`Decision: ${d.note}\n`);
  } else if (cmd === 'task') {
    updateTask(state, args[0], args[1], args.slice(2).join(' ') || undefined);
  } else if (cmd === 'decision') {
    addDecision(state, args.join(' '));
  } else {
    state.nextSteps = args;
  }

  try {
    save(state, dir);
  } catch (err) {
    process.stderr.write(`session-state: ${err.message}\n`);
    return 1;
  }
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
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
  reconcileTasks,
  describeReconcile,
  main,
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
