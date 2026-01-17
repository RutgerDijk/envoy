---
name: visual-review
description: Chrome DevTools visual and functional verification. Use to manually verify UI changes work correctly.
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

```bash
# Start backend (in background)
cd backend && dotnet run &
BACKEND_PID=$!

# Start frontend (in background)
cd frontend && npm run dev &
FRONTEND_PID=$!

# Wait for startup
echo "Waiting for services to start..."
sleep 10

# Verify services are running
curl -s http://localhost:5000/health || echo "Backend not ready"
curl -s http://localhost:5173 || echo "Frontend not ready"
```

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

### Step 4: Navigate and Verify Each Page

For each affected page:

#### 4a. Navigate to Page

```
mcp__chrome-devtools__navigate_page
  url: "http://localhost:5173/<path>"
```

#### 4b. Take Screenshot

```
mcp__chrome-devtools__take_screenshot
```

Save/display screenshot for visual inspection.

#### 4c. Check Console Messages

```
mcp__chrome-devtools__list_console_messages
```

**Flag issues:**
- ❌ Errors (red) — Must fix
- ⚠️ Warnings related to changed code — Should review
- ℹ️ Info/debug — Usually OK

#### 4d. Check Network Requests

```
mcp__chrome-devtools__list_network_requests
```

**Flag issues:**
- ❌ Failed requests (4xx, 5xx status)
- ⚠️ Slow requests (>1000ms)
- ⚠️ Missing expected requests

### Step 5: Test User Flows

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

### Step 6: Take DOM Snapshot (Optional)

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

After visual review:

```bash
# Stop services
kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
```

## Common Issues

### Page Not Loading

```
Check:
1. Is the frontend dev server running?
2. Is the correct URL being used?
3. Are there build errors?

Run: npm run dev (in frontend directory)
```

### Network Requests Failing

```
Check:
1. Is the backend running?
2. Is the API URL configured correctly?
3. Are there CORS issues?

Run: dotnet run (in backend directory)
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
