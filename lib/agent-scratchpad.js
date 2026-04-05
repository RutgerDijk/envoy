/**
 * Agent Scratchpad — Multi-Agent Coordination
 *
 * File-based messaging system for parallel agents to share discoveries
 * without duplicating work or causing conflicts.
 *
 * Inspired by lean-ctx's ctx_agent scratchpad coordination.
 *
 * Each agent registers, posts findings, and reads others' findings.
 * File: .envoy-scratchpad.json in worktree/cwd root.
 *
 * Designed for use with envoy:dispatching-parallel-agents and
 * envoy:subagent-driven-development.
 */

const fs = require('fs');
const path = require('path');

const SCRATCHPAD_FILE = '.envoy-scratchpad.json';

/**
 * Resolve scratchpad file path.
 * @param {string} [dir]
 * @returns {string}
 */
function scratchpadPath(dir) {
  return path.resolve(dir || process.cwd(), SCRATCHPAD_FILE);
}

/**
 * Load or create scratchpad.
 * @param {string} [dir]
 * @returns {Scratchpad}
 */
function load(dir) {
  try {
    const raw = fs.readFileSync(scratchpadPath(dir), 'utf8');
    return JSON.parse(raw);
  } catch {
    return createEmpty();
  }
}

/**
 * Save scratchpad to disk.
 * Uses atomic write (write to tmp, rename) to avoid partial reads.
 * @param {Scratchpad} pad
 * @param {string} [dir]
 */
function save(pad, dir) {
  pad.updatedAt = new Date().toISOString();
  const filePath = scratchpadPath(dir);
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(pad, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * Remove scratchpad file.
 * @param {string} [dir]
 */
function clear(dir) {
  try {
    fs.unlinkSync(scratchpadPath(dir));
  } catch {
    // Already gone
  }
  try {
    fs.unlinkSync(scratchpadPath(dir) + '.tmp');
  } catch {
    // Already gone
  }
}

/**
 * Create empty scratchpad.
 * @returns {Scratchpad}
 */
function createEmpty() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    agents: {},
    messages: [],
    nextId: 1,
  };
}

/**
 * Register an agent in the scratchpad.
 * @param {Scratchpad} pad
 * @param {string} agentId - Unique agent identifier
 * @param {string} role - What this agent is working on
 * @param {string[]} [scope] - Files/directories this agent owns
 */
function registerAgent(pad, agentId, role, scope) {
  pad.agents[agentId] = {
    role,
    scope: scope || [],
    registeredAt: new Date().toISOString(),
    status: 'active',
  };
}

/**
 * Mark an agent as finished.
 * @param {Scratchpad} pad
 * @param {string} agentId
 */
function deregisterAgent(pad, agentId) {
  if (pad.agents[agentId]) {
    pad.agents[agentId].status = 'done';
  }
}

/**
 * Post a finding to the scratchpad.
 * Other agents can read this to avoid conflicts or leverage discoveries.
 *
 * @param {Scratchpad} pad
 * @param {string} agentId - Who is posting
 * @param {'discovery'|'conflict'|'dependency'|'question'|'decision'} category
 * @param {string} message - The finding
 * @param {string[]} [affectedFiles] - Files relevant to this finding
 */
function post(pad, agentId, category, message, affectedFiles) {
  if (!pad.nextId) pad.nextId = pad.messages.length + 1;
  pad.messages.push({
    id: pad.nextId++,
    agentId,
    category,
    message,
    affectedFiles: affectedFiles || [],
    postedAt: new Date().toISOString(),
    readBy: [],
  });
}

/**
 * Read unread messages for an agent, optionally filtered by category.
 * Marks messages as read.
 *
 * @param {Scratchpad} pad
 * @param {string} agentId - Who is reading
 * @param {string} [category] - Filter by category
 * @returns {ScratchpadMessage[]}
 */
function readUnread(pad, agentId, category) {
  const unread = pad.messages.filter(m => {
    if (m.agentId === agentId) return false; // Skip own messages
    if (m.readBy.includes(agentId)) return false;
    if (category && m.category !== category) return false;
    return true;
  });

  // Mark as read
  for (const msg of unread) {
    msg.readBy.push(agentId);
  }

  return unread;
}

/**
 * Check if any agent has claimed a file (scope overlap detection).
 * Prevents two agents from editing the same file.
 *
 * @param {Scratchpad} pad
 * @param {string} filePath - File to check
 * @param {string} [excludeAgent] - Agent to exclude from check
 * @returns {{claimed: boolean, by: string|null}}
 */
function checkFileOwnership(pad, filePath, excludeAgent) {
  for (const [agentId, info] of Object.entries(pad.agents)) {
    if (agentId === excludeAgent) continue;
    if (info.status !== 'active') continue;
    if (info.scope.some(s => filePath.startsWith(s) || filePath === s)) {
      return { claimed: true, by: agentId };
    }
  }
  return { claimed: false, by: null };
}

/**
 * Get all conflict messages (highest priority for agents to check).
 * @param {Scratchpad} pad
 * @returns {ScratchpadMessage[]}
 */
function getConflicts(pad) {
  return pad.messages.filter(m => m.category === 'conflict');
}

/**
 * Format scratchpad as a compact briefing for an agent.
 * Include in agent dispatch prompts so they're aware of shared state.
 *
 * @param {Scratchpad} pad
 * @param {string} agentId - The agent being briefed
 * @returns {string}
 */
function formatBriefing(pad, agentId) {
  const lines = ['## Shared Scratchpad'];

  // Other active agents
  const others = Object.entries(pad.agents)
    .filter(([id, info]) => id !== agentId && info.status === 'active');

  if (others.length > 0) {
    lines.push('**Active agents:**');
    for (const [id, info] of others) {
      const scopeStr = info.scope.length > 0 ? ` (owns: ${info.scope.join(', ')})` : '';
      lines.push(`- ${id}: ${info.role}${scopeStr}`);
    }
  }

  // Unread messages
  const unread = pad.messages.filter(m => {
    if (m.agentId === agentId) return false;
    if (m.readBy.includes(agentId)) return false;
    return true;
  });

  if (unread.length > 0) {
    lines.push('**Unread findings:**');
    for (const msg of unread) {
      const filesStr = msg.affectedFiles.length > 0
        ? ` [${msg.affectedFiles.join(', ')}]`
        : '';
      lines.push(`- [${msg.category}] ${msg.message}${filesStr}`);
    }
  }

  // Conflicts always shown
  const conflicts = getConflicts(pad);
  if (conflicts.length > 0) {
    lines.push('**CONFLICTS (resolve before proceeding):**');
    for (const c of conflicts) {
      lines.push(`- ${c.message}`);
    }
  }

  if (lines.length === 1) {
    return ''; // Nothing to brief
  }

  return lines.join('\n');
}

module.exports = {
  load,
  save,
  clear,
  createEmpty,
  registerAgent,
  deregisterAgent,
  post,
  readUnread,
  checkFileOwnership,
  getConflicts,
  formatBriefing,
  SCRATCHPAD_FILE,
};

/**
 * @typedef {Object} Scratchpad
 * @property {number} version
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {Object<string, {role: string, scope: string[], registeredAt: string, status: string}>} agents
 * @property {ScratchpadMessage[]} messages
 */

/**
 * @typedef {Object} ScratchpadMessage
 * @property {number} id
 * @property {string} agentId
 * @property {'discovery'|'conflict'|'dependency'|'question'|'decision'} category
 * @property {string} message
 * @property {string[]} affectedFiles
 * @property {string} postedAt
 * @property {string[]} readBy
 */
