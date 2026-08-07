# Pickup — Steps 1–6: Fetch issue, branch, worktree, stack detection

### Step 1: Fetch Issue

```bash
gh issue view <issue-number> --json title,body,labels,state
```

Parse the response to extract:
- **Title** (for branch naming)
- **Body** (design content, acceptance criteria, task list)
- **Labels** (for context)
- **State** (verify it's open)

### Step 2: Set In Progress

Mark the issue as being actively worked on:

```bash
# Add "in progress" label (create if doesn't exist)
gh issue edit <issue-number> --add-label "in progress"

# Comment with branch name
gh issue comment <issue-number> --body "Started working on this issue in branch \`feature/<N>-$TOPIC\`"
```

### Step 3: Create Feature Branch

Create a new branch from main:

```bash
TOPIC=$(echo "<title>" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-' | head -c 40)
git checkout -b feature/<N>-$TOPIC main
```

### Step 4: Create Worktree

Use envoy:using-git-worktrees. **Worktrees are ALWAYS created in `.worktrees/`** — no exceptions.

```bash
# Ensure .worktrees/ is gitignored
grep -q "^\.worktrees/$" .gitignore 2>/dev/null || echo ".worktrees/" >> .gitignore

# Create worktree from the new branch
git worktree add .worktrees/<N>-$TOPIC feature/<N>-$TOPIC

# Copy Claude settings to worktree
cp -r .claude .worktrees/<N>-$TOPIC/

# Migrate any pre-worktree .envoy/ state into the worktree (fixes #1560 — pickup
# preflight writes .envoy/ in the main checkout before the worktree exists, so it
# would otherwise be stranded where a concurrent session could read or clobber it).
# Pass the worktree path via shell $TOPIC as a node arg — a `node -e` child cannot
# see the un-exported shell var through its environment, so reading it that way
# would be undefined and strand state in `.worktrees/<N>-undefined`.
node -e "require('${CLAUDE_SKILL_DIR}/../../lib/worktree-state').migrateEnvoyState(process.cwd(), process.argv[1])" ".worktrees/<N>-$TOPIC"

# Record this worktree's absolute path so later steps can prove they're inside it.
node -e "const fs=require('fs'),path=require('path'),wt=path.resolve(process.argv[1]); fs.mkdirSync(wt+'/.envoy',{recursive:true}); fs.writeFileSync(wt+'/.envoy/expected-worktree', wt)" ".worktrees/<N>-$TOPIC"
```

Step 5 `cd`s into the worktree and then **invokes** `assertInWorktree` (see
`lib/worktree-state.js`) against the `.envoy/expected-worktree` marker written
above: the guard throws if the process isn't running in this exact, git-registered
worktree. Because the migration removed `.envoy/` from the main checkout, a state
write attempted from the main checkout finds no marker and aborts — that's what
keeps a concurrent main-checkout session from racing on Envoy state.

### Step 5: Merge Permissions (REQUIRED)

**After copying .claude/, merge Envoy's required permissions into the worktree's settings.**

Read `.worktrees/$TOPIC/.claude/settings.local.json` and ensure these permissions exist in `allow`:

```json
{
  "permissions": {
    "allow": [
      "Bash(*)",
      "Read(**)",
      "Edit(**)",
      "Write(**)",
      "Grep",
      "Glob",
      "WebFetch",
      "WebSearch",
      "Task",
      "Skill(*)",
      "mcp__chrome-devtools__*"
    ],
    "deny": [
      "Read(.env)",
      "Read(.env.*)",
      "Read(**/.env)",
      "Read(**/.env.*)"
    ]
  }
}
```

**Merge logic:**
1. Read existing `settings.local.json` if present
2. For each permission above, check if it exists in `allow`
3. If missing, add it to the `allow` array
4. **Preserve all existing user permissions** (don't remove anything)
5. Merge `deny` arrays (union of both)
6. Write the merged result back

```bash
cd .worktrees/<N>-$TOPIC

# Guard: abort before any .envoy/ write if we're not actually inside this worktree
# (fixes #1560 — a write from the main checkout would strand or clobber state).
node -e "const ws=require('${CLAUDE_SKILL_DIR}/../../lib/worktree-state'),fs=require('fs'); ws.assertInWorktree(fs.readFileSync('.envoy/expected-worktree','utf8').trim())"

# Identify the worktree's terminal tab: OSC 0 sets both icon name and window
# title. Guarded on [ -t 1 ] so this never pollutes piped output or hook logs
# (e.g. this whole pickup run invoked non-interactively as a subagent).
[ -t 1 ] && printf '\033]0;#%s %s\007' "<N>" "$TOPIC"
```

### Step 6: Detect Stack Profiles

#### 6a: Run Detection

```bash
~/.claude/plugins/cache/envoy-marketplace/envoy/*/stacks/detect-stacks.sh --json
```

Or manually detect by checking for:

| File | Stack Profiles |
|------|----------------|
| `*.csproj` | dotnet, entity-framework, testing-dotnet |
| `package.json` with "react" | react, typescript, shadcn-radix, react-query |
| `tsconfig.json` | typescript |
| `docker-compose*.yml` | docker-compose |
| `*.bicep` | bicep, azure-container-apps |
| `.github/workflows/` | github-actions |

#### 6b: Read Detected Stack Profiles

For each detected stack, read the profile from `../../stacks/<stack-name>.md`.

Extract from each stack profile:
- **Common mistakes** — Avoid these during implementation
- **Best practices** — Follow these patterns
- **Review checklist** — Will be checked during review

Keep this context loaded for the implementation phase.
