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
// Directory changes: `cd DIR` / `pushd DIR` (scoped to its `( ... )` subshell)
// and `env -C DIR` move the base that later relative targets resolve against;
// when DIR cannot be established (`cd`, `cd -`, `~`, `$VAR`, `$(...)`),
// relative targets after it are not blocked (absolute targets still are).
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
// Shell reserved words that may precede the real command in a segment
// (`if sed -i ...`, `then tee ...`, `do cp ...`). Only unquoted words count:
// `echo 'then'` is not a keyword.
const COMPOUND_KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{']);

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
 * Each segment carries `quoted[]` (parallel to `words`: true when any part of
 * the word was quoted or escaped) and `depth` (the `( ... )` subshell nesting
 * level it runs at).
 * @returns {Array<{words: string[], quoted: boolean[], depth: number, redirects: Array<{op: string, fd: string, target: string}>}>}
 */
function tokenize(command) {
  const segments = [];
  let depth = 0; // ( ... ) subshell nesting
  const newSegment = () => ({ words: [], quoted: [], depth, redirects: [] });
  let current = newSegment();
  let word = null; // null = no word in progress
  let wordQuoted = false; // any part of the current word was quoted/escaped
  let pendingRedirect = null; // redirect awaiting its target word
  let heredocDelimiterNext = false; // next word is a heredoc delimiter (body already stripped)
  // Inside `[[ ... ]]`: `>`/`<` are comparisons and `&&`, `||`, `(`, `)` are
  // condition operators, not segment boundaries. Tracked at tokenizer level so
  // the scope survives those operators.
  let inDoubleBracket = false;

  const s = stripHeredocBodies(command);
  let i = 0;

  function finishWord() {
    if (word === null) return;
    const w = word;
    const q = wordQuoted;
    word = null;
    wordQuoted = false;
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
    if (!q && w === '[[') inDoubleBracket = true;
    else if (!q && w === ']]') inDoubleBracket = false;
    current.words.push(w);
    current.quoted.push(q);
  }

  function pushOperatorWord(op) {
    finishWord();
    current.words.push(op);
    current.quoted.push(false);
  }

  function finishSegment() {
    finishWord();
    pendingRedirect = null;
    inDoubleBracket = false;
    if (current.words.length || current.redirects.length) segments.push(current);
    current = newSegment();
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
      wordQuoted = true;
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
      wordQuoted = true;
      i = j + 1;
      continue;
    }
    if (c === '\\') {
      if (i + 1 < s.length && s[i + 1] !== '\n') { word = (word || '') + s[i + 1]; wordQuoted = true; }
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
    if ((c === '|' || c === '(' || c === ')') && inDoubleBracket) {
      const op = (c === '|' && s[i + 1] === '|') ? '||' : c;
      pushOperatorWord(op);
      i += op.length;
      continue;
    }
    if (c === ';' || c === '|' || c === '(' || c === ')') {
      finishSegment();
      if (c === '(') depth++;
      else if (c === ')') depth = Math.max(0, depth - 1);
      current.depth = depth;
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
      if (inDoubleBracket && s[i + 1] === '&') {
        pushOperatorWord('&&');
        i += 2;
        continue;
      }
      finishSegment();
      i += s[i + 1] === '&' ? 2 : 1;
      continue;
    }
    if ((c === '>' || c === '<') && inDoubleBracket) {
      // `[[ a > b ]]` is a string comparison, not a redirect.
      pushOperatorWord(c);
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

function commandWords(words, quoted = []) {
  let k = 0;
  while (k < words.length) {
    const w = words[k];
    if (!quoted[k] && COMPOUND_KEYWORDS.has(w)) { k++; continue; }
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
    // Attached script options (`-e's/a/b/'`, `-frules.sed`) carry their own
    // argument; recognise them before the in-place check so the file operand
    // is not mistaken for the script.
    if (/^-[ef]./.test(a)) { explicitScript = true; continue; }
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

// A directory operand we can resolve lexically (no ~, variables or substitutions).
function resolvableDir(d) {
  return typeof d === 'string' && d !== '' && d !== '-' && !d.startsWith('~') && !/[$`]/.test(d);
}

/**
 * `env -C DIR` / `env --chdir DIR` / `--chdir=DIR` / `-CDIR` in a segment's
 * wrapper prefix. Returns undefined when absent, the DIR string when found.
 * @param {string[]} words
 * @returns {string|undefined}
 */
function envChdir(words) {
  const at = words.indexOf('env');
  if (at === -1) return undefined;
  for (let k = at + 1; k < words.length; k++) {
    const a = words[k];
    if (a === '-C' || a === '--chdir') return words[k + 1] || '';
    if (a.startsWith('--chdir=')) return a.slice('--chdir='.length);
    if (/^-C./.test(a)) return a.slice(2);
    if (!a.startsWith('-') && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) break;
  }
  return undefined;
}

/**
 * Extract the write targets of a Bash command together with the directory
 * changes in effect when each runs. `dirs` is the list of `cd`/`env -C`
 * operands to apply (in order) to the payload cwd, or null when the effective
 * directory cannot be established. Pure: never executes the command.
 * @param {string} command
 * @returns {Array<{target: string, dirs: string[]|null}>}
 */
function extractWriteTargetsWithDirs(command) {
  const out = [];
  // dirStack[d] = cd operands in effect at subshell depth d (null = unknown).
  const dirStack = [[]];
  for (const seg of tokenize(command)) {
    const d = seg.depth || 0;
    while (dirStack.length > d + 1) dirStack.pop();
    while (dirStack.length < d + 1) {
      const top = dirStack[dirStack.length - 1];
      dirStack.push(top === null ? null : top.slice());
    }
    let dirs = dirStack[d];
    const chdir = envChdir(seg.words);
    if (chdir !== undefined) dirs = dirs !== null && resolvableDir(chdir) ? [...dirs, chdir] : null;

    const targets = [];
    for (const r of seg.redirects) {
      if (r.target === null || r.target === undefined) continue;
      if (r.op === '<' || r.op === '<<<' || r.op === '<&' || r.op === '<>') continue;
      if (r.op === '>&' && /^(\d+|-)$/.test(r.target)) continue; // fd dup
      targets.push(r.target);
    }
    const k0 = seg.words.length - commandWords(seg.words, seg.quoted).length;
    const words = seg.words.slice(k0);
    if (words.length) {
      const cmd = path.basename(words[0]);
      const args = words.slice(1);
      if (cmd === 'tee') targets.push(...teeTargets(args));
      else if (cmd === 'sed' || cmd === 'gsed') targets.push(...sedTargets(args));
      else if (cmd === 'cp' || cmd === 'mv' || cmd === 'install') targets.push(...copyTargets(args));
    }
    for (const target of targets) out.push({ target, dirs: dirs === null ? null : dirs.slice() });

    // `cd`/`pushd` move the base for the following segments at this depth.
    if (words.length && (words[0] === 'cd' || words[0] === 'pushd')) {
      const operand = words.slice(1).find((a) => a === '-' || !a.startsWith('-'));
      const cur = dirStack[d];
      dirStack[d] = cur !== null && resolvableDir(operand) ? [...cur, operand] : null;
    }
  }
  return out;
}

/**
 * Extract the file paths a Bash command would write to (best effort).
 * Pure: never executes or evaluates the command.
 * @param {string} command
 * @returns {string[]}
 */
function extractWriteTargets(command) {
  return extractWriteTargetsWithDirs(command).map((t) => t.target);
}

/**
 * True when a write target resolves inside the project root (lexically).
 * `~` paths are outside by definition; absolute paths count only if they
 * land under the root.
 * @param {string} target
 * @param {string} cwd project root
 * @param {string} [base] directory the command runs in (defaults to cwd)
 * @returns {boolean}
 */
function insideProject(target, cwd, base = cwd) {
  if (!target || target.startsWith('~')) return false;
  const rel = path.relative(cwd, path.resolve(base, target));
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

// process.cwd() is already a realpath (macOS /var -> /private/var); the
// payload cwd may not be, so normalize it before comparing.
function realpathOr(p) {
  try { return require('fs').realpathSync(p); } catch { return p; }
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
    // The payload's cwd is where the command runs; relative targets resolve
    // there, but "inside the project" is still judged against the hook cwd.
    const base = typeof input.cwd === 'string' && input.cwd ? realpathOr(input.cwd) : cwd;
    for (const { target, dirs } of extractWriteTargetsWithDirs(command)) {
      // Unknown effective directory (e.g. `cd "$X"`): a relative target
      // cannot be placed, so it is not blocked. Absolute targets still are.
      if (dirs === null && !path.isAbsolute(target)) continue;
      const targetBase = dirs === null ? base : path.resolve(base, ...dirs);
      if (!insideProject(target, cwd, targetBase)) continue;
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
  extractWriteTargetsWithDirs,
  insideProject,
  blockReason,
  BLOCKED_PATTERNS,
  WARN_PATTERNS,
  BASH_BLOCKED_PATTERNS,
  BASH_WARN_PATTERNS,
};
