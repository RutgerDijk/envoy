#!/usr/bin/env node
'use strict';

/**
 * Doctor preflight.
 *
 * Gates entry into the doctor skill and prints the read-only hygiene report:
 *   - not inside a git repo                              -> fatal
 *   - --fix requested (ENVOY_DOCTOR_FIX=1) on a dirty
 *     worktree                                            -> fatal
 *   - otherwise                                           -> ok
 *
 * Report-only runs (no --fix) work regardless of worktree cleanliness —
 * doctor's default mode never mutates anything, so a dirty worktree is not
 * a blocker for it.
 *
 * --fix flag: the inline `!` Briefing substitution takes no CLI args, so
 * flags reach preflight via an env-var seam, matching the convention pickup
 * uses for ENVOY_ISSUE_NUMBER — set ENVOY_DOCTOR_FIX=1 in the environment
 * before invoking `/envoy:doctor --fix`.
 *
 * Test seams (never used outside tests):
 *   - ENVOY_GH_ISSUE_STATE_FILE points at a JSON file of
 *     { "<issueNumber>": "OPEN"|"CLOSED", ... } instead of shelling out to
 *     `gh issue view <n> --json state`.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CWD = process.cwd();
const REPO_ROOT = process.env.ENVOY_REPO_ROOT || path.resolve(__dirname, '..', '..');
const {
  findTrackedEnvoyFiles,
  checkGitignoreEntries,
  parseIssueNumberFromTaskFile,
  planFix,
} = require(path.join(REPO_ROOT, 'lib', 'repo-hygiene'));
const { appendEvent } = require(path.join(REPO_ROOT, 'lib', 'ledger'));

function say(line) { process.stdout.write(`${line}\n`); }
function banner(tier) { say(`## STATUS: ${tier}`); }

function isGitRepo(cwd) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch (_err) {
    return false;
  }
}

function isDirty(cwd) {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length > 0;
  } catch (_err) {
    return false;
  }
}

// Issue state ('OPEN'/'CLOSED') for a given issue number, or null when
// unavailable (no gh, no such issue, network failure, etc.)
function fetchIssueState(issueNumber) {
  const override = process.env.ENVOY_GH_ISSUE_STATE_FILE;
  if (override) {
    try {
      const map = JSON.parse(fs.readFileSync(override, 'utf8'));
      return map[String(issueNumber)] || null;
    } catch (_err) {
      return null;
    }
  }
  try {
    const out = execFileSync('gh', ['issue', 'view', String(issueNumber), '--json', 'state', '-q', '.state'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || null;
  } catch (_err) {
    return null;
  }
}

function main() {
  if (!isGitRepo(CWD)) {
    banner('fatal');
    say('');
    say('Not inside a git repo — doctor needs a git working tree to check tracked files and .gitignore.');
    return;
  }

  const fixRequested = process.env.ENVOY_DOCTOR_FIX === '1';

  // Check dirtiness BEFORE appendEvent — appendEvent creates/touches
  // .envoy/ledger.jsonl, which would itself make the worktree look dirty on
  // a repo that doesn't already track/ignore .envoy/.
  if (fixRequested && isDirty(CWD)) {
    banner('fatal');
    say('');
    say('Worktree has uncommitted changes — --fix refuses to run on a dirty worktree.');
    say('Commit or stash your changes, then re-run /envoy:doctor --fix.');
    return;
  }

  appendEvent(CWD, { type: 'skill-started', skill: 'doctor' });

  const trackedFiles = findTrackedEnvoyFiles(CWD);
  const gitignoreGaps = checkGitignoreEntries(CWD);
  const plan = planFix(trackedFiles, gitignoreGaps);

  banner('ok');
  say('');
  say(`Tracked Envoy runtime-state files: ${trackedFiles.length}`);
  for (const f of trackedFiles) {
    const issueNumber = parseIssueNumberFromTaskFile(f);
    let issueNote = '';
    if (issueNumber !== null) {
      const state = fetchIssueState(issueNumber);
      issueNote = state ? ` (issue #${issueNumber}: ${state})` : ` (issue #${issueNumber}: unknown)`;
    }
    say(`  - ${f}${issueNote}`);
  }
  if (gitignoreGaps.length > 0) {
    say('');
    say(`Missing .gitignore entries: ${gitignoreGaps.join(', ')}`);
  } else {
    say('');
    say('.gitignore already has the required Envoy runtime-state entries.');
  }

  say('');
  if (fixRequested) {
    say(`--fix plan: git rm --cached -r for ${plan.rmCached.length} file(s), append ${plan.gitignoreAppend.length} .gitignore entr${plan.gitignoreAppend.length === 1 ? 'y' : 'ies'}.`);
  }
  say('Next: read skills/doctor/SKILL.md.');
}

main();
