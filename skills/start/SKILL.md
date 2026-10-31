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
(plugin root) and `SNAP` (snapshot file) itself. Copy each block whole.

## Process

### Step 1: Show the coloured dashboard

```bash
ENVOY=$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd)
REPO=$(git rev-parse --show-toplevel)
[ -n "$CMUX_WORKSPACE_ID" ] && cmux new-split right --focus false \
  --command "cd '$REPO' && node '$ENVOY/bin/envoy-start.js'; exec \$SHELL" && echo "MODE=cmux" \
  || echo "MODE=plain  RUN: ! node '$ENVOY/bin/envoy-start.js'"
```

- `MODE=cmux` → tell the user the dashboard is open in the right split.
- `MODE=plain` (no cmux, or the split failed) → tell the user to type the printed
  `! node '…/bin/envoy-start.js'` line for the coloured view (Claude's Bash
  output strips colour and links). Do not paste the dashboard yourself.

### Step 2: Snapshot and build the options

Saves the `lib/start-status.js` snapshot (shape: its `StartSnapshot` typedef) to
gitignored `.envoy/start/snapshot.json`, then prints up to 4 options.

```bash
ENVOY=$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd)
SNAP="$(git rev-parse --show-toplevel)/.envoy/start/snapshot.json"
mkdir -p "$(dirname "$SNAP")" && node "$ENVOY/lib/start-status.js" > "$SNAP" &&
SNAP="$SNAP" node -e '
const s = require(process.env.SNAP);
const cut = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
const issueOf = (n) => s.issues.find((i) => i.number === n);
const items = s.ranking.slice(0, 3);
const rec = s.issues.find((i) => i.recommended);
if (rec && !items.some((r) => r.kind === "issue" && r.ref === rec.number)) {
  items.push(s.ranking.find((r) => r.kind === "issue" && r.ref === rec.number)
    || { kind: "issue", ref: rec.number, action: rec.plan ? "pickup" : "brainstorm" });
}
const seen = new Set(), out = [];
for (const r of items) {
  if (seen.has(r.kind + ":" + r.ref)) continue;
  seen.add(r.kind + ":" + r.ref);
  let label, why;
  if (r.kind === "pr") {
    const p = s.prs.find((x) => x.number === r.ref) || { title: "" };
    label = `Hervat PR #${r.ref}: ${p.title}`;
    why = [p.ci && `CI ${p.ci}`, p.unresolved && `${p.unresolved} unresolved threads`].filter(Boolean).join(", ");
  } else if (r.kind === "worktree") {
    const w = s.worktrees.find((x) => x.branch === r.ref) || { sessions: [] };
    const t = (w.issue && issueOf(w.issue)) || s.prs.find((x) => x.branch === r.ref);
    const verb = r.action === "cleanup" ? "Cleanup" : "Hervat";
    label = verb === "Hervat" && w.issue ? `Hervat #${w.issue}: ${t ? t.title : r.ref}` : `${verb} ${r.ref}`;
    why = r.action === "cleanup" ? `stale, idle ${w.idleDays} days`
      : [`${w.ahead} commits ahead`, w.dirty && "uncommitted changes", `${w.sessions.length} session(s)`].filter(Boolean).join(", ");
  } else if (r.kind === "brainstorm") {
    const b = s.brainstorms.find((x) => x.sessionId === r.ref) || {};
    label = `Hervat brainstorm: ${b.topic || String(r.ref).slice(0, 8)}`;
    why = `brainstorm from ${b.ageDays} days ago, no issue yet`;
  } else {
    const i = issueOf(r.ref) || { title: "", description: "" };
    label = `${r.action === "pickup" ? "Pickup" : "Brainstorm"} #${r.ref}: ${i.title}`;
    why = [i.recommended && "recommended", i.plan ? "has plan" : "no plan yet", i.description].filter(Boolean).join(" · ");
  }
  out.push({ label: cut(label, 70), description: cut(why || r.label, 120), kind: r.kind, ref: r.ref, action: r.action });
}
if (out.length < 2) out.push({ label: "Brainstorm something new", description: "Start a new idea with envoy:brainstorm", kind: "new", ref: null, action: "brainstorm" });
if (out.length < 2) out.push({ label: "Nothing for now", description: "Close the dashboard without starting anything", kind: "none", ref: null, action: "none" });
console.log(JSON.stringify(out, null, 2));
'
```

### Step 3: Ask the user

Call **AskUserQuestion** with one question ("What do you want to work on?",
`header: "Next"`), one option per entry above (2–4; the script pads with
`Brainstorm something new` / `Nothing for now` when fewer than 2 are open): `label` → option
label, `description` → option description. Keep the order.

- **Free-text answer** ("Other") → match it against the labels, issue numbers,
  branch names and brainstorm topics in the snapshot. If it names nothing in the
  snapshot, say so and stop — never guess an item.

### Step 4: Dispatch the choice

| Choice `action` | Do |
|---|---|
| `hervat` (`kind` pr / worktree / brainstorm) | Resolve and open the session — Step 4a |
| `pickup` | Invoke Skill `envoy:pickup` with args `<issue number>` |
| `brainstorm` | Invoke Skill `envoy:brainstorm` with args `#<issue number> <issue title>` (no args when `kind` is `new`) |
| `none` | Stop |
| `cleanup` | cleanup acts on the current branch: in Bash `cd '<worktree path from snapshot>'`, then invoke Skill `envoy:cleanup` |

#### Step 4a: Resume a session

Resolve the directory, the most recent session id, and the tab-title parts.
Set `KIND` and `REF` from the chosen entry (`REF` as a string):

```bash
SNAP="$(git rev-parse --show-toplevel)/.envoy/start/snapshot.json"
SNAP="$SNAP" KIND="worktree" REF="feature/83-example" node -e '
const s = require(process.env.SNAP);
const { KIND, REF } = process.env;
let wt = null, pr = null, dir = null, session = null;
if (KIND === "brainstorm") {
  const b = s.brainstorms.find((x) => x.sessionId === REF);
  if (b) { dir = b.cwd; session = b.sessionId; }
} else {
  if (KIND === "pr") {
    pr = s.prs.find((x) => String(x.number) === REF) || null;
    wt = pr && s.worktrees.find((w) => w.branch === pr.branch);
  } else {
    wt = s.worktrees.find((w) => w.branch === REF);
  }
  if (wt) {
    dir = wt.path;
    const newest = [...wt.sessions].sort((a, b) => String(b.modified).localeCompare(String(a.modified)))[0];
    session = newest ? newest.sessionId : null;
    if (!pr) pr = s.prs.find((x) => x.branch === wt.branch) || null;
  }
}
const issue = (wt && wt.issue) || (pr && pr.issue) || null;
const it = issue && s.issues.find((i) => i.number === issue);
console.log(JSON.stringify({ dir, session, issue, pr: pr ? pr.number : null,
  issueTitle: (it && it.title) || (pr && pr.title) || null }));
'
```

- `session` is `null` → say "No Claude session recorded for this item." If
  `dir` is set, print `cd '<dir>'` so the user can start a fresh session there.
  Stop.
- Otherwise open it. Build the title with `lib/tab-title.js`, then run
  `lib/open-session.js` with the resolved values (all from the JSON above —
  **never invent a session id**; open-session rejects malformed ids):

```bash
ENVOY=$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd)
DIR="/abs/worktree/path"; SESSION="<session from JSON>"
ISSUE="83"; PR="91"; ISSUE_TITLE='<issueTitle from JSON>'   # '' when null; escape ' as '\''
TITLE=$(ENVOY="$ENVOY" ISSUE="$ISSUE" PR="$PR" ISSUE_TITLE="$ISSUE_TITLE" node -e '
const { computeTitle } = require(process.env.ENVOY + "/lib/tab-title.js");
process.stdout.write(computeTitle({ issue: Number(process.env.ISSUE) || null,
  pr: Number(process.env.PR) || null, issueTitle: process.env.ISSUE_TITLE || null }) || "");
')
node "$ENVOY/lib/open-session.js" --dir "$DIR" --session "$SESSION" --title "$TITLE"   # empty title is ignored
```

Relay what open-session printed (cmux workspace opened / VS Code window +
command on clipboard / command to run by hand). This session stays put.

## Integration with Envoy

- Reads `lib/start-status.js` — the single snapshot source (brainstorms,
  worktrees + sessions, PRs, issues, `ranking`)
- Renders via `bin/envoy-start.js` (cmux right split, or the user's `!` command)
- Opens resumed sessions via `lib/open-session.js` (cmux workspace / VS Code
  window + clipboard / printed command)
- Titles via `lib/tab-title.js` `computeTitle` (`#83 · PR #91 · <title>`); VS
  Code tab titles need the opt-in in
  [docs/vscode-tab-title-spike.md](../../docs/vscode-tab-title-spike.md)
- Invokes `envoy:pickup`, `envoy:brainstorm`, or `envoy:cleanup` in the current
  session for new work
