#!/usr/bin/env node
/**
 * PreToolUse hook: Config protection
 *
 * Blocks modifications to linter/formatter config files,
 * forcing Claude to fix source code instead of weakening rules.
 *
 * Two entry points share one decision (evaluateBasename):
 *  - run(rawInput)     — Edit/Write path; process.exit(2) on block
 *  - runBash(rawInput) — Bash path; RETURNS 0/2 (never exits) so
 *                        bash-guard-combined can run other guards too
 *
 * ENVOY_OVERRIDE (non-empty and not "0"/"false", case-insensitive) lets a
 * protected write through on both paths — same semantics as observe-gate.
 */

const path = require('path');

const BLOCKED_PATTERNS = [
  /^\.eslintrc/,
  /^eslint\.config\./,
  /^\.prettierrc/,
  /^prettier\.config\./,
  /^biome\.json$/,
  /^\.editorconfig$/,
];

const WARN_PATTERNS = [
  /^tsconfig\.json$/,
  /^tsconfig\..+\.json$/,
];

// Bash path only: anchored to real config file names, so look-alikes such
// as `.eslintrc.json.bak`, `.eslintrc.patch` or `.prettierrc.log` written by
// ordinary commands are not blocked. The Edit/Write path keeps the broader
// prefix patterns above (unchanged behaviour).
const BASH_BLOCKED_PATTERNS = [
  /^\.eslintrc(\.(json|js|cjs|yaml|yml))?$/,
  /^eslint\.config\.(js|cjs|mjs|ts|cts|mts)$/,
  /^\.prettierrc(\.(json|js|cjs|mjs|ts|cts|mts|yaml|yml|toml|json5))?$/,
  /^prettier\.config\.(js|cjs|mjs|ts|cts|mts)$/,
  /^biome\.jsonc?$/,
  /^\.editorconfig$/,
];

// WARN_PATTERNS are already end-anchored (`tsconfig.json.bak` never matches).
const BASH_WARN_PATTERNS = WARN_PATTERNS;

function blockReason(basename) {
  return `BLOCKED: Cannot modify ${basename}. Fix source code instead of weakening linter/formatter config.`;
}

function warnReason(basename) {
  return `WARNING: Modifying ${basename}. Ensure this is intentional and not to suppress errors.`;
}

function overrideActive() {
  const ov = (process.env.ENVOY_OVERRIDE || '').trim().toLowerCase();
  return ov !== '' && ov !== '0' && ov !== 'false';
}

/**
 * Classify a file path by basename.
 * @param {string} filePath
 * @param {RegExp[]} [blocked] defaults to BLOCKED_PATTERNS (Edit/Write)
 * @param {RegExp[]} [warn] defaults to WARN_PATTERNS (Edit/Write)
 * @returns {{decision: 'block'|'warn', reason: string} | null}
 */
function evaluateBasename(filePath, blocked = BLOCKED_PATTERNS, warn = WARN_PATTERNS) {
  const basename = path.basename(filePath);
  if (!basename) return null;
  for (const pattern of blocked) {
    if (pattern.test(basename)) return { decision: 'block', reason: blockReason(basename) };
  }
  for (const pattern of warn) {
    if (pattern.test(basename)) return { decision: 'warn', reason: warnReason(basename) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bash write-target parser
//
// Pure string scanning: the command is NEVER executed, evaluated or passed to
// a shell. Supported write forms:
//   - redirects to a file: `>`, `>>`, `>|`, `&>`, `&>>`, `N>`, `N>>`, `>&file`
//     (`>&2`, `2>&1`, `>&-` are fd dups, not files; `<`, `<<`, `<<<` are reads)
//   - `tee [-a] <files>`
//   - `sed -i[suffix]` / `--in-place` — every file operand (script skipped)
//   - `cp` / `mv` / `install` — last operand; with `-t DIR` /
//     `--target-directory=DIR`, DIR/<basename of each source>
//   - heredoc redirects (`cat > f <<EOF`) via the redirect; heredoc BODIES are
//     stripped first (stripHeredocBodies), even inside "$(...)", so text
//     inside them is never mistaken for a redirect
// Chains split on `;`, `&&`, `||`, `|`, `&`, newlines and `( )`. Quotes
// ('...', "...", backslash) are honoured. Leading `VAR=val` assignments and
// `sudo`/`env`/`command`/`nohup`/`time`/`exec` wrappers (and their options,
// see WRAPPER_ARG_OPTS) are skipped. `#` comments are ignored. Inside
// `[[ ... ]]`, `>` / `<` are string comparisons, not redirects.
// runBash only blocks targets that resolve inside the project (cwd); `~...`
// and absolute paths outside cwd pass. Names are matched with the anchored
// BASH_* patterns.
//
// Known limits (deliberate false negatives — prefer these over blocking
// normal commands): command substitution `$(...)` / backticks and
// `bash -c "..."` / `eval` strings are opaque (not recursed into); variable
// expansion is not performed (only the literal basename is checked);
// `rm`, `mv` SOURCES (rename-away), `ln`, `dd of=`, `truncate`, `perl -i`,
// `python -c`, `npx prettier --write` etc. are not detected; `cp`/`mv` into a
// directory operand (e.g. `cp x/.eslintrc.json ./`) is checked by the
// operand's own basename only (only `-t DIR` maps source basenames); a `<<`
// inside a quoted string (or arithmetic `$(( a << 2 ))`) may over-strip
// following lines; symlinked paths are compared lexically, not via realpath;
// a target starting with `$VAR` is resolved literally, relative to cwd.
// ---------------------------------------------------------------------------

/**
 * Remove heredoc BODY lines from the raw command before tokenizing, wherever
 * the heredoc appears (top level, inside "$(...)", inside quotes). The opener
 * line is kept so `cat > f <<EOF` still yields its redirect; body and
 * terminator lines are dropped.
 * Without this, a body containing `"` or `)` (e.g. a commit message passed as
 * "$(cat <<'EOF' ... EOF)") desynchronises quote / paren scanning and body
 * text gets parsed as commands. Over-stripping only causes false negatives.
 * @param {string} s
 * @returns {string}
 */
function stripHeredocBodies(s) {
  const lines = String(s || '').split('\n');
  const out = [];
  const opener = /(?<!<)<<(?!<)(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g;
  let k = 0;
  while (k < lines.length) {
    const line = lines[k];
    out.push(line);
    k++;
    const pending = [];
    let m;
    opener.lastIndex = 0;
    while ((m = opener.exec(line)) !== null) pending.push({ strip: m[1] === '-', delim: m[3] });
    for (const { strip, delim } of pending) {
      while (k < lines.length) {
        const body = strip ? lines[k].replace(/^\t+/, '') : lines[k];
        k++;
        if (body === delim) break;
      }
    }
  }
  return out.join('\n');
}

// Wrapper commands and which of their options consume a following argument.
// Unknown options are skipped as flags (conservative: at worst we look at the
// wrong word and miss a write — a false negative).
const WRAPPER_ARG_OPTS = {
  sudo: new Set(['-u', '-g', '-U', '-C', '-p', '-r', '-t', '-D', '-h']),
  env: new Set(['-u', '-C', '-S', '--unset', '--chdir', '--split-string']),
  command: new Set(),
  nohup: new Set(),
  time: new Set(['-f', '-o', '--format', '--output']),
  exec: new Set(['-a']),
};

/**
 * Tokenize a shell command into segments of words and redirects.
 * @param {string} command
 * @returns {Array<{words: string[], redirects: Array<{op: string, fd: string, target: string}>}>}
 */
function tokenize(command) {
  const segments = [];
  let current = { words: [], redirects: [] };
  let word = null; // null = no word in progress
  let pendingRedirect = null; // redirect awaiting its target word
  let heredocDelimiterNext = false; // next word is a heredoc delimiter (body already stripped)

  const s = stripHeredocBodies(command);
  let i = 0;

  function finishWord() {
    if (word === null) return;
    const w = word;
    word = null;
    if (heredocDelimiterNext) {
      heredocDelimiterNext = false;
      return;
    }
    if (pendingRedirect) {
      pendingRedirect.target = w;
      current.redirects.push(pendingRedirect);
      pendingRedirect = null;
      return;
    }
    current.words.push(w);
  }

  function finishSegment() {
    finishWord();
    pendingRedirect = null;
    if (current.words.length || current.redirects.length) segments.push(current);
    current = { words: [], redirects: [] };
  }

  function inDoubleBracket() {
    return current.words.lastIndexOf('[[') > current.words.lastIndexOf(']]');
  }

  while (i < s.length) {
    const c = s[i];

    if (c === '\n') {
      finishSegment();
      heredocDelimiterNext = false;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t') { finishWord(); i++; continue; }
    if (c === '#' && word === null) {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      const stop = end === -1 ? s.length : end;
      word = (word || '') + s.slice(i + 1, stop);
      i = stop + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let buf = '';
      while (j < s.length && s[j] !== '"') {
        if (s[j] === '\\' && j + 1 < s.length) { buf += s[j + 1]; j += 2; continue; }
        buf += s[j];
        j++;
      }
      word = (word || '') + buf;
      i = j + 1;
      continue;
    }
    if (c === '\\') {
      if (i + 1 < s.length && s[i + 1] !== '\n') word = (word || '') + s[i + 1];
      i += 2;
      continue;
    }
    if (c === '$' && s[i + 1] === '(') {
      // Opaque command substitution: consume to the matching paren.
      let depth = 0;
      let j = i + 1;
      for (; j < s.length; j++) {
        if (s[j] === '(') depth++;
        else if (s[j] === ')') { depth--; if (depth === 0) break; }
      }
      word = (word || '') + s.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '`') {
      const end = s.indexOf('`', i + 1);
      const stop = end === -1 ? s.length : end;
      word = (word || '') + s.slice(i, stop + 1);
      i = stop + 1;
      continue;
    }
    if (c === ';' || c === '|' || c === '(' || c === ')') {
      finishSegment();
      i += (c === '|' && s[i + 1] === '|') ? 2 : 1;
      continue;
    }
    if (c === '&') {
      if (s[i + 1] === '>') {
        finishWord();
        const op = s[i + 2] === '>' ? '&>>' : '&>';
        pendingRedirect = { op, fd: '&', target: null };
        i += op.length;
        continue;
      }
      finishSegment();
      i += s[i + 1] === '&' ? 2 : 1;
      continue;
    }
    if ((c === '>' || c === '<') && inDoubleBracket()) {
      // `[[ a > b ]]` is a string comparison, not a redirect.
      finishWord();
      current.words.push(c);
      i++;
      continue;
    }
    if (c === '>' || c === '<') {
      // A word consisting only of digits right before the operator is an fd.
      let fd = c === '>' ? '1' : '0';
      if (word !== null && /^\d+$/.test(word)) { fd = word; word = null; }
      finishWord();
      if (c === '<') {
        if (s.startsWith('<<<', i)) { pendingRedirect = { op: '<<<', fd, target: null }; i += 3; continue; }
        if (s.startsWith('<<', i)) {
          heredocDelimiterNext = true;
          i += s[i + 2] === '-' ? 3 : 2;
          continue;
        }
        if (s[i + 1] === '>') { pendingRedirect = { op: '<>', fd, target: null }; i += 2; continue; }
        if (s[i + 1] === '&') { pendingRedirect = { op: '<&', fd, target: null }; i += 2; continue; }
        pendingRedirect = { op: '<', fd, target: null };
        i += 1;
        continue;
      }
      let op = '>';
      if (s[i + 1] === '>') op = '>>';
      else if (s[i + 1] === '|') op = '>|';
      else if (s[i + 1] === '&') op = '>&';
      pendingRedirect = { op, fd, target: null };
      i += op.length;
      continue;
    }
    word = (word || '') + c;
    i++;
  }
  finishSegment();
  return segments;
}

function commandWords(words) {
  let k = 0;
  while (k < words.length) {
    const w = words[k];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) { k++; continue; }
    if (Object.prototype.hasOwnProperty.call(WRAPPER_ARG_OPTS, w)) {
      const argOpts = WRAPPER_ARG_OPTS[w];
      k++;
      while (k < words.length && words[k].startsWith('-') && words[k] !== '-') {
        if (words[k] === '--') { k++; break; }
        k += argOpts.has(words[k]) ? 2 : 1;
      }
      continue;
    }
    break;
  }
  return words.slice(k);
}

function teeTargets(args) {
  const out = [];
  let endOpts = false;
  for (const a of args) {
    if (!endOpts && a === '--') { endOpts = true; continue; }
    if (!endOpts && a.startsWith('-') && a !== '-') continue;
    out.push(a);
  }
  return out;
}

function sedTargets(args) {
  let inPlace = false;
  let explicitScript = false;
  const operands = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === '--in-place' || a.startsWith('--in-place=') || /^-[a-zA-Z]*i/.test(a) && !a.startsWith('--')) {
      inPlace = true;
      // `-i` combined with other short flags before it (e.g. -Ei) is fine;
      // the suffix (if any) is attached. A separate BSD suffix arg is
      // simply treated as an operand (an empty/".bak" string never matches).
      if (/^-[a-zA-Z]*[ef]$/.test(a)) { explicitScript = true; k++; }
      continue;
    }
    if (a === '-e' || a === '-f' || a === '--expression' || a === '--file') { explicitScript = true; k++; continue; }
    if (a.startsWith('--expression=') || a.startsWith('--file=')) { explicitScript = true; continue; }
    if (a === '-l') { k++; continue; }
    if (a.startsWith('-') && a !== '-') continue;
    operands.push(a);
  }
  if (!inPlace) return [];
  if (!explicitScript && operands.length) {
    // BSD `sed -i '' script file`: '' is the suffix, script follows.
    if (operands[0] === '' && operands.length > 1) return operands.slice(2);
    return operands.slice(1);
  }
  return operands;
}

function copyTargets(args) {
  let targetDir = null;
  const operands = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === '-t' || a === '--target-directory') { targetDir = args[k + 1] || null; k++; continue; }
    if (a.startsWith('--target-directory=')) { targetDir = a.slice('--target-directory='.length); continue; }
    if (/^-(m|o|g|S)$/.test(a)) { k++; continue; } // install options with values
    if (a.startsWith('-') && a !== '-') continue;
    operands.push(a);
  }
  if (targetDir !== null) {
    return operands.map((src) => path.posix.join(targetDir, path.basename(src)));
  }
  if (operands.length < 2) return [];
  return [operands[operands.length - 1]];
}

/**
 * Extract the file paths a Bash command would write to (best effort).
 * Pure: never executes or evaluates the command.
 * @param {string} command
 * @returns {string[]}
 */
function extractWriteTargets(command) {
  const targets = [];
  for (const seg of tokenize(command)) {
    for (const r of seg.redirects) {
      if (r.target === null || r.target === undefined) continue;
      if (r.op === '<' || r.op === '<<<' || r.op === '<&' || r.op === '<>') continue;
      if (r.op === '>&' && /^(\d+|-)$/.test(r.target)) continue; // fd dup
      targets.push(r.target);
    }
    const words = commandWords(seg.words);
    if (!words.length) continue;
    const cmd = path.basename(words[0]);
    const args = words.slice(1);
    if (cmd === 'tee') targets.push(...teeTargets(args));
    else if (cmd === 'sed' || cmd === 'gsed') targets.push(...sedTargets(args));
    else if (cmd === 'cp' || cmd === 'mv' || cmd === 'install') targets.push(...copyTargets(args));
  }
  return targets;
}

/**
 * True when a write target resolves inside cwd (lexically). `~` paths are
 * outside by definition; absolute paths count only if they land under cwd.
 * @param {string} target
 * @param {string} cwd
 * @returns {boolean}
 */
function insideProject(target, cwd) {
  if (!target || target.startsWith('~')) return false;
  const rel = path.relative(cwd, path.resolve(cwd, target));
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

function emit(decision, reason) {
  process.stderr.write(JSON.stringify({ decision, reason }) + '\n');
}

/**
 * Bash path. Returns 2 to block, 0 to allow. Never calls process.exit.
 * @param {string|object} rawInput
 * @returns {number}
 */
function runBash(rawInput) {
  try {
    const input = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
    if ((input.tool_name || '') !== 'Bash') return 0;
    const command = input.tool_input?.command || '';
    if (!command) return 0;

    let warned = null;
    const cwd = process.cwd();
    for (const target of extractWriteTargets(command)) {
      if (!insideProject(target, cwd)) continue;
      const result = evaluateBasename(target, BASH_BLOCKED_PATTERNS, BASH_WARN_PATTERNS);
      if (!result) continue;
      if (result.decision === 'block') {
        if (overrideActive()) continue;
        emit('block', result.reason);
        return 2;
      }
      if (!warned) warned = result.reason;
    }
    if (warned) emit('warn', warned);
    return 0;
  } catch (err) {
    return 0; // Don't block on errors in the hook itself
  }
}

function run(rawInput) {
  try {
    const input = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
    const toolName = input.tool_name || '';
    const filePath = input.tool_input?.file_path || '';

    if (!filePath) return;
    if (!['Edit', 'Write'].includes(toolName)) return;

    const result = evaluateBasename(filePath);
    if (!result) return;

    if (result.decision === 'block') {
      if (overrideActive()) return;
      // Exit code 2 = block the tool call
      console.error(JSON.stringify({ decision: 'block', reason: result.reason }));
      process.exit(2);
    }

    console.error(JSON.stringify({ decision: 'warn', reason: result.reason }));
  } catch (err) {
    // Don't block on errors in the hook itself
  }
}

// CLI mode
if (require.main === module) {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { data += chunk; });
  process.stdin.on('end', () => {
    run(data);
    process.exit(0);
  });
}

module.exports = {
  run,
  runBash,
  evaluateBasename,
  extractWriteTargets,
  insideProject,
  blockReason,
  BLOCKED_PATTERNS,
  WARN_PATTERNS,
  BASH_BLOCKED_PATTERNS,
  BASH_WARN_PATTERNS,
};
