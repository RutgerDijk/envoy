#!/usr/bin/env node
'use strict';

/**
 * Aggregate test runner — the single entry point for the suite.
 *
 * Discovers <dir>/**\/*.test.js, runs each in its own child process, prints a
 * per-file result and a total summary, and exits non-zero if any file fails or
 * errors. Zero dependencies.
 *
 * Usage:
 *   node scripts/run-tests.js [dir]     # dir defaults to "tests"
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function findTestFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_err) {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      out.push(...findTestFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const targetDir = process.argv[2] || 'tests';
  const files = findTestFiles(targetDir).sort();

  if (files.length === 0) {
    process.stderr.write(`run-tests: no *.test.js files under ${targetDir}\n`);
    process.exit(1);
  }

  const green = (s) => `\x1b[32m${s}\x1b[0m`;
  const red = (s) => `\x1b[31m${s}\x1b[0m`;

  let failedFiles = 0;
  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    const result = spawnSync('node', [file], { encoding: 'utf8' });
    if (result.status === 0) {
      process.stdout.write(`${green('✓')} ${rel}\n`);
    } else {
      failedFiles++;
      process.stdout.write(`${red('✗')} ${rel}\n`);
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
  }

  const passedFiles = files.length - failedFiles;
  process.stdout.write(`\n${passedFiles} passed, ${failedFiles} failed (${files.length} total)\n`);
  process.exit(failedFiles > 0 ? 1 : 0);
}

if (require.main === module) main();

module.exports = { findTestFiles };
