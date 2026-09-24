#!/usr/bin/env node
'use strict';

/**
 * Pickup preflight.
 *
 * Reads .envoy-tasks/<issue>.json, validates it against the tasks schema,
 * writes .envoy/pickup/session.json (seeded from the tasks list) and
 * .envoy/active-skill.json, then prints a briefing.
 *
 * Emits `## STATUS: ok|fatal` as the first content line so the
 * eval harness (and Claude reading the inline `!` substitution) can parse
 * the outcome.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CWD = process.cwd();
const REPO_ROOT = process.env.ENVOY_REPO_ROOT || path.resolve(__dirname, '..', '..');
const { validateFile } = require(path.join(REPO_ROOT, 'lib', 'validate-schema'));
const { extractEmbeddedBlock, ensureTasksDirIgnored } = require(path.join(REPO_ROOT, 'lib', 'tasks-embed'));
const { writeActiveSkill } = require(path.join(REPO_ROOT, 'lib', 'active-skill'));
const { appendEvent } = require(path.join(REPO_ROOT, 'lib', 'ledger'));
const { resolveTestCommands } = require(path.join(REPO_ROOT, 'lib', 'test-commands'));
const { detectStacksCached } = require(path.join(REPO_ROOT, 'lib', 'stack-loader'));

// Best-effort fetch of an issue body via gh. Returns the body string, or null
// when gh is unavailable or the call fails — callers must tolerate null.
// ENVOY_ISSUE_BODY_FILE overrides the source (test seam): read that file
// instead of calling gh; unreadable ⇒ null.
function fetchIssueBody(issueNumber) {
  const override = process.env.ENVOY_ISSUE_BODY_FILE;
  if (override) {
    try {
      return fs.readFileSync(override, 'utf8');
    } catch (_err) {
      return null;
    }
  }
  try {
    return execFileSync('gh', ['issue', 'view', String(issueNumber), '--json', 'body', '-q', '.body'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_err) {
    return null;
  }
}

// Recover the tasks payload embedded in the issue body, or null.
function payloadFromIssue(issueNumber) {
  const body = fetchIssueBody(issueNumber);
  return body ? extractEmbeddedBlock(body) : null;
}

function say(line) { process.stdout.write(`${line}\n`); }
function banner(tier) { say(`## STATUS: ${tier}`); }

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

// ### Complexity — per-task tier from lib/context-budget.js classifyComplexity,
// with signals (files count, behavior count, backend/frontend crossing)
// derived by signalsFromTask. The model tier is advisory text for the
// orchestrator; it never selects the Agent model automatically. Fail-soft:
// the module is required inside the try so a load or classification error
// prints a note and never touches the STATUS banner.
function printComplexity(taskList) {
  say('### Complexity');
  say('');
  try {
    const budget = require(path.join(REPO_ROOT, 'lib', 'context-budget'));
    const rows = taskList.map((t) => {
      const tier = budget.classifyComplexity(budget.signalsFromTask(t));
      return `| ${t.id} | ${tier.label} | ${tier.modelTier} |`;
    });
    say('| Task | Tier | Model tier |');
    say('|------|------|------------|');
    for (const r of rows) say(r);
    say('');
    say('Model tier is advisory. Pass each task\'s tier as --tier to `lib/context-budget.js build` when assembling its implementer prompt (see prompts.md).');
  } catch (err) {
    say(`Tasks could not be classified (${err && err.message ? err.message : 'unknown error'}) — build implementer prompts with --tier standard.`);
  }
}

// ### Scratchpad — under strategy parallel, several implementers write at
// once. Step 13 creates .envoy-scratchpad.json (lib/agent-scratchpad.js)
// with one agent per task scoped to that task's files. registerAgent does
// not detect overlaps, so pad creation checks each task's files against the
// agents registered before it and posts a 'conflict' message per overlap —
// that is what getConflicts reports. A scope matches a file exactly, or as a
// directory containing it (never by bare name prefix: a.js ≠ a.jsx).
function normPath(p) { return String(p).replace(/\\/g, '/').replace(/^\.\//, ''); }

function scopesOverlap(a, b) {
  const x = normPath(a);
  const y = normPath(b);
  if (x === y) return true;
  const under = (f, d) => f.startsWith(d.endsWith('/') ? d : `${d}/`);
  return under(x, y) || under(y, x);
}

function buildScratchpad(taskList) {
  const sp = require(path.join(REPO_ROOT, 'lib', 'agent-scratchpad'));
  const pad = sp.createEmpty();
  for (const t of taskList) {
    const files = Array.isArray(t.files) ? t.files.map(String) : [];
    for (const [otherId, info] of Object.entries(pad.agents)) {
      for (const f of files) {
        const hit = info.scope.find((s) => scopesOverlap(f, s));
        if (hit === undefined) continue;
        const via = normPath(hit) === normPath(f) ? '' : ` (via ${hit})`;
        sp.post(pad, t.id, 'conflict', `${otherId} and ${t.id} both touch ${f}${via} — run these tasks as batch, not parallel`, [f]);
      }
    }
    sp.registerAgent(pad, t.id, t.title, files);
  }
  return { sp, pad };
}

// Briefing-time view: computed in memory, never written to disk.
function printScratchpad(tasks) {
  if (tasks.strategy !== 'parallel') return;
  say('### Scratchpad');
  say('');
  try {
    const { sp, pad } = buildScratchpad(tasks.tasks || []);
    const conflicts = sp.getConflicts(pad);
    say('Strategy parallel — Step 13 creates .envoy-scratchpad.json first (`node ${CLAUDE_SKILL_DIR}/preflight.js --init-scratchpad`), one agent per task scoped to its files.');
    if (conflicts.length === 0) {
      say('No file overlaps between tasks — all can run in parallel.');
    } else {
      say('Conflicts (tasks sharing a file — Step 12 must run these tasks as batch, not parallel):');
      for (const c of conflicts) say(`- ${c.message.replace(/ — run these tasks as batch, not parallel$/, '')}`);
    }
  } catch (err) {
    say(`Scratchpad conflicts could not be computed (${err && err.message ? err.message : 'unknown error'}) — treat file boundaries as uncertain and prefer batch.`);
  }
  say('');
}

// Load + validate the tasks file for the scratchpad CLI modes. Throws with a
// human-readable reason; never writes session state.
function loadTasksOrThrow() {
  const issueNumber = process.env.ENVOY_ISSUE_NUMBER;
  if (!issueNumber) throw new Error('no ENVOY_ISSUE_NUMBER in environment');
  const tasksFile = path.join(CWD, '.envoy-tasks', `${issueNumber}.json`);
  if (!fs.existsSync(tasksFile)) throw new Error(`tasks file not found at .envoy-tasks/${issueNumber}.json`);
  const result = validateFile('tasks', tasksFile);
  if (!result.valid) throw new Error(`tasks file schema validation failed: ${result.errors.join('; ')}`);
  return JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
}

// `--init-scratchpad` — Step 13 under parallel: write the pad in the cwd
// (worktree root). Sequential/batch: create nothing.
function initScratchpad() {
  let tasks;
  try {
    tasks = loadTasksOrThrow();
  } catch (err) {
    say(`Scratchpad not created: ${err.message}.`);
    return 1;
  }
  if (tasks.strategy !== 'parallel') {
    say(`No scratchpad: strategy is ${tasks.strategy || '(not specified)'} — only parallel uses one.`);
    return 0;
  }
  try {
    const { sp, pad } = buildScratchpad(tasks.tasks || []);
    sp.save(pad, CWD);
    const conflicts = sp.getConflicts(pad);
    say(`Scratchpad created: ${sp.SCRATCHPAD_FILE} (${Object.keys(pad.agents).length} agents, ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}).`);
    for (const c of conflicts) say(`- ${c.message}`);
    return 0;
  } catch (err) {
    say(`Scratchpad not created: ${err && err.message ? err.message : 'unknown error'}.`);
    return 1;
  }
}

// `--scratchpad-briefing <task-id>` — prints formatBriefing(pad, taskId) for
// the implementer prompt's scratchpad section. The id must be a registered
// agent, so a file-sourced value never reaches anything but a key lookup.
function scratchpadBriefing(agentId) {
  const sp = require(path.join(REPO_ROOT, 'lib', 'agent-scratchpad'));
  if (!fs.existsSync(path.join(CWD, sp.SCRATCHPAD_FILE))) {
    process.stderr.write(`No scratchpad at ${sp.SCRATCHPAD_FILE} — run --init-scratchpad first (parallel strategy only).\n`);
    return 1;
  }
  const pad = sp.load(CWD);
  if (!agentId || !pad.agents || !Object.prototype.hasOwnProperty.call(pad.agents, agentId)) {
    process.stderr.write(`Unknown scratchpad agent id: ${JSON.stringify(agentId || '')} — pass a registered task id.\n`);
    return 1;
  }
  const brief = sp.formatBriefing(pad, agentId);
  if (brief) say(brief);
  return 0;
}

function main() {
  const issueNumber = process.env.ENVOY_ISSUE_NUMBER;

  if (!issueNumber) {
    banner('fatal');
    say('No ENVOY_ISSUE_NUMBER in environment.');
    say('Set it before invoking pickup (usually handled by the slash command).');
    return;
  }

  const tasksFile = path.join(CWD, '.envoy-tasks', `${issueNumber}.json`);
  let materialized = false;

  if (!fs.existsSync(tasksFile)) {
    // The issue's embedded machine block is the durable task source —
    // materialize the local file from it.
    const recovered = payloadFromIssue(issueNumber);
    if (recovered) {
      recovered.issueNumber = Number(issueNumber);
      writeJson(path.join('.envoy-tasks', `${issueNumber}.json`), recovered);
      ensureTasksDirIgnored(CWD);
      materialized = true;
    } else {
      banner('fatal');
      say(`tasks file not found at .envoy-tasks/${issueNumber}.json`);
      say('');
      say('Remediation:');
      say(`  1. Run /envoy:brainstorm for issue #${issueNumber} to produce the task list, OR`);
      say(`  2. Write .envoy-tasks/${issueNumber}.json manually conforming to lib/schemas/tasks.json`);
      return;
    }
  }

  const result = validateFile('tasks', tasksFile);
  if (!result.valid) {
    banner('fatal');
    say(`tasks file schema validation failed: ${tasksFile}`);
    for (const e of result.errors) say(`  - ${e}`);
    say('');
    say('Regenerate via /envoy:brainstorm or fix the file to match lib/schemas/tasks.json.');
    return;
  }

  const tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));

  // Non-fatal drift check: if the local file and the issue's embedded block
  // disagree on the task set, the issue was likely edited after the file
  // was materialized.
  let driftWarning = null;
  if (!materialized) {
    const issuePayload = payloadFromIssue(issueNumber);
    if (issuePayload) {
      const key = (p) => JSON.stringify((p.tasks || []).map((t) => [t.id, t.title]));
      if (key(issuePayload) !== key(tasks)) {
        driftWarning = 'local .envoy-tasks file differs from the issue\'s embedded task block (issue edited after it was materialized?)';
      }
    }
  }

  // Seed session.json
  const session = {
    $schemaVersion: '1',
    branch: 'unknown',
    plan: `issue #${issueNumber}`,
    issueNumber: Number(issueNumber),
    startedAt: nowIso(),
    updatedAt: nowIso(),
    tasks: (tasks.tasks || []).map(t => ({
      id: t.id,
      name: t.title,
      status: 'pending',
    })),
    decisions: [],
    nextSteps: [],
  };
  writeJson('.envoy/pickup/session.json', session);
  writeActiveSkill(CWD, { skill: 'pickup', issueNumber: issueNumber ? Number(issueNumber) : undefined });
  appendEvent(CWD, { type: 'skill-started', skill: 'pickup', issue: Number(issueNumber) });

  banner('ok');
  say('');
  if (materialized) {
    say('Tasks materialized from the issue\'s embedded block.');
    say('');
  }
  if (driftWarning) {
    say(`WARNING: ${driftWarning}`);
    say('');
  }
  say(`Issue #${issueNumber} — ${tasks.tasks.length} task${tasks.tasks.length === 1 ? '' : 's'} loaded`);
  say(`Strategy: ${tasks.strategy || '(not specified — will be chosen during Step 12)'}`);
  say('');
  say('Tasks:');
  for (const t of tasks.tasks) say(`  - ${t.id}: ${t.title}`);
  say('');
  printComplexity(tasks.tasks);
  say('');
  printScratchpad(tasks);
  say('### Test Command');
  say('');
  const testCommands = resolveTestCommands(CWD);
  // A rejected template is a security event, not a detail: the command was
  // dropped because it carried shell metacharacters outside the {{test}}
  // placeholder, and it would otherwise be executed verbatim downstream.
  for (const w of testCommands.warnings || []) say(`WARNING: ${w}`);
  if (testCommands.filtered) {
    if (testCommands.commands.length > 1) {
      // .filtered/.full mirror commands[0] only — silently using that alone
      // would hand the implementer a picked-at-random stack's command on a
      // multi-stack repo with no indication another stack exists.
      say(`Multiple stacks resolved a Test Command — reporting all ${testCommands.commands.length}:`);
      for (const c of testCommands.commands) {
        say(`  - ${c.stack} (source: ${c.source}): ${c.filtered}${c.full ? ` (full: ${c.full})` : ''}`);
      }
      say(`Primary (source: ${testCommands.source}): ${testCommands.filtered}`);
    } else {
      say(`Resolved (source: ${testCommands.source}): ${testCommands.filtered}`);
      if (testCommands.full) say(`Full suite: ${testCommands.full}`);
    }
    say('Give the implementer agent this filtered command as ${RESOLVED_TEST_COMMAND} (see prompts.md).');
  } else {
    say('No test command could be resolved for this repo (no CLAUDE.md or stack profile Test Command section).');
    say('Do NOT default to a full-suite command. Instruct the implementer agent to determine and report the narrowest test command itself.');
  }
  say('');
  // Stack filter for the patterns — best-effort: a detection error means
  // "no filter" (all confirmed patterns), never a failed preflight.
  let stacks = [];
  try { stacks = detectStacksCached(CWD); } catch { stacks = []; }
  printKnownPatterns(stacks);
  say('');
  say('Give the implementer agent this section verbatim as its **Known patterns (avoid these):** block (see prompts.md).');
  say('');
  say('Next: read skills/pickup/steps/worktree.md and proceed with Step 1.');
}

const argv = process.argv.slice(2);
if (argv[0] === '--init-scratchpad') {
  process.exitCode = initScratchpad();
} else if (argv[0] === '--scratchpad-briefing') {
  process.exitCode = scratchpadBriefing(argv[1]);
} else {
  main();
}
