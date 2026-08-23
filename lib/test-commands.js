/**
 * Envoy Test Command Resolver (#78 task-1)
 *
 * One place to ask "what is the narrowest test command here, and what is
 * the full-suite command" so skills stop hardcoding `dotnet test` / `npm
 * test`.
 *
 * ## Source precedence
 *
 * 1. `CLAUDE.md` at the project root — if it declares a `## Test Command`
 *    section, its values win over every stack profile. This lets a project
 *    override the stack default (e.g. `--no-build`, a custom project flag).
 * 2. `stacks/<name>.md` — the `## Test Command` section of each stack
 *    detected in the project (via `lib/stack-loader.js`'s `detectStacks`).
 *    Multiple detected stacks (e.g. a dotnet backend + a Playwright
 *    frontend) each contribute their own entry — callers never get a
 *    single guessed command for a multi-stack repo.
 * 3. Neither source yields anything: `resolveTestCommands` returns
 *    `{filtered: null, full: null, source: 'none', commands: []}`. This
 *    module never throws on a missing or malformed source; callers degrade.
 *
 * ## `## Test Command` section format (CLAUDE.md and stack profiles alike)
 *
 * ```
 * ## Test Command
 *
 * filtered: dotnet test --filter "FullyQualifiedName~{{test}}"
 * full: dotnet test
 * ```
 *
 * - `filtered:` — a command that runs a single named test. Contains the
 *   literal placeholder `{{test}}` (see `PLACEHOLDER` below), which
 *   `buildFilteredCommand` substitutes with the caller's test name.
 * - `full:` — the full-suite command, no placeholder.
 * - Either line may be omitted; a section missing both is treated as if
 *   the section were absent (degrades, does not throw).
 *
 * ## `resolveTestCommands(projectDir, options)` return shape
 *
 * ```
 * {
 *   filtered: string | null,   // primary (first) filtered command
 *   full: string | null,       // primary (first) full command
 *   source: 'claude.md' | 'stack-profile' | 'none',
 *   commands: [
 *     {
 *       stack: string,               // 'claude.md' or a detected stack name
 *       filtered: string | null,
 *       full: string | null,
 *       source: 'claude.md' | 'stack-profile',
 *       buildFilteredCommand(testName): string | null,
 *     },
 *     ...
 *   ],
 *   warnings: string[],       // templates rejected as unsafe (see below)
 * }
 * ```
 *
 * ## Template safety
 *
 * Resolved commands are executed verbatim by the review skill, and rule 1
 * reads them from the project's own CLAUDE.md — untrusted content in a
 * cloned repo. Any template containing `;`, `&&`, `||`, `|`, `$(`, a
 * backtick, or a newline outside the `{{test}}` placeholder is DROPPED and
 * reported in `warnings`; callers must surface those rather than run them.
 *
 * `commands` holds one entry per source that actually produced a command
 * (one entry for CLAUDE.md when it wins, or one entry per detected stack
 * profile with a Test Command section). The top-level `filtered`/`full`
 * mirror `commands[0]` for callers that only care about "the" command.
 */

const fs = require('fs');
const path = require('path');

const stackLoader = require('./stack-loader.js');

/** Placeholder substituted by buildFilteredCommand(). */
const PLACEHOLDER = '{{test}}';

const DEFAULT_STACKS_DIR = path.join(__dirname, '..', 'stacks');

/**
 * Extract the raw `## Test Command` section body from markdown content.
 * Mirrors the extractor convention in lib/stack-loader.js.
 *
 * @param {string} content
 * @returns {string | null}
 */
function stripFencedCodeBlocks(content) {
    // Replace the contents of ``` / ~~~ fences with blank lines so a
    // documentation example ("here's what a `## Test Command` section looks
    // like") is never parsed as live configuration, while line offsets and
    // the surrounding document structure stay intact.
    const lines = content.split('\n');
    let fence = null;
    return lines
        .map((line) => {
            const open = line.match(/^\s{0,3}(`{3,}|~{3,})/);
            if (fence) {
                if (open && open[1][0] === fence[0] && open[1].length >= fence.length) {
                    fence = null;
                }
                return '';
            }
            if (open) {
                fence = open[1];
                return '';
            }
            return line;
        })
        .join('\n');
}

function extractTestCommandSection(content) {
    if (!content || typeof content !== 'string') return null;
    // Anchored at line start with exactly two hashes so `### Test Command`
    // and inline prose mentioning "## Test Command" never match, and
    // terminated by ANY subsequent ATX heading so the body cannot over-run
    // into a following `### ` subsection.
    const match = stripFencedCodeBlocks(content).match(
        // `$(?![\s\S])` — not a bare `$`: under /m (needed for the `^##`
        // anchor) `$` matches at every line end, so a lazy body would stop
        // after the first line.
        /^## Test Command\n([\s\S]*?)(?=\n#{1,6} |$(?![\s\S]))/m
    );
    return match ? match[1].trim() : null;
}

/**
 * Parse `filtered:` / `full:` lines out of a Test Command section body.
 *
 * @param {string | null} sectionBody
 * @returns {{filtered: string|null, full: string|null}}
 */
function parseTestCommandSection(sectionBody) {
    if (!sectionBody || typeof sectionBody !== 'string') {
        return { filtered: null, full: null };
    }

    const filteredMatch = sectionBody.match(/^filtered:\s*(.+)$/m);
    const fullMatch = sectionBody.match(/^full:\s*(.+)$/m);

    return {
        filtered: filteredMatch ? filteredMatch[1].trim() : null,
        full: fullMatch ? fullMatch[1].trim() : null,
    };
}

/**
 * Escape characters that would break out of a double-quoted shell argument.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeForDoubleQuotes(value) {
    return value.replace(/[\\"$`]/g, (ch) => `\\${ch}`);
}

/**
 * Escape a value for embedding inside a single-quoted shell argument.
 * Nothing is special inside '...' except the quote itself — a literal '
 * can only be embedded by closing the quote, escaping a lone quote, and
 * reopening it: it -> it'\''s.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeForSingleQuotes(value) {
    return value.replace(/'/g, `'\\''`);
}

/**
 * Wrap a value in its own single-quoted shell token. Safe regardless of
 * what surrounds it in the template — used when the placeholder isn't
 * quoted at all, so the substituted value can never be parsed as separate
 * shell syntax (e.g. a `;` or `&&` in a test name).
 *
 * @param {string} value
 * @returns {string}
 */
function quoteAsToken(value) {
    return `'${escapeForSingleQuotes(value)}'`;
}

/**
 * Scan a shell command string up to (not including) `upTo`, tracking POSIX
 * quote state, and report which quote (if any) is open at that position.
 * Handles backslash-escaping inside double quotes and unquoted text; a
 * backslash has no escaping meaning inside single quotes.
 *
 * @param {string} template
 * @param {number} upTo
 * @returns {'"' | "'" | null}
 */
function quoteStateAt(template, upTo) {
    let state = null; // null | '"' | "'"
    for (let i = 0; i < upTo; i++) {
        const ch = template[i];
        if (state === "'") {
            if (ch === "'") state = null;
            continue;
        }
        if (state === '"') {
            if (ch === '\\') { i++; continue; } // skip escaped char
            if (ch === '"') state = null;
            continue;
        }
        if (ch === '\\') { i++; continue; }
        if (ch === '"') { state = '"'; continue; }
        if (ch === "'") { state = "'"; continue; }
    }
    return state;
}

/**
 * Determine how to escape a value for substitution at a given position in
 * a template string, based on the actual shell quoting state at that
 * position — NOT an assumption about how every template quotes its
 * placeholder. A consumer repo's CLAUDE.md (precedence rule 1 in the
 * module doc above) can supply any template, quoted or not.
 *
 * @param {string} template - the full filtered command
 * @param {number} index - index of PLACEHOLDER within template
 * @param {string} value - the raw value to substitute
 * @returns {string} the value, escaped appropriately for that position
 */
function escapeForPosition(template, index, value) {
    const state = quoteStateAt(template, index);
    if (state === '"') return escapeForDoubleQuotes(value);
    if (state === "'") return escapeForSingleQuotes(value);
    // Unquoted: don't guess at the surrounding syntax, just make the value
    // its own safe token so it can't be interpreted as anything but a
    // single argument.
    return quoteAsToken(value);
}

/**
 * Substitute a test name into a filtered command's placeholder.
 *
 * @param {string | null} filteredCommand - command containing PLACEHOLDER
 * @param {string} testName
 * @returns {string | null} substituted command, the command unchanged if
 *   no placeholder is present, or null if filteredCommand is null/empty
 */
function buildFilteredCommand(filteredCommand, testName) {
    if (!filteredCommand || typeof filteredCommand !== 'string') return null;
    const index = filteredCommand.indexOf(PLACEHOLDER);
    if (index === -1) {
        console.warn(
            `test-commands: filtered command "${filteredCommand}" has no ${PLACEHOLDER} placeholder — ` +
            `returning it unchanged, but this likely means a stack profile's Test Command section is malformed.`
        );
        return filteredCommand;
    }
    // Each occurrence is escaped independently (code-review fix): a
    // template may mix quoted and unquoted placeholders
    // (`-g "{{test}}" -- {{test}}`), and reusing the first occurrence's
    // strategy for all of them mis-escapes — and on the unquoted one, is a
    // command injection. Quote state is computed against the string as
    // rebuilt so far, so already-substituted values (which are themselves
    // correctly quoted) are accounted for.
    const value = String(testName);
    let out = '';
    let rest = filteredCommand;
    for (;;) {
        const at = rest.indexOf(PLACEHOLDER);
        if (at === -1) return out + rest;
        const prefix = out + rest.slice(0, at);
        out = prefix + escapeForPosition(prefix, prefix.length, value);
        rest = rest.slice(at + PLACEHOLDER.length);
    }
}

/**
 * Shell metacharacters that turn a "test command" into an arbitrary command
 * chain. A resolved template is executed verbatim by
 * skills/review/layers/tests.md and layers/cleanup.md, and rule 1 of the
 * precedence order reads it out of the project's own CLAUDE.md — which, in a
 * cloned repo, is attacker-controlled content. Anything that could chain,
 * pipe, substitute, or start a second command is rejected outright rather
 * than escaped: no legitimate test command needs it.
 */
const UNSAFE_TEMPLATE_PATTERNS = [
    { token: ';', test: (s) => s.includes(';') },
    { token: '&&', test: (s) => s.includes('&&') },
    { token: '||', test: (s) => s.includes('||') },
    { token: '|', test: (s) => s.includes('|') },
    { token: '$(', test: (s) => s.includes('$(') },
    { token: '`', test: (s) => s.includes('`') },
    { token: 'newline', test: (s) => /[\r\n]/.test(s) },
];

/**
 * Validate one resolved command template.
 *
 * The `{{test}}` placeholder is removed before scanning — a caller-supplied
 * test name is escaped at substitution time by buildFilteredCommand(), so
 * the placeholder itself is not the risk surface; the surrounding template is.
 *
 * @param {string | null} command
 * @returns {{ok: boolean, reason: string|null}}
 */
function validateCommandTemplate(command) {
    if (command === null || command === undefined || command === '') {
        return { ok: true, reason: null };
    }
    if (typeof command !== 'string') {
        return { ok: false, reason: 'command is not a string' };
    }
    const bare = command.split(PLACEHOLDER).join('');
    for (const { token, test } of UNSAFE_TEMPLATE_PATTERNS) {
        if (test(bare)) {
            return {
                ok: false,
                reason: `contains shell metacharacter ${token === 'newline' ? 'newline' : `"${token}"`} outside the ${PLACEHOLDER} placeholder`,
            };
        }
    }
    return { ok: true, reason: null };
}

/**
 * Validate a {filtered, full} pair; the entry is usable only if BOTH are.
 *
 * @param {string} stack - source label, for the warning text
 * @param {{filtered: string|null, full: string|null}} pair
 * @returns {{ok: boolean, warnings: string[]}}
 */
function validateCommandPair(stack, pair) {
    const warnings = [];
    for (const field of ['filtered', 'full']) {
        const { ok, reason } = validateCommandTemplate(pair[field]);
        if (!ok) {
            warnings.push(
                `test-commands: rejected ${stack} ${field} command — ${reason}. ` +
                `Command dropped; it was NOT executed.`
            );
        }
    }
    return { ok: warnings.length === 0, warnings };
}

/**
 * Attach a bound buildFilteredCommand(testName) convenience method to a
 * resolved-command entry.
 *
 * @param {{filtered: string|null}} entry
 * @returns {object} the same entry, mutated
 */
function withBuiltHelper(entry) {
    entry.buildFilteredCommand = (testName) => buildFilteredCommand(entry.filtered, testName);
    return entry;
}

/**
 * Read CLAUDE.md's `## Test Command` section, if any.
 *
 * @param {string} projectDir
 * @returns {{filtered: string|null, full: string|null} | null} null if
 *   CLAUDE.md is missing, unreadable, or has no usable Test Command section
 */
function readClaudeMdOverride(projectDir) {
    try {
        const claudeMdPath = path.join(projectDir, 'CLAUDE.md');
        const content = fs.readFileSync(claudeMdPath, 'utf8');
        const section = extractTestCommandSection(content);
        const { filtered, full } = parseTestCommandSection(section);
        if (!filtered && !full) return null;
        return { filtered, full };
    } catch (err) {
        return null;
    }
}

/**
 * Resolve, per detected stack, the Test Command section of its profile.
 *
 * @param {string} projectDir
 * @param {string} stacksDir
 * @param {string[]} warnings - collector for rejected (unsafe) templates
 * @returns {Array<{stack: string, filtered: string|null, full: string|null}>}
 */
function readStackProfileCommands(projectDir, stacksDir, warnings = []) {
    let detected = [];
    try {
        detected = stackLoader.detectStacksCached(projectDir) || [];
    } catch (err) {
        detected = [];
    }

    const results = [];
    for (const stackName of detected) {
        let content = null;
        try {
            content = stackLoader.loadStackProfile(stackName, stacksDir);
        } catch (err) {
            content = null;
        }
        const section = extractTestCommandSection(content);
        const { filtered, full } = parseTestCommandSection(section);
        if (!filtered && !full) continue; // no Test Command section: skip, don't guess
        const check = validateCommandPair(`stack profile "${stackName}"`, { filtered, full });
        if (!check.ok) {
            warnings.push(...check.warnings);
            continue;
        }
        results.push({ stack: stackName, filtered, full });
    }
    return results;
}

/**
 * Resolve the narrowest ("filtered") and full-suite test commands for a
 * project. See file header for the return shape and source precedence.
 *
 * @param {string} projectDir - directory to inspect
 * @param {{stacksDir?: string}} [options]
 * @returns {{filtered: string|null, full: string|null, source: string, commands: object[]}}
 */
function resolveTestCommands(projectDir, options = {}) {
    const stacksDir = options.stacksDir || DEFAULT_STACKS_DIR;
    const warnings = [];

    try {
        const override = readClaudeMdOverride(projectDir);
        if (override) {
            // A cloned repo's CLAUDE.md is untrusted content, and these
            // commands are executed verbatim downstream. An unsafe override
            // is dropped (with a surfaced warning) and resolution falls
            // through to Envoy's own stack profiles rather than running it.
            const check = validateCommandPair('CLAUDE.md', override);
            if (!check.ok) {
                warnings.push(...check.warnings);
            } else {
                const entry = withBuiltHelper({
                    stack: 'claude.md',
                    filtered: override.filtered,
                    full: override.full,
                    source: 'claude.md',
                });
                return {
                    filtered: entry.filtered,
                    full: entry.full,
                    source: 'claude.md',
                    commands: [entry],
                    warnings,
                };
            }
        }

        const stackCommands = readStackProfileCommands(projectDir, stacksDir, warnings);
        if (stackCommands.length > 0) {
            const commands = stackCommands.map((c) =>
                withBuiltHelper({
                    stack: c.stack,
                    filtered: c.filtered,
                    full: c.full,
                    source: 'stack-profile',
                })
            );
            return {
                filtered: commands[0].filtered,
                full: commands[0].full,
                source: 'stack-profile',
                commands,
                warnings,
            };
        }

        return { filtered: null, full: null, source: 'none', commands: [], warnings };
    } catch (err) {
        // Never throw — callers degrade instead of crashing.
        return { filtered: null, full: null, source: 'none', commands: [], warnings };
    }
}

module.exports = {
    PLACEHOLDER,
    resolveTestCommands,
    buildFilteredCommand,
    extractTestCommandSection,
    parseTestCommandSection,
    validateCommandTemplate,
};
