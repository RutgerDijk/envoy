#!/bin/bash
# Envoy Session Start Hook
# Injects the using-envoy skill and auto-detects stack profiles

# Capture the SessionStart payload (has the trigger: startup|resume|clear|compact)
# before redirecting stdin to /dev/null so escape sequences can't leak through.
HOOK_INPUT=$(cat 2>/dev/null || true)
exec < /dev/null

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"

HOOK_SOURCE=$(HOOK_INPUT="$HOOK_INPUT" node -e '
  try {
    const s = JSON.parse(process.env.HOOK_INPUT || "{}");
    process.stdout.write(s.source || "");
  } catch (_e) {}
' 2>/dev/null)

# Function to escape content for JSON
escape_json() {
    local content="$1"
    # Escape backslashes, quotes, and control characters
    content="${content//\\/\\\\}"
    content="${content//\"/\\\"}"
    content="${content//$'\n'/\\n}"
    content="${content//$'\r'/\\r}"
    content="${content//$'\t'/\\t}"
    echo "$content"
}

# Build a compact skill-routing table (name + one-line description) instead of
# inlining the full using-envoy skill body. The full body loads on demand via
# the Skill tool, in line with progressive disclosure.
ROUTING_TABLE=$(node -e '
  const fs = require("fs");
  const path = require("path");
  const skillsDir = process.argv[1];
  let names = [];
  try {
    names = fs.readdirSync(skillsDir).filter((n) => {
      try { return fs.statSync(path.join(skillsDir, n)).isDirectory(); } catch (_e) { return false; }
    }).sort();
  } catch (_e) {}
  const lines = [];
  for (const name of names) {
    const file = path.join(skillsDir, name, "SKILL.md");
    let content;
    try { content = fs.readFileSync(file, "utf8"); } catch (_e) { continue; }
    const m = content.match(/^description:\s*(.+)$/m);
    if (!m) continue;
    let desc = m[1].trim();
    // Strip generic lead-in boilerplate so truncation preserves the
    // differentiating part of the description instead of cutting it off
    // mid boilerplate. Two shapes exist:
    //  - rigid-skill template: "<Skill> expert. ALWAYS invoke when/before/
    //    after ..." — the "ALWAYS invoke ..." clause is not anchored at
    //    position 0 (it follows "<Skill> expert."), so search for it
    //    anywhere near the start and strip through it.
    //  - flexible-skill template: "Use when/before ..." — anchored at
    //    position 0.
    const rigidLeadIn = /\bALWAYS\s+invoke\s+(when|before|after)\b[.:]?\s*/i;
    const rigidMatch = desc.slice(0, 60).match(rigidLeadIn);
    if (rigidMatch && rigidMatch.index <= 40) {
      desc = desc.slice(rigidMatch.index + rigidMatch[0].length);
    } else {
      desc = desc.replace(/^(use\s+(when|before|after|this)|before|when)\b[.:]?\s*/i, "");
    }
    const MAX = 42;
    if (desc.length > MAX) desc = desc.slice(0, MAX - 3) + "...";
    lines.push(name + ": " + desc);
  }
  process.stdout.write(lines.join("\n"));
' "$PLUGIN_DIR/skills" 2>/dev/null)

if [ -z "$ROUTING_TABLE" ]; then
    ROUTING_TABLE="(routing table unavailable — invoke envoy:using-envoy via the Skill tool for skill discovery)"
fi

# Detect stacks in current directory.
# Single source of truth (#78 task-8): delegates to lib/stack-loader.js
# (same STACK_RULES, exclusion flags, and per-rule files: lists used by
# stacks/detect-stacks.sh) instead of carrying its own copy of the probe
# logic — one Node process, not one per rule, to stay fast on large repos.
DETECTED_STACKS=$(node "$PLUGIN_DIR/lib/stack-loader.js" . 2>/dev/null)

# Detect session state (cross-session continuity)
SESSION_STATE=""
if [ -f ".envoy-session.json" ]; then
    # Extract all fields in a single Node process
    eval "$(node -e "
      const s=JSON.parse(require('fs').readFileSync('.envoy-session.json','utf8'));
      const esc=v=>(v||'').replace(/'/g,\"'\\\\''\");
      console.log('SESSION_BRANCH=\'' + esc(s.branch||'unknown') + '\'');
      console.log('SESSION_PLAN=\'' + esc(s.plan||'') + '\'');
      const d=(s.tasks||[]).filter(t=>t.status==='done').length;
      console.log('SESSION_TASKS=\'' + d+'/'+(s.tasks||[]).length + '\'');
      console.log('SESSION_UPDATED=\'' + esc(s.updatedAt||'') + '\'');
      const ns=(s.nextSteps||[]).slice(0,3).map(n=>'- '+n).join('\n');
      console.log('SESSION_NEXTSTEPS=\'' + esc(ns) + '\'');
      const dc=(s.decisions||[]).slice(-3).map(d=>'- '+d.text).join('\n');
      console.log('SESSION_DECISIONS=\'' + esc(dc) + '\'');
    " 2>/dev/null)"

    SESSION_STATE="---

**Session state detected** (from \`.envoy-session.json\`, last updated: $SESSION_UPDATED)

**Branch:** $SESSION_BRANCH"

    if [ -n "$SESSION_PLAN" ]; then
        SESSION_STATE="$SESSION_STATE
**Plan:** $SESSION_PLAN"
    fi

    SESSION_STATE="$SESSION_STATE
**Progress:** $SESSION_TASKS tasks complete"

    if [ -n "$SESSION_DECISIONS" ]; then
        SESSION_STATE="$SESSION_STATE
**Recent decisions:**
$SESSION_DECISIONS"
    fi

    if [ -n "$SESSION_NEXTSTEPS" ]; then
        SESSION_STATE="$SESSION_STATE
**Next steps:**
$SESSION_NEXTSTEPS"
    fi

    SESSION_STATE="$SESSION_STATE

Load full state with: \`const session = require('./lib/session-state').load()\`
To clear after branch is done: \`require('./lib/session-state').clear()\`"
fi

# Compaction-resume nudge: on a resume trigger, if the most recent ledger
# event is a pre-compact that recorded an active skill, surface an explicit
# nudge to re-invoke it — after compaction the skill's full discipline rules
# may have been trimmed from context. The ledger tail alone is not enough:
# it stays put indefinitely if the skill is never re-invoked, so we also
# consult the active-skill marker (same TTL/branch/session staleness logic
# pre-compact.js already uses) as the source of truth for "still relevant".
RESUME_NUDGE=""
if [ "$HOOK_SOURCE" = "resume" ] && [ -f ".envoy/ledger.jsonl" ]; then
    RESUME_NUDGE=$(node -e '
      try {
        const { tailLedger } = require(process.argv[1]);
        const { readActiveSkill } = require(process.argv[2]);
        const events = tailLedger(process.cwd(), 1);
        const last = events[events.length - 1];
        if (last && last.type === "pre-compact" && last.activeSkill) {
          const marker = readActiveSkill(process.cwd());
          if (marker && marker.skill === last.activeSkill) {
            const issuePart = (last.issueNumber !== undefined && last.issueNumber !== null)
              ? " (issue #" + last.issueNumber + ")"
              : "";
            process.stdout.write(
              "⚠ Resuming after compaction — re-invoke envoy:" + last.activeSkill +
              " now to restore its full discipline rules" + issuePart + "."
            );
          }
        }
      } catch (_err) {}
    ' "$PLUGIN_DIR/lib/ledger" "$PLUGIN_DIR/lib/active-skill" 2>/dev/null)
fi

if [ -n "$RESUME_NUDGE" ]; then
    RESUME_NUDGE="---

**$RESUME_NUDGE**"
fi

# Recent workflow record from the durable ledger (trust the record over recollection)
WORKFLOW_RECORD=""
if [ -f ".envoy/ledger.jsonl" ]; then
    LEDGER_TAIL=$(node -e '
      try {
        const { tailLedger } = require(process.argv[1]);
        const events = tailLedger(process.cwd(), 10);
        const lines = events.map((e) => {
          const parts = [e.ts, e.branch, e.type || e.event || "event"];
          if (e.issue !== undefined && e.issue !== null) parts.push("#" + e.issue);
          if (e.skill) parts.push(e.skill);
          if (e.detail) parts.push(e.detail);
          return "- " + parts.filter(Boolean).join(" ");
        });
        process.stdout.write(lines.join("\n"));
      } catch (_err) {}
    ' "$PLUGIN_DIR/lib/ledger" 2>/dev/null)

    if [ -n "$LEDGER_TAIL" ]; then
        WORKFLOW_RECORD="---

**Recent workflow record (trust this + git log over recollection)**

Ledger (last events):
$LEDGER_TAIL"

        GIT_LOG=$(git log --oneline -10 2>/dev/null)
        if [ -n "$GIT_LOG" ]; then
            WORKFLOW_RECORD="$WORKFLOW_RECORD

Recent git log:
$GIT_LOG"
        fi
    fi
fi

# Build stack list for output
if [ -n "$DETECTED_STACKS" ]; then
    STACK_INFO="**Detected stacks:** $DETECTED_STACKS

When implementing or reviewing code, load the relevant stack profiles from \`stacks/<stack-name>.md\` for best practices and common mistakes."
else
    STACK_INFO="No specific stacks detected. Load stack profiles as needed from \`stacks/\`."
fi

# Build the output message
OUTPUT_CONTENT="<EXTREMELY_IMPORTANT>
Envoy skills (check before responding, invoke via Skill tool; using-envoy has full guidance):

$ROUTING_TABLE

---

$STACK_INFO
$SESSION_STATE
$WORKFLOW_RECORD
$RESUME_NUDGE
</EXTREMELY_IMPORTANT>"

# Escape for JSON
ESCAPED_CONTENT=$(escape_json "$OUTPUT_CONTENT")

# Output JSON response
cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "$ESCAPED_CONTENT"
  }
}
EOF
