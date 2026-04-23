#!/usr/bin/env node
'use strict';

/**
 * Cleanup preflight (stub).
 *
 * Cleanup runs after merge; it tolerates missing state (that's the point —
 * we're about to remove it). Mainly, we write the active-skill marker so
 * Stop-audit can tell the difference between "cleanup is running" and
 * "something else wandered into .worktrees/".
 */

const fs = require('fs');
const path = require('path');

const CWD = process.cwd();

function say(line) { process.stdout.write(`${line}\n`); }
function banner(tier) { say(`## STATUS: ${tier}`); }

function writeJson(rel, data) {
  const full = path.join(CWD, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(data, null, 2));
}

function nowIso() { return new Date().toISOString(); }

function main() {
  writeJson('.envoy/active-skill.json', {
    $schemaVersion: '1',
    skill: 'cleanup',
    startedAt: nowIso(),
    pid: process.pid,
  });

  const statePath = path.join(CWD, '.envoy', 'finalize', 'state.json');
  banner('ok');
  say('');
  if (fs.existsSync(statePath)) {
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      say(`Cleaning up branch ${state.branch || '(unknown)'} — PR #${state.prNumber || '?'}`);
    } catch {
      say('Cleaning up (finalize state present but unreadable — that is fine, cleanup removes it).');
    }
  } else {
    say('Cleaning up — no active finalize state, proceeding with worktree + branch removal.');
  }
  say('');
  say('Next: read skills/cleanup/SKILL.md.');
}

main();
