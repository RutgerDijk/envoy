#!/usr/bin/env node
'use strict';

/**
 * Coderabbit-pr-review preflight.
 *
 * Requires .envoy/finalize/state.json with a prNumber.
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
    say('Remediation: run /envoy:finalize first, or pass a PR number explicitly.');
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
    say('finalize state has no prNumber — cannot fetch CodeRabbit comments.');
    return;
  }

  writeJson('.envoy/active-skill.json', {
    $schemaVersion: '1',
    skill: 'coderabbit-pr-review',
    issueNumber: state.issueNumber,
    branch: state.branch,
    startedAt: nowIso(),
    pid: process.pid,
  });
  appendEvent(CWD, { type: 'skill-started', skill: 'coderabbit-pr-review', issue: state.issueNumber });

  banner('ok');
  say('');
  say(`PR #${state.prNumber} — ready to fetch CodeRabbit comments`);
  say(`CodeRabbit status: ${state.coderabbitStatus || 'unknown'}`);
  say('');
  say('Next: read skills/coderabbit-pr-review/SKILL.md — poll, address, reply, resolve cycle.');
}

main();
