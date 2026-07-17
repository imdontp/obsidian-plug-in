import { ItemView, ViewStateResult, WorkspaceLeaf } from "obsidian";
import type ClaudeCodexTerminalPlugin from "../main";
import type { ProjectDiff } from "./GitDiffService";

export const VIEW_TYPE_DIFF_REVIEW = "claude-codex-diff-review-view";

export interface DiffReviewViewState {
	projectRoot: string;
}

const DEFAULT_STATE: DiffReviewViewState = {
	projectRoot: "",
};

export class DiffReviewView extends ItemView {
	private readonly plugin: ClaudeCodexTerminalPlugin;
	private state: DiffReviewViewState = DEFAULT_STATE;
	private diff: ProjectDiff | null = null;
	private error: string | null = null;
	private loading = false;
	private refreshQueued = false;
	private opened = false;

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
		this.render();
		if (this.state.projectRoot) {
			void this.refresh();
		}
	}

	async onClose(): Promise<void> {
		this.opened = false;
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
			const diff = await this.plugin.gitDiffService.readProjectDiff(projectRoot);
			if (projectRoot === this.state.projectRoot) {
				this.diff = diff;
			}
		} catch (error) {
			if (projectRoot === this.state.projectRoot) {
				this.diff = null;
				this.error = error instanceof Error ? error.message : "Could not read the Git diff.";
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

		const toolbar = this.contentEl.createDiv({ cls: "claude-codex-diff-review-toolbar" });
		const heading = toolbar.createDiv({ cls: "claude-codex-diff-review-heading" });
		heading.createEl("h2", { text: "Project Diff Review" });
		heading.createEl("code", { text: this.state.projectRoot || "No project root" });

		const refreshButton = toolbar.createEl("button", { text: this.loading ? "Refreshing..." : "Refresh" });
		refreshButton.disabled = this.loading;
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
		if (this.diff.text.length === 0) {
			this.contentEl.createDiv({
				cls: "claude-codex-diff-review-message",
				text: "No tracked changes relative to HEAD.",
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
		summary.createSpan({ text: `${diff.filesChanged} file${diff.filesChanged === 1 ? "" : "s"} changed` });
		summary.createSpan({ cls: "claude-codex-diff-review-addition", text: `+${diff.additions}` });
		summary.createSpan({ cls: "claude-codex-diff-review-deletion", text: `-${diff.deletions}` });
		if (diff.untrackedFiles > 0) {
			summary.createSpan({
				cls: "claude-codex-diff-review-untracked",
				text: `${diff.untrackedFiles} untracked not shown`,
			});
		}
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
