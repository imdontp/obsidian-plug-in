import { ItemView, Notice, ViewStateResult, WorkspaceLeaf } from "obsidian";
import type ClaudeCodexTerminalPlugin from "../main";
import type { ExternalTextFile } from "./ExternalFileService";

export const VIEW_TYPE_EXTERNAL_FILE_EDITOR = "claude-codex-external-file-editor-view";

export interface ExternalFileEditorViewState {
	projectRoot: string;
	relativePath: string;
}

const DEFAULT_STATE: ExternalFileEditorViewState = {
	projectRoot: "",
	relativePath: "",
};

/** A deliberately small text editor for a project file selected by the user. */
export class ExternalFileEditorView extends ItemView {
	private readonly plugin: ClaudeCodexTerminalPlugin;
	private state: ExternalFileEditorViewState = DEFAULT_STATE;
	private snapshot: ExternalTextFile | null = null;
	private draft = "";
	private error: string | null = null;
	private loading = false;
	private saving = false;
	private loadQueued = false;
	private dirty = false;
	private opened = false;
	private editorEl: HTMLTextAreaElement | null = null;
	private dirtyStatusEl: HTMLElement | null = null;
	private saveButton: HTMLButtonElement | null = null;
	private discardButton: HTMLButtonElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ClaudeCodexTerminalPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_EXTERNAL_FILE_EDITOR;
	}

	getDisplayText(): string {
		return "External File Editor";
	}

	getIcon(): string {
		return "file-pen-line";
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (state && typeof state === "object") {
			const next = state as Partial<ExternalFileEditorViewState>;
			this.state = {
				projectRoot: typeof next.projectRoot === "string" ? next.projectRoot : this.state.projectRoot,
				relativePath: typeof next.relativePath === "string" ? next.relativePath : this.state.relativePath,
			};
			this.snapshot = null;
			this.draft = "";
			this.error = null;
			this.dirty = false;
		}

		await super.setState(state, result);
		if (this.opened) {
			void this.loadFile();
		}
	}

	getState(): Record<string, unknown> {
		return { ...this.state };
	}

	async onOpen(): Promise<void> {
		this.opened = true;
		this.contentEl.addClass("claude-codex-external-file-editor");
		this.render();
		if (this.hasFileSelection()) {
			void this.loadFile();
		}
	}

	async onClose(): Promise<void> {
		if (this.dirty && !this.saving) {
			new Notice("Unsaved external file edits were discarded when the editor tab closed.");
		}
		this.opened = false;
	}

	private hasFileSelection(): boolean {
		return Boolean(this.state.projectRoot && this.state.relativePath);
	}

	private async loadFile(): Promise<void> {
		if (this.loading || this.saving) {
			this.loadQueued = true;
			return;
		}
		if (this.dirty) {
			this.error = "Save or discard the current edits before reloading the file.";
			this.render();
			return;
		}
		if (!this.hasFileSelection()) {
			this.snapshot = null;
			this.error = "Choose a project file from Project File Browser or Project Diff Review first.";
			this.render();
			return;
		}

		const requestKey = this.getStateKey();
		this.loading = true;
		this.error = null;
		this.render();

		try {
			const snapshot = await this.plugin.externalFileService.readTextFile(
				this.state.projectRoot,
				this.state.relativePath
			);
			if (requestKey === this.getStateKey()) {
				this.snapshot = snapshot;
				this.draft = toEditorText(snapshot.text);
				this.dirty = false;
			}
		} catch (error) {
			if (requestKey === this.getStateKey()) {
				this.snapshot = null;
				this.error = error instanceof Error ? error.message : "Could not open the external file.";
			}
		} finally {
			this.loading = false;
			if (this.loadQueued) {
				this.loadQueued = false;
				void this.loadFile();
				return;
			}
			if (this.opened) {
				this.render();
			}
		}
	}

	private async save(): Promise<void> {
		if (!this.snapshot || !this.dirty || this.loading || this.saving) {
			return;
		}

		const requestKey = this.getStateKey();
		this.saving = true;
		this.error = null;
		this.render();

		try {
			const saved = await this.plugin.externalFileService.saveTextFile(this.snapshot, this.draft);
			if (requestKey === this.getStateKey()) {
				this.snapshot = saved;
				this.draft = toEditorText(saved.text);
				this.dirty = false;
				new Notice(`Saved ${this.state.relativePath}. Refresh Project Diff Review to update its diff.`);
			}
		} catch (error) {
			if (requestKey === this.getStateKey()) {
				this.error = error instanceof Error ? error.message : "Could not save the external file.";
			}
		} finally {
			this.saving = false;
			if (this.loadQueued) {
				this.loadQueued = false;
				void this.loadFile();
				return;
			}
			if (this.opened) {
				this.render();
			}
		}
	}

	private reload(): void {
		if (this.dirty) {
			this.error = "Save or discard the current edits before reloading the file.";
			this.render();
			return;
		}
		void this.loadFile();
	}

	private discard(): void {
		if (!this.snapshot || !this.dirty) {
			return;
		}

		this.draft = toEditorText(this.snapshot.text);
		this.dirty = false;
		this.error = null;
		this.render();
	}

	private render(): void {
		this.contentEl.empty();
		this.editorEl = null;
		this.dirtyStatusEl = null;
		this.saveButton = null;
		this.discardButton = null;

		const toolbar = this.contentEl.createDiv({ cls: "claude-codex-external-file-editor-toolbar" });
		const heading = toolbar.createDiv({ cls: "claude-codex-external-file-editor-heading" });
		heading.createEl("h2", { text: "External File Editor" });
		heading.createEl("code", { text: this.state.relativePath || "No file selected" });

		const actions = toolbar.createDiv({ cls: "claude-codex-external-file-editor-actions" });
		const reloadButton = actions.createEl("button", { text: "Reload" });
		reloadButton.disabled = this.loading || this.saving;
		reloadButton.addEventListener("click", () => this.reload());

		this.discardButton = actions.createEl("button", { text: "Discard changes" });
		this.discardButton.addEventListener("click", () => this.discard());

		this.saveButton = actions.createEl("button", { cls: "mod-cta", text: this.saving ? "Saving..." : "Save" });
		this.saveButton.addEventListener("click", () => void this.save());

		if (this.loading) {
			this.contentEl.createDiv({
				cls: "claude-codex-external-file-editor-message",
				text: "Reading local file...",
			});
			return;
		}

		if (this.error) {
			this.contentEl.createDiv({ cls: "claude-codex-external-file-editor-error", text: this.error });
		}

		if (!this.snapshot) {
			if (!this.error) {
				this.contentEl.createDiv({
					cls: "claude-codex-external-file-editor-message",
					text: "Choose a project file from Project File Browser or Project Diff Review first.",
				});
			}
			return;
		}

		const status = this.contentEl.createDiv({ cls: "claude-codex-external-file-editor-status" });
		this.dirtyStatusEl = status.createSpan();
		status.createSpan({ text: "Changes stay in this tab until you press Save." });

		this.editorEl = this.contentEl.createEl("textarea", { cls: "claude-codex-external-file-editor-textarea" });
		this.editorEl.value = this.draft;
		this.editorEl.spellcheck = false;
		this.editorEl.wrap = "off";
		this.editorEl.setAttribute("aria-label", `Edit ${this.state.relativePath}`);
		this.editorEl.addEventListener("input", () => {
			this.draft = this.editorEl?.value ?? "";
			this.updateEditorControls();
		});
		this.editorEl.addEventListener("keydown", (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
				event.preventDefault();
				void this.save();
			}
		});

		this.updateEditorControls();
	}

	private updateEditorControls(): void {
		this.dirty = Boolean(this.snapshot && this.draft !== toEditorText(this.snapshot.text));
		if (this.dirtyStatusEl) {
			this.dirtyStatusEl.setText(this.saving ? "Saving..." : this.dirty ? "Unsaved changes" : "Saved");
			this.dirtyStatusEl.toggleClass("claude-codex-external-file-editor-unsaved", this.dirty);
		}
		if (this.saveButton) {
			this.saveButton.disabled = !this.dirty || this.loading || this.saving;
		}
		if (this.discardButton) {
			this.discardButton.disabled = !this.dirty || this.loading || this.saving;
		}
		if (this.editorEl) {
			this.editorEl.disabled = this.saving;
		}
	}

	private getStateKey(): string {
		return JSON.stringify([this.state.projectRoot, this.state.relativePath]);
	}
}

function toEditorText(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
