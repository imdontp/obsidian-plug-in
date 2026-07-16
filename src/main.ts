import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { ClaudeCodexTerminalSettingTab } from "./settings/SettingsTab";
import {
	ClaudeCodexTerminalSettings,
	DEFAULT_SETTINGS,
} from "./settings/SettingsSchema";
import { PtyManager } from "./terminal/PtyManager";
import {
	TerminalView,
	TerminalViewState,
	VIEW_TYPE_TERMINAL,
} from "./terminal/TerminalView";
import { resolveProjectRoot, resolvePluginDir } from "./utils/paths";
import { resolveNodePath } from "./utils/node";

export default class ClaudeCodexTerminalPlugin extends Plugin {
	settings!: ClaudeCodexTerminalSettings;
	ptyManager!: PtyManager;

	async onload() {
		await this.loadSettings();

		const pluginDir = resolvePluginDir(this.app, this.manifest);
		if (!pluginDir) {
			new Notice("Claude & Codex Terminal: could not resolve the plugin's own folder path; terminal will not work.");
		}
		this.ptyManager = new PtyManager(pluginDir, resolveNodePath(this.settings.nodePath));

		this.registerView(VIEW_TYPE_TERMINAL, (leaf: WorkspaceLeaf) => new TerminalView(leaf, this));

		this.addSettingTab(new ClaudeCodexTerminalSettingTab(this.app, this));

		this.addRibbonIcon("terminal-square", "Open terminal", () => {
			void this.launchTerminal({ title: "Terminal" });
		});

		this.addCommand({
			id: "open-terminal",
			name: "Open terminal",
			callback: () => {
				void this.launchTerminal({ title: "Terminal" });
			},
		});

		this.addCommand({
			id: "launch-claude-code",
			name: "Launch Claude Code",
			callback: () => {
				void this.launchTerminal({
					title: "Claude Code",
					command: this.settings.agents.claude.binary,
					args: this.settings.agents.claude.defaultArgs,
				});
			},
		});

		this.addCommand({
			id: "launch-codex",
			name: "Launch Codex",
			callback: () => {
				void this.launchTerminal({
					title: "Codex",
					command: this.settings.agents.codex.binary,
					args: this.settings.agents.codex.defaultArgs,
				});
			},
		});
	}

	onunload() {
		this.ptyManager?.killAll();
	}

	refreshNodePath(): void {
		this.ptyManager?.setNodePath(resolveNodePath(this.settings.nodePath));
	}

	async launchTerminal(options: Omit<TerminalViewState, "cwd">): Promise<void> {
		const cwd = resolveProjectRoot(this.app, this.settings.projectRoot);
		if (!cwd) {
			new Notice("Set a project root (or open a vault on disk) before opening a terminal.");
			return;
		}

		if (!resolveNodePath(this.settings.nodePath)) {
			new Notice("Node.js not found. Install Node.js or set its path in the plugin settings.");
			return;
		}

		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({
			type: VIEW_TYPE_TERMINAL,
			active: true,
			state: { ...options, cwd } satisfies TerminalViewState,
		});
		this.app.workspace.revealLeaf(leaf);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
