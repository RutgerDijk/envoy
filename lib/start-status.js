#!/usr/bin/env node
'use strict';

/**
 * /envoy:start data collector — one read-only JSON snapshot of everything
 * open in this repo: brainstorms without an issue, worktrees (with their
 * resumable Claude sessions), open PRs, open issues, and a ranked "what next".
 *
 * Shared by the renderer (bin/envoy-start.js) and the skill (skills/start).
 * Never modifies a session, worktree, branch or issue.
 *
 * Sources, each fail-soft (a missing source yields an empty section):
 *   - git worktree list / branch / status / log      (injectable `git`)
 *   - gh pr list, gh issue list                      (injectable `gh`)
 *   - lib/pr-status.js per PR (child process)        (injectable `prSnapshot` / `execFile`)
 *   - Claude transcripts under <projectsRoot>/<encoded path>/  (injectable `projectsRoot`)
 *   - .envoy/ledger.jsonl in the main repo and every worktree
 *
 * Transcript discovery composes lib/cost-reporter.js `discoverSessions(dir)`.
 * `findProjectDir` is NOT used: it only maps `/` → `-` (Claude also maps `.`,
 * so `/.worktrees` becomes `--worktrees`) and hard-codes ~/.claude/projects,
 * so it can neither find worktree dirs nor be pointed at a fixture root.
 *
 * `collect(opts)` is async: PR snapshots run as concurrent `node lib/pr-status.js <n>`
 * children (cap PR_CONCURRENCY) in repoRoot. Every child call has a timeout
 * (git 5s, gh / pr-status 15s); a timed-out PR gets ci:null.
 *
 * CLI: `node lib/start-status.js` prints the snapshot JSON.
 *
 * Zero external dependencies.
 */

/**
 * @typedef {Object} StartSession
 * @property {string} sessionId
 * @property {string} summary     First prompt / index summary.
 * @property {string} modified    ISO time of last transcript write.
 * @property {string|null} cwd    Working directory recorded in the transcript.
 * @property {string} gitBranch   Branch recorded in the transcript ('unknown' if none).
 *
 * @typedef {Object} StartBrainstorm
 * @property {string} sessionId
 * @property {string} startedAt   ISO time (ledger ts, else first transcript timestamp).
 * @property {number} ageDays     Whole days since startedAt.
 * @property {string} topic       Session summary ('' when no transcript found).
 * @property {string} cwd
 *
 * @typedef {Object} StartWorktree
 * @property {string} path
 * @property {string} branch
 * @property {number|null} issue  From `feature|fix|hotfix/<N>-…`.
 * @property {number} ahead       Commits ahead of the default branch.
 * @property {boolean} dirty      Uncommitted changes present.
 * @property {string|null} lastActivityAt  max(last commit, newest session write).
 * @property {number|null} idleDays
 * @property {boolean} stale      idleDays > 30 (never for the main worktree).
 * @property {number|null} pr     Open PR number for this branch, if any.
 * @property {boolean} merged     Branch has a merged PR and no open one.
 * @property {'hervat'|'cleanup'|null} action  Verb for the dashboard and ranking:
 *   null for the main worktree or one with an open PR (the PR represents it);
 *   cleanup when merged or stale; hervat when ahead or dirty.
 * @property {StartSession[]} sessions
 *
 * @typedef {Object} StartPr
 * @property {number} number
 * @property {string} title
 * @property {string} url
 * @property {string} branch
 * @property {number|null} issue
 * @property {string|null} ci     pr-status ci.state (null when unavailable).
 * @property {number} unresolved  pr-status threads.unresolved (all authors).
 * @property {boolean} needsAttention  ci failure/error or unresolved > 0.
 *
 * @typedef {Object} StartIssue
 * @property {number} number
 * @property {string} title
 * @property {string} description  One-line body excerpt, ≤120 chars.
 * @property {string[]} labels
 * @property {string} url
 * @property {boolean} plan        Body carries the envoy tasks machine block.
 * @property {boolean} inProgress  Linked to a worktree or open PR (in flight).
 * @property {boolean} recommended Exactly one when issues is non-empty: best
 *   non-in-flight issue (plan first, then lowest number); if all are in
 *   flight, the best one overall.
 *
 * @typedef {Object} StartRankItem
 * @property {'pr'|'worktree'|'brainstorm'|'issue'} kind
 * @property {string|number} ref   PR/issue number, worktree branch, or brainstorm sessionId.
 * @property {string} label
 * @property {'hervat'|'pickup'|'brainstorm'|'cleanup'} action
 *
 * @typedef {Object} StartSnapshot
 * @property {string} generatedAt
 * @property {{root: string, url?: string}} repo
 * @property {StartBrainstorm[]} brainstorms
 * @property {StartWorktree[]} worktrees
 * @property {StartPr[]} prs
 * @property {StartIssue[]} issues
 * @property {StartRankItem[]} ranking
 *   Order: PR needing attention (hervat) > non-stale worktree with work
 *   (hervat) > brainstorm (hervat) > issue with plan (pickup) > issue without
 *   plan (brainstorm) > stale worktree (cleanup). Not ranked: green PRs, idle
 *   worktrees without work, the main worktree, any worktree whose branch has
 *   an open PR (the PR represents it), and in-flight issues.
 * @property {StartRankItem|null} next  ranking[0], or null.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execFile: nodeExecFile } = require('child_process');
const { discoverSessions } = require('./cost-reporter');
const { extractEmbeddedBlock } = require('./tasks-embed');

const DAY_MS = 24 * 60 * 60 * 1000;
/** Sessions on a dead branch are still listed when modified within this window. */
const RECENT_DAYS = 7;
/** Worktrees idle longer than this are marked stale. */
const STALE_DAYS = 30;
/** Transcript-scan brainstorm fallback only looks at sessions this recent. */
const BRAINSTORM_SCAN_DAYS = 30;
/** Byte caps for bounded transcript reads. */
const META_BYTES = 64 * 1024;
/** Brainstorm/issue scan reads forward in chunks up to this cap. */
const SCAN_MAX_BYTES = 32 * 1024 * 1024;
const SCAN_CHUNK = 1024 * 1024;
const DESC_MAX = 120;
/** Per-call timeouts (ms) for child processes. */
const TIMEOUTS = { git: 5000, gh: 15000, prStatus: 15000 };
const MAX_BUFFER = 16 * 1024 * 1024;
/** Max concurrent pr-status children. */
const PR_CONCURRENCY = 4;

// ═══════════════════════════════════════════════════════════════════
// Pure helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Encode an absolute path the way Claude Code names its project dirs:
 * every non-alphanumeric character becomes '-'.
 * @param {string} p
 * @returns {string}
 */
function encodeProjectDir(p) {
  return String(p).replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Issue number linked to a branch name (`feature|fix|hotfix/<N>-…`), or null.
 * @param {string|null|undefined} branch
 * @returns {number|null}
 */
function linkedIssue(branch) {
  const m = typeof branch === 'string' && branch.match(/^(?:feature|fix|hotfix)\/(\d+)-/);
  return m ? Number(m[1]) : null;
}

/**
 * Short single-line excerpt of an issue body: drops markdown headers, HTML
 * comments and emphasis markers, collapses whitespace, caps at 120 chars.
 * @param {string|null|undefined} body
 * @returns {string}
 */
function describeBody(body) {
  if (typeof body !== 'string') return '';
  const text = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join(' ')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > DESC_MAX ? `${text.slice(0, DESC_MAX - 1).trimEnd()}…` : text;
}

/**
 * Single clean line from a transcript summary: drops markup tags (including
 * one cut off by discoverSessions' 60-char truncation) and collapses whitespace.
 * @param {string} s
 * @returns {string}
 */
function cleanSummary(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/<[^>]*$/, '').replace(/\s+/g, ' ').trim();
}

/** Whole days between an ISO time and now, or null. */
function daysSince(iso, now) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

/** Normalize a git remote URL to an https web URL. */
function webUrl(remote) {
  const r = String(remote || '').trim();
  if (!r) return undefined;
  const ssh = r.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  return r.replace(/\.git$/, '');
}

/** Run fn, return fallback on any throw. */
function soft(fn, fallback) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (_err) {
    return fallback;
  }
}

/** Parse JSONL text, skipping blank and corrupt lines. */
function parseLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch (_err) {
      // partial or corrupt line — skip
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// Default runners
// ═══════════════════════════════════════════════════════════════════

function defaultGit(args, cwd) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: TIMEOUTS.git, maxBuffer: MAX_BUFFER,
  });
}

function defaultGh(args, cwd) {
  return execFileSync('gh', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: TIMEOUTS.gh, maxBuffer: MAX_BUFFER,
  });
}

/**
 * Default async PR snapshot: run `node lib/pr-status.js <n>` as a child in
 * repoRoot (so its gh calls target this repo) and parse its JSON stdout.
 * @param {string} repoRoot
 * @param {Function} [execFile] - child_process.execFile-compatible (injectable for tests)
 * @returns {(n: number) => Promise<object>}
 */
function makeDefaultPrSnapshot(repoRoot, execFile = nodeExecFile) {
  const script = path.join(__dirname, 'pr-status.js');
  return (n) => new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [script, String(n)],
      { cwd: repoRoot, encoding: 'utf8', timeout: TIMEOUTS.prStatus, maxBuffer: MAX_BUFFER },
      (err, stdout) => {
        if (err) return reject(err);
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

/**
 * Map items through an async fn with at most `limit` in flight; order kept.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// Transcripts
// ═══════════════════════════════════════════════════════════════════

/**
 * Read at most `cap` bytes from the head and `cap` from the tail of a file.
 * Partial lines at the cut points are left to parseLines to drop.
 * @param {string} file
 * @param {number} cap
 * @returns {{head: string, tail: string}}
 */
function readHeadTail(file, cap) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const headLen = Math.min(size, cap);
    const head = Buffer.alloc(headLen);
    fs.readSync(fd, head, 0, headLen, 0);
    let tail = '';
    if (size > headLen) {
      const tailLen = Math.min(cap, size - headLen);
      const buf = Buffer.alloc(tailLen);
      fs.readSync(fd, buf, 0, tailLen, size - tailLen);
      tail = buf.toString('utf8');
    }
    return { head: head.toString('utf8'), tail };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * cwd / gitBranch / first timestamp from a transcript's head and tail.
 * Sessions often start in the main checkout and `cd` into a worktree, so the
 * LATEST cwd/gitBranch (from the tail) wins over the first one.
 * @param {string} file
 * @returns {{cwd: string|null, gitBranch: string|null, startedAt: string|null}}
 */
function transcriptMeta(file) {
  const meta = { cwd: null, gitBranch: null, startedAt: null };
  const { head, tail } = soft(() => readHeadTail(file, META_BYTES), { head: '', tail: '' });
  for (const obj of parseLines(head).concat(parseLines(tail))) {
    if (!meta.startedAt && obj.timestamp) meta.startedAt = obj.timestamp;
    if (obj.cwd) {
      // A cwd change without a gitBranch must not keep the previous dir's branch.
      if (obj.cwd !== meta.cwd || obj.gitBranch) meta.gitBranch = obj.gitBranch || null;
      meta.cwd = obj.cwd;
    }
  }
  return meta;
}

/** tool_use blocks in an assistant transcript line. */
function toolUses(obj) {
  const content = obj && obj.type === 'assistant' && obj.message && obj.message.content;
  return Array.isArray(content) ? content.filter((c) => c && c.type === 'tool_use') : [];
}

/** Text of a user transcript line. */
function userText(obj) {
  if (!obj || obj.type !== 'user' || !obj.message) return '';
  const c = obj.message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('\n');
  return '';
}

/**
 * Bounded forward scan (chunked, capped at SCAN_MAX_BYTES) for brainstorm
 * invocation and issue creation. Lines are substring-prefiltered before
 * JSON.parse so large transcripts stay cheap.
 * Only structured signals count: a Skill tool_use for *brainstorm or a
 * `/envoy:brainstorm` command tag; a Bash tool_use running `gh issue create`.
 * Skill text quoted in user messages never counts.
 * @param {string} file
 * @returns {{brainstorm: boolean, issueCreated: boolean}}
 */
function scanTranscript(file) {
  const res = { brainstorm: false, issueCreated: false };
  const inspect = (line) => {
    if (!line.includes('gh issue create') && !line.includes('"Skill"') && !line.includes('command-name')) return;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (_err) {
      return;
    }
    for (const t of toolUses(obj)) {
      const input = t.input || {};
      if (t.name === 'Skill' && /(^|:)brainstorm$/.test(String(input.skill || ''))) res.brainstorm = true;
      if (t.name === 'Bash' && /\bgh\s+issue\s+create\b/.test(String(input.command || ''))) res.issueCreated = true;
    }
    if (/<command-name>\/?(?:envoy:)?brainstorm<\/command-name>/.test(userText(obj))) res.brainstorm = true;
  };
  soft(() => {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(SCAN_CHUNK);
      let pos = 0;
      let carry = '';
      while (pos < SCAN_MAX_BYTES && !res.issueCreated) {
        const n = fs.readSync(fd, buf, 0, SCAN_CHUNK, pos);
        if (n <= 0) break;
        pos += n;
        const lines = (carry + buf.toString('utf8', 0, n)).split('\n');
        carry = lines.pop();
        for (const l of lines) inspect(l);
      }
      if (carry && !res.issueCreated) inspect(carry);
    } finally {
      fs.closeSync(fd);
    }
  }, null);
  return res;
}

/**
 * All sessions for the given directories, deduped by sessionId, enriched with
 * transcript cwd/branch.
 * @param {string} projectsRoot
 * @param {string[]} dirs
 * @returns {Array<StartSession & {jsonlPath: string, startedAt: string|null}>}
 */
function collectSessions(projectsRoot, dirs) {
  const seen = new Map();
  for (const dir of dirs) {
    const candidates = [encodeProjectDir(dir), String(dir).replace(/\//g, '-')];
    for (const name of new Set(candidates)) {
      const projectDir = path.join(projectsRoot, name);
      if (!soft(() => fs.statSync(projectDir).isDirectory(), false)) continue;
      for (const s of soft(() => discoverSessions(projectDir), [])) {
        if (seen.has(s.sessionId)) continue;
        const meta = transcriptMeta(s.jsonlPath);
        seen.set(s.sessionId, {
          sessionId: s.sessionId,
          summary: cleanSummary(s.summary),
          modified: s.modified,
          cwd: meta.cwd,
          gitBranch: meta.cwd
            ? meta.gitBranch || 'unknown'
            : s.gitBranch && s.gitBranch !== 'unknown' ? s.gitBranch : 'unknown',
          jsonlPath: s.jsonlPath,
          startedAt: meta.startedAt,
        });
      }
    }
  }
  return Array.from(seen.values());
}

// ═══════════════════════════════════════════════════════════════════
// Git / gh sources
// ═══════════════════════════════════════════════════════════════════

/** Parse `git worktree list --porcelain`. */
function parseWorktrees(text) {
  const out = [];
  let cur = null;
  for (const line of String(text).split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice(9).trim(), branch: null };
      out.push(cur);
    } else if (cur && line.startsWith('branch ')) {
      cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
    } else if (cur && line.trim() === 'detached') {
      cur.branch = cur.branch || '(detached)';
    }
  }
  return out;
}

function readLedgerEvents(dir) {
  return soft(() => parseLines(fs.readFileSync(path.join(dir, '.envoy', 'ledger.jsonl'), 'utf8')), []);
}

// ═══════════════════════════════════════════════════════════════════
// collect
// ═══════════════════════════════════════════════════════════════════

/**
 * Collect the /envoy:start snapshot. Read-only and fail-soft.
 * @param {Object} [opts]
 * @param {string} [opts.repoRoot]      Main checkout (default: first `git worktree list` entry).
 * @param {string} [opts.projectsRoot]  Claude projects dir (default ~/.claude/projects).
 * @param {Date}   [opts.now]
 * @param {(args: string[], cwd: string) => string} [opts.git]
 * @param {(args: string[], cwd: string) => string} [opts.gh]
 * @param {(n: number) => object|Promise<object>} [opts.prSnapshot]  pr-status snapshot (sync or async).
 * @param {Function} [opts.execFile]  execFile used by the default prSnapshot runner.
 * @returns {Promise<StartSnapshot>}
 */
async function collect(opts = {}) {
  const now = opts.now || new Date();
  const git = opts.git || defaultGit;
  const gh = opts.gh || defaultGh;
  const projectsRoot = opts.projectsRoot || path.join(os.homedir(), '.claude', 'projects');
  const startCwd = opts.repoRoot || process.cwd();

  // ── git ──
  const wtList = soft(() => parseWorktrees(git(['worktree', 'list', '--porcelain'], startCwd)), []);
  const repoRoot = opts.repoRoot || (wtList[0] && wtList[0].path) || startCwd;
  const url = soft(() => webUrl(git(['remote', 'get-url', 'origin'], repoRoot)), undefined);
  const defaultBranch = soft(
    () => git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], repoRoot).trim().replace(/^origin\//, ''),
    ''
  ) || 'main';
  const hasOrigin = soft(
    () => (git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${defaultBranch}`], repoRoot), true),
    false
  );
  const aheadBase = hasOrigin ? `origin/${defaultBranch}` : defaultBranch;
  const prSnapshot = opts.prSnapshot || makeDefaultPrSnapshot(repoRoot, opts.execFile);
  const localBranches = soft(
    () => git(['branch', '--format=%(refname:short)'], repoRoot).split('\n').map((s) => s.trim()).filter(Boolean),
    []
  );

  // ── gh ──
  const rawPrs = soft(() => JSON.parse(gh(['pr', 'list', '--state', 'open', '--json', 'number,title,headRefName,url'], repoRoot)), []);
  // Merged PRs: a squash-merged branch stays "ahead", so without this its
  // worktree would keep offering hervat instead of cleanup.
  const rawMerged = soft(
    () => JSON.parse(gh(['pr', 'list', '--state', 'merged', '--json', 'number,headRefName', '--limit', '100'], repoRoot)),
    []
  );
  const rawIssues = soft(
    () => JSON.parse(gh(['issue', 'list', '--state', 'open', '--json', 'number,title,body,labels,url', '--limit', '100'], repoRoot)),
    []
  );

  const prs = await mapLimit(Array.isArray(rawPrs) ? rawPrs : [], PR_CONCURRENCY, async (p) => {
    let snap = null;
    try {
      snap = await prSnapshot(p.number);
    } catch (_err) {
      snap = null; // timeout / gh failure: this PR gets ci:null, others still fill
    }
    const ci = snap && snap.ci ? snap.ci.state || null : null;
    const unresolved = (snap && snap.threads && snap.threads.unresolved) || 0;
    return {
      number: p.number,
      title: p.title || '',
      url: p.url || '',
      branch: p.headRefName || '',
      issue: linkedIssue(p.headRefName),
      ci,
      unresolved,
      needsAttention: /^(failure|error)$/i.test(String(ci || '')) || unresolved > 0,
    };
  });

  const issues = (Array.isArray(rawIssues) ? rawIssues : []).map((i) => ({
    number: i.number,
    title: i.title || '',
    description: describeBody(i.body),
    labels: (i.labels || []).map((l) => (typeof l === 'string' ? l : l && l.name)).filter(Boolean),
    url: i.url || '',
    plan: extractEmbeddedBlock(i.body) !== null,
    inProgress: false,
    recommended: false,
  }));

  // ── sessions ──
  const dirs = [repoRoot].concat(wtList.map((w) => w.path));
  const allSessions = soft(() => collectSessions(projectsRoot, Array.from(new Set(dirs))), []);

  const openIssueNums = new Set(issues.map((i) => i.number));
  const alive = new Set([...localBranches, ...wtList.map((w) => w.branch), ...prs.map((p) => p.branch)]);
  const isKept = (s) => {
    const b = s.gitBranch;
    if (b && b !== defaultBranch && b !== 'unknown') {
      if (alive.has(b)) return true;
      if (openIssueNums.has(linkedIssue(b))) return true;
    }
    const age = daysSince(s.modified, now);
    return age !== null && age < RECENT_DAYS;
  };
  const publicSession = (s) => ({
    sessionId: s.sessionId,
    summary: s.summary,
    modified: s.modified,
    cwd: s.cwd,
    gitBranch: s.gitBranch,
  });

  // ── worktrees ──
  const byPath = new Map(wtList.map((w) => [w.path, []]));
  for (const s of allSessions.filter(isKept)) {
    let home = s.cwd && byPath.has(s.cwd) ? s.cwd : null;
    if (!home) {
      const w = wtList.find((x) => x.branch && x.branch === s.gitBranch);
      if (w) home = w.path;
    }
    if (home) byPath.get(home).push(s);
  }

  // A worktree with an open PR is represented by that PR (red → ranked as the
  // PR; green → waiting on review), so it never gets its own verb.
  const prByBranch = new Map(prs.map((p) => [p.branch, p.number]));
  const mergedBranches = new Set(
    (Array.isArray(rawMerged) ? rawMerged : []).map((p) => p && p.headRefName).filter(Boolean)
  );

  const worktrees = wtList.map((w, idx) => {
    const isMain = idx === 0 || w.path === repoRoot;
    const ahead = isMain ? 0 : soft(() => parseInt(git(['rev-list', '--count', `${aheadBase}..HEAD`], w.path), 10) || 0, 0);
    const dirty = soft(() => git(['--no-optional-locks', 'status', '--porcelain'], w.path).trim().length > 0, false);
    const commitAt = soft(() => git(['log', '-1', '--format=%cI'], w.path).trim(), '');
    const sessions = byPath.get(w.path).sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
    const times = [commitAt, ...sessions.map((s) => s.modified)].map((t) => Date.parse(t)).filter((t) => !Number.isNaN(t));
    const lastActivityAt = times.length ? new Date(Math.max(...times)).toISOString() : null;
    const idleDays = lastActivityAt ? daysSince(lastActivityAt, now) : null;
    const stale = !isMain && idleDays !== null && idleDays > STALE_DAYS;
    const pr = prByBranch.has(w.branch) ? prByBranch.get(w.branch) : null;
    const merged = !isMain && pr === null && mergedBranches.has(w.branch);
    let action = null;
    if (!isMain && pr === null) {
      if (merged || stale) action = 'cleanup';
      else if (ahead > 0 || dirty) action = 'hervat';
    }
    return {
      isMain,
      path: w.path,
      branch: w.branch,
      issue: linkedIssue(w.branch),
      ahead,
      dirty,
      lastActivityAt,
      idleDays,
      stale,
      pr,
      merged,
      action,
      sessions: sessions.map(publicSession),
    };
  });

  // ── in-flight issues + recommendation (one sort, reused for ranking) ──
  const inFlight = new Set(
    [...worktrees.map((w) => w.issue), ...prs.map((p) => p.issue)].filter((n) => n !== null)
  );
  for (const i of issues) i.inProgress = inFlight.has(i.number);
  const issueOrder = issues.slice().sort((a, b) => (b.plan - a.plan) || (a.number - b.number));
  const freeIssues = issueOrder.filter((i) => !i.inProgress);
  const pick = freeIssues[0] || issueOrder[0];
  if (pick) pick.recommended = true;

  // ── brainstorms ──
  const sessionById = new Map(allSessions.map((s) => [s.sessionId, s]));
  const ledgerEvents = [];
  for (const dir of Array.from(new Set(dirs))) {
    for (const e of readLedgerEvents(dir)) ledgerEvents.push({ ...e, _dir: dir });
  }
  const withIssue = new Set(ledgerEvents.filter((e) => e.sessionId && e.issue != null).map((e) => e.sessionId));
  const started = new Map();
  for (const e of ledgerEvents) {
    if (e.type !== 'skill-started' || e.skill !== 'brainstorm' || !e.sessionId) continue;
    const prev = started.get(e.sessionId);
    if (!prev || String(e.ts) < String(prev.ts)) started.set(e.sessionId, e);
  }

  const brainstorms = [];
  for (const [sessionId, e] of started) {
    if (withIssue.has(sessionId)) continue;
    const ledgerAge = daysSince(e.ts, now);
    if (ledgerAge === null || ledgerAge >= BRAINSTORM_SCAN_DAYS) continue;
    const s = sessionById.get(sessionId);
    if (s && scanTranscript(s.jsonlPath).issueCreated) continue;
    brainstorms.push({
      sessionId,
      startedAt: e.ts,
      ageDays: ledgerAge,
      topic: s ? s.summary : '',
      cwd: (s && s.cwd) || e._dir,
    });
  }
  for (const s of allSessions) {
    if (started.has(s.sessionId) || withIssue.has(s.sessionId)) continue;
    const age = daysSince(s.modified, now);
    if (age === null || age >= BRAINSTORM_SCAN_DAYS) continue;
    const scan = scanTranscript(s.jsonlPath);
    if (!scan.brainstorm || scan.issueCreated) continue;
    const startedAt = s.startedAt || s.modified;
    brainstorms.push({
      sessionId: s.sessionId,
      startedAt,
      ageDays: daysSince(startedAt, now),
      topic: s.summary,
      cwd: s.cwd || repoRoot,
    });
  }
  brainstorms.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));

  // ── ranking ──
  const ranking = [];
  for (const p of prs.filter((x) => x.needsAttention)) {
    ranking.push({ kind: 'pr', ref: p.number, label: `PR #${p.number} ${p.title}`.trim(), action: 'hervat' });
  }
  // Worktrees rank by the verb computed above (null: main, or has an open PR).
  for (const w of worktrees.filter((x) => x.action === 'hervat')) {
    ranking.push({ kind: 'worktree', ref: w.branch, label: w.branch || w.path, action: 'hervat' });
  }
  for (const b of brainstorms) {
    ranking.push({ kind: 'brainstorm', ref: b.sessionId, label: b.topic || `brainstorm ${b.sessionId.slice(0, 8)}`, action: 'hervat' });
  }
  for (const i of freeIssues) {
    ranking.push({ kind: 'issue', ref: i.number, label: `#${i.number} ${i.title}`.trim(), action: i.plan ? 'pickup' : 'brainstorm' });
  }
  for (const w of worktrees.filter((x) => x.action === 'cleanup')) {
    ranking.push({ kind: 'worktree', ref: w.branch, label: w.branch || w.path, action: 'cleanup' });
  }

  const repo = { root: repoRoot };
  if (url) repo.url = url;

  return {
    generatedAt: now.toISOString(),
    repo,
    brainstorms,
    worktrees: worktrees.map(({ isMain, ...w }) => w),
    prs,
    issues,
    ranking,
    next: ranking[0] || null,
  };
}

// ═══════════════════════════════════════════════════════════════════
// CLI entrypoint
// ═══════════════════════════════════════════════════════════════════

if (require.main === module) {
  collect()
    .catch((err) => {
      process.stderr.write(`start-status: ${err && err.message}\n`);
      return {
        generatedAt: new Date().toISOString(),
        repo: { root: process.cwd() },
        brainstorms: [],
        worktrees: [],
        prs: [],
        issues: [],
        ranking: [],
        next: null,
      };
    })
    .then((snap) => process.stdout.write(`${JSON.stringify(snap, null, 2)}\n`));
}

module.exports = {
  collect,
  encodeProjectDir,
  linkedIssue,
  describeBody,
  parseWorktrees,
  scanTranscript,
  makeDefaultPrSnapshot,
  TIMEOUTS,
  MAX_BUFFER,
  PR_CONCURRENCY,
  RECENT_DAYS,
  STALE_DAYS,
};
