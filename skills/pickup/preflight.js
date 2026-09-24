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
const { validate, validateFile } = require(path.join(REPO_ROOT, 'lib', 'validate-schema'));
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

// ### Scratchpad — when Step 12 chooses parallel, several implementers write
// at once. Step 13 creates .envoy-scratchpad.json (lib/agent-scratchpad.js)
// with one agent per parallel task scoped to that task's files.
// registerAgent does not detect overlaps, so pad creation checks each task's
// files against the agents registered before it and posts a 'conflict'
// message per overlap — that is what getConflicts reports. A scope matches a
// file exactly, or as a directory containing it (never by bare name prefix:
// a.js ≠ a.jsx). Comparison is on normalized, case-folded posix paths.
const SAFE_ID = /^[A-Za-z0-9._-]+$/;
const POST_CATEGORIES = ['discovery', 'conflict', 'dependency', 'question', 'decision'];
const BATCH_NOTE = ' — run these tasks as batch, not parallel';

function normPath(p) {
  let n = path.posix.normalize(String(p).replace(/\\/g, '/'));
  while (n.length > 1 && n.endsWith('/')) n = n.slice(0, -1);
  if (n.startsWith('./')) n = n.slice(2);
  return n.toLowerCase();
}

function scopesOverlap(a, b) {
  const x = normPath(a);
  const y = normPath(b);
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
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
        sp.post(pad, t.id, 'conflict', `${otherId} and ${t.id} both touch ${f}${via}${BATCH_NOTE}`, [f]);
      }
    }
    sp.registerAgent(pad, t.id, t.title, files);
  }
  return { sp, pad };
}

// Briefing-time view: computed in memory for every multi-task plan (the
// strategy is chosen at Step 12, not here), never written to disk.
function printScratchpad(tasks) {
  const list = tasks.tasks || [];
  if (list.length < 2) return;
  say('### Scratchpad');
  say('');
  try {
    const { sp, pad } = buildScratchpad(list);
    const conflicts = sp.getConflicts(pad);
    say('Needed only if Step 12 chooses parallel: Step 13 then creates .envoy-scratchpad.json first (`node ${CLAUDE_SKILL_DIR}/preflight.js --init-scratchpad [--exclude <batched ids>]`), one agent per parallel task scoped to its files.');
    if (conflicts.length === 0) {
      say('No file overlaps between tasks — all can run in parallel.');
    } else {
      say('Conflicts (tasks sharing a file — if parallel is chosen, Step 12 must run these tasks as batch and --exclude them from the pad):');
      for (const c of conflicts) say(`- ${c.message.endsWith(BATCH_NOTE) ? c.message.slice(0, -BATCH_NOTE.length) : c.message}`);
    }
  } catch (err) {
    say(`Scratchpad conflicts could not be computed (${err && err.message ? err.message : 'unknown error'}) — treat file boundaries as uncertain and prefer batch.`);
  }
  say('');
}

// Issue number for the scratchpad CLI modes: later Bash calls in Step 13 do
// not carry ENVOY_ISSUE_NUMBER, so the session seeded by the briefing run
// (.envoy/pickup/session.json in the worktree) wins, then the env var.
function resolveIssueNumber() {
  try {
    const session = JSON.parse(fs.readFileSync(path.join(CWD, '.envoy', 'pickup', 'session.json'), 'utf8'));
    if (session && Number.isInteger(session.issueNumber) && session.issueNumber > 0) return String(session.issueNumber);
  } catch { /* fall through */ }
  const env = process.env.ENVOY_ISSUE_NUMBER;
  return env && /^\d+$/.test(env) ? env : null;
}

// Tasks for the scratchpad CLI modes: cwd .envoy-tasks/<N>.json, else the
// issue's embedded block (the same source main() materializes from). Throws
// with a human-readable reason; never writes session state or tasks files.
function loadTasksOrThrow() {
  const issueNumber = resolveIssueNumber();
  if (!issueNumber) throw new Error('no issue number (no .envoy/pickup/session.json issueNumber and no ENVOY_ISSUE_NUMBER)');
  const tasksFile = path.join(CWD, '.envoy-tasks', `${issueNumber}.json`);
  let tasks;
  if (fs.existsSync(tasksFile)) {
    tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
  } else {
    tasks = payloadFromIssue(issueNumber);
    if (!tasks) throw new Error(`tasks file not found at .envoy-tasks/${issueNumber}.json and the issue has no embedded task block`);
    tasks.issueNumber = Number(issueNumber);
  }
  const result = validate('tasks', tasks);
  if (!result.valid) throw new Error(`tasks schema validation failed: ${result.errors.join('; ')}`);
  return tasks;
}

function loadPadOrFail(sp) {
  if (!fs.existsSync(path.join(CWD, sp.SCRATCHPAD_FILE))) {
    process.stderr.write(`No scratchpad at ${sp.SCRATCHPAD_FILE} — run --init-scratchpad first (parallel strategy only).\n`);
    return null;
  }
  return sp.load(CWD);
}

// Registered-agent check for a CLI-supplied id: shell-safe charset, then a
// key lookup — a file-sourced value never reaches anything else.
function checkAgentId(pad, agentId) {
  if (!agentId || !SAFE_ID.test(agentId)) return `Invalid task id: ${JSON.stringify(agentId || '')} — ids must match ${SAFE_ID}.`;
  if (!pad.agents || !Object.prototype.hasOwnProperty.call(pad.agents, agentId)) return `Unknown scratchpad agent id: ${agentId} — pass a registered task id.`;
  return null;
}

// `--init-scratchpad [--exclude <id,...>]` — Step 13 once parallel is chosen:
// write the pad in the cwd (worktree root) with every task except the
// excluded (batched) ones. Unconditional: the orchestrator only calls it
// after choosing parallel.
function initScratchpad(exclude) {
  let tasks;
  try {
    tasks = loadTasksOrThrow();
  } catch (err) {
    say(`Scratchpad not created: ${err.message}.`);
    return 1;
  }
  const list = tasks.tasks || [];
  const ids = new Set(list.map((t) => t.id));
  const badIds = list.map((t) => t.id).filter((id) => !SAFE_ID.test(id));
  if (badIds.length > 0) {
    say(`Scratchpad not created: task ids must match ${SAFE_ID} for shell use — offending: ${badIds.map((i) => JSON.stringify(i)).join(', ')}.`);
    return 1;
  }
  const unknown = exclude.filter((id) => !ids.has(id));
  if (unknown.length > 0) {
    say(`Scratchpad not created: --exclude names unknown task id(s): ${unknown.map((i) => JSON.stringify(i)).join(', ')}.`);
    return 1;
  }
  try {
    const { sp, pad } = buildScratchpad(list.filter((t) => !exclude.includes(t.id)));
    sp.save(pad, CWD);
    const conflicts = sp.getConflicts(pad);
    say(`Scratchpad created: ${sp.SCRATCHPAD_FILE} (${Object.keys(pad.agents).length} agents, ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}${exclude.length ? `; excluded: ${exclude.join(', ')}` : ''}).`);
    for (const c of conflicts) say(`- ${c.message}`);
    return 0;
  } catch (err) {
    say(`Scratchpad not created: ${err && err.message ? err.message : 'unknown error'}.`);
    return 1;
  }
}

// `--scratchpad-briefing <task-id>` — prints formatBriefing(pad, taskId) for
// the implementer prompt's scratchpad section.
function scratchpadBriefing(agentId) {
  const sp = require(path.join(REPO_ROOT, 'lib', 'agent-scratchpad'));
  const pad = loadPadOrFail(sp);
  if (!pad) return 1;
  const bad = checkAgentId(pad, agentId);
  if (bad) { process.stderr.write(`${bad}\n`); return 1; }
  const brief = sp.formatBriefing(pad, agentId);
  if (brief) say(brief);
  return 0;
}

// `--scratchpad-post <task-id> <category> <message> [files...]` — an
// implementer records a discovery/decision that affects other agents.
function scratchpadPost(agentId, category, message, files) {
  const sp = require(path.join(REPO_ROOT, 'lib', 'agent-scratchpad'));
  const pad = loadPadOrFail(sp);
  if (!pad) return 1;
  const bad = checkAgentId(pad, agentId);
  if (bad) { process.stderr.write(`${bad}\n`); return 1; }
  if (!POST_CATEGORIES.includes(category)) {
    process.stderr.write(`Invalid category: ${JSON.stringify(category || '')} — one of ${POST_CATEGORIES.join(', ')}.\n`);
    return 1;
  }
  if (!message || !String(message).trim()) {
    process.stderr.write('Missing message: --scratchpad-post <task-id> <category> <message> [files...]\n');
    return 1;
  }
  sp.post(pad, agentId, category, String(message), files);
  sp.save(pad, CWD);
  say(`Posted [${category}] for ${agentId}.`);
  return 0;
}

// `--scratchpad-done <task-id>` — deregisterAgent when the implementer ends.
function scratchpadDone(agentId) {
  const sp = require(path.join(REPO_ROOT, 'lib', 'agent-scratchpad'));
  const pad = loadPadOrFail(sp);
  if (!pad) return 1;
  const bad = checkAgentId(pad, agentId);
  if (bad) { process.stderr.write(`${bad}\n`); return 1; }
  sp.deregisterAgent(pad, agentId);
  sp.save(pad, CWD);
  say(`Marked ${agentId} done.`);
  return 0;
}

// CLI dispatch. Any unrecognized argument exits 2 — a typo must never fall
// through to main(), which would reset session.json mid-Step 13.
function usageError(msg) {
  process.stderr.write(`${msg}\nUsage: preflight.js [--init-scratchpad [--exclude <id,...>] | --scratchpad-briefing <task-id> | --scratchpad-post <task-id> <category> <message> [files...] | --scratchpad-done <task-id>]\n`);
  return 2;
}

function cli(argv) {
  if (argv.length === 0) { main(); return 0; }
  const [mode, ...rest] = argv;
  switch (mode) {
    case '--init-scratchpad': {
      let exclude = [];
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--exclude' && i + 1 < rest.length) {
          exclude = exclude.concat(rest[++i].split(',').map((x) => x.trim()).filter(Boolean));
        } else {
          return usageError(`Unknown argument: ${rest[i]}`);
        }
      }
      return initScratchpad(exclude);
    }
    case '--scratchpad-briefing':
      if (rest.length !== 1) return usageError('Unknown argument: --scratchpad-briefing takes exactly one <task-id>');
      return scratchpadBriefing(rest[0]);
    case '--scratchpad-post':
      return scratchpadPost(rest[0], rest[1], rest[2], rest.slice(3));
    case '--scratchpad-done':
      if (rest.length !== 1) return usageError('Unknown argument: --scratchpad-done takes exactly one <task-id>');
      return scratchpadDone(rest[0]);
    default:
      return usageError(`Unknown argument: ${mode}`);
  }
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

process.exitCode = cli(process.argv.slice(2));
