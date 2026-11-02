---
name: start
description: Use when you want a session dashboard of everything open — brainstorms, worktrees, PRs, issues — and to resume or start the next item by name.
when_to_use:
  - When the user types /envoy:start
  - At the start of a session to see what's open and resume it
  - When the user asks "where was I?" or "what should I work on next?"
allowed-tools:
  - Read
  - Bash
  - Skill
  - AskUserQuestion
---

# Session Start Dashboard

## Overview

Show the `/envoy:start` dashboard, then let the user pick what to work on by
name. Resuming an existing item opens its Claude session in a new terminal;
starting new work (pickup, brainstorm, cleanup) runs that Envoy skill in **this**
session. The dashboard and snapshot are read-only.

**Announce at start:** "I'm using envoy:start to show what's open and pick what to resume."

Shell state does not persist between Bash calls: every block sets `ENVOY`
(plugin root) itself. Copy each block whole. Never paste a branch, path, title
or session id into a command — only the option **index** and the one snapshot
path Step 2 prints as `SNAP=<path>`; `lib/start-choices.js` reads everything
else from that snapshot.

## Process

### Step 1: Show the coloured dashboard

```bash
ENVOY=$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd)
REPO=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "MODE=no-repo"; exit 0; }
case "$REPO$ENVOY" in
  *"'"*) echo "MODE=plain  RUN: ! node \"$ENVOY/bin/envoy-start.js\"" ;;
  *) [ -n "$CMUX_WORKSPACE_ID" ] && cmux new-split right --focus false \
       --command "cd '$REPO' && node '$ENVOY/bin/envoy-start.js'; exec \$SHELL" && echo "MODE=cmux" \
       || echo "MODE=plain  RUN: ! node '$ENVOY/bin/envoy-start.js'" ;;
esac
```

- `MODE=no-repo` → tell the user `/envoy:start` must run inside a git repo. Stop.
- `MODE=cmux` → tell the user the dashboard is open in the right split.
- `MODE=plain` (no cmux, the split failed, or a path contains `'`) → tell the
  user to type the printed `! node …/bin/envoy-start.js` line for the coloured
  view (Claude's Bash output strips colour and links). Do not paste the
  dashboard yourself.

### Step 2: Snapshot and build the options

Saves the `lib/start-status.js` snapshot (shape: its `StartSnapshot` typedef) to
a new, unique file under gitignored `.envoy/start/` (so concurrent
`/envoy:start` runs never share one; snapshots older than a day are pruned),
prints `SNAP=<path>`, then 2–4 options as JSON (`index`, `label`,
`description`, `action`, `kind`, `ref`).

```bash
ENVOY=$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd)
TOP=$(git rev-parse --show-toplevel) && mkdir -p "$TOP/.envoy/start" &&
find "$TOP/.envoy/start" -maxdepth 1 -name 'snapshot.*' -mtime +1 -delete
SNAP=$(mktemp "$TOP/.envoy/start/snapshot.XXXXXX") && echo "SNAP=$SNAP" &&
node "$ENVOY/lib/start-status.js" > "$SNAP" &&
node "$ENVOY/lib/start-choices.js" options "$SNAP"
```

Remember the printed `SNAP=` path: Step 4 acts on exactly that snapshot.

The list is the first 3 ranking items plus the recommended issue. A PR and its
own worktree count as one option (the PR). When fewer than 2 items are open, it
is padded with `Brainstorm something new` / `Nothing for now`.

### Step 3: Ask the user

Call **AskUserQuestion** with one question ("What do you want to work on?",
`header: "Next"`), one option per entry, in order: `label` → option label,
`description` → option description. Map the answer back to its `index`.

- **Free-text answer** ("Other") → match it against the option labels and the
  snapshot's issue numbers, branches and brainstorm topics. If it names nothing
  in the options, say so and stop — never guess an item.

### Step 4: Dispatch the choice

In the blocks below, set `SNAP=` to the exact path Step 2 printed (single-quoted
literal) and `INDEX=` to the chosen option's `index` (a plain number).

| `action` | Do |
|---|---|
| `hervat` | Run the resume block below |
| `pickup` | Invoke Skill `envoy:pickup` with args `<ref>` (the issue number) |
| `brainstorm` | Invoke Skill `envoy:brainstorm` with args `#<ref>` (no args when `kind` is `new`) |
| `cleanup` | Run the cleanup block below, then invoke Skill `envoy:cleanup` |
| `none` | Stop |

**Resume** — opens the newest session for the item via `lib/open-session.js`
(title from `lib/tab-title.js`). If no session exists it prints the worktree
path instead; for a PR without a local worktree it points to `envoy:babysit` or
`gh pr checkout <n>`.

```bash
ENVOY=$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd)
SNAP='<printed SNAP path>'   # the exact path Step 2 printed
INDEX=1   # the chosen option's index
node "$ENVOY/lib/start-choices.js" resume "$SNAP" "$INDEX"
```

Relay what it printed (cmux workspace opened / VS Code window + command on
clipboard / command to run by hand / no session). This session stays put.

**Cleanup** — `envoy:cleanup` reads the branch and worktree from the current
directory, then moves to the main repo itself. So `cd` into the worktree first:

```bash
ENVOY=$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd)
SNAP='<printed SNAP path>'   # the exact path Step 2 printed
INDEX=1   # the chosen option's index
DIR=$(node "$ENVOY/lib/start-choices.js" dir "$SNAP" "$INDEX") && cd "$DIR" && pwd
```

## Integration with Envoy

- Reads `lib/start-status.js` — the single snapshot source (brainstorms,
  worktrees + sessions, PRs, issues, `ranking`)
- Renders via `bin/envoy-start.js` (cmux right split, or the user's `!` command)
- Builds options and dispatches by index via `lib/start-choices.js`, which runs
  `lib/open-session.js` (cmux workspace / VS Code window + clipboard / printed
  command) with argv only — no snapshot value reaches a shell string
- Titles via `lib/tab-title.js` `computeTitle` (`#83 · PR #91 · <title>`); VS
  Code tab titles need the opt-in in
  [docs/vscode-tab-title-spike.md](../../docs/vscode-tab-title-spike.md)
- Invokes `envoy:pickup`, `envoy:brainstorm`, or `envoy:cleanup` in the current
  session for new work
