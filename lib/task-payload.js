/**
 * Task Payload — slim per-agent prompt slices
 *
 * Pickup's Step 13 dispatches implementer/reviewer agents once per task.
 * Historically each agent only ever received its own task's full spec —
 * but agents had zero visibility into sibling tasks, which made it easy
 * to duplicate work or step on a neighboring task's files.
 *
 * These are pure functions:
 * - buildSiblingIndex: a one-line-per-task index of siblings (id + title
 *   only — never a full spec) so agents get sibling awareness without
 *   the token cost of every task's complete text.
 * - buildTaskSlice: formats a single task's structured fields
 *   (intent/behavior/files/acceptance/contracts/outOfScope) per the
 *   canonical shape in lib/schemas/tasks.json — not an ad-hoc format.
 */

/**
 * Build a one-line-per-task index of sibling tasks.
 *
 * @param {Array<{id: string, title: string}>} allTasks - Full task list
 * @param {string} currentTaskId - The task currently being worked
 * @param {Object} [options]
 * @param {boolean} [options.includeCurrent] - Include current task, marked "(current)"
 * @returns {string} One line per task, e.g. "- T1: Add login form"
 */
function buildSiblingIndex(allTasks, currentTaskId, options = {}) {
  const { includeCurrent = false } = options;

  if (!Array.isArray(allTasks) || allTasks.length === 0) return '';

  const lines = allTasks
    .filter(task => includeCurrent || task.id !== currentTaskId)
    .map(task => {
      const marker = task.id === currentTaskId ? ' (current)' : '';
      return `- ${task.id}: ${task.title}${marker}`;
    });

  return lines.join('\n');
}

/**
 * Build a single task's slice using only the structured schema fields
 * (lib/schemas/tasks.json): intent, behavior, files, acceptance,
 * contracts, outOfScope. Ignores ad-hoc fields like `description`.
 *
 * @param {Object} task - A task object conforming to lib/schemas/tasks.json
 * @returns {string} Formatted task slice
 */
function buildTaskSlice(task) {
  const lines = [];

  lines.push(`Task ${task.id}: ${task.title}`);

  if (task.intent) {
    lines.push('', 'Intent:', task.intent);
  }

  if (Array.isArray(task.behavior) && task.behavior.length > 0) {
    lines.push('', 'Behavior:', ...task.behavior.map(b => `- ${b}`));
  }

  if (Array.isArray(task.files) && task.files.length > 0) {
    lines.push('', 'Files:', ...task.files.map(f => `- ${f}`));
  }

  if (Array.isArray(task.acceptance) && task.acceptance.length > 0) {
    lines.push('', 'Acceptance:', ...task.acceptance.map(a => `- ${a}`));
  }

  if (Array.isArray(task.contracts) && task.contracts.length > 0) {
    lines.push('', 'Contracts:', ...task.contracts.map(c => `- ${c}`));
  }

  if (Array.isArray(task.outOfScope) && task.outOfScope.length > 0) {
    lines.push('', 'Out of scope:', ...task.outOfScope.map(o => `- ${o}`));
  }

  return lines.join('\n');
}

module.exports = {
  buildSiblingIndex,
  buildTaskSlice,
};
