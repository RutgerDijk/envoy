---
description: Sync docs/wiki/ directory to GitHub wiki repository
---

# Wiki Sync Command

Use the envoy:wiki-sync skill to synchronize documentation.

**Syncs:** `docs/wiki/` → GitHub wiki repository

**Can be used:**
- Standalone after documentation updates
- As part of `/envoy:finalize` workflow

**Prerequisites:**
- `docs/wiki/` directory exists with markdown files
- GitHub wiki is enabled for the repository
- `gh` CLI is authenticated
