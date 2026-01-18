---
name: wiki-sync
description: Use after updating documentation in docs/wiki/, or as part of PR finalization
---

# Wiki Sync

## Overview

Sync contents of `docs/wiki/` to the GitHub wiki repository. Can be used standalone or as part of the finalization workflow.

**Announce at start:** "I'm using envoy:wiki-sync to sync documentation to GitHub wiki."

## Prerequisites

- `docs/wiki/` directory exists with content
- GitHub CLI (`gh`) authenticated
- Repository has wiki enabled

## Process

### Step 1: Verify docs/wiki/ Exists

```bash
if [ ! -d "docs/wiki" ]; then
  echo "No docs/wiki/ directory found."
  echo "Create documentation in docs/wiki/ first."
  exit 1
fi

# Check for content
FILE_COUNT=$(find docs/wiki -name "*.md" | wc -l)
if [ "$FILE_COUNT" -eq 0 ]; then
  echo "docs/wiki/ is empty. Add documentation first."
  exit 1
fi

echo "Found $FILE_COUNT markdown files in docs/wiki/"
```

### Step 2: Get Repository Info

```bash
# Get repo name (e.g., "owner/repo")
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo "Repository: $REPO"

# Create wiki cache path
WIKI_PATH=~/.cache/wiki-repos/$(echo $REPO | tr '/' '-').wiki
echo "Wiki cache: $WIKI_PATH"
```

### Step 3: Clone or Update Wiki Repository

```bash
# Create cache directory
mkdir -p ~/.cache/wiki-repos

if [ -d "$WIKI_PATH" ]; then
  echo "Updating existing wiki clone..."
  cd "$WIKI_PATH"
  git fetch origin
  git reset --hard origin/master 2>/dev/null || git reset --hard origin/main
else
  echo "Cloning wiki repository..."
  git clone "git@github.com:${REPO}.wiki.git" "$WIKI_PATH" 2>/dev/null

  if [ $? -ne 0 ]; then
    echo "Wiki doesn't exist yet. Creating..."
    mkdir -p "$WIKI_PATH"
    cd "$WIKI_PATH"
    git init
    git remote add origin "git@github.com:${REPO}.wiki.git"
  fi
fi
```

### Step 4: Check for Divergence

```bash
cd "$WIKI_PATH"

# Get current wiki state
git status

# Check if wiki has commits not in our docs/wiki
WIKI_COMMITS=$(git log --oneline 2>/dev/null | head -5)
if [ -n "$WIKI_COMMITS" ]; then
  echo "Current wiki commits:"
  echo "$WIKI_COMMITS"
fi
```

**If wiki has changes not in docs/wiki/:**

```
**Wiki Divergence Detected**

The GitHub wiki has changes that are not in docs/wiki/.
This could happen if someone edited the wiki directly.

Options:
1. **Overwrite** — Replace wiki with docs/wiki/ content (loses wiki-only changes)
2. **Merge** — Manually review and merge changes
3. **Skip** — Don't sync, keep both as-is

Choice?
```

### Step 5: Copy Documentation

```bash
# Get project root (where docs/wiki is)
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

# Copy files from docs/wiki to wiki repo
cd "$WIKI_PATH"
cp -r "${PROJECT_ROOT}/docs/wiki/"* .

# Show what changed
git status
```

### Step 6: Commit and Push

```bash
cd "$WIKI_PATH"

# Stage all changes
git add -A

# Check if there are changes to commit
if git diff --cached --quiet; then
  echo "No changes to sync."
else
  # Commit
  git commit -m "docs: sync from main repo

Synced from: ${REPO}
Branch: $(cd ${PROJECT_ROOT} && git branch --show-current)
Commit: $(cd ${PROJECT_ROOT} && git rev-parse --short HEAD)"

  # Push
  git push origin master 2>/dev/null || git push origin main 2>/dev/null || {
    # First push to new wiki
    git push --set-upstream origin master
  }

  echo "Wiki synced successfully!"
fi
```

### Step 7: Report

```
**Wiki Sync Complete**

| Item | Status |
|------|--------|
| Files synced | <count> |
| New files | <list> |
| Modified files | <list> |
| Deleted files | <list> |

**Wiki URL:** https://github.com/<owner>/<repo>/wiki

**Synced files:**
- Home.md
- Getting-Started.md
- API-Reference.md
- ...
```

## Wiki File Structure

Recommended `docs/wiki/` structure:

```
docs/wiki/
├── Home.md              # Wiki landing page
├── Getting-Started.md   # Setup and installation
├── Architecture.md      # System architecture
├── API-Reference.md     # API documentation
├── Contributing.md      # How to contribute
└── _Sidebar.md          # Wiki sidebar navigation
```

### Special Files

| File | Purpose |
|------|---------|
| `Home.md` | Wiki landing page (required) |
| `_Sidebar.md` | Custom sidebar navigation |
| `_Footer.md` | Custom footer on all pages |

### Sidebar Example

```markdown
<!-- _Sidebar.md -->
**Navigation**

* [[Home]]
* [[Getting Started]]
* [[Architecture]]

**Reference**

* [[API Reference]]
* [[Configuration]]

**Contributing**

* [[Contributing]]
* [[Code of Conduct]]
```

## Troubleshooting

### Wiki Not Enabled

```
Error: Repository doesn't have wiki enabled.

Solution:
1. Go to repository Settings
2. Scroll to Features section
3. Enable "Wikis"
```

### Permission Denied

```
Error: Permission denied (publickey).

Solution:
1. Check SSH key is configured: ssh -T git@github.com
2. Or use HTTPS: git remote set-url origin https://github.com/<repo>.wiki.git
```

### Empty Wiki

```
First-time sync to empty wiki:
1. Wiki repo will be created automatically
2. Home.md becomes the landing page
3. Initial push creates the wiki
```

## Standalone Usage

Wiki sync can be run anytime, not just during finalization:

```
/envoy:wiki-sync
```

Use after:
- Adding new documentation
- Updating existing docs
- Fixing documentation errors
- Regular sync to keep wiki current
