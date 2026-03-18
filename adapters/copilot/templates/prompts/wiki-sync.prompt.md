---
mode: 'agent'
description: 'Sync docs/wiki/ directory to the GitHub wiki repository'
---

# Wiki Sync

Push the local `docs/wiki/` directory to the GitHub wiki.

## Check for Wiki Content

```bash
ls docs/wiki/
```

If `docs/wiki/` does not exist or is empty, there is nothing to sync. Inform the user.

## Get Repository Info

```bash
REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner')
echo "Repository: $REPO"
```

## Clone the Wiki Repository

```bash
WIKI_DIR=$(mktemp -d)
git clone "https://github.com/$REPO.wiki.git" "$WIKI_DIR"
```

If the clone fails because the wiki is not initialized on GitHub:
1. Go to the repository on GitHub
2. Click the "Wiki" tab
3. Click "Create the first page" to initialize it
4. Then re-run this command

## Sync Files

```bash
# Copy all files from docs/wiki/ to the wiki repo
cp -r docs/wiki/. "$WIKI_DIR/"

cd "$WIKI_DIR"

# Stage all changes
git add -A

# Check if there are changes to commit
if git diff --staged --quiet; then
  echo "No changes to sync — wiki is up to date"
  exit 0
fi

# Show what changed
git diff --staged --stat

# Commit and push
git commit -m "docs: sync wiki from main repository"
git push origin master
```

## Clean Up

```bash
rm -rf "$WIKI_DIR"
echo "✅ Wiki sync complete"
```

## File Naming Convention for GitHub Wiki

GitHub wiki uses the filename (without extension) as the page title, with hyphens shown as spaces:

- `Home.md` → "Home" (main wiki page)
- `Getting-Started.md` → "Getting Started"
- `API-Reference.md` → "API Reference"
- `Deployment-Guide.md` → "Deployment Guide"

Ensure your `docs/wiki/` files follow this convention.
