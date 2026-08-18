#!/usr/bin/env node
/**
 * Contract invariant reachability — Test Suite.
 *
 * Run: node tests/lib/contract-invariant-reachability.test.js
 *
 * An invariant that matches no real dispatch site never fires — the gate
 * looks armed but guards nothing (exactly how the description-keyed
 * matchers went inert). For every skills/&ast;/contract.json with
 * agentInvariants, this suite cross-checks the invariants against the
 * dispatch sites written in that skill's own step files:
 *  - every invariant selects by identity (matchDescription, and
 *    matchTaskId when the site goes through dispatch());
 *  - every matchDescription matches at least one `description: "..."`
 *    literal in the skill's files;
 *  - every literal `taskId: '...'` passed to dispatch() is covered by
 *    some invariant's matchTaskId;
 *  - every matchTaskId matches a literal taskId, or the skill has a
 *    dynamic `taskId: task.id` site justifying a catch-all.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SKILLS_DIR = path.join(REPO_ROOT, 'skills');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
  } catch (err) {
    failed++;
    process.stdout.write(`  \x1b[31m✗\x1b[0m ${name}\n    ${err.message}\n`);
  }
}

function section(name) {
  process.stdout.write(`\n${name}\n`);
}

function markdownFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(p));
    else if (entry.name.endsWith('.md')) out.push(p);
  }
  return out;
}

function collectMarkdown(dir) {
  return markdownFiles(dir).map((p) => fs.readFileSync(p, 'utf8')).join('\n');
}

function skillsWithInvariants() {
  const result = [];
  for (const name of fs.readdirSync(SKILLS_DIR)) {
    const contractPath = path.join(SKILLS_DIR, name, 'contract.json');
    if (!fs.existsSync(contractPath)) continue;
    const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
    const invariants = contract.agentInvariants || [];
    if (invariants.length > 0) result.push({ name, invariants });
  }
  return result;
}

section('contract invariants are reachable from real dispatch sites');

for (const { name, invariants } of skillsWithInvariants()) {
  const markdown = collectMarkdown(path.join(SKILLS_DIR, name));
  // Both quote styles are in active use across the step files; matching
  // only one would read the other's dispatch sites as unreachable.
  const descriptions = [...markdown.matchAll(/description:\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const taskIds = [...markdown.matchAll(/taskId:\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const hasDynamicTaskId = /taskId:\s*task\.id/.test(markdown);

  test(`${name}: every invariant selects by identity, not prompt prose`, () => {
    for (const inv of invariants) {
      assert.ok(inv.matchDescription, `invariant ${JSON.stringify(inv)} has no matchDescription`);
      assert.ok(!inv.matchPrompt, `invariant "${inv.matchDescription}" still carries matchPrompt`);
    }
  });

  test(`${name}: every matchDescription matches a real description literal`, () => {
    for (const inv of invariants) {
      if (!inv.matchDescription) continue;
      const re = new RegExp(inv.matchDescription);
      assert.ok(
        descriptions.some((d) => re.test(d)),
        `matchDescription "${inv.matchDescription}" matches none of ${JSON.stringify(descriptions)}`,
      );
    }
  });

  test(`${name}: every dispatch() taskId literal is covered by an invariant`, () => {
    for (const id of taskIds) {
      const covered = invariants.some((inv) => inv.matchTaskId && new RegExp(inv.matchTaskId).test(id));
      assert.ok(covered, `taskId '${id}' is dispatched but no invariant's matchTaskId covers it`);
    }
  });

  test(`${name}: every matchTaskId corresponds to a real dispatch site`, () => {
    for (const inv of invariants) {
      if (!inv.matchTaskId) continue;
      const re = new RegExp(inv.matchTaskId);
      const reachable = taskIds.some((id) => re.test(id)) || hasDynamicTaskId;
      assert.ok(
        reachable,
        `matchTaskId "${inv.matchTaskId}" matches no taskId literal and the skill has no dynamic taskId site`,
      );
    }
  });

  test(`${name}: a catch-all matchTaskId covers only dynamic dispatch sites`, () => {
    for (const inv of invariants) {
      if (!inv.matchTaskId) continue;
      const re = new RegExp(inv.matchTaskId);
      if (!re.test('__probe-no-real-task-would-be-named-this__')) continue;
      // A catch-all is fail-closed for dynamic ids (every worker must carry
      // the tokens), but it also swallows any future literal-id site into
      // this invariant's requirements without anyone choosing that. Keep
      // catch-alls legal only while the skill has no literal sites at all —
      // adding one forces an explicit per-site invariant here.
      assert.ok(
        hasDynamicTaskId,
        `catch-all matchTaskId "${inv.matchTaskId}" but the skill has no dynamic taskId site`,
      );
      assert.strictEqual(
        taskIds.length,
        0,
        `catch-all matchTaskId "${inv.matchTaskId}" would silently absorb literal taskIds ${JSON.stringify(taskIds)} — key an explicit invariant per literal site instead`,
      );
    }
  });
}

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
