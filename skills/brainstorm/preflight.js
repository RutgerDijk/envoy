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
 * Existing-issue mode (`/envoy:brainstorm #82`, dispatched by /envoy:start for
 * an open issue without a plan): the first argument token `#<n>` or `<n>`
 * selects it. Then:
 *   - issue missing / `gh issue view` fails                  -> fatal
 *   - issue closed                                           -> fatal
 *   - issue already carries an envoy tasks block (has a plan) -> fatal
 *     (re-planning would append a second machine block; the
 *     remediation is /envoy:pickup <n>, so there is nothing to
 *     degrade into)
 *   - otherwise prints `MODE: existing-issue #<n>` + an `## Existing issue`
 *     section, skips the duplicate-title check, and writes
 *     .envoy/brainstorm/session.json {issueNumber, mode} so the
 *     issue-create-guard hard-blocks any `gh issue create` this run.
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
 *   - ENVOY_BRAINSTORM_ISSUE supplies the issue ref when no argv is given
 *     (the eval harness passes env only).
 *   - ENVOY_GH_ISSUE_VIEW_FILE points at a JSON file standing in for
 *     `gh issue view <n> --json number,title,body,state,labels`; a missing
 *     or unreadable file means the issue was not found.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CWD = process.cwd();
const REPO_ROOT = process.env.ENVOY_REPO_ROOT || path.resolve(__dirname, '..', '..');
const { appendEvent } = require(path.join(REPO_ROOT, 'lib', 'ledger'));
const { BEGIN: TASKS_BEGIN } = require(path.join(REPO_ROOT, 'lib', 'tasks-embed'));

const BODY_EXCERPT_MAX = 1200;

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

// The skill forwards "$ARGUMENTS" as ONE quoted string (an unquoted `#82`
// would be a shell comment), so split it into tokens here (#89). Only a
// leading `#<n>` / `<n>` token selects existing-issue mode; anything else
// (a topic, nothing) keeps the normal new-issue flow.
function resolveIssueRef(argv) {
  const tokens = argv.flatMap((a) => String(a).split(/\s+/)).filter(Boolean);
  const first = tokens.length ? tokens[0] : (process.env.ENVOY_BRAINSTORM_ISSUE || '').trim();
  const m = /^#?([1-9]\d*)$/.exec(first || '');
  return m ? Number(m[1]) : null;
}

// Issue object from `gh issue view`, or null when missing / unavailable.
function fetchIssue(n) {
  const override = process.env.ENVOY_GH_ISSUE_VIEW_FILE;
  if (override) {
    try {
      return JSON.parse(fs.readFileSync(override, 'utf8'));
    } catch (_err) {
      return null;
    }
  }
  try {
    const out = execFileSync('gh', ['issue', 'view', String(n), '--json', 'number,title,body,state,labels'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(out);
  } catch (_err) {
    return null;
  }
}

function excerpt(body) {
  const text = String(body || '').trim();
  if (!text) return '(empty body)';
  return text.length > BODY_EXCERPT_MAX ? `${text.slice(0, BODY_EXCERPT_MAX)}\n…(truncated)` : text;
}

// Existing-issue mode. Returns after printing the full briefing.
function runExistingIssue(n, warnings) {
  const issue = fetchIssue(n);
  if (!issue || typeof issue !== 'object') {
    banner('fatal');
    say(`Issue #${n} not found — \`gh issue view ${n}\` failed.`);
    say('');
    say('Remediation: check the issue number, or run /envoy:brainstorm without an argument to design a new issue.');
    return;
  }
  if (String(issue.state || '').toUpperCase() !== 'OPEN') {
    banner('fatal');
    say(`Issue #${n} is ${String(issue.state || 'not open').toLowerCase()} — brainstorm only plans open issues.`);
    say('');
    say(`Remediation: reopen #${n} first, or run /envoy:brainstorm without an argument to design a new issue.`);
    return;
  }
  if (String(issue.body || '').includes(TASKS_BEGIN)) {
    banner('fatal');
    say(`Issue #${n} already carries an envoy tasks block — it already has a plan.`);
    say('');
    say(`Remediation: run /envoy:pickup ${n} to implement it. To re-plan, remove the existing machine-readable task block from the issue first.`);
    return;
  }

  // Arm the issue-create-guard: any `gh issue create` this run is a duplicate.
  const stateDir = path.join(CWD, '.envoy', 'brainstorm');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'session.json'), JSON.stringify({
    $schemaVersion: '1',
    issueNumber: n,
    mode: 'existing-issue',
    createdAt: new Date().toISOString(),
  }, null, 2));

  banner(warnings.length > 0 ? strictPromote('degraded') : 'ok');
  say('');
  say(`MODE: existing-issue #${n}`);
  for (const w of warnings) say(w);
  say('');
  say('## Existing issue');
  say('');
  say(`- Number: #${n}`);
  say(`- Title: ${issue.title || '(untitled)'}`);
  const labels = (issue.labels || []).map((l) => (l && l.name) || l).filter(Boolean);
  if (labels.length) say(`- Labels: ${labels.join(', ')}`);
  say('');
  say(excerpt(issue.body));
  say('');
  say(`Next: read skills/brainstorm/SKILL.md and follow "Existing-issue mode" — plan #${n}; Phase 4 edits it, never creates a new issue.`);
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

  const issueRef = resolveIssueRef(process.argv.slice(2));
  if (issueRef !== null) {
    runExistingIssue(issueRef, warnings);
    return;
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
