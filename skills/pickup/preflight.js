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

const CWD = process.cwd();
const REPO_ROOT = process.env.ENVOY_REPO_ROOT || path.resolve(__dirname, '..', '..');
const { validateFile } = require(path.join(REPO_ROOT, 'lib', 'validate-schema'));

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

function writeActiveSkill(issueNumber) {
  writeJson('.envoy/active-skill.json', {
    $schemaVersion: '1',
    skill: 'pickup',
    issueNumber: issueNumber ? Number(issueNumber) : undefined,
    startedAt: nowIso(),
    pid: process.pid,
  });
}

function main() {
  const issueNumber = process.env.ENVOY_ISSUE_NUMBER;

  if (!issueNumber) {
    banner('fatal');
    say('No ENVOY_ISSUE_NUMBER in environment.');
    say('Set it before invoking pickup (usually handled by the slash command).');
    return;
  }

  const tasksFile = path.join(CWD, '.envoy-tasks', `${issueNumber}.json`);

  if (!fs.existsSync(tasksFile)) {
    banner('fatal');
    say(`tasks file not found at .envoy-tasks/${issueNumber}.json`);
    say('');
    say('Remediation:');
    say(`  1. Run /envoy:brainstorm for issue #${issueNumber} to produce the task list, OR`);
    say(`  2. Write .envoy-tasks/${issueNumber}.json manually conforming to lib/schemas/tasks.json`);
    return;
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
  writeActiveSkill(issueNumber);

  const tier = strictPromote('ok');
  banner(tier);
  say('');
  say(`Issue #${issueNumber} — ${tasks.tasks.length} task${tasks.tasks.length === 1 ? '' : 's'} loaded`);
  say(`Strategy: ${tasks.strategy || '(not specified — will be chosen during Step 12)'}`);
  say('');
  say('Tasks:');
  for (const t of tasks.tasks) say(`  - ${t.id}: ${t.title}`);
  say('');
  say('Next: read skills/pickup/steps/worktree.md and proceed with Step 1.');
}

main();
