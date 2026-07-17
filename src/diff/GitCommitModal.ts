import { App, Modal } from "obsidian";

export class GitCommitModal extends Modal {
	private readonly submitCommit: (message: string) => Promise<void>;
	private messageInput: HTMLTextAreaElement | null = null;
	private commitButton: HTMLButtonElement | null = null;
	private cancelButton: HTMLButtonElement | null = null;
	private errorEl: HTMLElement | null = null;
	private submitting = false;

	constructor(app: App, submitCommit: (message: string) => Promise<void>) {
		super(app);
		this.submitCommit = submitCommit;
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: "Create local Git commit" });
		this.contentEl.createEl("p", {
			text: "This commits the currently staged changes locally. It does not push to a remote. Git hooks may run.",
		});

		this.messageInput = this.contentEl.createEl("textarea", {
			cls: "claude-codex-git-commit-message",
			attr: {
				placeholder: "Commit message",
				"aria-label": "Commit message",
				rows: "4",
			},
		});
		this.messageInput.addEventListener("input", () => this.updateControls());
		this.messageInput.addEventListener("keydown", (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
				event.preventDefault();
				void this.submit();
			}
		});

		this.errorEl = this.contentEl.createDiv({ cls: "claude-codex-git-commit-error" });
		const actions = this.contentEl.createDiv({ cls: "claude-codex-git-commit-actions" });
		this.cancelButton = actions.createEl("button", { text: "Cancel" });
		this.cancelButton.addEventListener("click", () => this.close());
		this.commitButton = actions.createEl("button", { cls: "mod-warning", text: "Create local commit" });
		this.commitButton.addEventListener("click", () => void this.submit());
		this.updateControls();
		this.messageInput.focus();
	}

	onClose(): void {
		this.contentEl.empty();
		this.messageInput = null;
		this.commitButton = null;
		this.cancelButton = null;
		this.errorEl = null;
	}

	private async submit(): Promise<void> {
		const message = this.messageInput?.value ?? "";
		if (this.submitting || !message.trim()) {
			return;
		}

		this.submitting = true;
		this.updateControls();
		if (this.errorEl) {
			this.errorEl.empty();
		}
		try {
			await this.submitCommit(message);
			this.close();
		} catch (error) {
			if (this.errorEl) {
				this.errorEl.setText(error instanceof Error ? error.message : "Could not create the Git commit.");
			}
		} finally {
			this.submitting = false;
			this.updateControls();
		}
	}

	private updateControls(): void {
		const hasMessage = Boolean(this.messageInput?.value.trim());
		if (this.messageInput) {
			this.messageInput.disabled = this.submitting;
		}
		if (this.commitButton) {
			this.commitButton.disabled = this.submitting || !hasMessage;
			this.commitButton.setText(this.submitting ? "Creating..." : "Create local commit");
		}
		if (this.cancelButton) {
			this.cancelButton.disabled = this.submitting;
		}
	}
}
