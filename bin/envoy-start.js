#!/usr/bin/env node
'use strict';

/**
 * /envoy:start renderer — prints the lib/start-status.js snapshot as a
 * coloured, box-drawn terminal dashboard: brainstorms without an issue,
 * worktrees/branches, open PRs, open issues, and a NEXT STEP line.
 *
 * Issue and PR numbers are OSC 8 hyperlinks. Column widths are computed on
 * visible text, so ANSI colours and links never break alignment.
 *
 * Usage:
 *   node bin/envoy-start.js          # dashboard
 *   node bin/envoy-start.js --json   # raw snapshot
 *   node bin/envoy-start.js --no-color
 *
 * Colour and OSC 8 links are on by default (also when stdout is not a TTY:
 * Claude Code `!` output and cmux splits render them). A non-empty `NO_COLOR`
 * or `--no-color` disables both; box characters stay.
 *
 * All snapshot text is sanitized: C0/C1 control characters are stripped and
 * links are emitted only for http(s) URLs, so data cannot inject escapes. Read-only and fail-soft: if collecting throws, the error
 * goes to stderr and an empty dashboard is printed (exit 0).
 *
 * Zero external dependencies.
 */

const path = require('path');

const SGR_RE = /\x1b\[[0-9;]*m/g;
const OSC8_RE = /\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)/g;
const ELLIPSIS = '…';
const DASH = '—';
const MIN_COL = 3;
/** Documented minimum: at or above this width every table fits; below it tables may overflow but stay aligned. */
const MIN_WIDTH = 50;
const DEFAULT_WIDTH = 100;
const VERBS = new Set(['hervat', 'pickup', 'brainstorm', 'cleanup']);
const CONTROL_RE = /[\x00-\x1f\x7f-\x9f]/g;
const SAFE_URL_RE = /^https?:\/\/[^\x00-\x20\x7f-\x9f]+$/;

/**
 * Strip C0 and C1 control characters (ESC, BEL, CR, LF, CSI, …) from text.
 * @param {*} value
 * @returns {string}
 */
function clean(value) {
  return value == null ? '' : String(value).replace(CONTROL_RE, '');
}

/**
 * Return the URL when it is a plain http(s) URL without control characters, else null.
 * @param {*} url
 * @returns {string|null}
 */
function safeUrl(url) {
  return typeof url === 'string' && SAFE_URL_RE.test(url) ? url : null;
}

/** Terminal width fallback shared by render and main. */
function defaultWidth() {
  return (process.stdout && process.stdout.columns) || DEFAULT_WIDTH;
}

/**
 * A cell is a list of segments; each segment is plain text with an optional
 * SGR style (e.g. '31' or '1;36') and an optional hyperlink URL.
 * @typedef {{t: string, s?: string, u?: string}} Segment
 * @typedef {Segment[]|string} Cell
 */

/**
 * Visible width of a string: SGR and OSC 8 sequences stripped, code points
 * counted (East Asian wide characters count as 1).
 * @param {string} str
 * @returns {number}
 */
function visibleWidth(str) {
  return Array.from(String(str).replace(OSC8_RE, '').replace(SGR_RE, '')).length;
}

/**
 * Wrap text in an OSC 8 hyperlink (BEL-terminated).
 * @param {string} text
 * @param {string} url
 * @returns {string}
 */
function link(text, url) {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

/** @param {Cell} cell @returns {Segment[]} */
function segs(cell) {
  if (cell == null) return [];
  const list = typeof cell === 'string' ? [{ t: cell }] : cell;
  return list.map((seg) => ({ t: clean(seg.t), s: seg.s, u: safeUrl(seg.u) || undefined }));
}

/** @param {Cell} cell @returns {number} */
function cellWidth(cell) {
  return segs(cell).reduce((n, s) => n + Array.from(s.t).length, 0);
}

/**
 * Render a cell truncated (with an ellipsis) and padded to exactly `w` columns.
 * @param {Cell} cell
 * @param {number} w
 * @param {boolean} color
 * @param {string} [rowStyle]  SGR applied to unstyled segments (e.g. bold).
 * @returns {string}
 */
function fitCell(cell, w, color, rowStyle) {
  const list = segs(cell);
  const overflow = list.reduce((n, seg) => n + Array.from(seg.t).length, 0) > w;
  let budget = overflow ? w - 1 : w;
  let out = '';
  let used = 0;
  for (const seg of list) {
    if (budget <= 0) break;
    const chars = Array.from(seg.t);
    const text = chars.slice(0, budget).join('');
    budget -= Array.from(text).length;
    used += Array.from(text).length;
    out += paint(text, seg.s || rowStyle, seg.u, color);
  }
  if (overflow) { out += paint(ELLIPSIS, '2', null, color); used += 1; }
  return out + ' '.repeat(Math.max(0, w - used));
}

function paint(text, style, url, color) {
  if (!color || !text) return text;
  let s = url ? link(text, url) : text;
  if (style) s = `\x1b[${style}m${s}\x1b[0m`;
  return s;
}

/**
 * Shrink column widths (widest first) until the table fits `maxWidth`.
 * The last column (Action) is never shrunk, so verbs stay whole.
 * @param {number[]} widths
 * @param {number} maxWidth
 */
function fitWidths(widths, maxWidth) {
  const total = () => widths.reduce((a, b) => a + b, 0) + widths.length * 3 + 1;
  while (total() > maxWidth) {
    let iMax = -1;
    for (let i = 0; i < widths.length - 1; i++) {
      if (widths[i] > MIN_COL && (iMax < 0 || widths[i] > widths[iMax])) iMax = i;
    }
    if (iMax < 0) break;
    widths[iMax]--;
  }
  return widths;
}

/**
 * Render one titled, box-drawn table.
 * @param {string} title
 * @param {string[]} headers
 * @param {Array<Cell[]|{cells: Cell[], style?: string}>} rows
 * @param {{color?: boolean, width?: number, placeholder?: string}} [opts]
 * @returns {string}
 */
function table(title, headers, rows, opts = {}) {
  const color = opts.color !== false;
  const maxWidth = opts.width || 100;
  const norm = rows.map((r) => (Array.isArray(r) ? { cells: r } : r));
  const empty = norm.length === 0;

  let widths = headers.map((h, i) => Math.max(cellWidth(h), ...norm.map((r) => cellWidth(r.cells[i]))));
  const placeholder = [{ t: opts.placeholder || 'none', s: '2' }];
  if (empty) {
    const inner = widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * 3;
    const need = cellWidth(placeholder);
    if (need > inner) widths[widths.length - 1] += need - inner;
  }
  widths = fitWidths(widths, maxWidth);

  const hline = (l, m, r, mid = m) => l + widths.map((w) => '─'.repeat(w + 2)).join(mid) + r;
  const line = (cells, style) => '│' + cells.map((c, i) => ' ' + fitCell(c, widths[i], color, style) + ' ').join('│') + '│';

  const out = [paint(title, '1;36', null, color)];
  out.push(hline('┌', '┬', '┐'));
  out.push(line(headers.map((h) => [{ t: h, s: '1' }])));
  if (empty) {
    out.push(hline('├', '┴', '┤'));
    const inner = widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * 3;
    out.push('│ ' + fitCell(placeholder, inner, color) + ' │');
    out.push(hline('└', '─', '┘'));
  } else {
    out.push(hline('├', '┼', '┤'));
    for (const r of norm) out.push(line(r.cells, r.style));
    out.push(hline('└', '┴', '┘'));
  }
  return out.join('\n');
}

const dim = (t) => [{ t, s: '2' }];
const none = () => dim(DASH);

const ACTION_STYLE = { hervat: '1;32', pickup: '36', brainstorm: '35', cleanup: '31' };
function actionCell(verb) {
  return verb ? [{ t: verb, s: ACTION_STYLE[verb] }] : none();
}

function numLink(n, url, prefix = '') {
  const seg = { t: `#${n}`, s: '36' };
  if (safeUrl(url)) seg.u = url;
  return prefix ? [{ t: prefix }, seg] : [seg];
}

function ciCell(ci) {
  if (!ci) return none();
  const s = /fail|error/i.test(ci) ? '31' : /success|pass/i.test(ci) ? '32' : '33';
  return [{ t: ci, s }];
}

/** Recommended first, then planned, then by number. */
function issueSort(a, b) {
  return (Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)))
    || (Number(Boolean(b.plan)) - Number(Boolean(a.plan)))
    || (a.number - b.number);
}

/**
 * Render the full dashboard.
 * @param {import('../lib/start-status').StartSnapshot} snapshot
 * @param {{color?: boolean, width?: number}} [opts]
 * @returns {string}
 */
function render(snapshot, opts = {}) {
  const color = opts.color !== false;
  const width = opts.width || defaultWidth();
  const snap = snapshot || {};
  const repoUrl = safeUrl(snap.repo && snap.repo.url);
  const t = { color, width };

  const brainstorms = (snap.brainstorms || []).map((b) => [
    b.topic ? b.topic : dim(b.sessionId || '(untitled)'),
    b.ageDays == null ? none() : `${b.ageDays}d`,
    actionCell('hervat'),
  ]);

  const worktrees = (snap.worktrees || []).map((w) => {
    const issue = w.issue == null ? none() : numLink(w.issue, repoUrl ? `${repoUrl}/issues/${w.issue}` : null);
    let idle = w.idleDays == null ? none() : [{ t: `${w.idleDays}d`, s: w.stale ? '31' : '2' }];
    // Stale but not offered for cleanup (has work, or nothing to do): flag it next to the idle days.
    if (w.idleDays != null && w.stale && w.action !== 'cleanup') idle = [...idle, { t: ' stale', s: '2' }];
    const sessions = (w.sessions || []).length;
    return [
      w.branch || dim('(detached)'),
      issue,
      // null = the git inspection failed: unknown, not 0 / clean.
      w.ahead == null ? dim('?') : w.ahead > 0 ? [{ t: String(w.ahead), s: '33' }] : dim('0'),
      w.dirty == null ? dim('?') : w.dirty ? [{ t: 'yes', s: '33' }] : dim('no'),
      idle,
      sessions > 0 ? String(sessions) : dim('0'),
      actionCell(w.action),
    ];
  });

  const prs = (snap.prs || []).map((p) => [
    numLink(p.number, p.url),
    p.title || '',
    ciCell(p.ci),
    p.unresolved > 0 ? [{ t: String(p.unresolved), s: '31' }] : dim('0'),
    actionCell(p.needsAttention ? 'hervat' : null),
  ]);

  const issues = (snap.issues || []).slice().sort(issueSort).map((i) => ({
    style: i.recommended ? '1' : undefined,
    cells: [
      numLink(i.number, i.url, i.recommended ? '> ' : '  '),
      [{ t: i.title || '' }, ...(i.description ? [{ t: `  ${i.description}`, s: '2' }] : [])],
      [
        i.plan ? { t: 'yes', s: '32' } : { t: 'no', s: '2' },
        ...(i.inProgress ? [{ t: ' in progress', s: '2' }] : []),
      ],
      actionCell(i.inProgress ? null : i.plan ? 'pickup' : 'brainstorm'),
    ],
  }));

  const parts = [
    table('Brainstorms without issue', ['Topic', 'Age', 'Action'], brainstorms, { ...t, placeholder: 'no open brainstorms' }),
    table('Worktrees / branches', ['Branch', 'Issue', 'Ahead', 'Dirty', 'Idle', 'Sessions', 'Action'], worktrees, { ...t, placeholder: 'no worktrees' }),
    table('Open PRs', ['PR', 'Title', 'CI', 'Threads', 'Action'], prs, { ...t, placeholder: 'no open PRs' }),
    table('Open issues', ['Issue', 'Title', 'Plan', 'Action'], issues, { ...t, placeholder: 'no open issues' }),
  ];

  // NEXT STEP: collector `display` (issue/PR title) preferred over the raw label;
  // the whole line is truncated to the render width.
  const next = snap.next;
  const verb = next && VERBS.has(next.action) ? next.action : null;
  const head = { t: 'NEXT STEP', s: '1;36' };
  const nextSegs = next
    ? [head, { t: '  ' }, verb ? { t: verb, s: ACTION_STYLE[verb] } : { t: DASH, s: '2' }, { t: '  ' },
      { t: next.display || next.label || '', s: '1' }]
    : [head, { t: '  ' }, { t: `nothing open ${DASH} run /envoy:brainstorm`, s: '2' }];
  const nextLine = fitCell(nextSegs, Math.min(width, cellWidth(nextSegs)), color);

  return parts.join('\n\n') + '\n\n' + nextLine + '\n';
}

function emptySnapshot(root) {
  return {
    generatedAt: new Date().toISOString(),
    repo: { root },
    brainstorms: [], worktrees: [], prs: [], issues: [], ranking: [], next: null,
  };
}

/**
 * CLI entry point.
 * @param {string[]} argv  Arguments after the script name (`--json`, `--no-color`).
 * @param {{collect?: Function, stdout?: {write: Function}, stderr?: {write: Function},
 *          env?: Object, cwd?: string, width?: number}} [deps]
 *   `collect` may be sync or return a Promise.
 *   Fail-soft: a throwing `collect` or `render` prints an empty dashboard.
 * @returns {Promise<number>} Exit code (always 0).
 */
async function main(argv = [], deps = {}) {
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;
  const env = deps.env || process.env;
  const cwd = deps.cwd || process.cwd();
  const collect = deps.collect || require(path.join(__dirname, '..', 'lib', 'start-status')).collect;

  let snapshot;
  try {
    snapshot = await collect({ cwd });
  } catch (err) {
    stderr.write(`envoy-start: could not collect status: ${err && err.message ? err.message : err}\n`);
    snapshot = emptySnapshot(cwd);
  }

  if (argv.includes('--json')) {
    stdout.write(JSON.stringify(snapshot, null, 2) + '\n');
    return 0;
  }

  // Not gated on isTTY: `!` output and cmux splits are non-TTY but render colour + OSC 8.
  const color = !env.NO_COLOR && !argv.includes('--no-color'); // no-color.org: set and non-empty
  const width = deps.width || defaultWidth();
  let out;
  try {
    out = render(snapshot, { color, width });
  } catch (err) {
    stderr.write(`envoy-start: could not render status: ${err && err.message ? err.message : err}\n`);
    out = render(emptySnapshot(cwd), { color, width });
  }
  stdout.write(out);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      process.stderr.write(`envoy-start: ${err && err.message ? err.message : err}\n`);
      process.exitCode = 0;
    });
}

module.exports = { render, table, visibleWidth, link, main, MIN_WIDTH };
