# Claude & Codex Terminal (Obsidian plugin)

Native terminal inside Obsidian for running [Claude Code](https://docs.claude.com/en/docs/claude-code) and
[Codex CLI](https://github.com/openai/codex) directly against a code project, without leaving your vault.

Desktop-only (requires Node.js/Electron APIs not available on Obsidian mobile).

## Status

Phase 0 — project scaffold. No terminal functionality yet; the plugin currently only registers a
placeholder command/ribbon icon and a settings tab.

## Roadmap

| Phase | Scope |
|---|---|
| 0 | Scaffold: esbuild + TypeScript + manifest, dev build |
| 1 | Terminal MVP: `node-pty` + `xterm.js` pane, spawn default shell, resize/close lifecycle |
| 2 | Agent launch commands: configurable `projectRoot` (separate from vault path), launch `claude`/`codex` in a new tab, multi-tab sessions |
| 3 | Context actions: send active file/selection to the running agent, status bar session indicator |
| 4 | Polish: missing-binary error handling, theme sync, keybindings |
| 5 (future) | Diff review / lightweight code editor layer |

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
- **Claude Code binary** / **Codex binary** — command or absolute path used to spawn each agent.
