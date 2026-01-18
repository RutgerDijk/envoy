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
    { name: 'application-insights', type: 'content', pattern: 'ApplicationInsights', files: ['*.csproj', 'package.json'] },
    { name: 'health-checks', type: 'content', pattern: 'AddHealthChecks|HealthChecks', files: ['*.csproj', '*.cs'] },
    { name: 'openapi', type: 'content', pattern: 'Swashbuckle|AddSwaggerGen|AddEndpointsApiExplorer', files: ['*.csproj', '*.cs'] },
];

/**
 * Detect stacks in a directory
 * @param {string} projectDir - Directory to scan
 * @returns {string[]} Array of detected stack names
 */
function detectStacks(projectDir) {
    const detected = [];

    for (const rule of STACK_RULES) {
        try {
            if (rule.type === 'file') {
                // Check for file existence using glob
                const result = execSync(
                    `find "${projectDir}" -maxdepth 3 -name "${rule.pattern}" 2>/dev/null | head -1`,
                    { encoding: 'utf8', timeout: 5000 }
                ).trim();

                if (result) {
                    detected.push(rule.name);
                }
            } else if (rule.type === 'content') {
                // Search for content pattern in specified files
                const filePatterns = rule.files.map(f => `--include="${f}"`).join(' ');
                const result = execSync(
                    `grep -r -l "${rule.pattern}" ${filePatterns} "${projectDir}" 2>/dev/null | head -1`,
                    { encoding: 'utf8', timeout: 5000 }
                ).trim();

                if (result) {
                    detected.push(rule.name);
                }
            }
        } catch (err) {
            // Command failed or timed out, skip this stack
        }
    }

    // Security stack is always applicable for web projects
    if (detected.some(s => ['dotnet', 'react', 'api-patterns'].includes(s))) {
        detected.push('security');
    }

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

module.exports = {
    STACK_RULES,
    detectStacks,
    detectStacksFromFiles,
    loadStackProfile,
    loadStackProfiles,
    extractCommonMistakes,
    extractReviewChecklist
};
