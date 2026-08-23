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
 * }
 * ```
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
function extractTestCommandSection(content) {
    if (!content || typeof content !== 'string') return null;
    const match = content.match(/## Test Command\n([\s\S]*?)(?=\n## |$)/);
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
 * Both shipped Test Command sections wrap PLACEHOLDER in double quotes
 * (e.g. `--filter "FullyQualifiedName~{{test}}"`), so a test name carrying
 * `"`, `$`, a backtick, or a backslash must not reach the shell unescaped.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeForDoubleQuotes(value) {
    return value.replace(/[\\"$`]/g, (ch) => `\\${ch}`);
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
    if (!filteredCommand.includes(PLACEHOLDER)) {
        console.warn(
            `test-commands: filtered command "${filteredCommand}" has no ${PLACEHOLDER} placeholder — ` +
            `returning it unchanged, but this likely means a stack profile's Test Command section is malformed.`
        );
        return filteredCommand;
    }
    return filteredCommand.split(PLACEHOLDER).join(escapeForDoubleQuotes(String(testName)));
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
 * @returns {Array<{stack: string, filtered: string|null, full: string|null}>}
 */
function readStackProfileCommands(projectDir, stacksDir) {
    let detected = [];
    try {
        detected = stackLoader.detectStacks(projectDir) || [];
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

    try {
        const override = readClaudeMdOverride(projectDir);
        if (override) {
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
            };
        }

        const stackCommands = readStackProfileCommands(projectDir, stacksDir);
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
            };
        }

        return { filtered: null, full: null, source: 'none', commands: [] };
    } catch (err) {
        // Never throw — callers degrade instead of crashing.
        return { filtered: null, full: null, source: 'none', commands: [] };
    }
}

module.exports = {
    PLACEHOLDER,
    resolveTestCommands,
    buildFilteredCommand,
    extractTestCommandSection,
    parseTestCommandSection,
};
