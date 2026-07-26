#!/usr/bin/env node
'use strict';

/**
 * Brainstorm → Pickup handoff helper.
 *
 * Usage:
 *   node write-tasks.js <issueNumber> <tasksJsonPath>
 *
 * Reads the JSON file at <tasksJsonPath> (the payload brainstorm drafted
 * for the issue body), validates it against lib/schemas/tasks.json, and
 * writes the local (gitignored) .envoy-tasks/<issueNumber>.json. The issue's
 * embedded block is the durable copy; pickup rematerializes the file from it.
 *
 * Exits 0 on success, 1 on validation failure or I/O error.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = process.env.ENVOY_REPO_ROOT || path.resolve(__dirname, '..', '..');
const { validate } = require(path.join(REPO_ROOT, 'lib', 'validate-schema'));
const {
  enforceSpecFields,
  renderTasksSection,
  renderEmbeddedBlock,
} = require(path.join(REPO_ROOT, 'lib', 'tasks-embed'));

function fail(msg) {
  process.stderr.write(`write-tasks: ${msg}\n`);
  process.exit(1);
}

function main() {
  const [, , issueArg, tasksJsonPath] = process.argv;
  if (!issueArg || !tasksJsonPath) {
    fail('Usage: write-tasks.js <issueNumber> <tasksJsonPath>');
  }

  const issueNumber = Number(issueArg);
  if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
    fail(`invalid issueNumber: ${issueArg}`);
  }

  if (!fs.existsSync(tasksJsonPath)) {
    fail(`tasks JSON not found: ${tasksJsonPath}`);
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(tasksJsonPath, 'utf8'));
  } catch (err) {
    fail(`invalid JSON in ${tasksJsonPath}: ${err.message}`);
  }

  // Ensure the issueNumber is embedded in the payload.
  if (payload.issueNumber && payload.issueNumber !== issueNumber) {
    fail(`issueNumber mismatch: CLI ${issueNumber}, payload ${payload.issueNumber}`);
  }
  payload.issueNumber = issueNumber;
  payload.$schemaVersion = payload.$schemaVersion || '1';

  const result = validate('tasks', payload);
  if (!result.valid) {
    process.stderr.write('write-tasks: schema validation failed:\n');
    for (const e of result.errors) process.stderr.write(`  - ${e}\n`);
    process.exit(1);
  }

  // New task lists must be spec-driven: intent + behavior + acceptance per task.
  // (The schema keeps these optional so historical task files stay valid.)
  const spec = enforceSpecFields(payload);
  if (!spec.ok) {
    process.stderr.write('write-tasks: spec-field enforcement failed:\n');
    for (const e of spec.errors) process.stderr.write(`  - ${e}\n`);
    process.exit(1);
  }

  const outDir = path.join(process.cwd(), '.envoy-tasks');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${issueNumber}.json`);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');

  // stdout carries the issue-ready markdown (human section + recoverable block)
  // so brainstorm splices it into the issue body from this single source;
  // status goes to stderr to keep stdout clean for capture.
  process.stdout.write(renderTasksSection(payload));
  process.stdout.write('\n');
  process.stdout.write(renderEmbeddedBlock(payload));
  process.stdout.write('\n');
  process.stderr.write(`wrote ${path.relative(process.cwd(), outPath)} (${(payload.tasks || []).length} tasks)\n`);
}

if (require.main === module) main();

module.exports = { main };
