#!/usr/bin/env node
/**
 * Stop hook: Batch lint/format across all files edited in this session.
 *
 * Reads accumulated file paths from post-edit-accumulator, deduplicates,
 * runs lint/format once, then cleans up the temp file.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getAccumulatorPath() {
  const sessionId = process.env.CLAUDE_SESSION_ID || 'default';
  return path.join(require('os').tmpdir(), `envoy-edited-${sessionId}.txt`);
}

function run(rawInput) {
  const accPath = getAccumulatorPath();

  if (!fs.existsSync(accPath)) return;

  try {
    const content = fs.readFileSync(accPath, 'utf8').trim();
    if (!content) return;

    // Deduplicate and filter existing files
    const files = [...new Set(content.split('\n'))]
      .filter(f => f && fs.existsSync(f));

    if (files.length === 0) return;

    // Group by project type for targeted lint
    const jsFiles = files.filter(f => /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(f));
    const csFiles = files.filter(f => /\.(cs|csx)$/.test(f));

    // Run ESLint/Prettier on JS/TS files if package.json exists
    if (jsFiles.length > 0 && fs.existsSync('package.json')) {
      try {
        execSync(`npx eslint --fix ${jsFiles.join(' ')}`, {
          encoding: 'utf8',
          timeout: 30000,
          stdio: 'pipe',
        });
      } catch (err) {
        // Lint errors are informational, don't block
      }
    }

    // Run dotnet format on C# files if csproj exists
    if (csFiles.length > 0) {
      try {
        const csproj = execSync('find . -maxdepth 3 -name "*.csproj" -print -quit 2>/dev/null', {
          encoding: 'utf8',
          timeout: 5000,
        }).trim();

        if (csproj) {
          execSync(`dotnet format --include ${csFiles.join(' ')}`, {
            encoding: 'utf8',
            timeout: 30000,
            stdio: 'pipe',
          });
        }
      } catch (err) {
        // Format errors are informational
      }
    }
  } catch (err) {
    // Non-blocking
  } finally {
    // Always clean up
    try { fs.unlinkSync(accPath); } catch (e) { /* ignore */ }
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

module.exports = { run };
