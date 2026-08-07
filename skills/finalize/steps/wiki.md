# Finalize — Step 10: Wiki sync

### Step 10: Wiki Sync

Announce: `Running Step 10: Wiki sync...`

```bash
PR_URL=$(jq -r '.prUrl // empty' .envoy/finalize/state.json 2>/dev/null || true)
echo "PR: $PR_URL"
```

Check if docs/wiki/ has changes on this branch:

```bash
git diff main...HEAD --name-only | grep "^docs/wiki/"
```

**If docs/wiki/ was changed:**

**YOU MUST invoke `/envoy:wiki-sync` here. Do NOT look for a shell script. Do NOT skip this step. Use the skill.**

```
/envoy:wiki-sync
```

If wiki-sync fails: do NOT proceed to Step 11. Diagnose and fix the wiki-sync error first.

**If docs/wiki/ was NOT changed:** skip to Step 11.
