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

/**
 * Select the first invariant whose identity matcher (`field`, a regex
 * string such as matchDescription or matchTaskId) matches `value`.
 * Invariants are keyed on dispatch identity — the Agent call's
 * description or the dispatch() taskId — never on prompt prose, which
 * rewords freely and silently de-arms a prose-keyed gate.
 */
function findInvariantMatch(invariants, field, value) {
  if (!Array.isArray(invariants)) return null;
  if (typeof value !== 'string' || value === '') return null;
  for (const inv of invariants) {
    if (!inv || !inv[field]) continue;
    const re = new RegExp(inv[field]);
    if (re.test(value)) return inv;
  }
  return null;
}

function validatePromptTokens(invariant, prompt) {
  const errors = [];
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
 * Check an invariant's forbiddenTools against the tool list the dispatch
 * actually grants. This is the mechanical form of a "read-only worker"
 * invariant: prompt prose may name any tool freely (interpolated file
 * paths like MarkdownEditor.tsx contain tool names as substrings), but a
 * GRANT of a forbidden tool is a violation. Tool specs are compared by
 * base name, so a scoped grant like `Edit(docs/*)` still counts as Edit.
 * Fails closed: declaring forbiddenTools while providing no allowedTools
 * to check is itself a violation — a guard that silently skips is inert.
 */
function validateForbiddenTools(invariant, allowedTools) {
  if (!Array.isArray(invariant.forbiddenTools) || invariant.forbiddenTools.length === 0) {
    return [];
  }
  if (allowedTools === undefined || allowedTools === null) {
    return ['invariant declares forbiddenTools but the dispatch provided no allowedTools to check'];
  }
  const list = Array.isArray(allowedTools) ? allowedTools : String(allowedTools).split(',');
  const granted = list.map((t) => String(t).trim().replace(/\(.*$/, '')).filter(Boolean);
  const errors = [];
  for (const tool of invariant.forbiddenTools) {
    if (granted.includes(tool)) {
      errors.push(`allowedTools grants forbidden tool: "${tool}"`);
    }
  }
  return errors;
}

function validatePrompt(invariant, toolInput) {
  const errors = [];
  const prompt = toolInput.prompt || '';
  const subtype = toolInput.subagent_type || toolInput.subagentType;

  if (invariant.subagentType && subtype !== invariant.subagentType) {
    errors.push(`subagent_type: expected "${invariant.subagentType}", got "${subtype}"`);
  }

  errors.push(...validatePromptTokens(invariant, prompt));
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
  const description = toolInput.description || '';
  const inv = findInvariantMatch(contract.agentInvariants, 'matchDescription', description);
  if (!inv) return { block: false };

  const errors = validatePrompt(inv, toolInput);
  if (errors.length === 0) return { block: false };

  return {
    block: true,
    skill: contract.skill,
    tool: toolName,
    reason: `${inv.matchDescription}: ${errors.join('; ')}`,
    errors,
  };
}

/**
 * Decide whether a worker prompt (a headless `claude -p` process dispatched
 * outside the Agent tool, so the PreToolUse[Agent] gate never sees it) would
 * violate the contract's agentInvariants. The invariant is selected by the
 * dispatch taskId (matchTaskId), never by prompt prose. The subagentType
 * check is skipped — a headless worker has none; the prompt-token
 * invariants apply, and forbiddenTools is checked against the tool list
 * the dispatch grants (the Agent hook path has no such list — there the
 * subagentType assertion is the tool-surface bound).
 * @param {string} contractPath absolute path to contract.json
 * @param {string} prompt the full worker prompt text
 * @param {string} taskId the dispatch taskId identifying the work
 * @param {string[]|string} [allowedTools] the tool list the dispatch grants
 * @returns {{block: boolean, skill?: string, reason?: string, errors?: string[]}}
 */
function evaluateWorkerPrompt(contractPath, prompt, taskId, allowedTools) {
  const contract = loadContract(contractPath);
  if (!contract) return { block: false };

  const inv = findInvariantMatch(contract.agentInvariants, 'matchTaskId', taskId || '');
  if (!inv) return { block: false };

  const errors = [
    ...validatePromptTokens(inv, prompt || ''),
    ...validateForbiddenTools(inv, allowedTools),
  ];
  if (errors.length === 0) return { block: false };

  return {
    block: true,
    skill: contract.skill,
    reason: `task "${taskId}": ${errors.join('; ')}`,
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
  evaluateWorkerPrompt,
  isIssueCreateCommand,
  findInvariantMatch,
  validatePrompt,
  loadContract,
};
