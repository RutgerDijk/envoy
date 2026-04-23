# Review — Layer 0: Lint (all tiers)

Announce: `Running Layer 0: Lint...`

Run project linters:

```bash
npm run lint
dotnet build
```

**If lint fails:**
- Fix auto-fixable issues: `npm run lint -- --fix`
- Fix remaining issues manually
- Commit:
  ```bash
  git add <fixed-files>
  git commit -m "fix: resolve lint issues"
  ```

**For trivial tier: stop here.** Report and suggest `/envoy:finalize`.
