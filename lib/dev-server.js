'use strict';

/**
 * Dev-server detection/start/stop logic for skills/visual-review.
 *
 * Envoy is a generic plugin (per CLAUDE.md) — it must not hardcode a
 * dotnet/React layout. This module detects how to start whatever dev
 * server a consumer repo has (via package.json scripts, or an explicit
 * `.envoy/visual.json` override for monorepos/custom setups), waits for it
 * to come up, and provides thin process-management wrappers so
 * visual-review can start a server it doesn't have and stop only the one
 * it started.
 *
 * Design: detectStartCommand is pure w.r.t. the fixture directory contents
 * (fs reads only, no process spawning) and unit-testable without spawning
 * anything. waitForReady/startServer/stopServer are the impure edges —
 * network polling and child-process management — kept thin so the actual
 * decision (which command to run) stays in the pure function.
 *
 * `.envoy/visual.json` override shape:
 *   {
 *     "command": "npm run custom-dev",   // shell command to start the server
 *     "url": "http://localhost:3000",    // URL to poll for readiness
 *     "cwd": "frontend"                  // optional, relative to repo root;
 *                                        // defaults to repo root (monorepo support)
 *   }
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn, execSync } = require('child_process');

/**
 * Detect the command to start a dev server for the given repo root.
 *
 * Precedence: `.envoy/visual.json` override, then package.json `scripts.dev`
 * (preferred — "dev" is the conventional script name for local development
 * servers in the Vite/Next/CRA ecosystem, whereas "start" often means
 * "run the production build"), then `scripts.start` as a fallback.
 *
 * @param {string} cwd - repo root to inspect
 * @returns {{command: string, cwd: string, url: string|null}|null}
 */
function detectStartCommand(cwd) {
  const overridePath = path.join(cwd, '.envoy', 'visual.json');
  if (fs.existsSync(overridePath)) {
    let override;
    try {
      override = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
    } catch (_err) {
      override = null;
    }
    if (override && override.command) {
      return {
        command: override.command,
        cwd: override.cwd ? path.join(cwd, override.cwd) : cwd,
        url: override.url || null,
      };
    }
  }

  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (_err) {
    return null;
  }

  const scripts = pkg.scripts || {};
  if (scripts.dev) {
    return { command: 'npm run dev', cwd, url: null };
  }
  if (scripts.start) {
    return { command: 'npm run start', cwd, url: null };
  }
  return null;
}

/**
 * Poll a URL until it responds or the timeout elapses.
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<boolean>} true once responding, false on timeout
 */
function waitForReady(url, timeoutMs = 90000) {
  const pollIntervalMs = 500;
  const client = url.startsWith('https:') ? https : http;
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve) => {
    function attempt() {
      const req = client.get(url, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() >= deadline) {
          resolve(false);
        } else {
          setTimeout(attempt, pollIntervalMs);
        }
      });
      req.setTimeout(pollIntervalMs, () => {
        req.destroy();
      });
    }
    attempt();
  });
}

/**
 * Start a dev server as a detached child process.
 * @param {string} command - shell command to run
 * @param {string} cwd - working directory
 * @returns {import('child_process').ChildProcess}
 */
function startServer(command, cwd) {
  const child = spawn(command, {
    cwd,
    shell: true,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child;
}

/**
 * Stop a server previously started by startServer. Never throws — killing
 * an already-dead or nonexistent pid is a no-op.
 * @param {number} pid
 */
function stopServer(pid) {
  if (!pid) return;
  try {
    // Negative pid targets the process group (we spawned detached).
    process.kill(-pid, 'SIGTERM');
  } catch (_err) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (_err2) {
      // already dead — nothing to do
    }
  }
}

/**
 * Write the "we started this" marker so cleanup only ever kills a server
 * this skill itself spawned, never a pre-existing one the user had running.
 * @param {string} cwd - repo root (marker lives at <cwd>/.envoy/visual-review/server.pid)
 * @param {number} pid
 */
function writePidFile(cwd, pid) {
  const dir = path.join(cwd, '.envoy', 'visual-review');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'server.pid'), String(pid));
}

/**
 * Read back the "we started this" marker, if present.
 * @param {string} cwd
 * @returns {number|null}
 */
function readPidFile(cwd) {
  const pidPath = path.join(cwd, '.envoy', 'visual-review', 'server.pid');
  if (!fs.existsSync(pidPath)) return null;
  const raw = fs.readFileSync(pidPath, 'utf8').trim();
  const pid = parseInt(raw, 10);
  return Number.isNaN(pid) ? null : pid;
}

/**
 * Remove the "we started this" marker after a successful stop.
 * @param {string} cwd
 */
function clearPidFile(cwd) {
  const pidPath = path.join(cwd, '.envoy', 'visual-review', 'server.pid');
  try {
    fs.unlinkSync(pidPath);
  } catch (_err) {
    // already gone — fine
  }
}

/**
 * Check whether a URL is already responding (synchronous, single attempt).
 * Used to decide whether we need to start anything at all.
 * @param {string} url
 * @returns {boolean}
 */
function isAlreadyRunning(url) {
  try {
    execSync(`curl -sf "${url}" >/dev/null`, { stdio: 'ignore' });
    return true;
  } catch (_err) {
    return false;
  }
}

module.exports = {
  detectStartCommand,
  waitForReady,
  startServer,
  stopServer,
  writePidFile,
  readPidFile,
  clearPidFile,
  isAlreadyRunning,
};
