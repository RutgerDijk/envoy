#!/usr/bin/env node
'use strict';

/**
 * Loop safeguards for autonomous Envoy workflows.
 *
 * A single "I'm done" could be hallucinated. Three consecutive
 * completion signals confirm genuine completion.
 *
 * Two interfaces:
 *   1. Module — backwards-compatible constants & PROTOCOL string
 *   2. CLI    — confirm / status / reset / cleanup / history <name>
 *              state lives in .envoy/loops/<name>.json
 */

const fs = require('fs');
const path = require('path');

const COMPLETION_SIGNAL = 'ENVOY_LOOP_COMPLETE';
const REQUIRED_CONSECUTIVE = 3;

const PROTOCOL = `
## Completion Signal Protocol

Autonomous loops must confirm completion ${REQUIRED_CONSECUTIVE} times consecutively.

\`\`\`
counter = 0

while counter < ${REQUIRED_CONSECUTIVE}:
  1. Run the verification/check
  2. If check PASSES:
     - Output: "${COMPLETION_SIGNAL}" with evidence
     - counter += 1
  3. If check FAILS:
     - counter = 0  (reset!)
     - Address the failure
     - Continue loop

Loop exits only when counter reaches ${REQUIRED_CONSECUTIVE}.
\`\`\`

A single "I'm done" could be hallucinated. Three consecutive confirmations
with fresh evidence each time prove genuine completion.
`;

function stateFile(name, cwd) {
  return path.join(cwd || process.cwd(), '.envoy', 'loops', `${name}.json`);
}

function loadState(name, cwd) {
  const file = stateFile(name, cwd);
  if (!fs.existsSync(file)) {
    return {
      loop: name,
      confirmed: 0,
      maxCycles: null,
      cyclesSeen: 0,
      history: [],
    };
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    loop: raw.loop || name,
    confirmed: raw.confirmed || 0,
    maxCycles: raw.maxCycles ?? null,
    cyclesSeen: raw.cyclesSeen || 0,
    history: Array.isArray(raw.history) ? raw.history : [],
  };
}

function saveState(state, cwd) {
  const file = stateFile(state.loop, cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}

function cmdConfirm(name, cwd) {
  const state = loadState(name, cwd);

  if (state.maxCycles !== null && state.cyclesSeen >= state.maxCycles && state.confirmed === 0) {
    state.history.push({ action: 'blocked', at: nowIso(), reason: 'max cycles exceeded' });
    saveState(state, cwd);
    process.stdout.write(`BLOCKED: loop '${name}' has reached maxCycles=${state.maxCycles} without confirming.\n`);
    process.stdout.write(`Run: node lib/loop-safeguards.js reset ${name} --reason <text>\n`);
    return 2;
  }

  state.confirmed += 1;
  state.cyclesSeen += 1;
  state.history.push({ action: 'confirm', at: nowIso(), count: state.confirmed });
  saveState(state, cwd);

  process.stdout.write(`confirm ${state.confirmed}/${REQUIRED_CONSECUTIVE} for '${name}'\n`);
  return state.confirmed >= REQUIRED_CONSECUTIVE ? 0 : 1;
}

function cmdStatus(name, cwd) {
  const state = loadState(name, cwd);
  const confirmed = state.confirmed >= REQUIRED_CONSECUTIVE;
  process.stdout.write(`loop: ${name}\n`);
  process.stdout.write(`count: ${state.confirmed}/${REQUIRED_CONSECUTIVE}\n`);
  process.stdout.write(`state: ${confirmed ? 'confirmed' : 'pending'}\n`);
  if (state.maxCycles !== null) {
    process.stdout.write(`cycles: ${state.cyclesSeen}/${state.maxCycles}\n`);
  }
  return confirmed ? 0 : 1;
}

function cmdReset(name, reason, cwd) {
  const state = loadState(name, cwd);
  state.confirmed = 0;
  state.history.push({ action: 'reset', at: nowIso(), reason: reason || '(no reason given)' });
  saveState(state, cwd);
  process.stdout.write(`reset '${name}' — reason: ${reason || '(no reason)'}\n`);
  return 0;
}

function cmdCleanup(name, cwd) {
  const file = stateFile(name, cwd);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    process.stdout.write(`removed ${file}\n`);
  } else {
    process.stdout.write(`no state file for '${name}'\n`);
  }
  return 0;
}

function cmdHistory(name, cwd) {
  const state = loadState(name, cwd);
  if (state.history.length === 0) {
    process.stdout.write(`(no history for '${name}')\n`);
    return 0;
  }
  for (const entry of state.history) {
    const extra = [entry.count && `count=${entry.count}`, entry.reason && `reason=${entry.reason}`]
      .filter(Boolean)
      .join(' ');
    process.stdout.write(`${entry.at}  ${entry.action}${extra ? '  ' + extra : ''}\n`);
  }
  return 0;
}

function usage() {
  process.stdout.write([
    'Usage: loop-safeguards <subcommand> <name> [options]',
    '',
    'Subcommands:',
    '  confirm <name>                  Increment confirmation count (exit 0 when 3 reached, else 1)',
    '  status <name>                   Print status (exit 0 if confirmed, 1 if pending)',
    '  reset <name> --reason <text>    Reset counter to 0 and record reason',
    '  cleanup <name>                  Remove the state file entirely',
    '  history <name>                  Print action history',
    '',
    'State is stored under .envoy/loops/<name>.json (relative to cwd).',
    '',
  ].join('\n'));
}

function parseArgs(argv) {
  const [sub, name, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--reason' && rest[i + 1] !== undefined) {
      opts.reason = rest[i + 1];
      i++;
    }
  }
  return { sub, name, opts };
}

function main(argv) {
  const { sub, name, opts } = parseArgs(argv);
  if (!sub || sub === '-h' || sub === '--help' || sub === 'help') {
    usage();
    return sub ? 0 : 1;
  }
  if (!name) {
    usage();
    process.stderr.write(`error: <name> is required for '${sub}'\n`);
    return 1;
  }
  switch (sub) {
    case 'confirm': return cmdConfirm(name, process.cwd());
    case 'status':  return cmdStatus(name, process.cwd());
    case 'reset':   return cmdReset(name, opts.reason, process.cwd());
    case 'cleanup': return cmdCleanup(name, process.cwd());
    case 'history': return cmdHistory(name, process.cwd());
    default:
      usage();
      process.stderr.write(`error: unknown subcommand '${sub}'\n`);
      return 1;
  }
}

module.exports = {
  COMPLETION_SIGNAL,
  REQUIRED_CONSECUTIVE,
  PROTOCOL,
  cmdConfirm,
  cmdStatus,
  cmdReset,
  cmdCleanup,
  cmdHistory,
  loadState,
  saveState,
};

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
