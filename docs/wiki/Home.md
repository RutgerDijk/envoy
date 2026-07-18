# Envoy Wiki

Professional development workflows for Claude Code and GitHub Copilot.

## Quick Navigation

- [[Getting Started]] — Installation and setup
- [[Workflow]] — The full brainstorm-to-merge pipeline
- [[Skills Reference]] — All 26 skills with descriptions
- [[Hooks]] — Automation hooks and profiles
- [[Stack Profiles]] — Technology-specific best practices
- [[Token Optimization]] — How Envoy minimizes token usage
- [[Context Efficiency]] — LITM-aware prompts, session continuity, agent coordination, output compression
- [[Advanced Patterns]] — Eval harness, search-first, iterative retrieval

## What Is Envoy?

Envoy is a Claude Code plugin that provides structured workflows for professional software development. It turns Claude into an opinionated development partner that follows TDD, runs multi-layer code reviews, manages git worktrees, and handles the full lifecycle from idea to merged PR.

## The Flow

```
brainstorm → pickup → review → finalize → cleanup
```

| Step | Command | What Happens |
|------|---------|-------------|
| Brainstorm | `/envoy:brainstorm` | Socratic dialogue → design doc → GitHub issue |
| Pickup | `/envoy:pickup 42` | Creates worktree → loads spec → plans → executes with TDD |
| Review | `/envoy:review` | Lint → Cleanup → Sonnet AI → Visual → Docs (local, no PR needed) |
| Finalize | `/envoy:finalize` | Docstrings → create PR → handle CodeRabbit → verify → wiki sync |
| Cleanup | `/envoy:cleanup` | Remove worktree and feature branch |
