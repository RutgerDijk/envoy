#!/usr/bin/env node
'use strict';

/**
 * Finalize preflight.
 *
 * Reads .envoy/review/handoff-to-finalize.json, validates it, requires
 * reviewStatus === "approved", then writes .envoy/finalize/state.json
 * and .envoy/active-skill.json.
 */

const fs = require('fs');
const path = require('path');

const CWD = process.cwd();
const REPO_ROOT = process.env.ENVOY_REPO_ROOT || path.resolve(__dirname, '..', '..');
const { validateFile } = require(path.join(REPO_ROOT, 'lib', 'validate-schema'));

function say(line) { process.stdout.write(`${line}\n`); }
function banner(tier) { say(`## STATUS: ${tier}`); }

function writeJson(rel, data) {
  const full = path.join(CWD, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(data, null, 2));
}

function nowIso() { return new Date().toISOString(); }

function main() {
  const handoffPath = path.join(CWD, '.envoy', 'review', 'handoff-to-finalize.json');

  if (!fs.existsSync(handoffPath)) {
    banner('fatal');
    say('review handoff not found at .envoy/review/handoff-to-finalize.json');
    say('');
    say('Remediation: run /envoy:review to completion first — it writes the handoff on the final report.');
    return;
  }

  const result = validateFile('handoff-review-to-finalize', handoffPath);
  if (!result.valid) {
    banner('fatal');
    say('review handoff schema validation failed:');
    for (const e of result.errors) say(`  - ${e}`);
    return;
  }

  const handoff = JSON.parse(fs.readFileSync(handoffPath, 'utf8'));

  if (handoff.reviewStatus !== 'approved') {
    banner('fatal');
    say(`review handoff marked ${handoff.reviewStatus} — not approved for finalize`);
    say('');
    say('Remediation: resolve the review findings, re-run /envoy:review, then /envoy:finalize.');
    return;
  }

  writeJson('.envoy/finalize/state.json', {
    $schemaVersion: '1',
    issueNumber: handoff.issueNumber,
    branch: handoff.branch,
    prNumber: 0,
    baseBranch: 'main',
    ciStatus: 'unknown',
    coderabbitStatus: 'pending',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });

  writeJson('.envoy/active-skill.json', {
    $schemaVersion: '1',
    skill: 'finalize',
    issueNumber: handoff.issueNumber,
    branch: handoff.branch,
    startedAt: nowIso(),
    pid: process.pid,
  });

  banner('ok');
  say('');
  say(`Review approved — ready to finalize branch ${handoff.branch}`);
  say(`Issue: #${handoff.issueNumber}`);
  const passed = handoff.layers.filter(l => l.status === 'passed' || l.status === 'fixed').length;
  say(`Layers: ${passed}/${handoff.layers.length} passed/fixed`);
  say('');
  say('Next: run the preconditions check in skills/finalize/SKILL.md, then steps/coderabbit.md, steps/ci.md, steps/verify.md, steps/wiki.md.');
}

main();
