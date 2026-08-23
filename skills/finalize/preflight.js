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
  const handoffPath = path.join(CWD, '.envoy', 'review', 'handoff-to-finalize.json');

  if (!fs.existsSync(handoffPath)) {
    banner('fatal');
    say('review handoff not found at .envoy/review/handoff-to-finalize.json');
    say('');
    say('Remediation: run /envoy:review to completion first — it writes the handoff on the final report.');
    return;
  }

  const result = validateFile('handoff-review-to-finalize', handoffPath);
  // Migration path: the `tests` layer entry became required only after the
  // Layer 0.75 gate was introduced, so every handoff written before it
  // legitimately lacks one. Failing those fatally would strand in-flight
  // branches with no way forward except hand-editing runtime state — so a
  // missing required layer entry degrades to a warning, while every other
  // schema error stays fatal. `ENVOY_HOOK_PROFILE=strict` promotes it back
  // to fatal, per the plugin-wide preflight convention.
  const MISSING_ITEM = /missing required item with name/;
  const hardErrors = result.errors.filter(e => !MISSING_ITEM.test(e));
  const softErrors = result.errors.filter(e => MISSING_ITEM.test(e));
  const strict = process.env.ENVOY_HOOK_PROFILE === 'strict';

  if (hardErrors.length > 0 || (strict && softErrors.length > 0)) {
    banner('fatal');
    say('review handoff schema validation failed:');
    for (const e of hardErrors.concat(strict ? softErrors : [])) say(`  - ${e}`);
    return;
  }
  const warnings = softErrors.map(
    e => `${e} — handoff predates the Layer 0.75 tests gate; re-run /envoy:review to record it`
  );

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
  appendEvent(CWD, { type: 'skill-started', skill: 'finalize', issue: handoff.issueNumber });

  banner(warnings.length > 0 ? 'degraded' : 'ok');
  say('');
  for (const w of warnings) say(`WARNING: ${w}`);
  if (warnings.length > 0) say('');
  say(`Review approved — ready to finalize branch ${handoff.branch}`);
  say(`Issue: #${handoff.issueNumber}`);
  const passed = handoff.layers.filter(l => l.status === 'passed' || l.status === 'fixed').length;
  say(`Layers: ${passed}/${handoff.layers.length} passed/fixed`);
  say('');
  say('Next: run the preconditions check in skills/finalize/SKILL.md, then steps/coderabbit.md, steps/ci.md, steps/verify.md, steps/wiki.md.');
}

main();
