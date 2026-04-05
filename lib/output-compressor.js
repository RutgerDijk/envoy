/**
 * Shell Output Compressor
 *
 * Pattern-based compression for verbose CLI output.
 * Strips noise, keeps failures and summaries.
 *
 * Inspired by lean-ctx's 90+ shell compression patterns,
 * focused on the tools most common in Envoy's target workflows.
 *
 * Usage:
 *   const { compress } = require('./output-compressor');
 *   const result = compress(rawOutput, 'dotnet test');
 *   // result.compressed — the shortened output
 *   // result.savings — { original, compressed, ratio }
 */

/**
 * Compression patterns.
 * Each pattern has a test (does this command match?) and a compress function.
 *
 * Patterns are tried in order; first match wins.
 */
const PATTERNS = [
  //
  // ── dotnet build ──
  //
  {
    name: 'dotnet-build',
    test: (cmd) => /dotnet\s+build/.test(cmd),
    compress: (output) => {
      const lines = output.split('\n');
      const errors = lines.filter(l => /\s*error\s+\w+\s*:/.test(l));
      const warnings = lines.filter(l => /\s*warning\s+\w+\s*:/.test(l));
      const summary = lines.filter(l => /Build succeeded|Build FAILED|^\s+\d+ Error|^\s+\d+ Warning/.test(l));

      if (errors.length === 0 && summary.some(l => /Build succeeded/.test(l))) {
        return `Build succeeded.${warnings.length > 0 ? ` (${warnings.length} warnings)` : ''}`;
      }

      const parts = [];
      if (errors.length > 0) parts.push('**Errors:**\n' + errors.join('\n'));
      if (warnings.length > 0) parts.push(`**Warnings (${warnings.length}):**\n` + warnings.slice(0, 5).join('\n') + (warnings.length > 5 ? `\n... and ${warnings.length - 5} more` : ''));
      if (summary.length > 0) parts.push(summary.join('\n'));
      return parts.join('\n\n') || output;
    },
  },

  //
  // ── dotnet test ──
  //
  {
    name: 'dotnet-test',
    test: (cmd) => /dotnet\s+test/.test(cmd),
    compress: (output) => {
      const lines = output.split('\n');
      const failures = [];
      let inFailure = false;

      for (const line of lines) {
        if (/^\s*Failed\s+/.test(line) || /^\s*X\s+/.test(line)) {
          inFailure = true;
          failures.push(line);
        } else if (inFailure && /^\s{4,}/.test(line)) {
          failures.push(line); // Stack trace or details
        } else {
          inFailure = false;
        }
      }

      const summary = lines.filter(l => /^(Passed|Failed)!|Total tests:|^\s+(Passed|Failed|Skipped)\s*:/.test(l));
      const testCounts = lines.filter(l => /^\s*Total:\s+\d+|Passed:\s+\d+|Failed:\s+\d+/.test(l));

      if (failures.length === 0 && summary.some(l => /^Passed!/.test(l))) {
        const countLine = testCounts.join(', ').trim() || summary.join(' ').trim();
        return `All tests passed. ${countLine}`;
      }

      const parts = [];
      if (failures.length > 0) {
        parts.push('**Failed tests:**\n' + failures.slice(0, 30).join('\n') + (failures.length > 30 ? `\n... and ${failures.length - 30} more lines` : ''));
      }
      if (summary.length > 0) parts.push('\n' + summary.join('\n'));
      return parts.join('\n') || output;
    },
  },

  //
  // ── npm install ──
  //
  {
    name: 'npm-install',
    test: (cmd) => /npm\s+(install|ci|i)\b/.test(cmd),
    compress: (output) => {
      const lines = output.split('\n');
      const errors = lines.filter(l => /^npm ERR!/.test(l));
      const added = lines.find(l => /added \d+ packages/.test(l));
      const audit = lines.find(l => /\d+ vulnerabilities/.test(l));

      if (errors.length > 0) {
        return '**npm errors:**\n' + errors.join('\n');
      }

      const parts = [];
      if (added) parts.push(added.trim());
      if (audit) parts.push(audit.trim());
      return parts.join('\n') || 'npm install completed.';
    },
  },

  //
  // ── npm run build / npm run dev ──
  //
  {
    name: 'npm-build',
    test: (cmd) => /npm\s+run\s+(build|dev|start)/.test(cmd),
    compress: (output) => {
      const lines = output.split('\n');
      const errors = lines.filter(l => /error\s+(TS\d+|ESLint)|ERROR\s+in|Module not found|Cannot find/.test(l));
      const warnings = lines.filter(l => /warning\s+|WARN\s+/.test(l));
      const result = lines.filter(l => /compiled|Compiled|Successfully|Build complete|built in/.test(l));

      if (errors.length === 0 && result.length > 0) {
        return result.join('\n') + (warnings.length > 0 ? `\n(${warnings.length} warnings)` : '');
      }

      const parts = [];
      if (errors.length > 0) parts.push('**Errors:**\n' + errors.slice(0, 10).join('\n'));
      if (result.length > 0) parts.push(result.join('\n'));
      return parts.join('\n\n') || output;
    },
  },

  //
  // ── jest / vitest ──
  //
  {
    name: 'jest-vitest',
    test: (cmd) => /jest|vitest|npx\s+jest|npm\s+test|npm\s+run\s+test/.test(cmd),
    compress: (output) => {
      const lines = output.split('\n');
      const failures = [];
      let inFailBlock = false;

      for (const line of lines) {
        if (/FAIL\s+/.test(line)) {
          inFailBlock = true;
          failures.push(line);
        } else if (/PASS\s+/.test(line)) {
          inFailBlock = false;
        } else if (inFailBlock && line.trim().length > 0) {
          failures.push(line);
        }
      }

      const summary = lines.filter(l =>
        /Tests?:\s+\d+|Test Suites?:\s+\d+|Time:\s+/i.test(l) ||
        /Tests\s+\d+ passed|Tests\s+\d+ failed/.test(l)
      );

      if (failures.length === 0) {
        return summary.join('\n') || 'All tests passed.';
      }

      return '**Failed:**\n' + failures.slice(0, 40).join('\n') +
        (failures.length > 40 ? `\n... ${failures.length - 40} more lines` : '') +
        '\n\n' + summary.join('\n');
    },
  },

  //
  // ── git status ──
  //
  {
    name: 'git-status',
    test: (cmd) => /git\s+status/.test(cmd),
    compress: (output) => {
      const lines = output.split('\n').filter(l => l.trim().length > 0);
      // Already fairly compact, just strip verbose headers
      const useful = lines.filter(l =>
        !/^On branch|^Your branch|^$|^\s*\(use "git/.test(l)
      );
      const branch = lines.find(l => /^On branch/.test(l));
      return (branch ? branch + '\n' : '') + useful.join('\n');
    },
  },

  //
  // ── git diff (stat mode) ──
  //
  {
    name: 'git-diff-stat',
    test: (cmd) => /git\s+diff\s+--stat/.test(cmd),
    compress: (output) => output, // Already compact
  },

  //
  // ── git log ──
  //
  {
    name: 'git-log',
    test: (cmd) => /git\s+log/.test(cmd),
    compress: (output) => {
      // If it's already --oneline, pass through
      if (output.split('\n').every(l => l.length < 120 || l.trim() === '')) return output;

      // Otherwise extract commit + message lines
      const lines = output.split('\n');
      const commits = [];
      for (const line of lines) {
        if (/^commit [0-9a-f]{40}/.test(line)) {
          commits.push(line.replace('commit ', '').slice(0, 8));
        } else if (/^\s{4}\S/.test(line) && commits.length > 0) {
          commits[commits.length - 1] += ' ' + line.trim();
        }
      }
      return commits.length > 0 ? commits.join('\n') : output;
    },
  },

  //
  // ── docker compose ──
  //
  {
    name: 'docker-compose',
    test: (cmd) => /docker[\s-]compose/.test(cmd),
    compress: (output) => {
      const lines = output.split('\n');
      // Strip progress bars and pull layers
      const useful = lines.filter(l =>
        !/^\s*[0-9a-f]{12}:\s*(Pulling|Waiting|Downloading|Extracting|Pull complete|Verifying)/.test(l) &&
        !/^\[[\d\/]+\]\s/.test(l) // Build step progress
      );
      return useful.join('\n');
    },
  },

  //
  // ── playwright ──
  //
  {
    name: 'playwright',
    test: (cmd) => /playwright\s+test|npx\s+playwright/.test(cmd),
    compress: (output) => {
      const lines = output.split('\n');
      const failures = lines.filter(l => /✘|×|FAILED|Error:|failed/.test(l));
      const summary = lines.filter(l => /\d+ passed|\d+ failed|\d+ skipped|Slow test/.test(l));

      if (failures.length === 0) {
        return summary.join('\n') || 'All tests passed.';
      }

      return '**Failed:**\n' + failures.slice(0, 20).join('\n') + '\n\n' + summary.join('\n');
    },
  },

  //
  // ── cargo build/test ──
  //
  {
    name: 'cargo',
    test: (cmd) => /cargo\s+(build|test|check|clippy)/.test(cmd),
    compress: (output) => {
      const lines = output.split('\n');
      const errors = lines.filter(l => /^error/.test(l));
      const warnings = lines.filter(l => /^warning/.test(l));
      const summary = lines.filter(l => /test result:|Compiling|Finished|error\[E/.test(l));

      if (errors.length === 0) {
        return summary.join('\n') + (warnings.length > 0 ? `\n(${warnings.length} warnings)` : '');
      }

      const parts = [];
      if (errors.length > 0) parts.push(errors.slice(0, 10).join('\n'));
      parts.push(summary.join('\n'));
      return parts.join('\n\n');
    },
  },
];

/**
 * Safeguard ratio — if compression removes more than 95% of content,
 * return the original. Prevents over-aggressive compression losing critical info.
 * Set to 0.05 (5%) to allow normal success summaries like "Build succeeded."
 * while still catching pathological compression that drops error details.
 */
const SAFEGUARD_RATIO = 0.05;

/**
 * Compress shell output based on the command that produced it.
 *
 * @param {string} output - Raw shell output
 * @param {string} command - The command that was run
 * @returns {{ compressed: string, savings: { original: number, compressed: number, ratio: number, pattern: string|null } }}
 */
function compress(output, command) {
  if (!output || !command) {
    return {
      compressed: output || '',
      savings: { original: 0, compressed: 0, ratio: 0, pattern: null },
    };
  }

  const originalLength = output.length;

  for (const pattern of PATTERNS) {
    if (pattern.test(command)) {
      const compressed = pattern.compress(output);
      const compressedLength = compressed.length;

      // Safeguard: don't over-compress
      if (originalLength > 100 && compressedLength / originalLength < SAFEGUARD_RATIO) {
        return {
          compressed: output,
          savings: { original: originalLength, compressed: originalLength, ratio: 0, pattern: `${pattern.name} (safeguard)` },
        };
      }

      return {
        compressed,
        savings: {
          original: originalLength,
          compressed: compressedLength,
          ratio: originalLength > 0 ? Math.round((1 - compressedLength / originalLength) * 100) : 0,
          pattern: pattern.name,
        },
      };
    }
  }

  // No pattern matched — return as-is
  return {
    compressed: output,
    savings: { original: originalLength, compressed: originalLength, ratio: 0, pattern: null },
  };
}

/**
 * Get all registered pattern names.
 * @returns {string[]}
 */
function listPatterns() {
  return PATTERNS.map(p => p.name);
}

module.exports = {
  compress,
  listPatterns,
  PATTERNS,
  SAFEGUARD_RATIO,
};
