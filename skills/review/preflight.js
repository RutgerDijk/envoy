#!/usr/bin/env node
'use strict';

/**
 * Review preflight.
 *
 * Reads .envoy/pickup/handoff-to-review.json, validates it, verifies
 * that the baseSha/headSha exist in the current repo (degraded if not),
 * writes .envoy/active-skill.json, then prints a briefing.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CWD = process.cwd();
const REPO_ROOT = process.env.ENVOY_REPO_ROOT || path.resolve(__dirname, '..', '..');
const { validateFile } = require(path.join(REPO_ROOT, 'lib', 'validate-schema'));
const { appendEvent } = require(path.join(REPO_ROOT, 'lib', 'ledger'));

function say(line) { process.stdout.write(`${line}\n`); }
function banner(tier) { say(`## STATUS: ${tier}`); }

function strictPromote(tier) {
  if (tier === 'degraded' && process.env.ENVOY_HOOK_PROFILE === 'strict') return 'fatal';
  return tier;
}

function writeJson(rel, data) {
  const full = path.join(CWD, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(data, null, 2));
}

function nowIso() { return new Date().toISOString(); }

function isGitRepo() {
  try {
    execSync('git rev-parse --git-dir', { cwd: CWD, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function gitHasSha(sha) {
  try {
    execSync(`git cat-file -e ${sha}`, { cwd: CWD, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function main() {
  const handoffPath = path.join(CWD, '.envoy', 'pickup', 'handoff-to-review.json');

  if (!fs.existsSync(handoffPath)) {
    banner('fatal');
    say('pickup handoff not found at .envoy/pickup/handoff-to-review.json');
    say('');
    say('Remediation: run /envoy:pickup to completion first — it writes the handoff on Step 14.');
    return;
  }

  const result = validateFile('handoff-pickup-to-review', handoffPath);
  if (!result.valid) {
    banner('fatal');
    say('pickup handoff schema validation failed:');
    for (const e of result.errors) say(`  - ${e}`);
    return;
  }

  const handoff = JSON.parse(fs.readFileSync(handoffPath, 'utf8'));
  const warnings = [];
  if (!Array.isArray(handoff.tasksCompleted) || handoff.tasksCompleted.length === 0) {
    warnings.push('tasksCompleted is empty — no task-level diffs will be reviewed');
  }
  if (isGitRepo()) {
    if (!gitHasSha(handoff.baseSha)) warnings.push(`baseSha ${handoff.baseSha} not found in current repo`);
    if (!gitHasSha(handoff.headSha)) warnings.push(`headSha ${handoff.headSha} not found in current repo`);
  }

  writeJson('.envoy/active-skill.json', {
    $schemaVersion: '1',
    skill: 'review',
    issueNumber: handoff.issueNumber,
    branch: handoff.branch,
    startedAt: nowIso(),
    pid: process.pid,
  });
  appendEvent(CWD, { type: 'skill-started', skill: 'review', issue: handoff.issueNumber });

  if (warnings.length > 0) {
    const tier = strictPromote('degraded');
    banner(tier);
    say('');
    say('## DEGRADED:');
    for (const w of warnings) say(`  - ${w}`);
    say('');
    say('Proceeding, but the diff walk may be incomplete. If strict mode is needed, rerun pickup to refresh the handoff.');
    return;
  }

  banner('ok');
  const n = handoff.tasksCompleted.length;
  say('');
  say(`Reviewing branch ${handoff.branch} — ${n} task${n === 1 ? '' : 's'} to verify`);
  say(`Issue: #${handoff.issueNumber}`);
  say(`Diff range: ${handoff.baseSha}..${handoff.headSha}`);
  if (handoff.stackProfiles && handoff.stackProfiles.length) {
    say(`Stack profiles: ${handoff.stackProfiles.join(', ')}`);
  }
  say('');
  say('Next: run pre-review setup from skills/review/SKILL.md, then proceed layer by layer (layers/lint.md, layers/cleanup.md, …).');
}

main();
