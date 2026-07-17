# Claude & Codex Terminal (Obsidian plugin)

Native terminal inside Obsidian for running [Claude Code](https://docs.claude.com/en/docs/claude-code) and
[Codex CLI](https://github.com/openai/codex) directly against a code project, without leaving your vault.

Desktop-only (requires Node.js/Electron APIs not available on Obsidian mobile).

## Status

Phase 3 manual validation is in progress. The native terminal and agent launch commands are implemented;
Phase 4 handling for missing commands, theme synchronization, and keyboard workflow is also implemented.

## Roadmap

| Phase | Scope |
|---|---|
| 0 | Scaffold: esbuild + TypeScript + manifest, dev build |
| 1 | Terminal MVP: `node-pty` + `xterm.js` pane, spawn default shell, resize/close lifecycle |
| 2 | Agent launch commands: configurable `projectRoot` (separate from vault path), launch `claude`/`codex` in a new tab, multi-tab sessions |
| 3 | Context actions: send active file/selection to the running agent, status bar session indicator |
| 4 | Polish: missing-binary error handling, theme sync, keybindings |
| 5A | Read-only project Git diff review |
| 5B (future) | External-file preview / lightweight code editor layer |

## Development

```bash
npm install
npm run dev    # esbuild watch mode -> main.js
```

Then symlink or copy this folder into `<vault>/.obsidian/plugins/claude-codex-terminal/` and enable it
from Obsidian's community plugin settings (with Community Plugins > Enable, and this plugin listed
under "Installed plugins").

## Settings

- **Project root** — absolute path to the code project the terminal/agents should run in. Intentionally
  separate from the vault path, so a vault can be used purely for notes while the terminal operates on a
  different repo.
- **Claude Code binary** / **Codex binary** — command or absolute path used to spawn each agent. Leave
  either blank to use `claude` or `codex` from `PATH`. On Windows, agent commands are launched through
  PowerShell so `.cmd` and `.ps1` shims work as they do in an interactive terminal.

## Context actions

Focus a terminal session to make it the **context target** (also shown in the status bar), then use
the Command palette to:

- **Paste active file path into context target** — inserts the active note's absolute path.
- **Paste selection into context target** — inserts up to 20,000 selected characters from a Markdown note.

The plugin reveals the target terminal and pastes the context, but never presses Enter. Review the
prompt and submit it yourself. Multi-line selections require a target that supports bracketed paste,
such as an active Claude or Codex TUI session.

## Theme and keyboard workflow

Open terminal panes update their colors when Obsidian's theme or CSS changes. The plugin does not reserve
default hotkeys, so it cannot conflict with your existing shortcuts. In **Settings > Hotkeys**, search for
**Claude & Codex Terminal** and assign your preferred keys to commands such as:

- **Focus context target terminal**
- **Launch Claude Code**
- **Paste active file path into context target**

## Project diff review (Phase 5A)

Use **Open project diff review** from the Command palette to inspect local Git changes for the configured
project root. It reads `git diff HEAD` and shows tracked staged/unstaged changes in a separate tab.

- The review is read-only: it does not save, stage, apply, reset, or otherwise modify project files.
- Untracked files are counted but are not displayed in this first version.
- Git must be available in the environment that launches Obsidian.
- Diff text stays local; the plugin does not send it over the network.
