#!/usr/bin/env node
/**
 * PR status snapshot engine.
 *
 * Produces one schema-stable JSON snapshot of a PR's status: CI, CodeRabbit
 * (check state, unresolved review threads via GraphQL, rate-limit), reviewers, idle.
 * Parsing/counting is pure and unit-tested; gh/GraphQL fetch lives in thin
 * wrappers kept out of the tests.
 */

const { execFileSync } = require('child_process');

// ═══════════════════════════════════════════════════════════════════
// Pure functions (unit-tested with fixtures — no network)
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse a CodeRabbit "rate limit exceeded" comment body.
 *
 * Detects the rate-limit marker, then resolves the reset time from either an
 * absolute ISO timestamp in the body or a relative "N minutes [and M seconds]"
 * phrase measured from `now`.
 *
 * @param {string} body - Comment body text
 * @param {Date} [now] - Reference time for relative resets (defaults to current time)
 * @returns {{ rateLimited: boolean, resetsAt: string|null }} ISO reset time or null
 */
function parseRateLimit(body, now = new Date()) {
  if (!body || !/rate limit exceeded/i.test(body)) {
    return { rateLimited: false, resetsAt: null };
  }

  // Absolute ISO timestamp takes precedence when present.
  const isoMatch = body.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/);
  if (isoMatch) {
    const parsed = new Date(isoMatch[0]);
    if (!Number.isNaN(parsed.getTime())) {
      return { rateLimited: true, resetsAt: parsed.toISOString() };
    }
  }

  // Relative "N minutes [and M seconds]".
  const relMatch = body.match(/(\d+)\s*minutes?(?:\s*and\s*(\d+)\s*seconds?)?/i);
  if (relMatch) {
    const minutes = parseInt(relMatch[1], 10);
    const seconds = relMatch[2] ? parseInt(relMatch[2], 10) : 0;
    const resetsAt = new Date(now.getTime() + (minutes * 60 + seconds) * 1000);
    return { rateLimited: true, resetsAt: resetsAt.toISOString() };
  }

  return { rateLimited: true, resetsAt: null };
}

/**
 * Count unresolved CodeRabbit review threads from a GraphQL reviewThreads payload.
 *
 * A thread counts when its first comment's author login contains "coderabbit"
 * (case-insensitive) AND the thread is not resolved. This is the #25 fix — REST
 * comment counts miss CodeRabbit inline threads, so the count MUST come from
 * GraphQL reviewThreads.
 *
 * @param {{nodes: object[]}|object[]} payload - reviewThreads object or its nodes array
 * @returns {number} Count of unresolved CodeRabbit threads
 */
function countUnresolvedThreads(payload) {
  if (!payload) return 0;
  const nodes = Array.isArray(payload) ? payload : payload.nodes;
  if (!Array.isArray(nodes)) return 0;

  return nodes.filter((threadNode) => {
    if (!threadNode || threadNode.isResolved !== false) return false;
    const comments = threadNode.comments && threadNode.comments.nodes;
    if (!Array.isArray(comments) || comments.length === 0) return false;
    const login = comments[0].author && comments[0].author.login;
    return typeof login === 'string' && login.toLowerCase().includes('coderabbit');
  }).length;
}

/**
 * Whole minutes elapsed between `lastActivityAt` and `now`.
 *
 * @param {string|null} lastActivityAt - ISO timestamp of last PR activity
 * @param {Date} now - Reference time
 * @returns {number|null} Idle minutes, or null when lastActivityAt is absent/invalid
 */
function idleMinutesSince(lastActivityAt, now) {
  if (!lastActivityAt) return null;
  const then = new Date(lastActivityAt);
  if (Number.isNaN(then.getTime())) return null;
  return Math.floor((now.getTime() - then.getTime()) / 60000);
}

/**
 * Assemble the schema-stable PR status snapshot from already-fetched raw inputs.
 *
 * @param {object} raw - Fetched inputs
 * @param {number} raw.pr - PR number
 * @param {{state: string, checks: object[]}} raw.ci - CI rollup state and checks
 * @param {string} raw.coderabbitCheckState - CodeRabbit check run state
 * @param {{nodes: object[]}|object[]} raw.reviewThreads - GraphQL reviewThreads payload
 * @param {string|null} raw.rateLimitCommentBody - CodeRabbit rate-limit comment body, if any
 * @param {object[]} raw.reviewers - Reviewer review states
 * @param {string|null} raw.lastActivityAt - ISO timestamp of last activity
 * @param {Date} [raw.now] - Reference time (defaults to current time)
 * @returns {object} Snapshot with { pr, ci, coderabbit, reviewers, idle }
 */
function buildSnapshot(raw) {
  const now = raw.now || new Date();
  return {
    pr: raw.pr,
    ci: {
      state: raw.ci ? raw.ci.state : null,
      checks: (raw.ci && raw.ci.checks) || [],
    },
    coderabbit: {
      checkState: raw.coderabbitCheckState || null,
      unresolvedThreads: countUnresolvedThreads(raw.reviewThreads),
      rateLimit: parseRateLimit(raw.rateLimitCommentBody, now),
    },
    reviewers: raw.reviewers || [],
    idle: {
      lastActivityAt: raw.lastActivityAt || null,
      idleMinutes: idleMinutesSince(raw.lastActivityAt, now),
    },
  };
}

/**
 * Derive CI state and per-check list from a statusCheckRollup, and pull out
 * CodeRabbit's own check state.
 * @param {object[]} rollup - statusCheckRollup nodes from gh pr view
 * @returns {{ci: {state: string, checks: object[]}, coderabbitCheckState: string|null}}
 */
function summarizeChecks(rollup) {
  const nodes = rollup || [];
  const checks = nodes.map((n) => ({
    name: n.name || n.context || 'unknown',
    state: n.conclusion || n.state || n.status || null,
  }));
  let state = 'SUCCESS';
  for (const c of checks) {
    const s = (c.state || '').toUpperCase();
    if (s === 'FAILURE' || s === 'ERROR' || s === 'TIMED_OUT' || s === 'CANCELLED' || s === 'ACTION_REQUIRED') {
      state = 'FAILURE';
      break;
    }
    if (s === 'PENDING' || s === 'IN_PROGRESS' || s === 'QUEUED' || s === '') {
      state = 'PENDING';
    }
  }
  if (checks.length === 0) state = 'NONE';

  const crCheck = checks.find((c) => /coderabbit/i.test(c.name));
  return { ci: { state, checks }, coderabbitCheckState: crCheck ? crCheck.state : null };
}

// ═══════════════════════════════════════════════════════════════════
// Thin gh/GraphQL wrappers (NOT unit-tested — live network)
// ═══════════════════════════════════════════════════════════════════

/**
 * Run gh and return parsed JSON stdout.
 * @param {string[]} args - Arguments passed to gh
 * @returns {any} Parsed JSON
 */
function ghJson(args) {
  const out = execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  return JSON.parse(out);
}

/**
 * Resolve the current repository's owner and name via gh.
 * @returns {{owner: string, repo: string}}
 */
function currentRepo() {
  const data = ghJson(['repo', 'view', '--json', 'owner,name']);
  return { owner: data.owner.login, repo: data.name };
}

/**
 * Fetch CI rollup, reviewers, and last-activity timestamp for a PR.
 * @param {number} prNumber
 * @returns {object}
 */
function fetchPrView(prNumber) {
  return ghJson([
    'pr', 'view', String(prNumber),
    '--json', 'number,statusCheckRollup,reviews,updatedAt,latestReviews',
  ]);
}

/**
 * Fetch reviewThreads via GraphQL — the authoritative source for unresolved
 * CodeRabbit inline threads (REST misses them, #25).
 * @param {{owner: string, repo: string}} repo
 * @param {number} prNumber
 * @returns {{nodes: object[]}}
 */
function fetchReviewThreads(repo, prNumber) {
  const query = [
    'query($owner:String!,$repo:String!,$pr:Int!){',
    '  repository(owner:$owner,name:$repo){',
    '    pullRequest(number:$pr){',
    '      reviewThreads(first:100){',
    '        nodes{ isResolved comments(first:1){ nodes{ author{ login } } } }',
    '      }',
    '    }',
    '  }',
    '}',
  ].join('\n');
  const data = ghJson([
    'api', 'graphql',
    '-f', `query=${query}`,
    '-F', `owner=${repo.owner}`,
    '-F', `repo=${repo.repo}`,
    '-F', `pr=${prNumber}`,
  ]);
  return data.data.repository.pullRequest.reviewThreads;
}

/**
 * Fetch the latest CodeRabbit rate-limit comment body, if any.
 * @param {number} prNumber
 * @returns {string|null}
 */
function fetchRateLimitCommentBody(prNumber) {
  const data = ghJson(['pr', 'view', String(prNumber), '--json', 'comments']);
  const comments = (data.comments || []).filter((c) => {
    const login = (c.author && (c.author.login || c.author.name)) || '';
    return login.toLowerCase().includes('coderabbit');
  });
  for (let i = comments.length - 1; i >= 0; i--) {
    if (/rate limit exceeded/i.test(comments[i].body || '')) {
      return comments[i].body;
    }
  }
  return null;
}

/**
 * Fetch all raw inputs for a PR and assemble the snapshot.
 * @param {number} prNumber
 * @returns {object} Snapshot
 */
function getSnapshot(prNumber) {
  const repo = currentRepo();
  const view = fetchPrView(prNumber);
  const { ci, coderabbitCheckState } = summarizeChecks(view.statusCheckRollup);
  const reviewThreads = fetchReviewThreads(repo, prNumber);
  const rateLimitCommentBody = fetchRateLimitCommentBody(prNumber);
  const reviewers = (view.latestReviews || view.reviews || []).map((r) => ({
    login: r.author ? r.author.login : null,
    state: r.state,
  }));

  return buildSnapshot({
    pr: view.number || prNumber,
    ci,
    coderabbitCheckState,
    reviewThreads,
    rateLimitCommentBody,
    reviewers,
    lastActivityAt: view.updatedAt || null,
  });
}

// ═══════════════════════════════════════════════════════════════════
// CLI entrypoint
// ═══════════════════════════════════════════════════════════════════

function main() {
  const prNumber = parseInt(process.argv[2], 10);
  if (!prNumber) {
    process.stderr.write('Usage: node lib/pr-status.js <pr-number>\n');
    process.exit(1);
  }
  const snapshot = getSnapshot(prNumber);
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  parseRateLimit,
  countUnresolvedThreads,
  idleMinutesSince,
  buildSnapshot,
  summarizeChecks,
  getSnapshot,
};
