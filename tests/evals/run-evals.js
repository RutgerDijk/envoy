#!/usr/bin/env node
'use strict';

/**
 * Envoy eval harness.
 *
 * Runs scenario files (tests/evals/<skill>/scenarios.json) against
 * the skill's preflight.js inside a sandboxed temp directory.
 *
 * Exit codes:
 *   0  all scenarios passed (or all pending)
 *   1  at least one scenario failed
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');

function loadScenarios(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`scenarios file not found: ${file}`);
  }
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`failed to parse JSON in ${file}: ${err.message}`);
  }
}

function applySetup(sandbox, setup) {
  if (!setup) return;
  if (setup.files) {
    for (const [relPath, content] of Object.entries(setup.files)) {
      if (content === null || content === undefined) continue;
      const full = path.join(sandbox, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      const str = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
      fs.writeFileSync(full, str);
    }
  }
}

function parseStatus(stdout) {
  const m = stdout.match(/^##\s*STATUS:\s*(ok|degraded|fatal)\b/mi);
  return m ? m[1].toLowerCase() : null;
}

function runPreflight(skill, sandbox, env) {
  const preflight = path.join(REPO_ROOT, 'skills', skill, 'preflight.js');
  if (!fs.existsSync(preflight)) {
    return { missing: true, preflightPath: preflight };
  }
  const r = spawnSync('node', [preflight], {
    cwd: sandbox,
    env: { ...process.env, ...env, ENVOY_REPO_ROOT: REPO_ROOT },
    encoding: 'utf8',
  });
  return {
    missing: false,
    exitCode: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

function assertExpected(actual, expected, sandbox) {
  const errors = [];

  if (expected.status && actual.status !== expected.status) {
    errors.push(`status: expected ${expected.status}, got ${actual.status || 'null'}`);
  }

  if (expected.stdout_matches) {
    const re = new RegExp(expected.stdout_matches);
    if (!re.test(actual.stdout || '')) {
      errors.push(`stdout did not match /${expected.stdout_matches}/`);
    }
  }

  if (Array.isArray(expected.artifacts_created)) {
    for (const rel of expected.artifacts_created) {
      const p = path.join(sandbox, rel);
      if (!fs.existsSync(p)) {
        errors.push(`expected artifact not created: ${rel}`);
      }
    }
  }

  if (Array.isArray(expected.artifacts_missing)) {
    for (const rel of expected.artifacts_missing) {
      const p = path.join(sandbox, rel);
      if (fs.existsSync(p)) {
        errors.push(`unexpected artifact present: ${rel}`);
      }
    }
  }

  if (typeof expected.exit_code === 'number' && actual.exitCode !== expected.exit_code) {
    errors.push(`exit_code: expected ${expected.exit_code}, got ${actual.exitCode}`);
  }

  return { passed: errors.length === 0, errors };
}

function runScenario({ skill, scenario, repoRoot }) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), `eval-${skill}-`));
  try {
    applySetup(sandbox, scenario.setup);
    const r = runPreflight(skill, sandbox, scenario.env || {});
    if (r.missing) {
      return {
        status: 'pending',
        message: `preflight.js not found at ${r.preflightPath} (scenario pending implementation)`,
      };
    }
    const actual = {
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.exitCode,
      status: parseStatus(r.stdout),
      artifacts_created: [],
    };
    const verdict = assertExpected(actual, scenario.expected || {}, sandbox);
    return {
      status: verdict.passed ? 'passed' : 'failed',
      errors: verdict.errors,
      stdout: r.stdout,
      stderr: r.stderr,
    };
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

function runAllForSkill(skill) {
  const file = path.join(__dirname, skill, 'scenarios.json');
  const data = loadScenarios(file);
  const results = [];
  for (const scenario of data.scenarios) {
    const r = runScenario({ skill, scenario, repoRoot: REPO_ROOT });
    results.push({ name: scenario.name, ...r });
  }
  return results;
}

function printResults(skill, results) {
  process.stdout.write(`\n== ${skill} ==\n`);
  let pass = 0, fail = 0, pend = 0;
  for (const r of results) {
    if (r.status === 'passed') { pass++; process.stdout.write(`  \x1b[32m✓\x1b[0m ${r.name}\n`); }
    else if (r.status === 'pending') { pend++; process.stdout.write(`  \x1b[33m⋯\x1b[0m ${r.name} (pending: ${r.message})\n`); }
    else { fail++; process.stdout.write(`  \x1b[31m✗\x1b[0m ${r.name}\n`); r.errors.forEach(e => process.stdout.write(`      - ${e}\n`)); }
  }
  return { pass, fail, pend };
}

function main(argv) {
  const args = argv.slice(2);
  const skillFlagIdx = args.indexOf('--skill');
  const skills = skillFlagIdx >= 0
    ? [args[skillFlagIdx + 1]]
    : ['review', 'pickup', 'finalize', 'fix-ci', 'coderabbit-pr-review', 'wiki-sync'];

  let totalFail = 0;
  for (const skill of skills) {
    try {
      const results = runAllForSkill(skill);
      const { fail } = printResults(skill, results);
      totalFail += fail;
    } catch (err) {
      process.stderr.write(`error running ${skill}: ${err.message}\n`);
      totalFail += 1;
    }
  }
  return totalFail === 0 ? 0 : 1;
}

module.exports = {
  loadScenarios,
  applySetup,
  parseStatus,
  runPreflight,
  runScenario,
  runAllForSkill,
  assertExpected,
};

if (require.main === module) {
  process.exit(main(process.argv));
}
