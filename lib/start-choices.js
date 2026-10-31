#!/usr/bin/env node
'use strict';

/**
 * /envoy:start choices — turns a lib/start-status.js snapshot into the 2–4
 * AskUserQuestion options, and dispatches a chosen option by its index.
 *
 * The skill (skills/start) only ever passes an option INDEX back in. Branch
 * names, paths, issue titles and session ids are read from the snapshot here
 * and handed to lib/open-session.js as argv entries (execFile, never a shell
 * string), so nothing from the snapshot is hand-copied into a shell command.
 *
 * CLI:
 *   node lib/start-choices.js options <snapshot.json>          JSON option array
 *   node lib/start-choices.js resume  <snapshot.json> <index>  open the session
 *   node lib/start-choices.js dir     <snapshot.json> <index>  print worktree path
 *
 * Zero external dependencies. `execFile` and `log` are injectable for tests.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { computeTitle } = require('./tab-title');

const LABEL_MAX = 60;
const DESC_MAX = 120;
const OPEN_SESSION = path.join(__dirname, 'open-session.js');

/**
 * @typedef {Object} StartOption
 * @property {number} index        1-based position, what the skill passes back.
 * @property {string} label        e.g. `Hervat #83: <title>` (≤ 60 chars).
 * @property {string} description  One-line reason (≤ 120 chars).
 * @property {'hervat'|'pickup'|'brainstorm'|'cleanup'|'none'} action
 * @property {'pr'|'worktree'|'brainstorm'|'issue'|'new'|'none'} kind
 * @property {string|number|null} ref
 */

/** Cut to n code points with an ellipsis. */
function cut(text, n) {
  const chars = Array.from(String(text || ''));
  return chars.length > n ? `${chars.slice(0, n - 1).join('').trimEnd()}…` : chars.join('');
}

const issueOf = (s, n) => (s.issues || []).find((i) => i.number === n) || null;
const prOf = (s, n) => (s.prs || []).find((p) => String(p.number) === String(n)) || null;
const worktreeOf = (s, branch) => (s.worktrees || []).find((w) => w.branch === branch) || null;

/**
 * Build the option list: ranking deduped (a PR and its own worktree count
 * once, as the PR), first 3, plus the recommended issue, padded to ≥ 2.
 * @param {object} s  StartSnapshot
 * @returns {StartOption[]}
 */
function buildOptions(s) {
  const ranking = s.ranking || [];
  const prBranches = new Set(
    ranking.filter((r) => r.kind === 'pr').map((r) => (prOf(s, r.ref) || {}).branch).filter(Boolean),
  );
  const seen = new Set();
  const deduped = [];
  for (const r of ranking) {
    if (r.kind === 'worktree' && r.action === 'hervat' && prBranches.has(r.ref)) continue;
    const key = `${r.kind}:${r.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }
  const items = deduped.slice(0, 3);
  const rec = (s.issues || []).find((i) => i.recommended);
  if (rec && !items.some((r) => r.kind === 'issue' && r.ref === rec.number)) {
    items.push(
      deduped.find((r) => r.kind === 'issue' && r.ref === rec.number) ||
        { kind: 'issue', ref: rec.number, label: `#${rec.number} ${rec.title}`, action: rec.plan ? 'pickup' : 'brainstorm' },
    );
  }

  const out = items.map((r) => describe(s, r));
  if (out.length < 2) {
    out.push({ label: 'Brainstorm something new', description: 'Start a new idea with envoy:brainstorm', action: 'brainstorm', kind: 'new', ref: null });
  }
  if (out.length < 2) {
    out.push({ label: 'Nothing for now', description: 'Close the dashboard without starting anything', action: 'none', kind: 'none', ref: null });
  }
  return out.map((o, i) => ({ index: i + 1, ...o, label: cut(o.label, LABEL_MAX), description: cut(o.description, DESC_MAX) }));
}

/** Label + description for one ranking item. */
function describe(s, r) {
  let label;
  let why;
  if (r.kind === 'pr') {
    const p = prOf(s, r.ref) || {};
    label = `Hervat PR #${r.ref}: ${p.title || ''}`;
    why = [p.ci && `CI ${p.ci}`, p.unresolved && `${p.unresolved} unresolved threads`].filter(Boolean).join(', ');
  } else if (r.kind === 'worktree') {
    const w = worktreeOf(s, r.ref) || { sessions: [] };
    if (r.action === 'cleanup') {
      label = `Cleanup ${r.ref}`;
      why = w.merged ? 'PR merged' : `stale, idle ${w.idleDays} days`;
    } else {
      const t = (w.issue && issueOf(s, w.issue)) || (s.prs || []).find((p) => p.branch === r.ref);
      label = w.issue ? `Hervat #${w.issue}: ${t ? t.title : r.ref}` : `Hervat ${r.ref}`;
      why = [`${w.ahead} commits ahead`, w.dirty && 'uncommitted changes', `${(w.sessions || []).length} session(s)`]
        .filter(Boolean)
        .join(', ');
    }
  } else if (r.kind === 'brainstorm') {
    const b = (s.brainstorms || []).find((x) => x.sessionId === r.ref) || {};
    label = `Hervat brainstorm: ${b.topic || String(r.ref).slice(0, 8)}`;
    why = `brainstorm from ${b.ageDays} days ago, no issue yet`;
  } else {
    const i = issueOf(s, r.ref) || {};
    label = `${r.action === 'pickup' ? 'Pickup' : 'Brainstorm'} #${r.ref}: ${i.title || ''}`;
    why = [i.recommended && 'recommended', i.plan ? 'has plan' : 'no plan yet', i.description].filter(Boolean).join(' · ');
  }
  return { label: label.trim(), description: why || r.label || '', action: r.action, kind: r.kind, ref: r.ref };
}

/** Newest session by parsed date (string order breaks across UTC offsets). */
function newestSession(sessions) {
  const t = (x) => new Date(x.modified).getTime() || 0;
  return [...(sessions || [])].sort((a, b) => t(b) - t(a))[0] || null;
}

/**
 * Resolve a resume target to directory, session id and tab-title parts.
 * @param {object} s  StartSnapshot
 * @param {{kind: string, ref: string|number}} option
 * @returns {{dir: string|null, session: string|null, issue: number|null, pr: number|null,
 *   issueTitle: string|null, prWithoutWorktree: boolean}}
 */
function resolve(s, option) {
  let wt = null;
  let pr = null;
  let dir = null;
  let session = null;
  if (option.kind === 'brainstorm') {
    const b = (s.brainstorms || []).find((x) => x.sessionId === option.ref);
    if (b) { dir = b.cwd || null; session = b.sessionId; }
  } else {
    if (option.kind === 'pr') {
      pr = prOf(s, option.ref);
      wt = pr ? worktreeOf(s, pr.branch) : null;
    } else {
      wt = worktreeOf(s, option.ref);
    }
    if (wt) {
      dir = wt.path;
      const n = newestSession(wt.sessions);
      session = n ? n.sessionId : null;
      if (!pr) pr = (s.prs || []).find((p) => p.branch === wt.branch) || null;
    }
  }
  const issue = (wt && wt.issue) || (pr && pr.issue) || null;
  const it = issue ? issueOf(s, issue) : null;
  return {
    dir,
    session,
    issue,
    pr: pr ? pr.number : null,
    issueTitle: (it && it.title) || (pr && pr.title) || null,
    prWithoutWorktree: option.kind === 'pr' && !wt,
  };
}

/** Option at a 1-based index, or throw. */
function optionAt(s, index) {
  const opt = buildOptions(s).find((o) => o.index === Number(index));
  if (!opt) throw new Error(`no option ${index}`);
  return opt;
}

/**
 * Resume option `index`: open its newest session via lib/open-session.js,
 * or explain why there is nothing to open.
 * @param {object} s  StartSnapshot
 * @param {number|string} index
 * @param {{execFile?: Function, log?: Function}} [deps]
 * @returns {{opened: boolean}}
 */
function resume(s, index, deps = {}) {
  const execFile = deps.execFile || execFileSync;
  const log = deps.log || console.log;
  const opt = optionAt(s, index);
  if (opt.action !== 'hervat') throw new Error(`option ${index} is not a resume option (${opt.action})`);
  const r = resolve(s, opt);
  if (r.prWithoutWorktree) {
    log(`PR #${r.pr} has no local worktree. Use envoy:babysit to move it forward, or check it out with: gh pr checkout ${r.pr}`);
    return { opened: false };
  }
  if (!r.session) {
    log('No Claude session recorded for this item.');
    if (r.dir) log(`Start a fresh session in: ${r.dir}`);
    return { opened: false };
  }
  const title = computeTitle({ issue: r.issue, pr: r.pr, issueTitle: r.issueTitle }) || '';
  execFile(process.execPath, [OPEN_SESSION, '--dir', r.dir, '--session', r.session, '--title', title], { stdio: 'inherit' });
  return { opened: true };
}

/**
 * Worktree path of option `index` (used to cd before envoy:cleanup).
 * @returns {string|null}
 */
function optionDir(s, index) {
  const opt = optionAt(s, index);
  if (opt.kind === 'worktree') return (worktreeOf(s, opt.ref) || {}).path || null;
  return resolve(s, opt).dir;
}

if (require.main === module) {
  const [cmd, file, index] = process.argv.slice(2);
  try {
    if (!file) throw new Error('missing <snapshot.json>');
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (cmd === 'options') {
      process.stdout.write(`${JSON.stringify(buildOptions(s), null, 2)}\n`);
    } else if (cmd === 'resume') {
      resume(s, index);
    } else if (cmd === 'dir') {
      const dir = optionDir(s, index);
      if (!dir) throw new Error(`option ${index} has no directory`);
      process.stdout.write(`${dir}\n`);
    } else {
      throw new Error(`unknown command: ${cmd || '(none)'}`);
    }
  } catch (err) {
    process.stderr.write(
      `start-choices: ${err.message}\nusage: node lib/start-choices.js options|resume|dir <snapshot.json> [index]\n`,
    );
    process.exit(1);
  }
}

module.exports = { buildOptions, resolve, resume, optionDir, newestSession, LABEL_MAX };
