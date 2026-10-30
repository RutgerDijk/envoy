# Spike: VS Code terminal tab title (#93, task 1)

**Question:** can Envoy set the VS Code terminal tab title from a hook or
preflight, so `lib/tab-title.js` can support VS Code beside cmux?

## Verdict

**Works — conditionally.** The OSC 2 sequence reaches the VS Code tab, but
only when both of these hold:

1. VS Code user setting `"terminal.integrated.tabs.title": "${sequence}"`
   (the default `${process}` ignores OSC titles entirely).
2. `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` in the environment Claude Code is
   launched with. Without it Claude Code keeps rewriting the title itself
   and an Envoy-written title is overwritten immediately.

`lib/tab-title.js` therefore takes the VS Code path only when
`TERM_PROGRAM=vscode` **and** `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1`;
otherwise VS Code is a silent no-op. Envoy never edits the user's VS Code
settings — the user opts in.

## How the sequence reaches the terminal

Hooks and Bash tool subprocesses run **without a controlling terminal**:

```
$ exec 3>/dev/tty
device not configured: /dev/tty
```

So writing to `/dev/tty` (or stdout, which Claude Code captures) never
reaches the tab. What does work is writing to the tty device of the parent
`claude` process, found by walking the process tree:

```
$ ps -o pid=,ppid=,tty=,comm= ...
 2107 74554 ??       /bin/zsh          # tool subprocess — no tty
74554 73581 ttys028  claude            # Claude Code — owns the terminal
73581 58900 ttys028  /bin/zsh          # VS Code integrated terminal shell
$ printf '\033]2;#93 spike test\007' > /dev/ttys028   # succeeds
```

The device is owned by the user, so no extra permissions are needed. The
walk stops at the first ancestor with a real tty (`ps -o tty=` other than
`??`).

## Observations (2026-10-30, VS Code 1.139.1, Claude Code 2.1.314, macOS)

| Setup | Result |
|-------|--------|
| No `tabs.title` setting (default `${process}`) | Tab shows the process name; OSC titles ignored |
| `${sequence}`, OSC 2 written to `/dev/ttys028`, `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` unset | Tab shows Claude Code's own title — proves OSC titles are honoured, and that Claude Code's title wins |
| `${sequence}` + `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` | Not observed in this session (the variable must be set before Claude Code starts); follows from the row above, since nothing else writes the title |

## Required user setup (documented, not automated)

```jsonc
// VS Code settings.json
"terminal.integrated.tabs.title": "${sequence}"
```

```bash
# shell profile, before launching claude
export CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1
```
