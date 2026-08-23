/**
 * Envoy Stack Loader Library
 *
 * Utilities for detecting and loading technology stack profiles.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Stack detection rules
 * Each rule has: name, detection method (file or content), and pattern
 */
const STACK_RULES = [
    // Core stacks
    { name: 'dotnet', type: 'file', pattern: '*.csproj' },
    { name: 'react', type: 'content', pattern: '"react"', files: ['package.json'] },
    { name: 'typescript', type: 'file', pattern: 'tsconfig.json' },
    { name: 'postgresql', type: 'content', pattern: 'Npgsql|PostgreSQL', files: ['*.csproj'] },

    // Testing stacks
    { name: 'testing-dotnet', type: 'content', pattern: 'xunit|Moq|FluentAssertions', files: ['*.csproj'] },
    { name: 'testing-playwright', type: 'content', pattern: '@playwright/test', files: ['package.json'] },

    // Infrastructure stacks
    { name: 'docker-compose', type: 'file', pattern: 'docker-compose*.yml' },
    { name: 'azure-container-apps', type: 'content', pattern: 'containerApps', files: ['*.bicep'] },
    { name: 'azure-static-web-apps', type: 'file', pattern: 'staticwebapp.config.json' },
    { name: 'azure-postgresql', type: 'content', pattern: 'flexibleServers', files: ['*.bicep'] },
    { name: 'bicep', type: 'file', pattern: '*.bicep' },
    { name: 'github-actions', type: 'file', pattern: '.github/workflows/*.yml' },

    // Supporting stacks
    { name: 'entity-framework', type: 'content', pattern: 'Microsoft.EntityFrameworkCore', files: ['*.csproj'] },
    { name: 'serilog', type: 'content', pattern: 'Serilog', files: ['*.csproj'] },
    { name: 'jwt-oauth', type: 'content', pattern: 'JwtBearer|OAuth|OpenIdConnect', files: ['*.csproj'] },
    { name: 'api-patterns', type: 'content', pattern: 'AddControllers|ApiController', files: ['*.cs'] },
    { name: 'shadcn-radix', type: 'content', pattern: '@radix-ui|class-variance-authority', files: ['package.json'] },
    { name: 'react-query', type: 'content', pattern: '@tanstack/react-query', files: ['package.json'] },
    { name: 'react-hook-form', type: 'content', pattern: 'react-hook-form', files: ['package.json'] },
    { name: 'tailwind', type: 'content', pattern: 'tailwindcss', files: ['package.json'] },
    { name: 'orval', type: 'content', pattern: '"orval"', files: ['package.json'] },
    { name: 'application-insights', type: 'content', pattern: '[Aa]pplication[Ii]nsights', files: ['*.csproj', 'package.json'] },
    { name: 'health-checks', type: 'content', pattern: 'AddHealthChecks|HealthChecks', files: ['*.csproj', '*.cs'] },
    { name: 'openapi', type: 'content', pattern: 'Swashbuckle|AddSwaggerGen|AddEndpointsApiExplorer', files: ['*.csproj', '*.cs'] },
];

/**
 * Directories detection must never probe (#78): dependency trees and build
 * output make scans take minutes on large repos and match third-party code.
 */
const EXCLUDED_DIRS = ['node_modules', '.git', 'bin', 'obj', '.worktrees'];

// One flag per directory — never --exclude-dir={a,b}: execSync runs through
// /bin/sh, where brace expansion does not happen and the braces would be
// passed literally, silently disabling the exclusions.
const GREP_EXCLUDES = EXCLUDED_DIRS.map(d => `--exclude-dir=${d}`).join(' ');
const FIND_PRUNE = `\\( ${EXCLUDED_DIRS.map(d => `-name ${d}`).join(' -o ')} \\) -prune -o`;

// Backstop only. With traversal bounded by -maxdepth/-prune/--exclude-dir
// this should never be reached; if it is, warnOnProbeFailure() says so.
const PROBE_TIMEOUT_MS = 5000;

/**
 * Report a stack probe that failed for a reason worth knowing about.
 *
 * `find ... | head -1` and `grep -l ... | head -1` exit non-zero whenever
 * nothing matched, which is the overwhelmingly common "this stack simply
 * isn't in the repo" case — warning on that would make every run noisy.
 * A timeout is different: now that traversal is bounded (#78) the 5s cap
 * should never be reached, so hitting it means a stack was dropped for a
 * reason the caller can act on and deserves a signal rather than silence
 * (#78 defect A3 / fix item 5).
 *
 * Writes to stderr via console.warn so the CLI entry point's stdout stays
 * valid JSON for `stacks/detect-stacks.sh` and `hooks/session-start.sh`.
 *
 * @param {Error} err - The error thrown by the probe's execSync call
 * @param {string} ruleName - Name of the stack rule whose probe failed
 */
function warnOnProbeFailure(err, ruleName) {
    const timedOut = err.code === 'ETIMEDOUT' || err.killed === true;
    if (timedOut) {
        console.warn(
            `[envoy:stack-loader] detection probe for "${ruleName}" timed out ` +
            `after ${PROBE_TIMEOUT_MS}ms — this stack was skipped and may be ` +
            `missing from the detected list.`
        );
    }
}

/**
 * Quote a value as a single, safe POSIX shell argument. Nothing inside
 * '...' is special except the quote itself, embedded via close-escape-
 * reopen (it -> it'\''s). Used for projectDir, which — since the CLI entry
 * point (task-8) — is externally reachable, unlike STACK_RULES' own
 * hardcoded patterns (code-review fix: verified command injection via a
 * projectDir like `/tmp/"; touch ...; "`).
 *
 * @param {string} value
 * @returns {string}
 */
function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Detect stacks in a directory
 * @param {string} projectDir - Directory to scan
 * @returns {string[]} Array of detected stack names
 */
function detectStacks(projectDir) {
    const detected = [];
    const quotedDir = shellQuote(projectDir);

    for (const rule of STACK_RULES) {
        try {
            if (rule.type === 'file') {
                // Check for file existence using glob. -name only matches a
                // basename — a pattern with a directory component (e.g.
                // .github/workflows/*.yml) can never match through it and
                // needs -path instead (code-review fix).
                const findFlag = rule.pattern.includes('/') ? '-path' : '-name';
                const findPattern = rule.pattern.includes('/') ? `*/${rule.pattern}` : rule.pattern;
                const result = execSync(
                    `find ${quotedDir} -maxdepth 3 ${FIND_PRUNE} ${findFlag} "${findPattern}" -print 2>/dev/null | head -1`,
                    { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS }
                ).trim();

                if (result) {
                    detected.push(rule.name);
                }
            } else if (rule.type === 'content') {
                // Search for content pattern in specified files. -E because
                // STACK_RULES patterns use ERE alternation (Npgsql|PostgreSQL);
                // plain grep (BRE) treats the | as a literal character.
                const filePatterns = rule.files.map(f => `--include="${f}"`).join(' ');
                const result = execSync(
                    `grep -r -l -E "${rule.pattern}" ${filePatterns} ${GREP_EXCLUDES} ${quotedDir} 2>/dev/null | head -1`,
                    { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS }
                ).trim();

                if (result) {
                    detected.push(rule.name);
                }
            }
        } catch (err) {
            // A plain non-zero exit is the ordinary "stack not present"
            // case and is skipped silently; a timeout is not (see
            // warnOnProbeFailure).
            warnOnProbeFailure(err, rule.name);
        }
    }

    // Security stack is always applicable, independent of every other
    // detected stack — matches the historical behavior of both shell
    // scripts (each unconditionally appended it) before they delegated to
    // this function (#78 code-review fix: consolidation silently narrowed
    // this to a dotnet/react/api-patterns gate for repos matching none).
    detected.push('security');

    return detected;
}

/**
 * Detect stacks from a list of changed files (for reviews)
 * @param {string[]} changedFiles - Array of file paths
 * @returns {string[]} Array of relevant stack names
 */
function detectStacksFromFiles(changedFiles) {
    const detected = new Set();

    for (const file of changedFiles) {
        const ext = path.extname(file).toLowerCase();
        const basename = path.basename(file).toLowerCase();

        // File extension mapping
        if (ext === '.cs') {
            detected.add('dotnet');
            detected.add('api-patterns');
        }
        if (ext === '.csproj') {
            detected.add('dotnet');
        }
        if (['.tsx', '.ts'].includes(ext)) {
            detected.add('typescript');
            if (ext === '.tsx') detected.add('react');
        }
        if (['.jsx', '.js'].includes(ext) && file.includes('components')) {
            detected.add('react');
        }
        if (ext === '.bicep') {
            detected.add('bicep');
            if (file.includes('container')) detected.add('azure-container-apps');
        }
        if (basename === 'docker-compose.yml' || basename === 'docker-compose.yaml') {
            detected.add('docker-compose');
        }
        if (file.includes('.github/workflows')) {
            detected.add('github-actions');
        }
        if (file.includes('test') || file.includes('spec')) {
            if (ext === '.cs') detected.add('testing-dotnet');
            if (['.ts', '.tsx'].includes(ext)) detected.add('testing-playwright');
        }
        if (basename === 'tailwind.config.js' || basename === 'tailwind.config.ts') {
            detected.add('tailwind');
        }
    }

    return Array.from(detected);
}

/**
 * Load stack profile content
 * @param {string} stackName - Name of the stack
 * @param {string} stacksDir - Directory containing stack profiles
 * @returns {string | null} Stack profile content or null if not found
 */
function loadStackProfile(stackName, stacksDir) {
    const profilePath = path.join(stacksDir, `${stackName}.md`);

    try {
        return fs.readFileSync(profilePath, 'utf8');
    } catch (err) {
        return null;
    }
}

/**
 * Load multiple stack profiles
 * @param {string[]} stackNames - Array of stack names to load
 * @param {string} stacksDir - Directory containing stack profiles
 * @returns {Object<string, string>} Map of stack name to content
 */
function loadStackProfiles(stackNames, stacksDir) {
    const profiles = {};

    for (const name of stackNames) {
        const content = loadStackProfile(name, stacksDir);
        if (content) {
            profiles[name] = content;
        }
    }

    return profiles;
}

/**
 * Extract common mistakes section from a stack profile
 * @param {string} profileContent - Full stack profile content
 * @returns {string | null} Common mistakes section or null
 */
function extractCommonMistakes(profileContent) {
    const match = profileContent.match(/## Common Mistakes\n([\s\S]*?)(?=\n## |$)/);
    return match ? match[1].trim() : null;
}

/**
 * Extract review checklist from a stack profile
 * @param {string} profileContent - Full stack profile content
 * @returns {string | null} Review checklist section or null
 */
function extractReviewChecklist(profileContent) {
    const match = profileContent.match(/## Review Checklist\n([\s\S]*?)(?=\n## |$)/);
    return match ? match[1].trim() : null;
}

/**
 * Extract best practices section from a stack profile
 * @param {string} profileContent - Full stack profile content
 * @returns {string | null} Best practices section or null
 */
function extractBestPractices(profileContent) {
    const match = profileContent.match(/## Best Practices\n([\s\S]*?)(?=\n## |$)/);
    return match ? match[1].trim() : null;
}

/**
 * Section name to extractor mapping
 */
const SECTION_EXTRACTORS = {
    'Common Mistakes': extractCommonMistakes,
    'Review Checklist': extractReviewChecklist,
    'Best Practices': extractBestPractices,
};

/**
 * Load a specific section from a stack profile.
 * Reduces token usage by loading only the needed content.
 *
 * @param {string} stackName - Name of the stack
 * @param {string} section - Section name: "Common Mistakes", "Best Practices", or "Review Checklist"
 * @param {string} stacksDir - Directory containing stack profiles
 * @returns {string | null} Section content or null
 */
function loadStackSection(stackName, section, stacksDir) {
    const content = loadStackProfile(stackName, stacksDir);
    if (!content) return null;

    const extractor = SECTION_EXTRACTORS[section];
    if (!extractor) return null;

    return extractor(content);
}

/**
 * Stack names from STACK_RULES that indicate a frontend/UI surface. Kept as
 * an explicit allowlist (rather than e.g. "typescript") because several
 * STACK_RULES entries (typescript, application-insights) apply equally to
 * backend/node code and would over-trigger the visual layer.
 */
const FRONTEND_STACKS = ['react', 'shadcn-radix', 'react-query', 'react-hook-form', 'tailwind'];

/**
 * True if the given stack name (as produced by detectStacks/detectStacksFromDiff)
 * represents a frontend/UI surface.
 *
 * @param {string} stackName
 * @returns {boolean}
 */
function isFrontendStack(stackName) {
    return FRONTEND_STACKS.includes(stackName);
}

/**
 * True if any of the given detected stack names is a frontend stack.
 *
 * @param {string[]} stackNames
 * @returns {boolean}
 */
function anyFrontendStack(stackNames) {
    return Array.isArray(stackNames) && stackNames.some(isFrontendStack);
}

/**
 * Detect stacks from a git diff against a base branch.
 * Only returns stacks relevant to files that actually changed.
 *
 * @param {string} baseBranch - Base branch to diff against (e.g., "main")
 * @param {string} [projectDir] - Optional project directory
 * @returns {string[]} Array of relevant stack names
 */
function detectStacksFromDiff(baseBranch, projectDir) {
    try {
        const cwd = projectDir || process.cwd();
        const output = execSync(
            `git diff --name-only ${baseBranch}...HEAD`,
            { encoding: 'utf8', timeout: 10000, cwd }
        ).trim();

        if (!output) return [];

        const changedFiles = output.split('\n').filter(Boolean);
        return detectStacksFromFiles(changedFiles);
    } catch (err) {
        return [];
    }
}

/**
 * Load stack profiles selectively — only stacks relevant to changed files,
 * and only the requested section.
 *
 * @param {string} baseBranch - Base branch to diff against
 * @param {string} section - Section to extract ("Common Mistakes", "Best Practices", "Review Checklist")
 * @param {string} stacksDir - Directory containing stack profiles
 * @returns {Object<string, string>} Map of stack name to section content
 */
function loadSelectiveProfiles(baseBranch, section, stacksDir) {
    const stacks = detectStacksFromDiff(baseBranch);
    const profiles = {};

    for (const name of stacks) {
        const sectionContent = loadStackSection(name, section, stacksDir);
        if (sectionContent) {
            profiles[name] = sectionContent;
        }
    }

    return profiles;
}

module.exports = {
    STACK_RULES,
    detectStacks,
    warnOnProbeFailure,
    detectStacksFromFiles,
    detectStacksFromDiff,
    isFrontendStack,
    anyFrontendStack,
    loadStackProfile,
    loadStackProfiles,
    loadStackSection,
    loadSelectiveProfiles,
    extractCommonMistakes,
    extractReviewChecklist,
    extractBestPractices,
};

/**
 * CLI entry point (#78 task-8): the single source of truth for stack
 * detection is this module's detectStacks(). stacks/detect-stacks.sh and
 * hooks/session-start.sh both shell out to `node lib/stack-loader.js`
 * instead of carrying their own duplicated bash probe logic, so a change
 * to STACK_RULES/EXCLUDED_DIRS here reaches all three entry points by
 * construction.
 *
 * Usage: node lib/stack-loader.js [projectDir] [--json|--checklist]
 *   (no flag)    space-separated stack names on one line (session-start.sh)
 *   --json       JSON array of stack names (detect-stacks.sh --json)
 *   --checklist  "✓ <name>" lines, one per stack (detect-stacks.sh listing)
 */
if (require.main === module) {
    const args = process.argv.slice(2);
    const flags = args.filter(a => a.startsWith('--'));
    const positional = args.filter(a => !a.startsWith('--'));
    const projectDir = positional[0] || process.cwd();

    const stacks = detectStacks(projectDir);

    if (flags.includes('--json')) {
        process.stdout.write(JSON.stringify(stacks));
    } else if (flags.includes('--checklist')) {
        for (const name of stacks) {
            process.stdout.write(`✓ ${name}\n`);
        }
    } else {
        process.stdout.write(stacks.join(' '));
    }
}
