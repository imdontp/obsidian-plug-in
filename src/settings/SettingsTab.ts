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
			.setName("Claude Code binary")
			.setDesc("Command or path used to launch Claude Code.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.agents.claude.binary)
					.onChange(async (value) => {
						this.plugin.settings.agents.claude.binary = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Codex binary")
			.setDesc("Command or path used to launch Codex.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.agents.codex.binary)
					.onChange(async (value) => {
						this.plugin.settings.agents.codex.binary = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
