#!/usr/bin/env node
/**
 * Async Stop hook: Export session token usage summary to a committable JSON file.
 *
 * Writes a minimal JSON summary to docs/costs/reports/<date>-<username>.json
 * for team visibility. Contains only token breakdowns — no prompts or content.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Build the export path for a cost summary.
 * @param {string} projectRoot
 * @param {string} username
 * @returns {string}
 */
function getExportPath(projectRoot, username) {
  const date = new Date().toISOString().split('T')[0];
  return path.join(projectRoot, 'docs', 'costs', 'reports', `${date}-${username}.json`);
}

/**
 * Build a minimal JSON summary from session usage data.
 * @param {import('../lib/cost-reporter').SessionUsage} usage
 * @param {string} username
 * @param {string} branch
 * @returns {object}
 */
function buildSummaryJson(usage, username, branch) {
  const activities = {};
  for (const [label, a] of Object.entries(usage.activities || {})) {
    activities[label] = a.totalTokens;
  }

  const models = {};
  for (const [model, m] of Object.entries(usage.models || {})) {
    models[model] = m.totalTokens;
  }

  return {
    date: new Date().toISOString().split('T')[0],
    user: username,
    branch,
    totalTokens: usage.totalTokens,
    turns: usage.turns,
    activities,
    models,
  };
}

/**
 * Hook entry point. Called by hook-runner on Stop event.
 * @param {string} rawInput
 */
function run(rawInput) {
  try {
    const costReporter = require('../lib/cost-reporter');
    const projectDir = costReporter.findProjectDir(process.cwd());
    if (!projectDir) return;

    // Find the most recent session
    const sessions = costReporter.discoverSessions(projectDir);
    if (sessions.length === 0) return;

    // Sort by modified date, take the most recent
    sessions.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    const latest = sessions[0];

    const usage = costReporter.extractSessionUsage(latest.jsonlPath);
    if (usage.turns === 0) return;

    const username = os.userInfo().username;
    const exportPath = getExportPath(process.cwd(), username);

    // Ensure directory exists
    const dir = path.dirname(exportPath);
    fs.mkdirSync(dir, { recursive: true });

    const summary = buildSummaryJson(usage, username, latest.gitBranch || 'unknown');
    fs.writeFileSync(exportPath, JSON.stringify(summary, null, 2) + '\n');
  } catch {
    // Async hook — never block or pollute context
  }
}

module.exports = { run, buildSummaryJson, getExportPath };
