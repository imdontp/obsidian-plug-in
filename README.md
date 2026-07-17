# Claude & Codex Terminal (Obsidian plugin)

Native terminal inside Obsidian for running [Claude Code](https://docs.claude.com/en/docs/claude-code) and
[Codex CLI](https://github.com/openai/codex) directly against a code project, without leaving your vault.

Desktop-only (requires Node.js/Electron APIs not available on Obsidian mobile).

## Status

Phases 0–8 are implemented. Runtime validation in Obsidian is still recommended for each local setup.

## Roadmap

| Phase | Scope |
|---|---|
| 0 | Scaffold: esbuild + TypeScript + manifest, dev build |
| 1 | Terminal MVP: `node-pty` + `xterm.js` pane, spawn default shell, resize/close lifecycle |
| 2 | Agent launch commands: configurable `projectRoot` (separate from vault path), launch `claude`/`codex` in a new tab, multi-tab sessions |
| 3 | Context actions: send active file/selection to the running agent, status bar session indicator |
| 4 | Polish: missing-binary error handling, theme sync, keybindings |
| 5A | Read-only project Git diff review |
| 5B | Diff-driven external-file preview and lightweight editor |
| 6 | Project file browser for safe text-file access, including untracked files |
| 7 | Auto-refreshing Git status with patch/status distinction |
| 8 | Guarded local Git stage, unstage, and commit actions |

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

- Refreshing the review is read-only. Phase 8 adds explicit local Git actions described below.
- Untracked files are shown as status entries, but do not have a Git patch until they are tracked.
- Git must be available in the environment that launches Obsidian.
- Diff text stays local; the plugin does not send it over the network.

While the tab is open, the review refreshes every three seconds. It separates files with a content patch from
other Git status entries, including untracked files and entries for which Git returns no patch. This makes a
Git status entry visible without claiming that it has a textual diff. Status entries can be opened in the
guarded external editor when they still refer to a regular file.

## Guarded Git actions (Phase 8)

For a file listed in Git status, use **Stage** or **Unstage** to change only that file's index state. The
**Commit...** button is enabled only when changes are staged, and requires a commit message plus a second
explicit confirmation in a dialog.

- Actions run only against the configured project root and use literal, validated file paths.
- The plugin does not offer reset, discard, force, remote push, or any automatic Git mutation.
- A commit is local only. Git hooks may run, just as they do when you commit from a terminal.

## External file editor (Phase 5B)

Select a non-deleted file in **Project Diff Review**, or a file in **Project File Browser**, to open it in
the **External File Editor**.

- The editor reads only UTF-8 text files up to 1 MB, inside the configured project root.
- It refuses paths outside that root, symbolic links, folders, and binary files.
- Edits remain local to the tab until you explicitly use **Save** (or `Ctrl/Cmd+S`).
- Before saving, it compares the file on disk with the version that was opened. If another app changed it,
  the save is stopped so external work is not overwritten.
- The plugin does not send file contents over the network.

## Project file browser (Phase 6)

Use **Open project file browser** from the Command palette to browse regular files under the configured
project root. If Project root is blank, it uses the local vault currently open in Obsidian.

- The browser includes files that Git does not show, such as untracked files and non-Git project files.
- It lists paths and sizes without reading file contents. File contents are read only after you choose a file.
- `.git`, `.obsidian`, `node_modules`, and symbolic links are excluded; the list is capped at 5,000 files.
- Filter by path, then open a file in the same guarded editor described above. Only UTF-8 text files up to
  1 MB can be opened and saved.
