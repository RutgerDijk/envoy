/**
 * Envoy Skills Core Library
 *
 * Utilities for skill discovery, resolution, and metadata extraction.
 * Enables personal skill shadowing and dynamic skill loading.
 */

const fs = require('fs');
const path = require('path');

/**
 * Extract frontmatter from a SKILL.md file
 * @param {string} filePath - Path to the SKILL.md file
 * @returns {{name: string, description: string} | null}
 */
function extractFrontmatter(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

        if (!frontmatterMatch) return null;

        const frontmatter = frontmatterMatch[1];
        const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
        const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

        return {
            name: nameMatch ? nameMatch[1].trim() : null,
            description: descMatch ? descMatch[1].trim() : null
        };
    } catch (err) {
        return null;
    }
}

/**
 * Strip frontmatter from skill content
 * @param {string} content - Raw SKILL.md content
 * @returns {string} Content without frontmatter
 */
function stripFrontmatter(content) {
    return content.replace(/^---\n[\s\S]*?\n---\n/, '');
}

/**
 * Find all skills in a directory
 * @param {string} dir - Directory to search
 * @param {string} sourceType - 'envoy' or 'personal' for namespacing
 * @param {number} maxDepth - Maximum recursion depth (default 3)
 * @returns {Array<{path: string, name: string, description: string, sourceType: string}>}
 */
function findSkillsInDir(dir, sourceType, maxDepth = 3) {
    const skills = [];

    function search(currentDir, depth) {
        if (depth > maxDepth) return;

        try {
            const entries = fs.readdirSync(currentDir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);

                if (entry.isDirectory()) {
                    // Check for SKILL.md in this directory
                    const skillFile = path.join(fullPath, 'SKILL.md');
                    if (fs.existsSync(skillFile)) {
                        const meta = extractFrontmatter(skillFile);
                        if (meta && meta.name) {
                            skills.push({
                                path: skillFile,
                                skillPath: fullPath,
                                name: meta.name,
                                description: meta.description,
                                sourceType
                            });
                        }
                    }
                    // Recurse into subdirectories
                    search(fullPath, depth + 1);
                }
            }
        } catch (err) {
            // Directory not accessible, skip
        }
    }

    search(dir, 0);
    return skills;
}

/**
 * Resolve a skill name to its file path
 * Personal skills shadow envoy skills unless explicitly prefixed
 *
 * @param {string} skillName - Skill name (e.g., "brainstorming" or "envoy:brainstorming")
 * @param {string} envoyDir - Path to envoy skills directory
 * @param {string} personalDir - Path to personal skills directory (~/.claude/skills)
 * @returns {{skillFile: string, sourceType: string, skillPath: string} | null}
 */
function resolveSkillPath(skillName, envoyDir, personalDir) {
    // Check for explicit prefix
    let forceEnvoy = false;
    let cleanName = skillName;

    if (skillName.startsWith('envoy:')) {
        forceEnvoy = true;
        cleanName = skillName.substring(6);
    }

    // Build potential paths
    const envoyPath = path.join(envoyDir, cleanName, 'SKILL.md');
    const personalPath = personalDir ? path.join(personalDir, cleanName, 'SKILL.md') : null;

    // If forced envoy, only check envoy
    if (forceEnvoy) {
        if (fs.existsSync(envoyPath)) {
            return {
                skillFile: envoyPath,
                sourceType: 'envoy',
                skillPath: path.dirname(envoyPath)
            };
        }
        return null;
    }

    // Personal skills shadow envoy skills
    if (personalPath && fs.existsSync(personalPath)) {
        return {
            skillFile: personalPath,
            sourceType: 'personal',
            skillPath: path.dirname(personalPath)
        };
    }

    if (fs.existsSync(envoyPath)) {
        return {
            skillFile: envoyPath,
            sourceType: 'envoy',
            skillPath: path.dirname(envoyPath)
        };
    }

    return null;
}

/**
 * List all available skills from both envoy and personal directories
 * @param {string} envoyDir - Path to envoy skills directory
 * @param {string} personalDir - Path to personal skills directory
 * @returns {Array<{name: string, description: string, sourceType: string, shadowed: boolean}>}
 */
function listAllSkills(envoyDir, personalDir) {
    const envoySkills = findSkillsInDir(envoyDir, 'envoy');
    const personalSkills = personalDir ? findSkillsInDir(personalDir, 'personal') : [];

    // Build map of personal skill names for shadowing detection
    const personalNames = new Set(personalSkills.map(s => s.name));

    // Mark envoy skills as shadowed if personal version exists
    const allSkills = [
        ...personalSkills,
        ...envoySkills.map(s => ({
            ...s,
            shadowed: personalNames.has(s.name)
        }))
    ];

    return allSkills;
}

module.exports = {
    extractFrontmatter,
    stripFrontmatter,
    findSkillsInDir,
    resolveSkillPath,
    listAllSkills
};
