#!/usr/bin/env node
'use strict';

/**
 * Spec-driven task fields — single source for the human `## Tasks` section,
 * the machine-readable block embedded in the issue, and authoring-time
 * enforcement of the spec fields.
 *
 * The issue is the authoring surface: brainstorm renders the human section
 * and embeds the machine block; pickup can recover the payload from that block
 * when the committed `.envoy-tasks/<n>.json` is missing.
 *
 * CLI:
 *   node lib/tasks-embed.js section <payload.json>   # prints the ## Tasks markdown
 *   node lib/tasks-embed.js block   <payload.json>   # prints the embeddable block
 */

const fs = require('fs');

const BEGIN = '<!-- envoy:tasks:begin -->';
const END = '<!-- envoy:tasks:end -->';

/**
 * Enforce the spec-driven fields required for NEW task lists at authoring time.
 * (The schema keeps these OPTIONAL so historical task files stay valid.)
 * @param {object} payload
 * @returns {{ ok: boolean, errors: string[] }}
 */
function enforceSpecFields(payload) {
  const errors = [];
  const tasks = (payload && payload.tasks) || [];
  tasks.forEach((t, i) => {
    const id = t.id || `#${i + 1}`;
    if (typeof t.intent !== 'string' || !t.intent.trim()) {
      errors.push(`task ${id}: intent is required (non-empty string)`);
    }
    if (!Array.isArray(t.behavior) || t.behavior.length === 0) {
      errors.push(`task ${id}: behavior is required (non-empty given/when/then list)`);
    }
    if (!Array.isArray(t.acceptance) || t.acceptance.length === 0) {
      errors.push(`task ${id}: acceptance is required (non-empty list)`);
    }
  });
  return { ok: errors.length === 0, errors };
}

function bullets(items) {
  return (items || []).map((x) => `- ${x}`).join('\n');
}

/**
 * Render the human-readable `## Tasks` section from the payload.
 * @param {object} payload
 * @returns {string}
 */
function renderTasksSection(payload) {
  const tasks = (payload && payload.tasks) || [];
  const parts = ['## Tasks', '', '> Every task in this spec is REQUIRED.', ''];
  tasks.forEach((t, i) => {
    parts.push(`### Task ${i + 1}: ${t.title || t.id}`);
    if (t.intent) parts.push('', `**Intent:** ${t.intent}`);
    if (Array.isArray(t.behavior) && t.behavior.length) {
      parts.push('', '**Behavior:**', bullets(t.behavior));
    }
    if (Array.isArray(t.files) && t.files.length) {
      parts.push('', `**Files:** ${t.files.join(', ')}`);
    }
    if (Array.isArray(t.acceptance) && t.acceptance.length) {
      parts.push('', '**Acceptance:**', bullets(t.acceptance));
    }
    if (Array.isArray(t.contracts) && t.contracts.length) {
      parts.push('', '**Contracts:**', bullets(t.contracts));
    }
    if (Array.isArray(t.outOfScope) && t.outOfScope.length) {
      parts.push('', '**Out of scope:**', bullets(t.outOfScope));
    }
    parts.push('');
  });
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * Render the machine-readable block to embed in the issue body. pickup recovers
 * the exact payload from this when the committed task file is missing.
 * @param {object} payload
 * @returns {string}
 */
function renderEmbeddedBlock(payload) {
  return [
    '<details>',
    '<summary>Machine-readable task list (envoy)</summary>',
    '',
    BEGIN,
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    END,
    '',
    '</details>',
  ].join('\n');
}

/**
 * Recover the embedded payload from an issue body, or null if absent/invalid.
 * @param {string} issueBody
 * @returns {object|null}
 */
function extractEmbeddedBlock(issueBody) {
  if (typeof issueBody !== 'string') return null;
  const start = issueBody.indexOf(BEGIN);
  const end = issueBody.indexOf(END);
  if (start === -1 || end === -1 || end < start) return null;
  const between = issueBody.slice(start + BEGIN.length, end);
  const fence = between.match(/```json\s*([\s\S]*?)```/);
  const json = fence ? fence[1] : between;
  try {
    return JSON.parse(json.trim());
  } catch (_err) {
    return null;
  }
}

function main() {
  const [, , mode, file] = process.argv;
  if (!mode || !file) {
    process.stderr.write('Usage: tasks-embed.js <section|block> <payload.json>\n');
    process.exit(1);
  }
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (mode === 'section') process.stdout.write(renderTasksSection(payload));
  else if (mode === 'block') process.stdout.write(renderEmbeddedBlock(payload) + '\n');
  else {
    process.stderr.write(`unknown mode: ${mode}\n`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  enforceSpecFields,
  renderTasksSection,
  renderEmbeddedBlock,
  extractEmbeddedBlock,
  BEGIN,
  END,
};
