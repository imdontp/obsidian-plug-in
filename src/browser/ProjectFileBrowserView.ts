import { ItemView, ViewStateResult, WorkspaceLeaf } from "obsidian";
import type ClaudeCodexTerminalPlugin from "../main";
import type { ProjectFileListing } from "./ProjectFileService";
import type { ExternalTextFile } from "../editor/ExternalFileService";

export const VIEW_TYPE_PROJECT_FILE_BROWSER = "claude-codex-project-file-browser-view";

export interface ProjectFileBrowserViewState {
	projectRoot: string;
}

const DEFAULT_STATE: ProjectFileBrowserViewState = {
	projectRoot: "",
};

const MAX_RENDERED_FILE_COUNT = 500;

/** Browses project files with a read-only preview before an explicit editor action. */
export class ProjectFileBrowserView extends ItemView {
	private readonly plugin: ClaudeCodexTerminalPlugin;
	private state: ProjectFileBrowserViewState = DEFAULT_STATE;
	private listing: ProjectFileListing | null = null;
	private error: string | null = null;
	private loading = false;
	private refreshQueued = false;
	private opened = false;
	private filter = "";
	private selectedPath: string | null = null;
	private preview: ExternalTextFile | null = null;
	private previewError: string | null = null;
	private previewLoading = false;
	private previewRequestId = 0;
	private resultsEl: HTMLElement | null = null;
	private countEl: HTMLElement | null = null;
	private fileListEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ClaudeCodexTerminalPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_PROJECT_FILE_BROWSER;
	}

	getDisplayText(): string {
		return "Project File Browser";
	}

	getIcon(): string {
		return "files";
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (state && typeof state === "object") {
			const next = state as Partial<ProjectFileBrowserViewState>;
			this.state = {
				projectRoot: typeof next.projectRoot === "string" ? next.projectRoot : this.state.projectRoot,
			};
			this.listing = null;
			this.error = null;
			this.filter = "";
			this.clearPreview();
		}

		await super.setState(state, result);
		if (this.opened) {
			void this.refresh();
		}
	}

	getState(): Record<string, unknown> {
		return { ...this.state };
	}

	async onOpen(): Promise<void> {
		this.opened = true;
		this.contentEl.addClass("claude-codex-project-file-browser");
		this.render();
		if (this.state.projectRoot) {
			void this.refresh();
		}
	}

	async onClose(): Promise<void> {
		this.opened = false;
	}

	private clearPreview(): void {
		this.previewRequestId += 1;
		this.selectedPath = null;
		this.preview = null;
		this.previewError = null;
		this.previewLoading = false;
	}

	private async refresh(): Promise<void> {
		if (this.loading) {
			this.refreshQueued = true;
			return;
		}

		const projectRoot = this.state.projectRoot;
		this.loading = true;
		this.error = null;
		this.render();

		try {
			const listing = await this.plugin.projectFileService.listProjectFiles(projectRoot);
			if (projectRoot === this.state.projectRoot) {
				this.listing = listing;
			}
		} catch (error) {
			if (projectRoot === this.state.projectRoot) {
				this.listing = null;
				this.error = error instanceof Error ? error.message : "Could not list project files.";
			}
		} finally {
			this.loading = false;
			if (this.refreshQueued) {
				this.refreshQueued = false;
				void this.refresh();
				return;
			}
			if (this.opened) {
				this.render();
			}
		}
	}

	private render(): void {
		this.contentEl.empty();
		this.resultsEl = null;
		this.countEl = null;
		this.fileListEl = null;

		const toolbar = this.contentEl.createDiv({ cls: "claude-codex-project-file-browser-toolbar" });
		const heading = toolbar.createDiv({ cls: "claude-codex-project-file-browser-heading" });
		heading.createEl("h2", { text: "Project File Browser" });
		heading.createEl("code", { text: this.state.projectRoot || "No project root" });

		const refreshButton = toolbar.createEl("button", { text: this.loading ? "Refreshing..." : "Refresh" });
		refreshButton.disabled = this.loading;
		refreshButton.addEventListener("click", () => void this.refresh());

		if (this.loading) {
			this.contentEl.createDiv({
				cls: "claude-codex-project-file-browser-message",
				text: "Listing local project files...",
			});
			return;
		}

		if (this.error) {
			this.contentEl.createDiv({ cls: "claude-codex-project-file-browser-error", text: this.error });
			return;
		}

		if (!this.listing) {
			this.contentEl.createDiv({
				cls: "claude-codex-project-file-browser-message",
				text: "Set a project root (or open a vault on disk) before browsing files.",
			});
			return;
		}

		const content = this.contentEl.createDiv({ cls: "claude-codex-project-file-browser-content" });
		const filePane = content.createDiv({ cls: "claude-codex-project-file-browser-file-pane" });

		const search = filePane.createEl("input", {
			cls: "claude-codex-project-file-browser-search",
			attr: {
				type: "search",
				placeholder: "Filter files by path...",
				"aria-label": "Filter project files by path",
			},
		});
		search.value = this.filter;
		search.addEventListener("input", () => {
			this.filter = search.value;
			this.renderResults();
		});

		this.resultsEl = filePane.createDiv({ cls: "claude-codex-project-file-browser-summary" });
		if (this.listing.truncated) {
			this.resultsEl.createSpan({
				cls: "claude-codex-project-file-browser-warning",
				text: "The list stopped at 5,000 files. Use the filter to narrow it.",
			});
		}
		this.countEl = this.resultsEl.createSpan({ cls: "claude-codex-project-file-browser-count" });
		this.fileListEl = filePane.createDiv({ cls: "claude-codex-project-file-browser-file-list" });

		const previewPane = content.createDiv({ cls: "claude-codex-project-file-browser-preview-pane" });
		this.renderPreview(previewPane);
		this.renderResults();
	}

	private renderPreview(previewPane: HTMLElement): void {
		const header = previewPane.createDiv({ cls: "claude-codex-project-file-browser-preview-header" });
		const heading = header.createDiv({ cls: "claude-codex-project-file-browser-preview-heading" });
		heading.createEl("h3", { text: "Preview" });
		heading.createEl("code", { text: this.selectedPath ?? "No file selected" });

		const actions = header.createDiv({ cls: "claude-codex-project-file-browser-preview-actions" });
		const reloadButton = actions.createEl("button", { text: "Reload preview" });
		reloadButton.disabled = !this.selectedPath || this.previewLoading;
		reloadButton.addEventListener("click", () => this.reloadPreview());

		const openEditorButton = actions.createEl("button", { cls: "mod-cta", text: "Open editor" });
		openEditorButton.disabled = !this.preview || this.previewLoading;
		openEditorButton.addEventListener("click", () => this.openPreviewInEditor());

		if (this.previewLoading) {
			previewPane.createDiv({
				cls: "claude-codex-project-file-browser-message",
				text: "Reading local file for preview...",
			});
			return;
		}

		if (this.previewError) {
			previewPane.createDiv({
				cls: "claude-codex-project-file-browser-error",
				text: this.previewError,
			});
			return;
		}

		if (!this.preview) {
			previewPane.createDiv({
				cls: "claude-codex-project-file-browser-message",
				text: "Select a file to preview it here. Preview is read-only; use Open editor only when you want to edit.",
			});
			return;
		}

		const status = previewPane.createDiv({ cls: "claude-codex-project-file-browser-preview-status" });
		status.createSpan({ text: "Read-only preview" });
		status.createSpan({ text: "UTF-8 text files up to 1 MB" });

		const previewText = previewPane.createEl("pre", { cls: "claude-codex-project-file-browser-preview-text" });
		previewText.setAttribute("tabindex", "0");
		previewText.setAttribute("aria-label", `Read-only preview of ${this.preview.relativePath}`);
		previewText.setText(this.preview.text);
	}

	private renderResults(): void {
		if (!this.listing || !this.countEl || !this.fileListEl) {
			return;
		}

		const normalizedFilter = this.filter.trim().toLocaleLowerCase();
		const matchingFiles = this.listing.files.filter((file) => file.path.toLocaleLowerCase().includes(normalizedFilter));
		const shownFiles = matchingFiles.slice(0, MAX_RENDERED_FILE_COUNT);

		const resultText = `${matchingFiles.length.toLocaleString()} of ${this.listing.files.length.toLocaleString()} files`;
		this.countEl.setText(resultText);

		this.fileListEl.empty();
		if (matchingFiles.length === 0) {
			this.fileListEl.createDiv({
				cls: "claude-codex-project-file-browser-message",
				text: "No files match this filter.",
			});
			return;
		}

		for (const file of shownFiles) {
			const button = this.fileListEl.createEl("button", {
				cls: "claude-codex-project-file-browser-file-button",
				text: file.path,
			});
			if (file.path === this.selectedPath) {
				button.addClass("is-selected");
				button.setAttribute("aria-current", "true");
			}
			button.setAttribute(
				"title",
				`Preview (${formatFileSize(file.size)}; UTF-8 text files up to 1 MB)`
			);
			button.addEventListener("click", () => {
				void this.previewFile(file.path);
			});
		}

		if (matchingFiles.length > shownFiles.length) {
			this.fileListEl.createDiv({
				cls: "claude-codex-project-file-browser-message",
				text: `Showing the first ${MAX_RENDERED_FILE_COUNT.toLocaleString()} matches. Refine the filter to find the rest.`,
			});
		}
	}

	private async previewFile(relativePath: string): Promise<void> {
		const projectRoot = this.state.projectRoot;
		if (!projectRoot) {
			return;
		}

		const requestId = ++this.previewRequestId;
		this.selectedPath = relativePath;
		this.preview = null;
		this.previewError = null;
		this.previewLoading = true;
		this.render();

		try {
			const preview = await this.plugin.externalFileService.readTextFile(projectRoot, relativePath);
			if (this.isCurrentPreviewRequest(requestId, projectRoot, relativePath)) {
				this.preview = preview;
			}
		} catch (error) {
			if (this.isCurrentPreviewRequest(requestId, projectRoot, relativePath)) {
				this.previewError = error instanceof Error ? error.message : "Could not preview the local file.";
			}
		} finally {
			if (!this.isCurrentPreviewRequest(requestId, projectRoot, relativePath)) {
				return;
			}
			this.previewLoading = false;
			if (this.opened) {
				this.render();
			}
		}
	}

	private isCurrentPreviewRequest(requestId: number, projectRoot: string, relativePath: string): boolean {
		return requestId === this.previewRequestId
			&& projectRoot === this.state.projectRoot
			&& relativePath === this.selectedPath;
	}

	private reloadPreview(): void {
		if (this.selectedPath) {
			void this.previewFile(this.selectedPath);
		}
	}

	private openPreviewInEditor(): void {
		if (!this.preview) {
			return;
		}

		void this.plugin.openExternalFileEditor(this.preview.projectRoot, this.preview.relativePath);
	}
}

function formatFileSize(bytes: number): string {
	if (bytes < 1_000) {
		return `${bytes} B`;
	}
	if (bytes < 1_000_000) {
		return `${Math.ceil(bytes / 1_000)} KB`;
	}
	return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
