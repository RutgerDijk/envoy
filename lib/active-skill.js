'use strict';

/**
 * Active-skill marker lifecycle.
 *
 * The active-skill marker lives at .envoy/active-skill.json and signals which
 * rigid skill currently owns the session. Left unmanaged, a stale marker turns
 * into a global tripwire — Stop-audit keeps reacting to a skill that finished
 * long ago, on a different branch, or in an unrelated session.
 *
 * This module gives the marker a lifecycle: it is stamped with the branch,
 * session, and start time it was written under, and reads that go stale on any
 * of those axes (or an explicit clear) return null instead of a live marker.
 *
 * Zero external dependencies. Branch and session are injectable so callers can
 * test hermetically without touching the real repo's git state or clock.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MARKER_REL = path.join('.envoy', 'active-skill.json');

/** Default staleness window: 4 hours. */
const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * Resolve the marker path under a working directory.
 * @param {string} dir
 * @returns {string}
 */
function markerPath(dir) {
  return path.join(dir, MARKER_REL);
}

/**
 * Current git branch for a directory, or 'unknown' when git is unavailable.
 * @param {string} dir
 * @returns {string}
 */
function currentBranch(dir) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_err) {
    return 'unknown';
  }
}

/**
 * Session identifier for the running process. Prefers CLAUDE_SESSION_ID, else a
 * stable-per-process token derived from the PID.
 * @returns {string}
 */
function currentSession() {
  return process.env.CLAUDE_SESSION_ID || `pid-${process.pid}`;
}

/**
 * Write the active-skill marker, stamping lifecycle fields alongside `meta`.
 * @param {string} dir - Working directory root (marker written under dir/.envoy).
 * @param {{skill: string, issueNumber?: number}} meta
 * @param {{now?: Date, branch?: string, session?: string}} [opts]
 */
function writeActiveSkill(dir, meta, opts = {}) {
  const now = opts.now || new Date();
  const branch = opts.branch !== undefined ? opts.branch : currentBranch(dir);
  const session = opts.session !== undefined ? opts.session : currentSession();

  const marker = {
    $schemaVersion: '1',
    skill: meta.skill,
    startedAt: now.toISOString(),
    branch,
    session,
    pid: process.pid,
  };
  if (meta.issueNumber !== undefined && meta.issueNumber !== null) {
    marker.issueNumber = Number(meta.issueNumber);
  }

  const full = markerPath(dir);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(marker, null, 2));
}

/**
 * Read the active-skill marker, or null when it is missing, unparseable, or
 * stale. Stale ⇔ older than the TTL, or written under a different branch or
 * session than the current one.
 * @param {string} dir
 * @param {{now?: Date, branch?: string, session?: string, ttlMs?: number}} [opts]
 * @returns {object|null}
 */
function readActiveSkill(dir, opts = {}) {
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(markerPath(dir), 'utf8'));
  } catch (_err) {
    return null;
  }

  const now = opts.now || new Date();
  const branch = opts.branch !== undefined ? opts.branch : currentBranch(dir);
  const session = opts.session !== undefined ? opts.session : currentSession();
  const ttlMs = opts.ttlMs !== undefined ? opts.ttlMs : DEFAULT_TTL_MS;

  const startedAt = Date.parse(marker.startedAt);
  if (Number.isNaN(startedAt) || now.getTime() - startedAt > ttlMs) {
    return null;
  }
  if (marker.branch !== branch) return null;
  if (marker.session !== session) return null;

  return marker;
}

/**
 * Remove the active-skill marker. No-op (no throw) when already absent.
 * @param {string} dir
 */
function clearActiveSkill(dir) {
  try {
    fs.unlinkSync(markerPath(dir));
  } catch (_err) {
    // Already gone — the desired end state either way.
  }
}

module.exports = {
  writeActiveSkill,
  readActiveSkill,
  clearActiveSkill,
  DEFAULT_TTL_MS,
};
