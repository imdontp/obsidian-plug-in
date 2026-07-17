import { ItemView, Notice, ViewStateResult, WorkspaceLeaf } from "obsidian";
import type ClaudeCodexTerminalPlugin from "../main";
import { GitCommitModal } from "./GitCommitModal";
import type { ProjectDiff, ProjectDiffFile, ProjectGitStatusFile } from "./GitDiffService";

export const VIEW_TYPE_DIFF_REVIEW = "claude-codex-diff-review-view";

export interface DiffReviewViewState {
	projectRoot: string;
}

const DEFAULT_STATE: DiffReviewViewState = {
	projectRoot: "",
};

const AUTO_REFRESH_INTERVAL_MS = 3_000;

export class DiffReviewView extends ItemView {
	private readonly plugin: ClaudeCodexTerminalPlugin;
	private state: DiffReviewViewState = DEFAULT_STATE;
	private diff: ProjectDiff | null = null;
	private error: string | null = null;
	private loading = false;
	private refreshQueued = false;
	private opened = false;
	private lastUpdatedAt: Date | null = null;
	private autoRefreshTimer: number | null = null;
	private actionInProgress = false;

	constructor(leaf: WorkspaceLeaf, plugin: ClaudeCodexTerminalPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_DIFF_REVIEW;
	}

	getDisplayText(): string {
		return "Project Diff Review";
	}

	getIcon(): string {
		return "git-compare";
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (state && typeof state === "object") {
			this.state = { ...this.state, ...(state as Partial<DiffReviewViewState>) };
			this.diff = null;
			this.error = null;
			this.lastUpdatedAt = null;
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
		this.contentEl.addClass("claude-codex-diff-review");
		this.startAutoRefresh();
		this.render();
		if (this.state.projectRoot) {
			void this.refresh();
		}
	}

	async onClose(): Promise<void> {
		this.opened = false;
		this.stopAutoRefresh();
	}

	private startAutoRefresh(): void {
		this.stopAutoRefresh();
		this.autoRefreshTimer = window.setInterval(() => {
			if (this.opened) {
				void this.refresh(true);
			}
		}, AUTO_REFRESH_INTERVAL_MS);
	}

	private stopAutoRefresh(): void {
		if (this.autoRefreshTimer !== null) {
			window.clearInterval(this.autoRefreshTimer);
			this.autoRefreshTimer = null;
		}
	}

	private async refresh(automatic = false): Promise<void> {
		if (this.loading || this.actionInProgress) {
			if (!automatic) {
				this.refreshQueued = true;
			}
			return;
		}

		const projectRoot = this.state.projectRoot;
		const previousDiff = this.diff;
		const previousError = this.error;
		let shouldRender = !automatic;
		this.loading = true;
		if (!automatic) {
			this.error = null;
			this.render();
		}

		try {
			const diff = await this.plugin.gitDiffService.readProjectDiff(projectRoot);
			if (projectRoot === this.state.projectRoot) {
				const changed = !sameProjectDiff(this.diff, diff);
				this.diff = diff;
				this.error = null;
				this.lastUpdatedAt = new Date();
				shouldRender ||= changed || previousError !== null;
			}
		} catch (error) {
			if (projectRoot === this.state.projectRoot) {
				const message = error instanceof Error ? error.message : "Could not read the Git diff.";
				this.diff = null;
				this.error = message;
				shouldRender ||= previousDiff !== null || previousError !== message;
			}
		} finally {
			this.loading = false;
			if (this.refreshQueued) {
				this.refreshQueued = false;
				void this.refresh();
				return;
			}
			if (this.opened && shouldRender) {
				this.render();
			}
		}
	}

	private render(): void {
		this.contentEl.empty();

		const toolbar = this.contentEl.createDiv({ cls: "claude-codex-diff-review-toolbar" });
		const heading = toolbar.createDiv({ cls: "claude-codex-diff-review-heading" });
		heading.createEl("h2", { text: "Project Diff Review" });
		heading.createEl("code", { text: this.state.projectRoot || "No project root" });

		const toolbarActions = toolbar.createDiv({ cls: "claude-codex-diff-review-toolbar-actions" });
		const commitButton = toolbarActions.createEl("button", { cls: "mod-warning", text: "Commit..." });
		const hasUnmergedFiles = Boolean(this.diff?.statusFiles.some(isUnmergedStatus));
		const canCommit = Boolean(this.diff && canCommitChanges(this.diff.statusFiles));
		commitButton.disabled = this.loading || this.actionInProgress || !canCommit;
		commitButton.setAttribute(
			"title",
			canCommit
				? "Create a local Git commit from staged changes"
				: hasUnmergedFiles
					? "Resolve merge conflicts before committing"
					: "Stage at least one file before committing"
		);
		commitButton.addEventListener("click", () => this.openCommitModal());

		const refreshButton = toolbarActions.createEl("button", { text: this.loading ? "Refreshing..." : "Refresh" });
		refreshButton.disabled = this.loading || this.actionInProgress;
		refreshButton.addEventListener("click", () => void this.refresh());

		if (this.loading) {
			this.contentEl.createDiv({ cls: "claude-codex-diff-review-message", text: "Reading local Git changes..." });
			return;
		}

		if (this.error) {
			this.contentEl.createDiv({ cls: "claude-codex-diff-review-error", text: this.error });
			return;
		}

		if (!this.diff) {
			return;
		}

		this.renderSummary(this.diff);
		this.renderChangedFiles(this.diff.files, this.diff.statusFiles);
		this.renderStatusWithoutPatch(this.diff.statusFiles, this.diff.files);
		if (this.diff.text.length === 0) {
			this.contentEl.createDiv({
				cls: "claude-codex-diff-review-message",
				text: this.diff.statusFiles.length > 0
					? "Git reports status entries, but no content patch was returned relative to HEAD."
					: "No Git changes relative to HEAD.",
			});
			return;
		}

		const linesEl = this.contentEl.createDiv({ cls: "claude-codex-diff-review-lines" });
		const lines = this.diff.text.split(/\r?\n/);
		if (lines[lines.length - 1] === "") {
			lines.pop();
		}

		for (const line of lines) {
			linesEl.createDiv({
				cls: `claude-codex-diff-review-line ${getDiffLineClass(line)}`,
				text: line || " ",
			});
		}
	}

	private renderSummary(diff: ProjectDiff): void {
		const summary = this.contentEl.createDiv({ cls: "claude-codex-diff-review-summary" });
		summary.createSpan({
			text: `${diff.filesChanged} file${diff.filesChanged === 1 ? "" : "s"} with a Git patch`,
		});
		summary.createSpan({ cls: "claude-codex-diff-review-addition", text: `+${diff.additions}` });
		summary.createSpan({ cls: "claude-codex-diff-review-deletion", text: `-${diff.deletions}` });

		const contentPaths = new Set(diff.files.map((file) => file.path));
		const statusWithoutPatch = diff.statusFiles.filter(
			(file) => !contentPaths.has(file.path) && !isUntrackedStatus(file)
		);
		if (statusWithoutPatch.length > 0) {
			summary.createSpan({
				cls: "claude-codex-diff-review-status-without-patch",
				text: `${statusWithoutPatch.length} Git status entr${statusWithoutPatch.length === 1 ? "y" : "ies"} without a patch`,
			});
		}
		if (diff.untrackedFiles > 0) {
			summary.createSpan({
				cls: "claude-codex-diff-review-untracked",
				text: `${diff.untrackedFiles} untracked`,
			});
		}
		summary.createSpan({
			cls: "claude-codex-diff-review-auto-refresh",
			text: `Auto-refreshing every ${AUTO_REFRESH_INTERVAL_MS / 1_000} seconds`,
		});
		if (this.lastUpdatedAt) {
			summary.createSpan({
				cls: "claude-codex-diff-review-auto-refresh",
				text: `Updated ${this.lastUpdatedAt.toLocaleTimeString()}`,
			});
		}
	}

	private renderChangedFiles(files: ProjectDiffFile[], statusFiles: ProjectGitStatusFile[]): void {
		if (files.length === 0) {
			return;
		}

		const statusByPath = new Map(statusFiles.map((file) => [file.path, file]));
		const section = this.contentEl.createDiv({ cls: "claude-codex-diff-review-files" });
		section.createEl("h3", { text: "Files with a Git patch" });
		const list = section.createDiv({ cls: "claude-codex-diff-review-file-list" });
		for (const file of files) {
			const statusFile = statusByPath.get(file.path);
			const deleted = file.status.startsWith("D") || (statusFile ? isDeletedStatus(statusFile) : false);
			const text = statusFile
				? `${getGitStatusLabel(statusFile)} ${getStatusFilePath(statusFile)}`
				: `${getDiffStatusLabel(file.status)} ${file.path}`;
			const actions = list.createDiv({ cls: "claude-codex-diff-review-file-actions" });
			const button = actions.createEl("button", {
				cls: "claude-codex-diff-review-file-button",
				text,
			});
			button.disabled = deleted;
			if (deleted) {
				button.setAttribute("title", "Deleted files cannot be opened in the external file editor.");
			} else {
				button.setAttribute("title", "Open in External File Editor");
				button.addEventListener("click", () => {
					void this.plugin.openExternalFileEditor(this.state.projectRoot, file.path);
				});
			}
			if (statusFile) {
				this.renderGitActionButtons(actions, statusFile);
			}
		}
	}

	private renderStatusWithoutPatch(statusFiles: ProjectGitStatusFile[], diffFiles: ProjectDiffFile[]): void {
		const contentPaths = new Set(diffFiles.map((file) => file.path));
		const files = statusFiles.filter((file) => !contentPaths.has(file.path));
		if (files.length === 0) {
			return;
		}

		const section = this.contentEl.createDiv({ cls: "claude-codex-diff-review-files" });
		section.createEl("h3", { text: "Other Git status" });
		section.createDiv({
			cls: "claude-codex-diff-review-status-note",
			text: "Includes untracked files and entries for which Git returned no content patch.",
		});
		const list = section.createDiv({ cls: "claude-codex-diff-review-file-list" });
		for (const file of files) {
			const canOpen = !isDeletedStatus(file) && !file.path.endsWith("/");
			const actions = list.createDiv({ cls: "claude-codex-diff-review-file-actions" });
			const button = actions.createEl("button", {
				cls: "claude-codex-diff-review-file-button",
				text: `${getGitStatusLabel(file)} ${getStatusFilePath(file)}`,
			});
			button.disabled = !canOpen;
			if (canOpen) {
				button.setAttribute("title", "Open in External File Editor");
				button.addEventListener("click", () => {
					void this.plugin.openExternalFileEditor(this.state.projectRoot, file.path);
				});
			} else {
				button.setAttribute("title", "This Git status entry does not refer to an openable file.");
			}
			this.renderGitActionButtons(actions, file);
		}
	}

	private renderGitActionButtons(container: HTMLElement, file: ProjectGitStatusFile): void {
		const disabled = this.loading || this.actionInProgress;
		if (canStageStatus(file)) {
			const stageButton = container.createEl("button", {
				cls: "claude-codex-diff-review-git-action",
				text: "Stage",
			});
			stageButton.disabled = disabled;
			stageButton.setAttribute("title", `Stage ${file.path}`);
			stageButton.addEventListener("click", () => void this.changeFileStatus("stage", file));
		}
		if (canUnstageStatus(file)) {
			const unstageButton = container.createEl("button", {
				cls: "claude-codex-diff-review-git-action",
				text: "Unstage",
			});
			unstageButton.disabled = disabled;
			unstageButton.setAttribute("title", `Unstage ${file.path}`);
			unstageButton.addEventListener("click", () => void this.changeFileStatus("unstage", file));
		}
	}

	private async changeFileStatus(action: "stage" | "unstage", file: ProjectGitStatusFile): Promise<void> {
		if (this.loading || this.actionInProgress) {
			return;
		}

		this.actionInProgress = true;
		this.render();
		try {
			if (action === "stage") {
				await this.plugin.gitActionService.stageFile(this.state.projectRoot, file.path);
				new Notice(`Staged ${file.path}.`);
			} else {
				await this.plugin.gitActionService.unstageFile(this.state.projectRoot, file.path);
				new Notice(`Unstaged ${file.path}.`);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : `Could not ${action} the file.`;
			new Notice(message);
		} finally {
			this.actionInProgress = false;
			void this.refresh();
		}
	}

	private openCommitModal(): void {
		if (this.actionInProgress || this.loading) {
			return;
		}
		if (!this.diff || !canCommitChanges(this.diff.statusFiles)) {
			new Notice(
				this.diff?.statusFiles.some(isUnmergedStatus)
					? "Resolve merge conflicts before creating a commit."
					: "Stage at least one file before creating a commit."
			);
			return;
		}

		new GitCommitModal(this.plugin.app, async (message) => this.commitStagedChanges(message)).open();
	}

	private async commitStagedChanges(message: string): Promise<void> {
		if (this.actionInProgress || this.loading) {
			throw new Error("Wait for the current Git operation to finish before committing.");
		}

		this.actionInProgress = true;
		this.render();
		try {
			const commitId = await this.plugin.gitActionService.commitStagedChanges(this.state.projectRoot, message);
			new Notice(`Created local Git commit ${commitId}.`);
		} catch (error) {
			throw error instanceof Error ? error : new Error("Could not create the Git commit.");
		} finally {
			this.actionInProgress = false;
			void this.refresh();
		}
	}
}

function sameProjectDiff(previous: ProjectDiff | null, next: ProjectDiff): boolean {
	if (!previous) {
		return false;
	}
	return previous.text === next.text
		&& previous.filesChanged === next.filesChanged
		&& previous.additions === next.additions
		&& previous.deletions === next.deletions
		&& previous.untrackedFiles === next.untrackedFiles
		&& sameDiffFiles(previous.files, next.files)
		&& sameStatusFiles(previous.statusFiles, next.statusFiles);
}

function sameDiffFiles(left: ProjectDiffFile[], right: ProjectDiffFile[]): boolean {
	return left.length === right.length && left.every((file, index) => (
		file.path === right[index].path && file.status === right[index].status
	));
}

function sameStatusFiles(left: ProjectGitStatusFile[], right: ProjectGitStatusFile[]): boolean {
	return left.length === right.length && left.every((file, index) => (
		file.path === right[index].path
			&& file.indexStatus === right[index].indexStatus
			&& file.workTreeStatus === right[index].workTreeStatus
			&& file.originalPath === right[index].originalPath
	));
}

function isUntrackedStatus(file: ProjectGitStatusFile): boolean {
	return file.indexStatus === "?" && file.workTreeStatus === "?";
}

function hasStagedChanges(files: ProjectGitStatusFile[]): boolean {
	return files.some((file) => file.indexStatus !== " " && file.indexStatus !== "?");
}

function canCommitChanges(files: ProjectGitStatusFile[]): boolean {
	return !files.some(isUnmergedStatus) && hasStagedChanges(files);
}

function canStageStatus(file: ProjectGitStatusFile): boolean {
	return !isUnmergedStatus(file)
		&& !file.path.endsWith("/")
		&& (isUntrackedStatus(file) || file.workTreeStatus !== " ");
}

function canUnstageStatus(file: ProjectGitStatusFile): boolean {
	return !isUnmergedStatus(file) && file.indexStatus !== " " && file.indexStatus !== "?";
}

function isUnmergedStatus(file: ProjectGitStatusFile): boolean {
	return file.indexStatus === "U" || file.workTreeStatus === "U";
}

function isDeletedStatus(file: ProjectGitStatusFile): boolean {
	return file.indexStatus === "D" || file.workTreeStatus === "D";
}

function getStatusFilePath(file: ProjectGitStatusFile): string {
	return file.originalPath ? `${file.originalPath} → ${file.path}` : file.path;
}

function getGitStatusLabel(file: ProjectGitStatusFile): string {
	if (isUntrackedStatus(file)) {
		return "Untracked";
	}

	const labels: string[] = [];
	if (file.indexStatus !== " ") {
		labels.push(`Staged ${getGitStatusAction(file.indexStatus)}`);
	}
	if (file.workTreeStatus !== " ") {
		labels.push(getGitStatusAction(file.workTreeStatus));
	}
	return labels.length > 0 ? labels.join(" · ") : "Changed";
}

function getGitStatusAction(status: string): string {
	switch (status) {
		case "A":
			return "added";
		case "C":
			return "copied";
		case "D":
			return "deleted";
		case "M":
			return "modified";
		case "R":
			return "renamed";
		case "T":
			return "type changed";
		case "U":
			return "unmerged";
		default:
			return "changed";
	}
}

function getDiffLineClass(line: string): string {
	if (line.startsWith("diff --git ")) {
		return "claude-codex-diff-review-file";
	}
	if (line.startsWith("@@")) {
		return "claude-codex-diff-review-hunk";
	}
	if (line.startsWith("+") && !line.startsWith("+++ ")) {
		return "claude-codex-diff-review-added";
	}
	if (line.startsWith("-") && !line.startsWith("--- ")) {
		return "claude-codex-diff-review-removed";
	}
	if (line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
		return "claude-codex-diff-review-meta";
	}
	return "claude-codex-diff-review-context";
}

function getDiffStatusLabel(status: string): string {
	switch (status.charAt(0)) {
		case "A":
			return "Added";
		case "C":
			return "Copied";
		case "D":
			return "Deleted";
		case "M":
			return "Modified";
		case "R":
			return "Renamed";
		case "T":
			return "Type changed";
		default:
			return "Changed";
	}
}
