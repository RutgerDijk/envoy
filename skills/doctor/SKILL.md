---
name: doctor
description: Repo-hygiene expert. ALWAYS invoke when the /envoy:doctor command fires or when checking whether Envoy runtime state (.envoy-tasks/*.json, .envoy/**) leaked into git tracking. Reports tracked files with issue state and missing .gitignore entries; with --fix, stages the untrack + updates .gitignore. Do not hand-remove tracked Envoy state files or edit .gitignore without running this skill first.
when_to_use:
  - When the user types /envoy:doctor
  - When onboarding a consumer repo that predates #71/#72 and may still track .envoy-tasks/*.json or .envoy/** in git
  - When git status shows unexpected .envoy or .envoy-tasks changes and you want to know if it's a tracking leak
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
---

## Briefing

!`node ${CLAUDE_SKILL_DIR}/preflight.js`

### Checklist

- [ ] Report tracked `.envoy-tasks/*.json` / `.envoy/**` files, each with its linked issue's open/closed state
- [ ] Report missing `.gitignore` entries (`.envoy-tasks/`, `.envoy/`)
- [ ] If `--fix`: stage `git rm --cached -r` for tracked files and append missing `.gitignore` entries — do NOT commit

# Repo Hygiene Doctor

## Overview

Envoy repos gitignore `.envoy-tasks/*.json` and `.envoy/**` — but repos that
adopted Envoy before #71/#72 landed may still have these files **tracked**
in git from before the ignore rules existed. `doctor` finds and reports that
drift, and can stage the fix.

**Announce at start:** "I'm using envoy:doctor to check for tracked Envoy runtime-state files."

## Read-only by default

Running `/envoy:doctor` with no flags is purely a report — it makes zero
mutations, not even `git add`. It is safe to run on any worktree, clean or
dirty.

The report, built from `lib/repo-hygiene.js`:

1. **Tracked files** — `findTrackedEnvoyFiles(cwd)` runs `git ls-files` and
   filters to `.envoy-tasks/*.json` and `.envoy/**`. For each
   `.envoy-tasks/<n>.json` match, look up issue `#<n>`'s state via
   `gh issue view <n> --json state` (`parseIssueNumberFromTaskFile` extracts
   `<n>` from the filename).
2. **`.gitignore` gaps** — `checkGitignoreEntries(cwd)` reports which of
   `.envoy-tasks/` / `.envoy/` are missing.

Preflight already prints this report inline — read its output rather than
re-running the checks by hand.

## `--fix` mode

Pass `--fix` to stage remediation. Because the inline preflight briefing
takes no CLI arguments, set `ENVOY_DOCTOR_FIX=1` in the environment before
invoking the skill (the same convention `pickup` uses for
`ENVOY_ISSUE_NUMBER`) — e.g.:

```bash
ENVOY_DOCTOR_FIX=1 node skills/doctor/preflight.js
```

Preflight refuses (fatal) to proceed with `--fix` if the worktree has
uncommitted changes — plan mutations should never land on top of an
unrelated dirty diff. Report-only runs are unaffected by worktree state.

On a clean worktree with `--fix`, once preflight reports `ok`:

1. Build the plan: `planFix(trackedFiles, gitignoreGaps)` — pure, returns
   `{ rmCached, gitignoreAppend }` without touching git or the filesystem.
2. Execute it via `executeFix(cwd, plan)`:
   - `git rm --cached -r -- <files>` for every tracked Envoy file (removes
     git's tracking, leaves the working-tree file in place)
   - append any missing `.envoy-tasks/` / `.envoy/` lines to `.gitignore`
3. **Stop there — do NOT run `git commit`.** Leave the staged removal and
   `.gitignore` edit for the user to review and commit themselves.

## Error Handling

### Not a git repo

```
Not inside a git repo — doctor needs a git working tree to check tracked files and .gitignore.
```

Run doctor from inside the repo you want to check.

### `--fix` on a dirty worktree

```
Worktree has uncommitted changes — --fix refuses to run on a dirty worktree.
Commit or stash your changes, then re-run /envoy:doctor --fix.
```

Commit or stash first, then re-run with `ENVOY_DOCTOR_FIX=1`.

## Integration with Envoy

`doctor` is a standalone diagnostic — it produces no durable handoff and
does not participate in the pickup → review → finalize chain. It's meant to
be run ad hoc, most usefully right after onboarding an older consumer repo
onto a newer Envoy plugin version.
