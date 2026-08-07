'use strict';

/**
 * Contract-guard decision logic. Given a skill's contract.json, evaluates
 * whether an Agent tool call or a Stop event would violate the contract and
 * returns the decision without exiting. The plugin observe-gate consumes these
 * evaluators to log (and, in strict mode, block) violations.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function loadContract(contractPath) {
  if (!fs.existsSync(contractPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  } catch {
    return null;
  }
}

function findInvariantMatch(invariants, prompt) {
  if (!Array.isArray(invariants)) return null;
  for (const inv of invariants) {
    if (!inv || !inv.matchPrompt) continue;
    const re = new RegExp(inv.matchPrompt);
    if (re.test(prompt)) return inv;
  }
  return null;
}

function validatePrompt(invariant, toolInput) {
  const errors = [];
  const prompt = toolInput.prompt || '';
  const subtype = toolInput.subagent_type || toolInput.subagentType;

  if (invariant.subagentType && subtype !== invariant.subagentType) {
    errors.push(`subagent_type: expected "${invariant.subagentType}", got "${subtype}"`);
  }

  if (Array.isArray(invariant.promptMustContain)) {
    for (const token of invariant.promptMustContain) {
      if (!prompt.includes(token)) {
        errors.push(`prompt missing required token: "${token}"`);
      }
    }
  }
  if (Array.isArray(invariant.promptMustNotContain)) {
    for (const token of invariant.promptMustNotContain) {
      if (prompt.includes(token)) {
        errors.push(`prompt contains forbidden token: "${token}"`);
      }
    }
  }
  return errors;
}

/**
 * Decide whether a parsed Agent event would violate the contract, WITHOUT
 * touching stdin or exiting. Callers get the decision and can enforce (exit 2)
 * or observe (log) as they see fit.
 * @param {string} contractPath absolute path to contract.json
 * @param {object} event the parsed PreToolUse event
 * @returns {{block: boolean, skill?: string, tool?: string, reason?: string, errors?: string[]}}
 */
function evaluateAgentGuard(contractPath, event) {
  const toolName = event.tool_name || event.toolName;
  if (toolName !== 'Agent') return { block: false };

  const contract = loadContract(contractPath);
  if (!contract) return { block: false };

  const toolInput = event.tool_input || event.toolInput || {};
  const prompt = toolInput.prompt || '';
  const inv = findInvariantMatch(contract.agentInvariants, prompt);
  if (!inv) return { block: false };

  const errors = validatePrompt(inv, toolInput);
  if (errors.length === 0) return { block: false };

  return {
    block: true,
    skill: contract.skill,
    tool: toolName,
    reason: `${inv.matchPrompt}: ${errors.join('; ')}`,
    errors,
  };
}

/**
 * Decide whether a Stop event would violate the contract, WITHOUT exiting.
 * Checks requiredArtifacts existence/commit state and loopSignal confirmation.
 * @param {string} contractPath absolute path to contract.json
 * @param {string} [cwd] working directory to resolve artifacts/loops against
 * @returns {{block: boolean, skill?: string, reason?: string, missing?: string[], loopIssues?: string[]}}
 */
function evaluateStopAudit(contractPath, cwd = process.cwd()) {
  const contract = loadContract(contractPath);
  if (!contract) return { block: false };

  const missing = [];
  for (const art of contract.requiredArtifacts || []) {
    const p = path.join(cwd, art.path);
    if (!fs.existsSync(p)) {
      missing.push(art.path);
      continue;
    }
    if (art.committed) {
      // verify at least one commit added this file
      const r = spawnSync('git', ['log', '--diff-filter=A', '--format=%H', '--', art.path], {
        cwd, encoding: 'utf8',
      });
      if (r.status !== 0 || !(r.stdout && r.stdout.trim())) {
        missing.push(`${art.path} (not committed)`);
      }
    }
  }

  const loopIssues = [];
  const loopSignals = Array.isArray(contract.loopSignals) ? contract.loopSignals : [];
  for (const loopName of loopSignals) {
    const statePath = path.join(cwd, '.envoy', 'loops', `${loopName}.json`);
    if (!fs.existsSync(statePath)) {
      loopIssues.push(`${loopName}: no loop state (not confirmed)`);
      continue;
    }
    const REPO_ROOT = process.env.ENVOY_REPO_ROOT || path.resolve(__dirname, '..');
    const cli = path.join(REPO_ROOT, 'lib', 'loop-safeguards.js');
    const r = spawnSync('node', [cli, 'status', loopName], { cwd, encoding: 'utf8' });
    if (r.status !== 0) loopIssues.push(`${loopName}: status pending (${(r.stdout || '').trim()})`);
  }

  if (missing.length === 0 && loopIssues.length === 0) return { block: false };

  const parts = [];
  if (missing.length) parts.push(`missing artifacts: ${missing.join(', ')}`);
  if (loopIssues.length) parts.push(`loop signals: ${loopIssues.join(', ')}`);

  return { block: true, skill: contract.skill, reason: parts.join('; '), missing, loopIssues };
}

/**
 * Detect whether a bash command string is a `gh issue create` call, or the
 * `gh api repos/*\/issues -X POST` (or `--method POST`) bypass route.
 * @param {string} command
 * @returns {boolean}
 */
function isIssueCreateCommand(command) {
  if (typeof command !== 'string' || !command) return false;
  if (/\bgh\s+issue\s+create\b/.test(command)) return true;
  // Match the *collection* endpoint only (no trailing path segment) — a
  // POST to /issues/<n>/comments or /issues/<n>/labels is an unrelated,
  // legitimate operation on an EXISTING issue, not an issue-create attempt.
  if (/\bgh\s+api\b/.test(command) && /\/issues(?:\s|["'`]|$)/.test(command) && /(-X\s*POST|--method[= ]POST)/i.test(command)) {
    return true;
  }
  return false;
}

/**
 * Decide whether a `gh issue create` (or bypass) Bash command should be
 * blocked, WITHOUT exiting. Two independent checks:
 *  - unconditional: a second issue create after one was already created this
 *    brainstorm run (.envoy/brainstorm/session.json exists) — always blocks.
 *  - toggled: no .envoy/brainstorm/issue-plan-approved.json yet — would-block,
 *    subject to the caller's observe/strict handling.
 * @param {string} cwd
 * @param {string} command raw bash command string
 * @returns {{block: boolean, unconditional?: boolean, reason?: string, issueNumber?: number}}
 */
function evaluateIssueCreateGuard(cwd, command) {
  if (!isIssueCreateCommand(command)) return { block: false };

  const sessionPath = path.join(cwd, '.envoy', 'brainstorm', 'session.json');
  if (fs.existsSync(sessionPath)) {
    let session = null;
    try {
      session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    } catch {
      session = null;
    }
    const issueNumber = session && session.issueNumber;
    const issueRef = issueNumber != null ? `#${issueNumber}` : 'an existing issue (number unreadable from session.json)';
    const issueDetail = issueNumber != null
      ? `(see .envoy-tasks/${issueNumber}.json or "gh issue view ${issueNumber}")`
      : '(session.json is present but missing or malformed issueNumber — check .envoy/brainstorm/session.json directly)';
    return {
      block: true,
      unconditional: true,
      issueNumber,
      reason: `an issue was already created in this brainstorm run (${issueRef}) — ` +
        `do not create a duplicate issue; add tasks to the existing issue's task list instead ` +
        issueDetail,
    };
  }

  const approvedPath = path.join(cwd, '.envoy', 'brainstorm', 'issue-plan-approved.json');
  if (!fs.existsSync(approvedPath)) {
    return {
      block: true,
      unconditional: false,
      reason: 'gh issue create attempted without .envoy/brainstorm/issue-plan-approved.json — ' +
        'the issue plan has not been confirmed by the user yet',
    };
  }

  return { block: false };
}

module.exports = {
  evaluateAgentGuard,
  evaluateStopAudit,
  evaluateIssueCreateGuard,
  isIssueCreateCommand,
  findInvariantMatch,
  validatePrompt,
  loadContract,
};
