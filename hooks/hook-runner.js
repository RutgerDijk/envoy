#!/usr/bin/env node
/**
 * Profile-aware hook runner for Envoy.
 *
 * Reads ENVOY_HOOK_PROFILE (minimal|standard|strict) and
 * ENVOY_DISABLED_HOOKS to decide which hooks to execute.
 *
 * Usage: node hook-runner.js <hook-name> [stdin-data]
 *
 * Hook profiles:
 *   minimal  — config-protection only
 *   standard — all hooks (default)
 *   strict   — all hooks + additional verification gates
 */

const { execSync } = require('child_process');
const path = require('path');

/**
 * Hook profile membership.
 * Each hook name maps to the profiles it belongs to.
 */
const HOOK_PROFILES = {
  'session-start':          ['minimal', 'standard', 'strict'],
  'config-protection':      ['minimal', 'standard', 'strict'],
  'issue-create-guard':     ['minimal', 'standard', 'strict'],
  'pre-compact':            ['minimal', 'standard', 'strict'],
  'post-edit-accumulator':  ['standard', 'strict'],
  'stop-batch-lint':        ['standard', 'strict'],
  'learning-extractor':     ['standard', 'strict'],
  'post-pr-poll':           ['standard', 'strict'],
  'coderabbit-aggregator':  ['standard', 'strict'],
  'correction-detector':    ['standard', 'strict'],
  'cost-summary-export':    ['standard', 'strict'],
};

/**
 * Check if a hook should run in the current profile.
 * @param {string} hookName - Name of the hook
 * @returns {boolean}
 */
function shouldRun(hookName) {
  const profile = (process.env.ENVOY_HOOK_PROFILE || 'standard').toLowerCase();
  const disabledList = (process.env.ENVOY_DISABLED_HOOKS || '')
    .split(',')
    .map(h => h.trim())
    .filter(Boolean);

  // Explicitly disabled hooks never run
  if (disabledList.includes(hookName)) return false;

  // If hook has no profile annotation, it runs in all profiles
  const allowedProfiles = HOOK_PROFILES[hookName];
  if (!allowedProfiles) return true;

  return allowedProfiles.includes(profile);
}

/**
 * Get the current profile name.
 * @returns {string}
 */
function getProfile() {
  return (process.env.ENVOY_HOOK_PROFILE || 'standard').toLowerCase();
}

// CLI mode: check profile and run hook
if (require.main === module) {
  const hookName = process.argv[2];

  if (!hookName) {
    console.error('Usage: node hook-runner.js <hook-name>');
    process.exit(1);
  }

  if (!shouldRun(hookName)) {
    // Hook skipped due to profile — exit cleanly
    process.exit(0);
  }

  // Hook is allowed — delegate to the actual hook script
  const hookPath = path.join(__dirname, `${hookName}.js`);
  try {
    const hook = require(hookPath);
    if (typeof hook.run === 'function') {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { data += chunk; });
      process.stdin.on('end', () => {
        const code = hook.run(data);
        process.exit(typeof code === 'number' ? code : 0);
      });
    }
  } catch (err) {
    console.error(`Hook ${hookName} failed: ${err.message}`);
    process.exit(0); // Don't block on hook failures
  }
}

module.exports = { shouldRun, getProfile, HOOK_PROFILES };
