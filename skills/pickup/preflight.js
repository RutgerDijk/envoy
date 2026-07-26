#!/usr/bin/env node
'use strict';

/**
 * Pickup preflight.
 *
 * Reads .envoy-tasks/<issue>.json, validates it against the tasks schema,
 * writes .envoy/pickup/session.json (seeded from the tasks list) and
 * .envoy/active-skill.json, then prints a briefing.
 *
 * Emits `## STATUS: ok|degraded|fatal` as the first content line so the
 * eval harness (and Claude reading the inline `!` substitution) can parse
 * the outcome.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CWD = process.cwd();
const REPO_ROOT = process.env.ENVOY_REPO_ROOT || path.resolve(__dirname, '..', '..');
const { validateFile } = require(path.join(REPO_ROOT, 'lib', 'validate-schema'));
const { extractEmbeddedBlock } = require(path.join(REPO_ROOT, 'lib', 'tasks-embed'));
const { writeActiveSkill } = require(path.join(REPO_ROOT, 'lib', 'active-skill'));
const { appendEvent } = require(path.join(REPO_ROOT, 'lib', 'ledger'));

// Best-effort fetch of an issue body via gh. Returns the body string, or null
// when gh is unavailable or the call fails — callers must tolerate null.
// ENVOY_ISSUE_BODY_FILE overrides the source (test seam): read that file
// instead of calling gh; unreadable ⇒ null.
function fetchIssueBody(issueNumber) {
  const override = process.env.ENVOY_ISSUE_BODY_FILE;
  if (override) {
    try {
      return fs.readFileSync(override, 'utf8');
    } catch (_err) {
      return null;
    }
  }
  try {
    return execFileSync('gh', ['issue', 'view', String(issueNumber), '--json', 'body', '-q', '.body'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_err) {
    return null;
  }
}

// Recover the tasks payload embedded in the issue body, or null.
function payloadFromIssue(issueNumber) {
  const body = fetchIssueBody(issueNumber);
  return body ? extractEmbeddedBlock(body) : null;
}

function say(line) { process.stdout.write(`${line}\n`); }
function banner(tier) { say(`## STATUS: ${tier}`); }

function writeJson(rel, data) {
  const full = path.join(CWD, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(data, null, 2));
}

function nowIso() { return new Date().toISOString(); }

function main() {
  const issueNumber = process.env.ENVOY_ISSUE_NUMBER;

  if (!issueNumber) {
    banner('fatal');
    say('No ENVOY_ISSUE_NUMBER in environment.');
    say('Set it before invoking pickup (usually handled by the slash command).');
    return;
  }

  const tasksFile = path.join(CWD, '.envoy-tasks', `${issueNumber}.json`);
  let materialized = false;

  if (!fs.existsSync(tasksFile)) {
    // Recover from the machine block embedded in the issue before giving up.
    const recovered = payloadFromIssue(issueNumber);
    if (recovered) {
      recovered.issueNumber = Number(issueNumber);
      writeJson(path.join('.envoy-tasks', `${issueNumber}.json`), recovered);
      materialized = true;
    } else {
      banner('fatal');
      say(`tasks file not found at .envoy-tasks/${issueNumber}.json`);
      say('');
      say('Remediation:');
      say(`  1. Run /envoy:brainstorm for issue #${issueNumber} to produce the task list, OR`);
      say(`  2. Write .envoy-tasks/${issueNumber}.json manually conforming to lib/schemas/tasks.json`);
      return;
    }
  }

  const result = validateFile('tasks', tasksFile);
  if (!result.valid) {
    banner('fatal');
    say(`tasks file schema validation failed: ${tasksFile}`);
    for (const e of result.errors) say(`  - ${e}`);
    say('');
    say('Regenerate via /envoy:brainstorm or fix the file to match lib/schemas/tasks.json.');
    return;
  }

  const tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));

  // Non-fatal drift check: if the committed file and the issue's embedded block
  // disagree on the task set, the issue was likely edited after filing.
  let driftWarning = null;
  if (!materialized) {
    const issuePayload = payloadFromIssue(issueNumber);
    if (issuePayload) {
      const key = (p) => JSON.stringify((p.tasks || []).map((t) => [t.id, t.title]));
      if (key(issuePayload) !== key(tasks)) {
        driftWarning = 'local .envoy-tasks file differs from the issue\'s embedded task block (issue edited after it was materialized?)';
      }
    }
  }

  // Seed session.json
  const session = {
    $schemaVersion: '1',
    branch: 'unknown',
    plan: `issue #${issueNumber}`,
    issueNumber: Number(issueNumber),
    startedAt: nowIso(),
    updatedAt: nowIso(),
    tasks: (tasks.tasks || []).map(t => ({
      id: t.id,
      name: t.title,
      status: 'pending',
    })),
    decisions: [],
    nextSteps: [],
  };
  writeJson('.envoy/pickup/session.json', session);
  writeActiveSkill(CWD, { skill: 'pickup', issueNumber: issueNumber ? Number(issueNumber) : undefined });
  appendEvent(CWD, { type: 'skill-started', skill: 'pickup', issue: Number(issueNumber) });

  banner('ok');
  say('');
  if (materialized) {
    say('Tasks materialized from the issue\'s embedded block.');
    say('');
  }
  if (driftWarning) {
    say(`WARNING: ${driftWarning}`);
    say('');
  }
  say(`Issue #${issueNumber} — ${tasks.tasks.length} task${tasks.tasks.length === 1 ? '' : 's'} loaded`);
  say(`Strategy: ${tasks.strategy || '(not specified — will be chosen during Step 12)'}`);
  say('');
  say('Tasks:');
  for (const t of tasks.tasks) say(`  - ${t.id}: ${t.title}`);
  say('');
  say('Next: read skills/pickup/steps/worktree.md and proceed with Step 1.');
}

main();
