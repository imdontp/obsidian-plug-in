import { App, PluginSettingTab, Setting } from "obsidian";
import type ClaudeCodexTerminalPlugin from "../main";

export class ClaudeCodexTerminalSettingTab extends PluginSettingTab {
	plugin: ClaudeCodexTerminalPlugin;

	constructor(app: App, plugin: ClaudeCodexTerminalPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Claude & Codex Terminal" });

		new Setting(containerEl)
			.setName("Project root")
			.setDesc(
				"Absolute path to the code project the terminal should run in (separate from the vault path)."
			)
			.addText((text) =>
				text
					.setPlaceholder("C:\\path\\to\\project")
					.setValue(this.plugin.settings.projectRoot)
					.onChange(async (value) => {
						this.plugin.settings.projectRoot = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Node.js path")
			.setDesc(
				"Path to a node executable used to host terminal sessions. Leave empty to auto-detect from PATH."
			)
			.addText((text) =>
				text
					.setPlaceholder("auto-detect")
					.setValue(this.plugin.settings.nodePath)
					.onChange(async (value) => {
						this.plugin.settings.nodePath = value;
						await this.plugin.saveSettings();
						this.plugin.refreshNodePath();
					})
			);

		new Setting(containerEl)
			.setName("Claude Code binary")
			.setDesc("Command or absolute path used to launch Claude Code. Leave empty to use claude from PATH.")
			.addText((text) =>
				text
					.setPlaceholder("claude")
					.setValue(this.plugin.settings.agents.claude.binary)
					.onChange(async (value) => {
						this.plugin.settings.agents.claude.binary = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Codex binary")
			.setDesc("Command or absolute path used to launch Codex. Leave empty to use codex from PATH.")
			.addText((text) =>
				text
					.setPlaceholder("codex")
					.setValue(this.plugin.settings.agents.codex.binary)
					.onChange(async (value) => {
						this.plugin.settings.agents.codex.binary = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
