# Review — Layer 2: Visual review

Runs when the complexity tier already includes Layer 2 (Medium/Large), **or**
when `.envoy/active-skill.json`'s `frontendDetected` is `true` (preflight's
`detectStacksFromDiff()`-based check — see `skills/review/preflight.js`),
regardless of tier. In the latter case this layer is not optional.

Announce: `Running Layer 2: Visual Review...`

Invoke `envoy:visual-review` for Chrome DevTools verification.

1. **Identify affected pages** from changed files
2. **For each affected page:**
   - Navigate to page
   - Take screenshot
   - Check console for errors
   - Check network for failures
3. **Test user flows** from acceptance criteria
4. **App health check:** don't hardcode ports — envoy is a generic plugin
   and must not assume a fixed dotnet:5000/vite:5173 layout. Detect and
   verify the dev server the same way `envoy:visual-review` does, via
   `lib/dev-server.js`:

   ```bash
   node -e "
   const { detectStartCommand, isAlreadyRunning } = require('./lib/dev-server');
   const detected = detectStartCommand(process.cwd());
   const url = (detected && detected.url) || process.env.ENVOY_VISUAL_URL;
   if (!url) {
     console.error('No dev server URL detected (.envoy/visual.json override, or set ENVOY_VISUAL_URL).');
     process.exit(1);
   }
   console.log(url + ': ' + (isAlreadyRunning(url) ? 'OK' : 'DOWN'));
   "
   ```

   `envoy:visual-review`'s own Step 1 already performs auto-start/readiness
   detection (Task 12) — this health check is a lightweight confirmation,
   not a replacement for it.

Fix console errors, network failures, and visual bugs before proceeding. Commit fixes.

## If the layer cannot run (no Chrome MCP, no server reachable)

If Chrome DevTools MCP isn't connected, or no dev server could be detected
or reached even after `envoy:visual-review`'s auto-start attempt (Task 12),
the layer is SKIPPED rather than failed. When that happens:

1. Print a loud warning in the review report (not a quiet ⊘):

   ```
   ⚠ visual layer SKIPPED on frontend diff — <reason: no Chrome MCP | no dev server reachable>
   ```

2. Append the skip to `.envoy/observe-log.jsonl` so it's part of the durable
   trail preflight/observe-gate infrastructure already writes to:

   ```bash
   node -e "
   const fs = require('fs');
   const path = require('path');
   const dir = path.join(process.cwd(), '.envoy');
   fs.mkdirSync(dir, { recursive: true });
   const record = {
     ts: new Date().toISOString(),
     skill: 'review',
     gate: 'visual-layer-skip',
     reason: process.argv[1] || 'unspecified',
   };
   fs.appendFileSync(path.join(dir, 'observe-log.jsonl'), JSON.stringify(record) + '\n');
   " "<reason>"
   ```

3. Record `layers: [{ name: 'visual', status: 'skipped', findings: 0 }]`
   (not `'passed'`) in `.envoy/review/handoff-to-finalize.json` — a skip on
   a frontend diff must be visible downstream, not silently green.

This applies whether the layer was already required by tier or forced on by
frontend detection — a frontend diff that skips visual review is always
loud, never silent.
