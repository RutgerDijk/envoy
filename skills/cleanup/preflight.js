#!/usr/bin/env node
'use strict';

/**
 * Cleanup preflight (stub).
 *
 * Cleanup runs after merge; it tolerates missing state (that's the point —
 * we're about to remove it). It is also the active-skill marker's explicit
 * clear point: whatever skill last owned the session is done, so we drop the
 * marker rather than leave it as a stale global tripwire.
 */

const fs = require('fs');
const path = require('path');

const CWD = process.cwd();
const REPO_ROOT = process.env.ENVOY_REPO_ROOT || path.resolve(__dirname, '..', '..');
const { readActiveSkill, clearActiveSkill } = require(path.join(REPO_ROOT, 'lib', 'active-skill'));

function say(line) { process.stdout.write(`${line}\n`); }
function banner(tier) { say(`## STATUS: ${tier}`); }

function main() {
  const priorMarker = readActiveSkill(CWD);
  clearActiveSkill(CWD);

  const statePath = path.join(CWD, '.envoy', 'finalize', 'state.json');
  banner('ok');
  say('');
  if (priorMarker) {
    say(`Cleared active-skill marker (was: ${priorMarker.skill}).`);
  }
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
