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
 * Count unresolved review threads from all authors in a GraphQL reviewThreads payload.
 *
 * A thread counts when it is not resolved (`isResolved === false`), regardless of
 * author. Mirrors `countUnresolvedThreads` in accepting either the reviewThreads
 * object or a bare nodes array.
 *
 * @param {{nodes: object[]}|object[]} payload - reviewThreads object or its nodes array
 * @returns {number} Count of unresolved threads across all authors
 */
function countUnresolvedTotal(payload) {
  if (!payload) return 0;
  const nodes = Array.isArray(payload) ? payload : payload.nodes;
  if (!Array.isArray(nodes)) return 0;

  return nodes.filter((threadNode) => threadNode && threadNode.isResolved === false).length;
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
 * @param {{state: string, checks: object[], fullSuiteSkipped?: boolean, fullSuiteOwed?: boolean, pinned?: boolean}} raw.ci - CI rollup state, checks, raw FULL SUITE NOT RUN marker (fullSuiteSkipped) and the derived "fast run green, full run owed" signal (fullSuiteOwed); both set by getSnapshot via deriveCi
 * @param {string} raw.coderabbitCheckState - CodeRabbit check run state
 * @param {string|null} [raw.coderabbitStatusState] - CodeRabbit commit status state (latest per context); null when no such status exists on the head SHA
 * @param {{nodes: object[]}|object[]} raw.reviewThreads - GraphQL reviewThreads payload
 * @param {string|null} raw.rateLimitCommentBody - CodeRabbit rate-limit comment body, if any
 * @param {object[]} raw.reviewers - Reviewer review states
 * @param {string|null} raw.lastActivityAt - ISO timestamp of last activity
 * @param {Date} [raw.now] - Reference time (defaults to current time)
 * @returns {object} Snapshot with { pr, ci, coderabbit, threads, reviewers, idle }
 */
function buildSnapshot(raw) {
  const now = raw.now || new Date();
  return {
    pr: raw.pr,
    ci: {
      state: raw.ci ? raw.ci.state : null,
      checks: (raw.ci && raw.ci.checks) || [],
      fullSuiteSkipped: !!(raw.ci && raw.ci.fullSuiteSkipped),
      fullSuiteOwed: !!(raw.ci && raw.ci.fullSuiteOwed),
    },
    coderabbit: {
      checkState: raw.coderabbitCheckState || null,
      statusState: raw.coderabbitStatusState || null,
      unresolvedThreads: countUnresolvedThreads(raw.reviewThreads),
      rateLimit: parseRateLimit(raw.rateLimitCommentBody, now),
    },
    threads: {
      unresolved: countUnresolvedTotal(raw.reviewThreads),
    },
    reviewers: raw.reviewers || [],
    idle: {
      lastActivityAt: raw.lastActivityAt || null,
      idleMinutes: idleMinutesSince(raw.lastActivityAt, now),
    },
  };
}

/** True when a rollup/API node is a commit status (context + state) rather than a check run. */
function isStatusNode(n) {
  return n.__typename === 'StatusContext' || (!n.__typename && !n.name && !!n.context);
}

/** Latest of a node's completed/started/created timestamps as epoch ms (gh camelCase and API snake_case); 0 when none parse. */
function nodeTime(n) {
  let best = 0;
  for (const v of [n.completedAt, n.completed_at, n.startedAt, n.started_at, n.updatedAt, n.updated_at, n.createdAt, n.created_at]) {
    const t = v ? Date.parse(v) : NaN;
    if (!Number.isNaN(t) && t > best) best = t;
  }
  return best;
}

/**
 * Keep one node per (kind, case-sensitive name/context, app slug or workflow name):
 * the one with the latest timestamp, so only true reruns of the same check collapse. Ties (including no timestamps) go to the later array entry.
 * @param {object[]} nodes
 * @returns {object[]} Deduped nodes in first-seen order
 */
function dedupeLatest(nodes) {
  const byKey = new Map();
  for (const n of nodes) {
    const origin = (n.app && n.app.slug) || n.workflowName || '';
    const key = JSON.stringify([isStatusNode(n) ? 's' : 'c', String(n.name || n.context || 'unknown'), origin]);
    const prev = byKey.get(key);
    if (!prev || nodeTime(n) >= nodeTime(prev)) byKey.set(key, n);
  }
  return [...byKey.values()];
}

/**
 * Derive CI state and per-check list from check-run / commit-status nodes, pull out
 * CodeRabbit's check-run and commit-status states separately, and collect candidate
 * CI-gate checks. Nodes are first deduped by (name, app/workflow) keeping the latest
 * completed_at/started_at, so a stale failed rerun never outlives a newer run.
 * A gate check is one named ENVOY_CI_GATE_CHECK (default 'ci-gate', case-insensitive)
 * whose state is FAILURE/ERROR/TIMED_OUT and whose detailsUrl yields a check-run id
 * (/job/<id>). The FULL SUITE NOT RUN marker lives in those checks' annotations, so
 * detection is done by detectFullSuiteSkipped. This function stays pure (no I/O).
 * `onlyGateFailing` is true iff every failed/pending item is such a gate check and no
 * commit status is non-success (precondition for fullSuiteOwed, see deriveCi).
 * @param {object[]} rollup - statusCheckRollup nodes from gh pr view, or normalizePinnedNodes output
 * @returns {{ci: {state: string, checks: object[]}, coderabbitCheckState: string|null, coderabbitStatusState: string|null, onlyGateFailing: boolean, gateChecks: {name: string, state: string, checkRunId: string}[]}}
 */
function summarizeChecks(rollup) {
  const nodes = dedupeLatest(rollup || []);
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

  const isCr = (i) => /coderabbit/i.test(checks[i].name);
  const crCheckIdx = nodes.findIndex((n, i) => !isStatusNode(n) && isCr(i));
  const crStatusIdx = nodes.findIndex((n, i) => isStatusNode(n) && isCr(i));
  const gateName = (process.env.ENVOY_CI_GATE_CHECK || 'ci-gate').toLowerCase();
  const gateChecks = [];
  let onlyGateFailing = true;
  nodes.forEach((n, i) => {
    const c = checks[i];
    const s = (c.state || '').toUpperCase();
    const isGateFailure = !isStatusNode(n) && c.name.toLowerCase() === gateName && /^(FAILURE|ERROR|TIMED_OUT)$/.test(s);
    const m = isGateFailure ? /\/job\/(\d+)/.exec(n.detailsUrl || n.details_url || '') : null;
    if (m) gateChecks.push({ name: c.name, state: c.state, checkRunId: m[1] });
    if (isStatusNode(n)) {
      if (s !== 'SUCCESS') onlyGateFailing = false;
    } else if (!m && !/^(SUCCESS|NEUTRAL|SKIPPED)$/.test(s)) {
      onlyGateFailing = false;
    }
  });
  return {
    ci: { state, checks },
    coderabbitCheckState: crCheckIdx >= 0 ? checks[crCheckIdx].state : null,
    coderabbitStatusState: crStatusIdx >= 0 ? checks[crStatusIdx].state : null,
    onlyGateFailing,
    gateChecks,
  };
}

/**
 * Merge API check runs and a combined commit status into the node shape
 * summarizeChecks understands. Statuses are tagged StatusContext so they are
 * never confused with check runs of the same name.
 * @param {object[]} checkRuns - check_runs from commits/<sha>/check-runs?filter=latest
 * @param {{statuses?: object[]}} combined - Response of commits/<sha>/status
 * @returns {object[]}
 */
function normalizePinnedNodes(checkRuns, combined) {
  const runs = (checkRuns || []).map((r) => ({ ...r, __typename: 'CheckRun' }));
  const statuses = ((combined && combined.statuses) || []).map((st) => ({
    __typename: 'StatusContext',
    context: st.context,
    state: st.state,
    created_at: st.updated_at || st.created_at,
  }));
  return [...runs, ...statuses];
}

/**
 * Read the checks and commit statuses of one head SHA (and only that SHA):
 * latest check run per name plus the combined status (latest per context).
 * Throws on an invalid SHA or any fetch error — callers must fail closed.
 * @param {{owner: string, repo: string}} repo
 * @param {string} sha - 40-hex head commit SHA
 * @param {{fetchCheckRuns?: Function, fetchStatus?: Function}} [fetchers] - Injectable (repo, sha) readers
 * @returns {object[]} Nodes for summarizeChecks
 */
function readPinnedChecks(repo, sha, fetchers = {}) {
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error(`invalid head SHA: ${JSON.stringify(sha)}`);
  }
  const fetchCheckRuns = fetchers.fetchCheckRuns || fetchCheckRunsForSha;
  const fetchStatus = fetchers.fetchStatus || fetchCombinedStatus;
  const checkRuns = fetchCheckRuns(repo, sha);
  const combined = fetchStatus(repo, sha);
  const listed = combined && Array.isArray(combined.statuses) ? combined.statuses.length : 0;
  if (combined && typeof combined.total_count === 'number' && combined.total_count !== listed) {
    throw new Error(`combined status truncated: total_count ${combined.total_count} != ${listed} statuses returned`);
  }
  return normalizePinnedNodes(checkRuns, combined);
}

/**
 * Assemble the ci block: raw marker detection plus the derived fullSuiteOwed.
 * fullSuiteOwed = fullSuiteSkipped && only ci-gate failures remain && no non-success
 * commit status && the read was SHA-pinned (pinned !== false; fail closed otherwise).
 * @param {{ci: {state: string, checks: object[]}, gateChecks: object[], onlyGateFailing: boolean}} summary - From summarizeChecks
 * @param {(checkRunId: string) => object[]} fetchAnnotations - Injectable annotation fetcher
 * @param {{pinned?: boolean}} [opts] - pinned:false marks a fallback read (not SHA-pinned)
 * @returns {{state: string, checks: object[], fullSuiteSkipped: boolean, fullSuiteOwed: boolean, pinned: boolean}}
 */
function deriveCi(summary, fetchAnnotations, opts = {}) {
  const pinned = opts.pinned !== false;
  const fullSuiteSkipped = detectFullSuiteSkipped(summary.gateChecks, fetchAnnotations);
  return {
    ...summary.ci,
    fullSuiteSkipped,
    fullSuiteOwed: pinned && fullSuiteSkipped && summary.onlyGateFailing === true,
    pinned,
  };
}

/**
 * True iff any failed gate check carries a FULL SUITE NOT RUN annotation
 * (in message or title). Never throws: a fetch error for a gate counts as no match.
 * @param {{checkRunId: string}[]} gateChecks - From summarizeChecks
 * @param {(checkRunId: string) => {message?: string, title?: string}[]} fetchAnnotations - Injectable annotation fetcher
 * @returns {boolean}
 */
function detectFullSuiteSkipped(gateChecks, fetchAnnotations) {
  for (const g of gateChecks || []) {
    try {
      const anns = fetchAnnotations(g.checkRunId) || [];
      if (anns.some((a) => a && /FULL SUITE NOT RUN/i.test(`${a.message || ''}\n${a.title || ''}`))) return true;
    } catch (_) {
      // gh failure: treat as no marker
    }
  }
  return false;
}

/**
 * Build the default annotation fetcher for a repo, using gh api (arg-array, no shell).
 * @param {{owner: string, repo: string}} repo
 * @returns {(checkRunId: string) => object[]}
 */
function makeGhAnnotationFetcher(repo) {
  return (checkRunId) => {
    const out = execFileSync(
      'gh',
      ['api', `repos/${repo.owner}/${repo.repo}/check-runs/${checkRunId}/annotations`, '--paginate', '--jq', '.[]'],
      { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
    );
    return out.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  };
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
 * Fetch the latest check run per name for a head SHA (filter=latest), paginated.
 * @param {{owner: string, repo: string}} repo
 * @param {string} sha - Validated 40-hex SHA
 * @returns {object[]} check_runs
 */
function fetchCheckRunsForSha(repo, sha) {
  const out = execFileSync(
    'gh',
    ['api', `repos/${repo.owner}/${repo.repo}/commits/${sha}/check-runs?filter=latest&per_page=100`, '--paginate', '--jq', '.check_runs[]'],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  );
  return out.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/**
 * Fetch the combined commit status for a head SHA (latest status per context).
 * @param {{owner: string, repo: string}} repo
 * @param {string} sha - Validated 40-hex SHA
 * @returns {{state: string, statuses: object[]}}
 */
function fetchCombinedStatus(repo, sha) {
  return ghJson(['api', `repos/${repo.owner}/${repo.repo}/commits/${sha}/status?per_page=100`]);
}

/**
 * Fetch CI rollup, reviewers, and last-activity timestamp for a PR.
 * @param {number} prNumber
 * @returns {object}
 */
function fetchPrView(prNumber) {
  return ghJson([
    'pr', 'view', String(prNumber),
    '--json', 'number,headRefOid,statusCheckRollup,reviews,updatedAt,latestReviews',
  ]);
}

/**
 * Fetch a single page of reviewThreads via GraphQL — the authoritative source
 * for unresolved review threads (REST misses inline CodeRabbit threads, #25).
 * @param {{owner: string, repo: string}} repo
 * @param {number} prNumber
 * @param {string|null} after - endCursor of the previous page, or null for the first page
 * @returns {{nodes: object[], pageInfo: {hasNextPage: boolean, endCursor: string|null}}}
 */
function fetchReviewThreadsPage(repo, prNumber, after) {
  const query = [
    'query($owner:String!,$repo:String!,$pr:Int!,$after:String){',
    '  repository(owner:$owner,name:$repo){',
    '    pullRequest(number:$pr){',
    '      reviewThreads(first:100,after:$after){',
    '        pageInfo{ hasNextPage endCursor }',
    '        nodes{ isResolved comments(first:1){ nodes{ author{ login } } } }',
    '      }',
    '    }',
    '  }',
    '}',
  ].join('\n');
  const args = [
    'api', 'graphql',
    '-f', `query=${query}`,
    '-F', `owner=${repo.owner}`,
    '-F', `repo=${repo.repo}`,
    '-F', `pr=${prNumber}`,
  ];
  if (after) args.push('-F', `after=${after}`);
  const data = ghJson(args);
  return data.data.repository.pullRequest.reviewThreads;
}

/**
 * Fetch all reviewThreads for a PR, paginating past the 100-thread page limit
 * by looping on `pageInfo.hasNextPage` and accumulating nodes across pages.
 * The page-fetcher is injectable so pagination can be unit-tested without network.
 * @param {{owner: string, repo: string}} repo
 * @param {number} prNumber
 * @param {(repo: object, prNumber: number, after: string|null) => object} [fetchPage]
 * @returns {{nodes: object[]}}
 */
function fetchReviewThreads(repo, prNumber, fetchPage = fetchReviewThreadsPage) {
  const nodes = [];
  let after = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const page = fetchPage(repo, prNumber, after);
    if (page && Array.isArray(page.nodes)) nodes.push(...page.nodes);
    const pageInfo = (page && page.pageInfo) || {};
    hasNextPage = Boolean(pageInfo.hasNextPage);
    const nextAfter = pageInfo.endCursor || null;
    // Abort rather than hang: if there's another page but the cursor didn't
    // advance, following it would loop forever on the same page.
    if (hasNextPage && (nextAfter === null || nextAfter === after)) {
      throw new Error('reviewThreads pagination did not advance (hasNextPage=true but endCursor missing/unchanged)');
    }
    after = nextAfter;
  }
  return { nodes };
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
  // Prefer the SHA-pinned read (latest check run per name + combined status). On any
  // read failure fall back to the unpinned rollup but fail closed: fullSuiteOwed stays false.
  let summary;
  let pinned = true;
  try {
    summary = summarizeChecks(readPinnedChecks(repo, view.headRefOid));
  } catch (err) {
    process.stderr.write(`pr-status: pinned check read failed, falling back to unpinned rollup (fullSuiteOwed=false): ${err && err.message}\n`);
    pinned = false;
    summary = summarizeChecks(view.statusCheckRollup);
  }
  const { coderabbitCheckState, coderabbitStatusState } = summary;
  const ci = deriveCi(summary, makeGhAnnotationFetcher(repo), { pinned });
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
    coderabbitStatusState,
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
  countUnresolvedTotal,
  idleMinutesSince,
  buildSnapshot,
  summarizeChecks,
  detectFullSuiteSkipped,
  normalizePinnedNodes,
  readPinnedChecks,
  deriveCi,
  fetchReviewThreads,
  getSnapshot,
};
