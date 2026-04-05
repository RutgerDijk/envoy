/**
 * Task-Aware File Relevance Scorer
 *
 * Given a set of changed/task-relevant files, walks import/dependency
 * chains to score every related file's relevance to the current task.
 *
 * Inspired by lean-ctx's heat diffusion + PageRank approach,
 * adapted for Envoy's review and implementation workflows.
 *
 * Output: ranked list of files with recommended read depth.
 */

const fs = require('fs');
const path = require('path');

/**
 * Read depth recommendations based on relevance score.
 */
const READ_DEPTH = {
  full: { label: 'full', description: 'Read entire file — directly changed or critical dependency' },
  focused: { label: 'focused', description: 'Read signatures + changed sections' },
  skim: { label: 'skim', description: 'Scan exports and public API only' },
  skip: { label: 'skip', description: 'Not relevant to this task' },
};

/**
 * Language-specific import/require pattern sources.
 * Returns fresh regex instances per call to avoid shared /g state.
 */
function getImportPatterns(ext) {
  const patterns = {
    ts: [
      /import\s+(?:(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|[\w]+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|[\w]+))*\s+from\s+)?['"]([^'"]+)['"]/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ],
    js: [
      /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|[\w]+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|[\w]+))*\s+from\s+)?['"]([^'"]+)['"]/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ],
    tsx: [
      /import\s+(?:(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|[\w]+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|[\w]+))*\s+from\s+)?['"]([^'"]+)['"]/g,
    ],
    jsx: [
      /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|[\w]+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|[\w]+))*\s+from\s+)?['"]([^'"]+)['"]/g,
    ],
    cs: [
      /using\s+([\w.]+)\s*;/g,
    ],
    py: [
      /(?:from\s+([\w.]+)\s+)?import\s+([\w.]+)/g,
    ],
  };
  return patterns[ext] || [];
}

/**
 * Extract imports from a file's content.
 *
 * @param {string} content - File content
 * @param {string} ext - File extension (without dot)
 * @returns {string[]} List of import paths/modules
 */
function extractImports(content, ext) {
  const patterns = getImportPatterns(ext);

  const imports = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      // Use first capturing group that has a value
      const importPath = match[1] || match[2];
      if (importPath) imports.push(importPath);
    }
  }
  return imports;
}

/**
 * Resolve a relative import to an absolute file path.
 * Tries common extensions if the import has none.
 *
 * @param {string} importPath - The import string
 * @param {string} fromFile - The file doing the importing
 * @param {string} projectRoot - Project root directory
 * @returns {string|null} Resolved path or null
 */
function resolveImport(importPath, fromFile, projectRoot) {
  // Skip external packages
  if (!importPath.startsWith('.') && !importPath.startsWith('/') && !importPath.startsWith('@/')) {
    return null;
  }

  // Handle @/ alias (common in React/Next.js projects)
  let basePath;
  if (importPath.startsWith('@/')) {
    basePath = path.join(projectRoot, 'src', importPath.slice(2));
  } else {
    basePath = path.resolve(path.dirname(fromFile), importPath);
  }

  // Try exact path first, then with extensions
  const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.cs', '.py', '/index.ts', '/index.tsx', '/index.js'];
  for (const ext of extensions) {
    const candidate = basePath + ext;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Build a dependency graph from a set of seed files.
 * Walks imports up to maxDepth hops.
 *
 * @param {string[]} seedFiles - Changed/task-relevant files (absolute paths)
 * @param {string} projectRoot - Project root
 * @param {number} [maxDepth=3] - Maximum traversal depth
 * @returns {Map<string, {depth: number, importedBy: string[], imports: string[]}>}
 */
function buildDependencyGraph(seedFiles, projectRoot, maxDepth = 3) {
  const graph = new Map();
  const queue = seedFiles.map(f => ({ file: f, depth: 0 }));
  const visited = new Set();

  while (queue.length > 0) {
    const { file, depth } = queue.shift();
    if (visited.has(file)) continue;
    if (depth > maxDepth) continue;
    visited.add(file);

    const ext = path.extname(file).slice(1);
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    const imports = extractImports(content, ext);
    const resolvedImports = imports
      .map(imp => resolveImport(imp, file, projectRoot))
      .filter(Boolean);

    graph.set(file, {
      depth,
      importedBy: [],
      imports: resolvedImports,
    });

    // Track reverse edges
    for (const imported of resolvedImports) {
      if (!graph.has(imported)) {
        graph.set(imported, { depth: depth + 1, importedBy: [], imports: [] });
      }
      graph.get(imported).importedBy.push(file);

      if (!visited.has(imported)) {
        queue.push({ file: imported, depth: depth + 1 });
      }
    }
  }

  return graph;
}

/**
 * Score files by relevance using heat diffusion from seed files.
 *
 * Seeds start with heat=1.0. Each hop diffuses heat by alpha factor.
 * Files imported by multiple seeds accumulate heat.
 *
 * @param {Map<string, {depth: number, importedBy: string[], imports: string[]}>} graph
 * @param {string[]} seedFiles - The task-relevant files
 * @param {number} [alpha=0.5] - Diffusion factor per hop
 * @param {number} [iterations=4] - Diffusion iterations
 * @returns {Map<string, number>} File → relevance score (0-1)
 */
function scoreRelevance(graph, seedFiles, alpha = 0.5, iterations = 4) {
  const scores = new Map();

  // Initialize seeds with full heat
  for (const seed of seedFiles) {
    scores.set(seed, 1.0);
  }

  // Initialize non-seeds with 0
  for (const file of graph.keys()) {
    if (!scores.has(file)) {
      scores.set(file, 0);
    }
  }

  // Diffuse heat through edges
  for (let iter = 0; iter < iterations; iter++) {
    const newScores = new Map(scores);

    for (const [file, info] of graph) {
      // Receive heat from files that import this file
      let incoming = 0;
      for (const importer of info.importedBy) {
        incoming += (scores.get(importer) || 0) * alpha;
      }
      // Receive heat from files this file imports
      for (const imported of info.imports) {
        incoming += (scores.get(imported) || 0) * alpha * 0.5; // Lower weight for outgoing
      }

      const current = scores.get(file) || 0;
      newScores.set(file, Math.min(1.0, current + incoming));
    }

    // Update scores
    for (const [file, score] of newScores) {
      scores.set(file, score);
    }
  }

  return scores;
}

/**
 * Recommend read depth based on relevance score.
 *
 * @param {number} score - Relevance score (0-1)
 * @param {boolean} isSeed - Whether this is a directly changed file
 * @returns {typeof READ_DEPTH[keyof typeof READ_DEPTH]}
 */
function recommendDepth(score, isSeed) {
  if (isSeed) return READ_DEPTH.full;
  if (score >= 0.5) return READ_DEPTH.focused;
  if (score >= 0.2) return READ_DEPTH.skim;
  return READ_DEPTH.skip;
}

/**
 * Main entry point: score all files related to a task.
 *
 * @param {string[]} changedFiles - Files changed/being changed (absolute paths)
 * @param {string} projectRoot - Project root
 * @param {Object} [options]
 * @param {number} [options.maxDepth=3] - Max dependency chain depth
 * @param {number} [options.alpha=0.5] - Heat diffusion factor
 * @returns {Array<{file: string, relPath: string, score: number, depth: typeof READ_DEPTH[keyof typeof READ_DEPTH], isSeed: boolean}>}
 */
function scoreTaskRelevance(changedFiles, projectRoot, options = {}) {
  const maxDepth = options.maxDepth || 3;
  const alpha = options.alpha || 0.5;

  const graph = buildDependencyGraph(changedFiles, projectRoot, maxDepth);
  const scores = scoreRelevance(graph, changedFiles, alpha);

  const seedSet = new Set(changedFiles);
  const results = [];

  for (const [file, score] of scores) {
    if (score < 0.1 && !seedSet.has(file)) continue; // Skip irrelevant

    results.push({
      file,
      relPath: path.relative(projectRoot, file),
      score: Math.round(score * 100) / 100,
      depth: recommendDepth(score, seedSet.has(file)),
      isSeed: seedSet.has(file),
    });
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results;
}

/**
 * Format relevance results as a compact briefing for agent prompts.
 *
 * @param {Array<{relPath: string, score: number, depth: {label: string}}>} results
 * @returns {string}
 */
function formatForPrompt(results) {
  if (results.length === 0) return '';

  const lines = ['## Relevant Files'];
  for (const r of results.slice(0, 15)) {
    lines.push(`- \`${r.relPath}\` — ${r.depth.label} (${r.score})`);
  }
  if (results.length > 15) {
    lines.push(`- ... and ${results.length - 15} more at skim/skip level`);
  }
  return lines.join('\n');
}

module.exports = {
  extractImports,
  resolveImport,
  buildDependencyGraph,
  scoreRelevance,
  recommendDepth,
  scoreTaskRelevance,
  formatForPrompt,
  READ_DEPTH,
  getImportPatterns,
};
