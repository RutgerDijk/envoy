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
const EXCLUDED_DIRS = [
    // VCS / worktrees
    '.git', '.worktrees',
    // Dependency trees
    'node_modules', 'packages', 'vendor', '.venv', '__pycache__',
    // Build output
    'bin', 'obj', 'dist', 'build', 'out', 'target', '.next',
    // Tool caches / reports
    'coverage', '.turbo', '.cache',
];

const FIND_PRUNE = `\\( ${EXCLUDED_DIRS.map(d => `-name ${d}`).join(' -o ')} \\) -prune -o`;

// Depth bound for the single candidate-file enumeration. Matches the
// -maxdepth 3 the file probes already used; content probes previously ran
// unbounded `grep -r` (18 separate full walks), which is what made
// detection take minutes on large repos (#78).
const FIND_MAXDEPTH = 3;

// Backstop only. With traversal bounded by -maxdepth/-prune this should
// never be reached; if it is, warnOnProbeFailure() says so.
const PROBE_TIMEOUT_MS = 5000;

// Files larger than this are not manifests or source we care about; reading
// them would only slow the single content pass down.
const MAX_CONTENT_BYTES = 2 * 1024 * 1024;

/**
 * Translate a `find -name` / `grep --include` style glob into a RegExp that
 * matches a whole string. Only the globbing find(1) and grep(1) actually
 * support here is needed: `*`, `?`, and character classes.
 *
 * @param {string} glob
 * @returns {RegExp}
 */
function globToRegExp(glob, crossSlash) {
    const star = crossSlash ? '.*' : '[^/]*';
    const single = crossSlash ? '.' : '[^/]';
    let out = '';
    for (const ch of glob) {
        if (ch === '*') out += star;
        else if (ch === '?') out += single;
        else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${out}$`);
}

const globCache = new Map();
function matchesGlob(name, glob, crossSlash = false) {
    const key = `${crossSlash ? 'p:' : 'n:'}${glob}`;
    let re = globCache.get(key);
    if (!re) {
        re = globToRegExp(glob, crossSlash);
        globCache.set(key, re);
    }
    return re.test(name);
}

/**
 * Report a stack probe that failed for a reason worth knowing about.
 *
 * Exit status 1 from find/grep means "nothing matched", the overwhelmingly
 * common "this stack simply isn't in the repo" case — warning on that
 * would make every run noisy and drown out the real signals.
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
        return;
    }
    // A broken or missing tool, or a permission error, is not "the stack
    // isn't here" — it means detection produced an answer it had no basis
    // for. grep/find reserve exit status > 1 for real errors (status 1 is
    // the ordinary no-match), and ENOENT means the binary itself is absent
    // (code-review fix item 9).
    if (err.code === 'ENOENT') {
        console.warn(
            `[envoy:stack-loader] detection probe for "${ruleName}" could not run ` +
            `(ENOENT — required command not found). This stack was skipped and may ` +
            `be missing from the detected list.`
        );
        return;
    }
    if (typeof err.status === 'number' && err.status > 1) {
        console.warn(
            `[envoy:stack-loader] detection probe for "${ruleName}" failed with ` +
            `exit status ${err.status} (not a no-match — likely a broken command or ` +
            `a permission error). This stack was skipped and may be missing from ` +
            `the detected list.`
        );
    }
}

/**
 * Enumerate every candidate file ONCE (#78 perf fix).
 *
 * Detection used to run 24 separate shell probes: 6 bounded `find` walks
 * plus 18 completely unbounded `grep -r` walks (`--exclude-dir` prunes, but
 * nothing capped depth). Every content rule therefore re-walked the whole
 * tree. Now a single bounded `find` produces the candidate list and every
 * rule — file and content alike — is evaluated against that one list in
 * process.
 *
 * @param {string} projectDir
 * @returns {string[]} paths relative to projectDir, '/'-separated
 */
function enumerateCandidateFiles(projectDir) {
    const quotedDir = shellQuote(projectDir);
    const out = execSync(
        `find ${quotedDir} -maxdepth ${FIND_MAXDEPTH} ${FIND_PRUNE} -type f -print 2>/dev/null`,
        { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 }
    );
    const prefix = projectDir.replace(/\/+$/, '') + '/';
    return out
        .split('\n')
        .filter(Boolean)
        .map(p => (p.startsWith(prefix) ? p.slice(prefix.length) : p));
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

    let candidates;
    try {
        candidates = enumerateCandidateFiles(projectDir);
    } catch (err) {
        // The single enumeration is now the only walk — if it fails, every
        // rule is affected, so say so once rather than 24 times.
        warnOnProbeFailure(err, 'candidate-file enumeration');
        return detected;
    }

    // Content matching reads each needed file at most once, no matter how
    // many rules reference it (package.json alone is referenced by 8).
    const contentCache = new Map();
    function readCandidate(rel) {
        if (contentCache.has(rel)) return contentCache.get(rel);
        let text = null;
        try {
            const abs = path.join(projectDir, rel);
            if (fs.statSync(abs).size <= MAX_CONTENT_BYTES) {
                text = fs.readFileSync(abs, 'utf8');
            }
        } catch (err) {
            text = null;
        }
        contentCache.set(rel, text);
        return text;
    }

    for (const rule of STACK_RULES) {
        try {
            if (rule.type === 'file') {
                // A pattern with a directory component (e.g.
                // .github/workflows/*.yml) is matched against the path, where
                // `*` crosses separators — mirroring find's -path. A plain
                // pattern is matched against the basename, like find's -name.
                const isPathPattern = rule.pattern.includes('/');
                const hit = candidates.some(rel =>
                    isPathPattern
                        ? matchesGlob(rel, `*${rule.pattern}`, true) || matchesGlob(rel, rule.pattern, true)
                        : matchesGlob(path.basename(rel), rule.pattern)
                );
                if (hit) detected.push(rule.name);
            } else if (rule.type === 'content') {
                // ERE semantics, matching the grep -E these rules were
                // written for: STACK_RULES patterns use alternation
                // (Npgsql|PostgreSQL) and bracket classes.
                const re = new RegExp(rule.pattern);
                const hit = candidates.some(rel => {
                    if (!rule.files.some(f => matchesGlob(path.basename(rel), f))) return false;
                    const text = readCandidate(rel);
                    return text !== null && re.test(text);
                });
                if (hit) detected.push(rule.name);
            }
        } catch (err) {
            warnOnProbeFailure(err, rule.name);
        }
    }

    return detected;
}

/**
 * Root manifests whose mtime invalidates a cached detection result. A stack
 * only appears or disappears when one of these changes (or when the root
 * listing itself does, which the root directory's own mtime covers).
 */
const CACHE_KEY_FILES = [
    'package.json', 'package-lock.json', 'tsconfig.json', 'requirements.txt',
    'pyproject.toml', 'go.mod', 'Cargo.toml', 'docker-compose.yml',
    'docker-compose.yaml', 'staticwebapp.config.json',
];

const CACHE_REL_PATH = path.join('.envoy', 'stack-detection.json');

/**
 * Build the cache key: the absolute project dir plus the mtime of the root
 * directory and of every root manifest that exists.
 *
 * @param {string} projectDir
 * @returns {string}
 */
function detectionCacheKey(projectDir) {
    const abs = path.resolve(projectDir);
    const parts = [abs];
    const stamp = (p) => {
        try { return String(fs.statSync(p).mtimeMs); } catch (err) { return '-'; }
    };
    parts.push(`.:${stamp(abs)}`);
    for (const name of CACHE_KEY_FILES) {
        parts.push(`${name}:${stamp(path.join(abs, name))}`);
    }
    return parts.join('|');
}

/**
 * detectStacks() with a cross-process cache under `.envoy/` (gitignored).
 *
 * Both entry points that run at session/skill start —
 * `hooks/session-start.sh` and `skills/pickup/preflight.js` (via
 * lib/test-commands.js) — used to run the identical full sweep moments
 * apart (#78 fix item 5). The result is memoised per project dir, keyed on
 * the mtimes of the root manifests, so the second caller reads a file
 * instead of re-walking the tree.
 *
 * Fails open in every direction: an unreadable, corrupt, or unwritable
 * cache just means a normal detection run.
 *
 * @param {string} projectDir
 * @returns {string[]}
 */
function detectStacksCached(projectDir) {
    const cachePath = path.join(path.resolve(projectDir), CACHE_REL_PATH);
    const key = detectionCacheKey(projectDir);

    try {
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        if (cached && cached.key === key && Array.isArray(cached.stacks)) {
            return cached.stacks.slice();
        }
    } catch (err) {
        // no usable cache — fall through and detect
    }

    const stacks = detectStacks(projectDir);

    try {
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        fs.writeFileSync(
            cachePath,
            JSON.stringify({ key, stacks, producedAt: new Date().toISOString() }),
            'utf8'
        );
    } catch (err) {
        // read-only or nonexistent project dir — caching is best-effort
    }

    return stacks;
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
    detectStacksCached,
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
 * Usage: node lib/stack-loader.js [projectDir] [--json]
 *   (no flag)    space-separated stack names on one line (session-start.sh)
 *   --json       JSON array of stack names (detect-stacks.sh)
 */
if (require.main === module) {
    const args = process.argv.slice(2);
    const flags = args.filter(a => a.startsWith('--'));
    const positional = args.filter(a => !a.startsWith('--'));
    const projectDir = positional[0] || process.cwd();

    // "security" is appended HERE, not inside detectStacks(): the
    // requirement is shell parity — stacks/detect-stacks.sh and
    // hooks/session-start.sh each unconditionally appended it before they
    // delegated to this module. Appending it inside detectStacks() would
    // make every JS consumer (lib/test-commands.js, the review skill's
    // selective profile loading) receive a stack that was never detected
    // (code-review fix item 12).
    const stacks = detectStacksCached(projectDir).concat('security');

    if (flags.includes('--json')) {
        process.stdout.write(JSON.stringify(stacks));
    } else {
        process.stdout.write(stacks.join(' '));
    }
}
