#!/usr/bin/env node
'use strict';

/**
 * Brainstorm preflight.
 *
 * Gates entry into the brainstorm skill:
 *   - `gh auth status` failure                              -> fatal
 *   - leftover .envoy/brainstorm/ state from a prior run     -> degraded
 *   - an open issue with a similar title to the topic being
 *     brainstormed (when a topic is determinable)            -> degraded
 *
 * Test seams (never used outside tests):
 *   - ENVOY_GH_AUTH_STATUS_FAKE = 'ok' | 'fail' bypasses the real `gh auth
 *     status` call.
 *   - ENVOY_GH_ISSUE_LIST_FILE points at a JSON file of
 *     [{ number, title }, ...] instead of shelling out to `gh issue list`.
 *   - ENVOY_BRAINSTORM_TOPIC supplies the topic when the caller already
 *     knows it (e.g. `/envoy:brainstorm <topic>`); brainstorm usually has no
 *     topic yet at preflight time, in which case the dup-title check is
 *     skipped entirely — that's expected, not a failure.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CWD = process.cwd();
const REPO_ROOT = process.env.ENVOY_REPO_ROOT || path.resolve(__dirname, '..', '..');
const { appendEvent } = require(path.join(REPO_ROOT, 'lib', 'ledger'));

function say(line) { process.stdout.write(`${line}\n`); }
function banner(tier) { say(`## STATUS: ${tier}`); }

function strictPromote(tier) {
  if (tier === 'degraded' && process.env.ENVOY_HOOK_PROFILE === 'strict') return 'fatal';
  return tier;
}

// Returns true when `gh auth status` succeeds (authenticated).
function ghAuthOk() {
  const fake = process.env.ENVOY_GH_AUTH_STATUS_FAKE;
  if (fake) return fake === 'ok';
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' });
    return true;
  } catch (_err) {
    return false;
  }
}

// List of { number, title } for open issues, or null when unavailable.
function fetchOpenIssues() {
  const override = process.env.ENVOY_GH_ISSUE_LIST_FILE;
  if (override) {
    try {
      return JSON.parse(fs.readFileSync(override, 'utf8'));
    } catch (_err) {
      return null;
    }
  }
  try {
    const out = execFileSync('gh', ['issue', 'list', '--state', 'open', '--json', 'number,title'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(out);
  } catch (_err) {
    return null;
  }
}

// Simple fuzzy match: normalize + token overlap. Not meant to be clever —
// just enough to catch "same idea, different phrasing" duplicates.
function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function similarTitle(topic, title) {
  const a = new Set(normalize(topic));
  const b = new Set(normalize(title));
  if (a.size === 0 || b.size === 0) return false;
  let overlap = 0;
  for (const tok of a) if (b.has(tok)) overlap++;
  const ratio = overlap / Math.min(a.size, b.size);
  return ratio >= 0.6;
}

function findSimilarIssue(topic) {
  if (!topic) return null;
  const issues = fetchOpenIssues();
  if (!issues) return null;
  for (const issue of issues) {
    if (similarTitle(topic, issue.title || '')) return issue;
  }
  return null;
}

function main() {
  appendEvent(CWD, { type: 'skill-started', skill: 'brainstorm' });

  if (!ghAuthOk()) {
    banner(strictPromote('fatal'));
    say('`gh auth status` failed — brainstorm needs an authenticated gh CLI to create the design issue.');
    say('');
    say('Remediation: run `gh auth login`, then re-invoke /envoy:brainstorm.');
    return;
  }

  const warnings = [];

  const stateDir = path.join(CWD, '.envoy', 'brainstorm');
  if (fs.existsSync(stateDir)) {
    warnings.push('Leftover .envoy/brainstorm/ state from a prior run was found — resume that session, or delete .envoy/brainstorm/ to start fresh.');
  }

  const topic = process.env.ENVOY_BRAINSTORM_TOPIC || '';
  let noTopicNote = null;
  if (topic) {
    const similar = findSimilarIssue(topic);
    if (similar) {
      warnings.push(`An open issue with a similar title already exists: #${similar.number} "${similar.title}" — confirm this isn't a duplicate before brainstorming a new one.`);
    }
  } else {
    noTopicNote = '(No topic determinable yet at preflight time — skipping the duplicate-issue check; re-check once the topic is known.)';
  }

  if (warnings.length > 0) {
    banner(strictPromote('degraded'));
    say('');
    for (const w of warnings) say(w);
    if (noTopicNote) say(noTopicNote);
    say('');
    say('Next: read skills/brainstorm/SKILL.md and proceed with Phase 1.');
    return;
  }

  banner('ok');
  say('');
  if (noTopicNote) say(noTopicNote);
  say('Next: read skills/brainstorm/SKILL.md and proceed with Phase 1.');
}

main();
