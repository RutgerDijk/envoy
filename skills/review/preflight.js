#!/usr/bin/env node
'use strict';

/**
 * Review preflight.
 *
 * Reads .envoy/pickup/handoff-to-review.json, validates it, verifies
 * that the baseSha/headSha exist in the current repo (degraded if not),
 * writes .envoy/active-skill.json, then prints a briefing.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CWD = process.cwd();
const REPO_ROOT = process.env.ENVOY_REPO_ROOT || path.resolve(__dirname, '..', '..');
const { validateFile } = require(path.join(REPO_ROOT, 'lib', 'validate-schema'));
const { appendEvent } = require(path.join(REPO_ROOT, 'lib', 'ledger'));
const { detectStacksFromDiff, anyFrontendStack } = require(path.join(REPO_ROOT, 'lib', 'stack-loader'));

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

// ### Known patterns — confirmed review/CodeRabbit patterns plus team
// corrections from lib/learning-loader.js, rendered by formatReminders().
// Fail-soft: any loader error is reported inside the section and never
// touches the STATUS banner. The loader swallows parse errors, so a file
// that exists but cannot be read (or carries an unparseable DATA block) is
// detected here and named explicitly.
function printKnownPatterns(stackNames) {
  say('### Known patterns');
  say('');
  const unreadable = [];
  let reminders = '';
  try {
    const loader = require(path.join(REPO_ROOT, 'lib', 'learning-loader'));
    const readable = (full) => {
      if (!fs.existsSync(full)) return null;
      try { return fs.readFileSync(full, 'utf8'); } catch { return false; }
    };
    for (const rel of ['memory/review-learnings.md', 'memory/coderabbit-patterns.md']) {
      const content = readable(path.join(CWD, rel));
      if (content === false || (content && /<!--\s*DATA:/.test(content) && loader.loadDataFromFile(path.join(CWD, rel)) === null)) {
        unreadable.push(rel);
      }
    }
    const userCorrections = path.join(process.env.HOME || process.env.USERPROFILE || '~', '.claude', 'learnings', 'corrections.md');
    if (readable(path.join(CWD, 'memory', 'corrections.md')) === false) unreadable.push('memory/corrections.md');
    if (readable(userCorrections) === false) unreadable.push('~/.claude/learnings/corrections.md');

    let patterns = [];
    let corrections = [];
    try { patterns = loader.loadConfirmedPatterns(stackNames); } catch { unreadable.push('confirmed patterns (loader error)'); }
    try { corrections = loader.loadCorrections(CWD); } catch { unreadable.push('team corrections (loader error)'); }
    reminders = loader.formatReminders(patterns, corrections);
  } catch {
    unreadable.push('lib/learning-loader.js (loader error)');
  }
  if (reminders) say(reminders);
  for (const f of [...new Set(unreadable)]) {
    say(`Learnings could not be read from ${f} (corrupt or unreadable) — skipped.`);
  }
  if (!reminders && unreadable.length === 0) say('(none recorded)');
}

function isGitRepo() {
  try {
    execSync('git rev-parse --git-dir', { cwd: CWD, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function gitHasSha(sha) {
  try {
    execSync(`git cat-file -e ${sha}`, { cwd: CWD, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function main() {
  const handoffPath = path.join(CWD, '.envoy', 'pickup', 'handoff-to-review.json');

  if (!fs.existsSync(handoffPath)) {
    banner('fatal');
    say('pickup handoff not found at .envoy/pickup/handoff-to-review.json');
    say('');
    say('Remediation: run /envoy:pickup to completion first — it writes the handoff on Step 14.');
    return;
  }

  const result = validateFile('handoff-pickup-to-review', handoffPath);
  if (!result.valid) {
    banner('fatal');
    say('pickup handoff schema validation failed:');
    for (const e of result.errors) say(`  - ${e}`);
    return;
  }

  const handoff = JSON.parse(fs.readFileSync(handoffPath, 'utf8'));
  const warnings = [];
  if (!Array.isArray(handoff.tasksCompleted) || handoff.tasksCompleted.length === 0) {
    warnings.push('tasksCompleted is empty — no task-level diffs will be reviewed');
  }
  if (isGitRepo()) {
    if (!gitHasSha(handoff.baseSha)) warnings.push(`baseSha ${handoff.baseSha} not found in current repo`);
    if (!gitHasSha(handoff.headSha)) warnings.push(`headSha ${handoff.headSha} not found in current repo`);
  }

  // Frontend detection (Task 13): if the diff touches any frontend-stack
  // file (react, tailwind, shadcn-radix, react-query, react-hook-form),
  // Layer 2 (visual) is required regardless of complexity tier. Best-effort
  // — a detection failure must never block review, so this stays fail-soft.
  let frontendDetected = false;
  let detectedStacks = [];
  try {
    detectedStacks = detectStacksFromDiff(handoff.baseSha, CWD);
    frontendDetected = anyFrontendStack(detectedStacks);
  } catch {
    frontendDetected = false;
  }

  writeJson('.envoy/active-skill.json', {
    $schemaVersion: '1',
    skill: 'review',
    issueNumber: handoff.issueNumber,
    branch: handoff.branch,
    startedAt: nowIso(),
    pid: process.pid,
    frontendDetected,
    detectedStacks,
  });
  appendEvent(CWD, { type: 'skill-started', skill: 'review', issue: handoff.issueNumber });

  if (warnings.length > 0) {
    const tier = strictPromote('degraded');
    banner(tier);
    say('');
    say('## DEGRADED:');
    for (const w of warnings) say(`  - ${w}`);
    say('');
    say('Proceeding, but the diff walk may be incomplete. If strict mode is needed, rerun pickup to refresh the handoff.');
    // Degraded review still proceeds, so the reviewer still needs the
    // learned patterns; a strict-promoted fatal stops here instead.
    if (tier !== 'fatal') {
      say('');
      printKnownPatterns(detectedStacks);
      say('');
      say('Give the Layer 1 reviewer this section verbatim as its **Known patterns** block (see layers/ai-review.md).');
    }
    return;
  }

  banner('ok');
  const n = handoff.tasksCompleted.length;
  say('');
  say(`Reviewing branch ${handoff.branch} — ${n} task${n === 1 ? '' : 's'} to verify`);
  say(`Issue: #${handoff.issueNumber}`);
  say(`Diff range: ${handoff.baseSha}..${handoff.headSha}`);
  if (handoff.stackProfiles && handoff.stackProfiles.length) {
    say(`Stack profiles: ${handoff.stackProfiles.join(', ')}`);
  }
  if (frontendDetected) {
    say('');
    say(`Frontend stack detected in diff (${detectedStacks.filter((s) => ['react', 'shadcn-radix', 'react-query', 'react-hook-form', 'tailwind'].includes(s)).join(', ')}) — Layer 2 (visual) is REQUIRED regardless of complexity tier.`);
  }
  say('');
  printKnownPatterns(detectedStacks);
  say('');
  say('Give the Layer 1 reviewer this section verbatim as its **Known patterns** block (see layers/ai-review.md).');
  say('');
  say('Next: run pre-review setup from skills/review/SKILL.md, then proceed layer by layer (layers/lint.md, layers/cleanup.md, …).');
}

main();
