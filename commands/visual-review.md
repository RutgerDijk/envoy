---
description: Run Chrome DevTools visual verification only
---

# Visual Review Command

Use the envoy:visual-review skill to verify UI changes with Chrome DevTools.

**Checks:**
- Screenshots of affected pages
- Console for errors/warnings
- Network requests for failures
- User flow testing

If "$ARGUMENTS" contains URLs or paths, verify those specific pages.
Otherwise, detect changed frontend files and verify affected pages.

**Requires:**
- Application running (backend + frontend)
- Chrome DevTools MCP configured
