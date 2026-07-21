'use strict';

/**
 * Shared contract-guard logic used by per-skill PreToolUse[Agent] and
 * Stop hooks. Each skill's hook file is a thin wrapper that passes its
 * contract.json path into this module.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function readStdin() {
  let data = '';
  try {
    data = fs.readFileSync(0, 'utf8');
  } catch {
    // no stdin — fine for Stop hooks that don't need input
  }
  return data.trim();
}

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
 * Run the PreToolUse[Agent] guard (reads stdin, enforces with exit code).
 * @param {string} contractPath absolute path to contract.json
 * @returns {number} exit code (0 allow, 2 block)
 */
function runAgentGuard(contractPath) {
  const raw = readStdin();
  if (!raw) return 0;
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return 0;
  }

  const decision = evaluateAgentGuard(contractPath, event);
  if (!decision.block) return 0;

  process.stderr.write(`agent-guard (${decision.skill}): blocked — ${decision.reason}\n`);
  return 2;
}

/**
 * Run the Stop-audit hook (enforces with exit code).
 * Ensures requiredArtifacts exist (relative to cwd) and that any
 * loopSignals referenced are in a confirmed state.
 */
function runStopAudit(contractPath) {
  const decision = evaluateStopAudit(contractPath, process.cwd());
  if (!decision.block) return 0;

  process.stderr.write(`stop-audit (${decision.skill}): blocked — ${decision.reason}\n`);
  return 2;
}

module.exports = {
  runAgentGuard,
  runStopAudit,
  evaluateAgentGuard,
  evaluateStopAudit,
  findInvariantMatch,
  validatePrompt,
  loadContract,
};
