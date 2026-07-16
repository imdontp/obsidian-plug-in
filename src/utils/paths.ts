import { App, FileSystemAdapter, PluginManifest } from "obsidian";
import { join } from "path";

export function resolveProjectRoot(app: App, projectRootSetting: string): string {
	if (projectRootSetting && projectRootSetting.trim().length > 0) {
		return projectRootSetting.trim();
	}
	const adapter = app.vault.adapter;
	if (adapter instanceof FileSystemAdapter) {
		return adapter.getBasePath();
	}
	return "";
}

/**
 * Obsidian evaluates plugin bundles with `__dirname` bound to its own
 * Electron asar path, not the plugin's folder — so the plugin's own
 * absolute path has to be derived from the vault base path + manifest.dir
 * instead of `__dirname`.
 */
export function resolvePluginDir(app: App, manifest: PluginManifest): string {
	const adapter = app.vault.adapter;
	if (adapter instanceof FileSystemAdapter && manifest.dir) {
		return join(adapter.getBasePath(), manifest.dir);
	}
	return "";
}
