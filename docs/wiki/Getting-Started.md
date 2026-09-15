# Getting Started

## Installation

### Claude Code

```bash
# Add the marketplace
/plugin marketplace add RutgerDijk/envoy

# Install the plugin
/plugin install envoy@envoy-marketplace
```

### GitHub Copilot

```bash
/path/to/envoy/adapters/copilot/install.sh
```

Re-running the script syncs updates: unmodified files are updated in place, locally edited files are preserved (tracked via `.github/.envoy-copilot-manifest.json`). See [adapters/copilot/INSTALL.md](../../adapters/copilot/INSTALL.md) for details.

## Prerequisites

### Required

| Tool | Purpose | Install |
|------|---------|---------|
| Claude Code CLI | Runtime | [docs.anthropic.com](https://docs.anthropic.com/en/docs/claude-code/overview) |
| GitHub CLI (`gh`) | Issue/PR management | `brew install gh` then `gh auth login` |
| Node.js 18+ | Hook scripts | `brew install node` |

### Recommended

| Tool | Purpose | Setup |
|------|---------|-------|
| CodeRabbit GitHub App | AI code review on PRs | [github.com/apps/coderabbitai](https://github.com/apps/coderabbitai) |
| Chrome DevTools MCP | Visual verification | Add to `~/.mcp.json` (see below) |

### Chrome DevTools MCP Setup

Add to `~/.mcp.json`:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["chrome-devtools-mcp@latest"]
    }
  }
}
```

Launch Chrome with debugging:

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222
```

```powershell
# Windows
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

On a headless box (server / remote dev VM) add `--headless=new`:

```bash
google-chrome --headless=new --remote-debugging-port=9222
```

If Chrome refuses to start in a container or CI sandbox you trust, add `--no-sandbox` — it disables Chrome's sandbox, so use it only in isolated, trusted environments.

### Verify Setup

```bash
echo "=== Required ===" && \
(command -v gh &>/dev/null && echo "✓ GitHub CLI" || echo "✗ GitHub CLI") && \
(command -v node &>/dev/null && echo "✓ Node.js" || echo "✗ Node.js") && \
echo "=== Optional ===" && \
(command -v coderabbit &>/dev/null && echo "✓ CodeRabbit CLI" || echo "⚠ CodeRabbit CLI") && \
(test -f ~/.mcp.json && grep -q "chrome-devtools" ~/.mcp.json && echo "✓ DevTools MCP" || echo "⚠ DevTools MCP")
```

## What Happens on First Session

When you start Claude Code with Envoy installed:

1. The session-start hook fires automatically
2. Envoy loads the `using-envoy` skill — Claude learns about all available commands
3. Stack detection scans your project for technologies (.csproj, package.json, tsconfig.json, etc.)
4. Detected stacks are reported so Claude knows which best practices apply

You're ready to use any `/envoy:*` command.
