import { FileSystemAdapter, MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
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
import { DiffReviewView, DiffReviewViewState, VIEW_TYPE_DIFF_REVIEW } from "./diff/DiffReviewView";
import { GitDiffService } from "./diff/GitDiffService";
import { resolveProjectRoot, resolvePluginDir } from "./utils/paths";
import { resolveNodePath } from "./utils/node";

const MAX_SELECTION_CONTEXT_LENGTH = 20_000;

export default class ClaudeCodexTerminalPlugin extends Plugin {
	settings!: ClaudeCodexTerminalSettings;
	ptyManager!: PtyManager;
	readonly gitDiffService = new GitDiffService();
	private readonly terminalSessions = new Map<string, TerminalView>();
	private contextTargetId: string | null = null;
	private contextStatusEl: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();

		const pluginDir = resolvePluginDir(this.app, this.manifest);
		if (!pluginDir) {
			new Notice("Claude & Codex Terminal: could not resolve the plugin's own folder path; terminal will not work.");
		}
		this.ptyManager = new PtyManager(pluginDir, resolveNodePath(this.settings.nodePath));

		this.registerView(VIEW_TYPE_TERMINAL, (leaf: WorkspaceLeaf) => new TerminalView(leaf, this));
		this.registerView(VIEW_TYPE_DIFF_REVIEW, (leaf: WorkspaceLeaf) => new DiffReviewView(leaf, this));
		this.registerEvent(this.app.workspace.on("css-change", () => this.refreshTerminalThemes()));
		this.contextStatusEl = this.addStatusBarItem();
		this.contextStatusEl.setAttribute("role", "button");
		this.contextStatusEl.setAttribute("tabindex", "0");
		this.registerDomEvent(this.contextStatusEl, "click", () => this.revealContextTarget());
		this.registerDomEvent(this.contextStatusEl, "keydown", (event: KeyboardEvent) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				this.revealContextTarget();
			}
		});
		this.updateContextStatus();

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
					command: this.getAgentBinary("claude"),
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
					command: this.getAgentBinary("codex"),
					args: this.settings.agents.codex.defaultArgs,
				});
			},
		});

		this.addCommand({
			id: "focus-context-target",
			name: "Focus context target terminal",
			callback: () => this.revealContextTarget(true),
		});

		this.addCommand({
			id: "open-project-diff-review",
			name: "Open project diff review",
			callback: () => {
				void this.openProjectDiffReview();
			},
		});

		this.addCommand({
			id: "paste-active-file-into-context-target",
			name: "Paste active file path into context target",
			callback: () => this.pasteActiveFileIntoContextTarget(),
		});

		this.addCommand({
			id: "paste-selection-into-context-target",
			name: "Paste selection into context target",
			editorCallback: (editor, context) => {
				const file = context.file;
				if (!file) {
					new Notice("Save the active Markdown note before pasting its selection into a terminal session.");
					return;
				}
				this.pasteSelectionIntoContextTarget(editor.getSelection(), file);
			},
		});
	}

	onunload() {
		this.ptyManager?.killAll();
		this.terminalSessions.clear();
		this.contextTargetId = null;
		this.contextStatusEl = null;
	}

	refreshNodePath(): void {
		this.ptyManager?.setNodePath(resolveNodePath(this.settings.nodePath));
	}

	registerTerminalSession(view: TerminalView): void {
		this.terminalSessions.set(view.getSessionId(), view);
		this.contextTargetId = view.getSessionId();
		this.updateContextStatus();
	}

	unregisterTerminalSession(view: TerminalView): void {
		const sessionId = view.getSessionId();
		this.terminalSessions.delete(sessionId);
		if (this.contextTargetId === sessionId) {
			this.contextTargetId = null;
		}
		this.updateContextStatus();
	}

	refreshTerminalSession(view: TerminalView): void {
		if (this.terminalSessions.has(view.getSessionId())) {
			this.updateContextStatus();
		}
	}

	setContextTarget(view: TerminalView): void {
		if (!this.terminalSessions.has(view.getSessionId())) {
			return;
		}

		this.contextTargetId = view.getSessionId();
		this.updateContextStatus();
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

	private async openProjectDiffReview(): Promise<void> {
		const projectRoot = resolveProjectRoot(this.app, this.settings.projectRoot);
		if (!projectRoot) {
			new Notice("Set a project root (or open a vault on disk) before reviewing Git changes.");
			return;
		}

		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({
			type: VIEW_TYPE_DIFF_REVIEW,
			active: true,
			state: { projectRoot } satisfies DiffReviewViewState,
		});
		this.app.workspace.revealLeaf(leaf);
	}

	private getAgentBinary(agent: "claude" | "codex"): string {
		const configuredBinary = this.settings.agents[agent]?.binary;
		return typeof configuredBinary === "string" && configuredBinary.trim()
			? configuredBinary.trim()
			: DEFAULT_SETTINGS.agents[agent].binary;
	}

	private pasteActiveFileIntoContextTarget(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		if (!file) {
			new Notice("Open a Markdown note before pasting its path into a terminal session.");
			return;
		}

		const prompt = `Use this active Obsidian note as context: ${this.getFileLocation(file)}. Do not modify it unless I ask.`;
		this.pasteIntoContextTarget(prompt);
	}

	private pasteSelectionIntoContextTarget(selection: string, file: TFile): void {
		if (selection.trim().length === 0) {
			new Notice("Select text in a Markdown note before pasting it into a terminal session.");
			return;
		}

		if (selection.length > MAX_SELECTION_CONTEXT_LENGTH) {
			new Notice(`Selection is too large to paste safely. Select at most ${MAX_SELECTION_CONTEXT_LENGTH.toLocaleString()} characters.`);
			return;
		}

		const isMultiline = /[\r\n]/.test(selection);
		const prompt = isMultiline
			? [
				"Use this selected text from my active Obsidian note as context.",
				"",
				`File: ${this.getFileLocation(file)}`,
				"",
				`~~~${file.extension}`,
				selection,
				"~~~",
			].join("\n")
			: `Use this selected text from ${this.getFileLocation(file)} as context: ${selection}`;
		this.pasteIntoContextTarget(prompt, isMultiline);
	}

	private pasteIntoContextTarget(text: string, requiresBracketedPaste = false): void {
		const target = this.getContextTarget();
		if (!target) {
			new Notice("Focus an open terminal session before pasting context.");
			return;
		}

		if (requiresBracketedPaste && !target.supportsBracketedPaste()) {
			new Notice("This terminal does not support safe multi-line paste. Focus a running Claude or Codex session, or select one line.");
			return;
		}

		if (!target.pasteContext(text)) {
			this.updateContextStatus();
			new Notice("The selected terminal session is no longer running.");
			return;
		}

		new Notice(`Context pasted into ${target.getSessionTitle()}. Review it, then press Enter to send.`);
	}

	private getContextTarget(): TerminalView | null {
		const current = this.contextTargetId ? this.terminalSessions.get(this.contextTargetId) : null;
		if (current?.isInteractive()) {
			return current;
		}

		const fallback = Array.from(this.terminalSessions.values())
			.reverse()
			.find((view) => view.isInteractive()) ?? null;
		this.contextTargetId = fallback?.getSessionId() ?? null;
		return fallback;
	}

	private revealContextTarget(showMissingNotice = false): void {
		const target = this.getContextTarget();
		if (target) {
			target.reveal();
			return;
		}

		if (showMissingNotice) {
			new Notice("Open a running terminal session before focusing the context target.");
		}
	}

	private refreshTerminalThemes(): void {
		for (const view of this.terminalSessions.values()) {
			view.refreshTheme();
		}
	}

	private updateContextStatus(): void {
		if (!this.contextStatusEl) {
			return;
		}

		const target = this.getContextTarget();
		if (!target) {
			this.contextStatusEl.setText("Context: no terminal");
			this.contextStatusEl.setAttribute("aria-label", "No active terminal context target");
			this.contextStatusEl.setAttribute("title", "Focus a terminal session to set the context target.");
			return;
		}

		const label = `Context: ${target.getSessionTitle()}`;
		this.contextStatusEl.setText(label);
		this.contextStatusEl.setAttribute("aria-label", `${label}. Activate to open the terminal.`);
		this.contextStatusEl.setAttribute("title", `${label}. Click to open the terminal.`);
	}

	private getFileLocation(file: TFile): string {
		const adapter = this.app.vault.adapter;
		return adapter instanceof FileSystemAdapter ? adapter.getFullPath(file.path) : file.path;
	}

	async loadSettings() {
		const saved = (await this.loadData()) as Partial<ClaudeCodexTerminalSettings> | null;
		this.settings = {
			...DEFAULT_SETTINGS,
			...saved,
			agents: {
				claude: { ...DEFAULT_SETTINGS.agents.claude, ...saved?.agents?.claude },
				codex: { ...DEFAULT_SETTINGS.agents.codex, ...saved?.agents?.codex },
			},
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
