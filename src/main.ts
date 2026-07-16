import { Notice, Plugin } from "obsidian";
import { ClaudeCodexTerminalSettingTab } from "./settings/SettingsTab";
import {
	ClaudeCodexTerminalSettings,
	DEFAULT_SETTINGS,
} from "./settings/SettingsSchema";

export default class ClaudeCodexTerminalPlugin extends Plugin {
	settings!: ClaudeCodexTerminalSettings;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new ClaudeCodexTerminalSettingTab(this.app, this));

		this.addRibbonIcon("terminal", "Open Claude/Codex terminal", () => {
			new Notice("Terminal pane not implemented yet (Phase 1)");
		});

		this.addCommand({
			id: "open-terminal",
			name: "Open terminal",
			callback: () => {
				new Notice("Terminal pane not implemented yet (Phase 1)");
			},
		});
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
