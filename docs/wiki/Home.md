# Envoy Wiki

Professional development workflows for Claude Code and GitHub Copilot.

## Quick Navigation

- [[Getting Started]] — Installation and setup
- [[Workflow]] — The full brainstorm-to-merge pipeline
- [[Skills Reference]] — All 25 skills with descriptions
- [[Hooks]] — Automation hooks and profiles
- [[Stack Profiles]] — Technology-specific best practices
- [[Token Optimization]] — How Envoy minimizes token usage
- [[Context Efficiency]] — LITM-aware prompts, session continuity, agent coordination, output compression
- [[Advanced Patterns]] — Eval harness, search-first, cleanup pass, iterative retrieval

## What Is Envoy?

Envoy is a Claude Code plugin that provides structured workflows for professional software development. It turns Claude into an opinionated development partner that follows TDD, runs multi-layer code reviews, manages git worktrees, and handles the full lifecycle from idea to merged PR.

## The Flow

```
brainstorm → pickup → implement → cleanup-pass → review → finalize → cleanup
```

| Step | Command | What Happens |
|------|---------|-------------|
| Brainstorm | `/envoy:brainstorm` | Socratic dialogue → design doc → plan → GitHub issue |
| Pickup | `/envoy:pickup 42` | Creates worktree → loads spec → executes plan with TDD |
| Implement | (auto) | Search-first → TDD cycles → fresh Sonnet reviewer per task |
| Cleanup Pass | `/envoy:cleanup-pass` | Fresh agent removes AI slop from the diff |
| Review | `/envoy:review` | Lint → Sonnet AI → Visual → Doc gaps (local, no PR needed) |
| Finalize | `/envoy:finalize` | Docstrings → create PR → handle CodeRabbit → verify → wiki sync |
| Cleanup | `/envoy:cleanup` | Remove worktree and feature branch |
