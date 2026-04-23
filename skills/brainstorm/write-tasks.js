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
 * writes .envoy-tasks/<issueNumber>.json in the current repo.
 *
 * Exits 0 on success, 1 on validation failure or I/O error.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = process.env.ENVOY_REPO_ROOT || path.resolve(__dirname, '..', '..');
const { validate } = require(path.join(REPO_ROOT, 'lib', 'validate-schema'));

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

  const outDir = path.join(process.cwd(), '.envoy-tasks');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${issueNumber}.json`);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');
  process.stdout.write(`wrote ${path.relative(process.cwd(), outPath)} (${(payload.tasks || []).length} tasks)\n`);
}

if (require.main === module) main();

module.exports = { main };
