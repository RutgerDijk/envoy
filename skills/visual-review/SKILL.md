---
name: visual-review
description: Use when UI changes need visual verification, or to check for console errors and network issues
---

# Visual Review with Chrome DevTools

## Overview

Verify UI changes using Chrome DevTools MCP integration. Takes screenshots, checks console for errors, verifies network requests, and tests user flows.

**Announce at start:** "I'm using envoy:visual-review to verify the UI changes."

## Prerequisites

- Application running (backend + frontend)
- Chrome browser open
- Chrome DevTools MCP configured and connected

## Process

### Step 1: Start Application

Envoy is a generic plugin — it does not assume a .NET+React layout. Detect
and manage the dev server via `lib/dev-server.js`:

**1a. Check if the target URL is already responding.**

```bash
node -e "console.log(require('./lib/dev-server').isAlreadyRunning(process.argv[1]))" "$TARGET_URL"
```

If `true`, do nothing further in this step — use what's already running.
Never start a second instance, and never plan to stop it in Cleanup (we
didn't start it).

**1b. If not responding, detect how to start it and start it.**

```bash
node -e "
const { detectStartCommand, startServer, waitForReady, writePidFile } = require('./lib/dev-server');
(async () => {
  const detected = detectStartCommand(process.cwd());
  if (!detected) {
    console.error('No dev server detected: no .envoy/visual.json override and no package.json scripts.dev/start.');
    process.exit(1);
  }
  const child = startServer(detected.command, detected.cwd);
  writePidFile(process.cwd(), child.pid);
  const url = detected.url || process.argv[1];
  const ready = await waitForReady(url, 90000);
  if (!ready) {
    console.error('Dev server did not become ready within 90s: ' + url);
    process.exit(1);
  }
  console.log('Ready: ' + url);
})();
" "$TARGET_URL"
```

`detectStartCommand` checks `.envoy/visual.json` first (override shape:
`{"command": "npm run custom-dev", "url": "http://localhost:3000", "cwd": "frontend"}`
— `cwd` is relative to repo root, for monorepos where the frontend lives in
a subdirectory), then falls back to `package.json` `scripts.dev` (preferred)
or `scripts.start`.

The PID is written to `.envoy/visual-review/server.pid` — this is the "did
WE start this" marker read back in Cleanup, so a pre-existing server the
user was already running is never killed.

**1c. If detection fails**, ask the user for the start command instead of
guessing.

### Step 2: Identify Pages to Verify

From changed files, determine affected pages:

| Changed File | Affected Page |
|--------------|---------------|
| `src/pages/Users.tsx` | `/users` |
| `src/components/UserForm.tsx` | `/users/new`, `/users/:id/edit` |
| `src/api/users.ts` | All user pages |

### Step 3: List Available Pages

```
mcp__chrome-devtools__list_pages
```

Select the page running your frontend (usually localhost:5173).

### Step 4: Handle Authentication

After navigating to a page, check if you're on a login screen.

**Detection:** Look for login indicators in the screenshot or DOM:
- Login form with email/password fields
- "Sign in" or "Log in" buttons
- Redirect to `/login`, `/auth`, `/signin` URLs

**If login screen detected:**

1. **Ask user for test credentials:**
   ```
   "I've hit a login screen. Please provide test credentials:
   - Email/username:
   - Password:

   Or tell me if there's a specific test user I should use."
   ```

2. **Log in using provided credentials:**
   ```
   mcp__chrome-devtools__fill_form
     selector: "input[type='email'], input[name='email'], #email"
     value: "<provided-email>"

   mcp__chrome-devtools__fill_form
     selector: "input[type='password'], input[name='password'], #password"
     value: "<provided-password>"

   mcp__chrome-devtools__click
     selector: "button[type='submit'], .login-button, button:contains('Sign in')"

   mcp__chrome-devtools__wait_for
     selector: ".dashboard, .home, [data-authenticated='true']"
     timeout: 5000
   ```

3. **Verify login succeeded** — Take screenshot to confirm authenticated state

4. **Continue with review** — Navigate to intended pages

### Step 5: Navigate and Verify Each Page

For each affected page:

#### 5a. Navigate to Page

```
mcp__chrome-devtools__navigate_page
  url: "http://localhost:5173/<path>"
```

#### 5b. Take Screenshot

```
mcp__chrome-devtools__take_screenshot
```

Save/display screenshot for visual inspection.

#### 5c. Check Console Messages

```
mcp__chrome-devtools__list_console_messages
```

**Flag issues:**
- ❌ Errors (red) — Must fix
- ⚠️ Warnings related to changed code — Should review
- ℹ️ Info/debug — Usually OK

#### 5d. Check Network Requests

```
mcp__chrome-devtools__list_network_requests
```

**Flag issues:**
- ❌ Failed requests (4xx, 5xx status)
- ⚠️ Slow requests (>1000ms)
- ⚠️ Missing expected requests

### Step 6: Test User Flows

For interactive features, test the complete flow:

#### Example: Form Submission

```
# 1. Navigate to form page
mcp__chrome-devtools__navigate_page
  url: "http://localhost:5173/users/new"

# 2. Fill form fields
mcp__chrome-devtools__fill_form
  selector: "#name"
  value: "Test User"

mcp__chrome-devtools__fill_form
  selector: "#email"
  value: "test@example.com"

# 3. Submit form
mcp__chrome-devtools__click
  selector: "button[type='submit']"

# 4. Wait for result
mcp__chrome-devtools__wait_for
  selector: ".success-message"
  timeout: 5000

# 5. Capture result
mcp__chrome-devtools__take_screenshot
```

#### Example: Navigation Flow

```
# 1. Start at list page
mcp__chrome-devtools__navigate_page
  url: "http://localhost:5173/users"

# 2. Click on item
mcp__chrome-devtools__click
  selector: ".user-card:first-child"

# 3. Wait for detail page
mcp__chrome-devtools__wait_for
  selector: ".user-detail"
  timeout: 3000

# 4. Verify content loaded
mcp__chrome-devtools__take_snapshot
```

### Step 7: Take DOM Snapshot (Optional)

For detailed inspection:

```
mcp__chrome-devtools__take_snapshot
```

Useful for verifying:
- Correct elements rendered
- Proper accessibility attributes
- Expected data displayed

## Report Format

```
**Visual Review Complete**

## Pages Verified

| Page | Screenshot | Console | Network |
|------|------------|---------|---------|
| /users | ✓ | ✓ 0 errors | ✓ 0 failures |
| /users/new | ✓ | ⚠ 1 warning | ✓ 0 failures |
| /users/123 | ✓ | ✓ 0 errors | ✓ 0 failures |

## User Flows Tested

| Flow | Result |
|------|--------|
| Create user | ✓ Pass |
| Edit user | ✓ Pass |
| Delete user | ✓ Pass |

## Issues Found

### Console Warning (Page: /users/new)
```
Warning: Each child in a list should have a unique "key" prop.
  at SelectOptions (SelectOptions.tsx:15)
```
**Recommendation:** Add key prop to list items in SelectOptions component.

## Screenshots

[Screenshots captured and available for review]

## Summary

- Pages checked: 3
- Screenshots: 3
- Console errors: 0
- Console warnings: 1
- Network failures: 0
- User flows: 3/3 passed

**Recommendation:** Fix console warning, otherwise ready to proceed.
```

## Cleanup

After visual review, stop the server ONLY if this skill started it (checked
via the PID file written in Step 1 — a server the user already had running
is never touched):

```bash
node -e "
const { readPidFile, stopServer, clearPidFile } = require('./lib/dev-server');
const pid = readPidFile(process.cwd());
if (pid) {
  stopServer(pid);
  clearPidFile(process.cwd());
  console.log('Stopped dev server (pid ' + pid + ') started by visual-review.');
} else {
  console.log('No server was started by visual-review — nothing to stop.');
}
"
```

## Common Issues

### Page Not Loading

```
Check:
1. Did Step 1's dev-server detection find a start command? (`.envoy/visual.json` or package.json scripts.dev/start)
2. Is the correct URL being used?
3. Are there build errors — check the dev server's own logs?
```

### Network Requests Failing

```
Check:
1. Is the backend/API server running (start it the same way, or add it to .envoy/visual.json)?
2. Is the API URL configured correctly?
3. Are there CORS issues?

Check: Browser DevTools Network tab
```

### Chrome DevTools Not Connected

```
Check:
1. Is Chrome running with remote debugging?
2. Is the MCP server configured?
3. Is the correct port being used?

Start Chrome with: --remote-debugging-port=9222
```
