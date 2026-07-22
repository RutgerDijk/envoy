#!/usr/bin/env node
'use strict';

/**
 * Fix-CI preflight.
 *
 * Requires .envoy/finalize/state.json with a prNumber. Initialises the
 * fix-ci loop counter (.envoy/loops/fix-ci.json with maxCycles=3) unless
 * it already exists. If the loop is already exhausted, fails fatal with
 * remediation.
 */

const fs = require('fs');
const path = require('path');

const CWD = process.cwd();
const REPO_ROOT = process.env.ENVOY_REPO_ROOT || path.resolve(__dirname, '..', '..');
const { validateFile } = require(path.join(REPO_ROOT, 'lib', 'validate-schema'));
const { appendEvent } = require(path.join(REPO_ROOT, 'lib', 'ledger'));

function say(line) { process.stdout.write(`${line}\n`); }
function banner(tier) { say(`## STATUS: ${tier}`); }

function writeJson(rel, data) {
  const full = path.join(CWD, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(data, null, 2));
}

function nowIso() { return new Date().toISOString(); }

function main() {
  const statePath = path.join(CWD, '.envoy', 'finalize', 'state.json');
  if (!fs.existsSync(statePath)) {
    banner('fatal');
    say('finalize state not found at .envoy/finalize/state.json — no PR number to act on.');
    say('');
    say('Remediation: run /envoy:finalize first (which opens the PR and writes state.json), or pass a PR number explicitly to fix-ci.');
    return;
  }

  const result = validateFile('finalize-state', statePath);
  if (!result.valid) {
    banner('fatal');
    say('finalize state failed schema validation:');
    for (const e of result.errors) say(`  - ${e}`);
    return;
  }

  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (!state.prNumber) {
    banner('fatal');
    say('finalize state has no prNumber — cannot fetch CI checks.');
    return;
  }

  const loopPath = path.join(CWD, '.envoy', 'loops', 'fix-ci.json');
  if (fs.existsSync(loopPath)) {
    const loop = JSON.parse(fs.readFileSync(loopPath, 'utf8'));
    const maxCycles = loop.maxCycles ?? 3;
    const seen = loop.cyclesSeen ?? 0;
    if (seen >= maxCycles && (loop.confirmed ?? 0) === 0) {
      banner('fatal');
      say(`fix-ci loop exhausted: maxCycles=${maxCycles} reached without confirmation`);
      say('');
      say('Remediation: investigate manually, then run:');
      say('  node lib/loop-safeguards.js reset fix-ci --reason "<why CI was reset>"');
      return;
    }
  } else {
    writeJson('.envoy/loops/fix-ci.json', {
      loop: 'fix-ci',
      confirmed: 0,
      maxCycles: 3,
      cyclesSeen: 0,
      history: [{ action: 'init', at: nowIso() }],
    });
  }

  writeJson('.envoy/active-skill.json', {
    $schemaVersion: '1',
    skill: 'fix-ci',
    issueNumber: state.issueNumber,
    branch: state.branch,
    startedAt: nowIso(),
    pid: process.pid,
  });
  appendEvent(CWD, { type: 'skill-started', skill: 'fix-ci', issue: state.issueNumber });

  banner('ok');
  say('');
  say(`PR #${state.prNumber} — ci ${state.ciStatus || 'unknown'}`);
  if (state.ciStatus === 'pending') say('CI is currently pending — poll before attempting fixes.');
  if (state.ciStatus === 'failure') say('CI has failing checks — classify failures and fix.');
  say('');
  say('Next: read skills/fix-ci/SKILL.md for the classify → fix → push → re-poll cycle.');
}

main();
