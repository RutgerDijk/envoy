# Review — Layer 2: Visual review (Medium+ tiers)

Announce: `Running Layer 2: Visual Review...`

Invoke `envoy:visual-review` for Chrome DevTools verification.

1. **Identify affected pages** from changed files
2. **For each affected page:**
   - Navigate to page
   - Take screenshot
   - Check console for errors
   - Check network for failures
3. **Test user flows** from acceptance criteria
4. **App health check:**
   ```bash
   curl -sf http://localhost:5000/health && echo "Backend OK" || echo "Backend DOWN"
   curl -sf http://localhost:5173 && echo "Frontend OK" || echo "Frontend DOWN"
   ```

Fix console errors, network failures, and visual bugs before proceeding. Commit fixes.
