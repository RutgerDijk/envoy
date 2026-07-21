'use strict';

/**
 * ABOUTME: Plugin-level observe-mode gate core for agent-guard and stop-audit.
 * ABOUTME: Resolves the active skill's contract, logs would-block decisions, never blocks.
 *
 * OBSERVE MODE (default): these gates only watch. When the active rigid skill's
 * contract would block an Agent dispatch or a Stop, we append one JSON line to
 * .envoy/observe-log.jsonl and return 0 (allow) anyway.
 *
 * STRICT MODE (ENVOY_HOOK_PROFILE=strict): the same would-block decision is
 * ENFORCED — we still log it, write the reason to stderr, and return 2 (block)
 * so the model sees why. Off by default; only the env var flips it.
 *
 * FAIL-OPEN: any error is swallowed and we return 0. A broken gate must never
 * block a tool call — this holds even under strict.
 */

const fs = require('fs');
const path = require('path');

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
const { readActiveSkill } = require(path.join(PLUGIN_ROOT, 'lib', 'active-skill'));
const { evaluateAgentGuard, evaluateStopAudit } = require(path.join(PLUGIN_ROOT, 'lib', 'contract-guard'));

/**
 * Append one observe record to .envoy/observe-log.jsonl under `cwd`.
 * @param {string} cwd
 * @param {object} record
 */
function appendObserveLog(cwd, record) {
  const dir = path.join(cwd, '.envoy');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'observe-log.jsonl'), `${JSON.stringify(record)}\n`);
}

/**
 * Run one observe gate and return the exit code the runner should exit with.
 * Resolves the active skill (null → 0), evaluates the contract's would-block
 * decision, and logs it. Under ENVOY_HOOK_PROFILE=strict a would-block returns 2
 * (and writes the reason to stderr); otherwise it returns 0 (observe only).
 * Never throws — any error fails open to 0.
 * @param {'agent-guard'|'stop-audit'} gate
 * @param {string} data raw stdin payload (the tool-use / stop event JSON)
 * @returns {number} exit code: 0 to allow, 2 to block (strict + would-block only)
 */
function observe(gate, data) {
  try {
    const cwd = process.cwd();
    const active = readActiveSkill(cwd);
    if (!active) return 0; // no rigid skill owns the session — nothing to guard

    const contractPath = path.join(PLUGIN_ROOT, 'skills', active.skill, 'contract.json');

    let decision;
    if (gate === 'agent-guard') {
      let event = {};
      try {
        event = JSON.parse(data || '{}');
      } catch {
        return 0; // malformed event — fail open, nothing to observe
      }
      decision = evaluateAgentGuard(contractPath, event);
    } else {
      decision = evaluateStopAudit(contractPath, cwd);
    }

    if (!decision || !decision.block) return 0;

    const record = {
      ts: new Date().toISOString(),
      skill: active.skill,
      gate,
      reason: decision.reason,
    };
    if (decision.tool) record.tool = decision.tool;
    appendObserveLog(cwd, record);

    if (process.env.ENVOY_HOOK_PROFILE === 'strict') {
      // Escape hatch: a strict block is never an unrecoverable dead end.
      // With ENVOY_OVERRIDE set (to anything but a falsy string), log the
      // override and allow the call through. "0"/"false"/"" mean off, so a
      // user who sets ENVOY_OVERRIDE=0 is not surprised by an enabled override.
      const ov = (process.env.ENVOY_OVERRIDE || '').trim().toLowerCase();
      if (ov !== '' && ov !== '0' && ov !== 'false') {
        appendObserveLog(cwd, { kind: 'override', ...record });
        return 0;
      }
      process.stderr.write(
        `Envoy ${gate} (strict) blocked: ${decision.reason}. To override: set ENVOY_OVERRIDE=1 and retry.\n`
      );
      return 2;
    }
    return 0;
  } catch {
    // fail-open: never block a tool call on gate failure, even under strict
    return 0;
  }
}

module.exports = { observe, appendObserveLog };
