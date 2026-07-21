'use strict';

/**
 * ABOUTME: Plugin-level observe-mode gate core for agent-guard and stop-audit.
 * ABOUTME: Resolves the active skill's contract, logs would-block decisions, never blocks.
 *
 * OBSERVE MODE: these gates only watch. When the active rigid skill's contract
 * would block an Agent dispatch or a Stop, we append one JSON line to
 * .envoy/observe-log.jsonl and exit 0 anyway. Enforcement (exit 2) stays out of
 * this path entirely — we call the non-exiting evaluate* variants, never run*.
 *
 * FAIL-OPEN: any error is swallowed. A broken gate must never block a tool call.
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
 * Run one observe gate. Resolves the active skill (null → no-op), evaluates the
 * contract's would-block decision, and logs it. Always returns without throwing.
 * @param {'agent-guard'|'stop-audit'} gate
 * @param {string} data raw stdin payload (the tool-use / stop event JSON)
 */
function observe(gate, data) {
  try {
    const cwd = process.cwd();
    const active = readActiveSkill(cwd);
    if (!active) return; // no rigid skill owns the session — nothing to guard

    const contractPath = path.join(PLUGIN_ROOT, 'skills', active.skill, 'contract.json');

    let decision;
    if (gate === 'agent-guard') {
      let event = {};
      try {
        event = JSON.parse(data || '{}');
      } catch {
        return; // malformed event — fail open, nothing to observe
      }
      decision = evaluateAgentGuard(contractPath, event);
    } else {
      decision = evaluateStopAudit(contractPath, cwd);
    }

    if (!decision || !decision.block) return;

    const record = {
      ts: new Date().toISOString(),
      skill: active.skill,
      gate,
      reason: decision.reason,
    };
    if (decision.tool) record.tool = decision.tool;
    appendObserveLog(cwd, record);
  } catch {
    // fail-open: never block a tool call on gate failure
  }
}

module.exports = { observe, appendObserveLog };
