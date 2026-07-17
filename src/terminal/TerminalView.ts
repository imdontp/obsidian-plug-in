import { ItemView, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { PtyHostProcess } from "./PtyHostProcess";
import type ClaudeCodexTerminalPlugin from "../main";
import { resolveTerminalCommand } from "../utils/shell";

export const VIEW_TYPE_TERMINAL = "claude-codex-terminal-view";

export interface TerminalViewState {
	title: string;
	cwd: string;
	command?: string;
	args?: string[];
}

const DEFAULT_STATE: TerminalViewState = {
	title: "Terminal",
	cwd: "",
};

export class TerminalView extends ItemView {
	private plugin: ClaudeCodexTerminalPlugin;
	private readonly workspaceLeaf: WorkspaceLeaf;
	private state: TerminalViewState = DEFAULT_STATE;
	private term: Terminal | null = null;
	private fitAddon: FitAddon | null = null;
	private ptyProcess: PtyHostProcess | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private started = false;
	private processExited = false;
	private readonly sessionId: string;

	constructor(leaf: WorkspaceLeaf, plugin: ClaudeCodexTerminalPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.workspaceLeaf = leaf;
		this.sessionId = `term-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	}

	getViewType(): string {
		return VIEW_TYPE_TERMINAL;
	}

	getDisplayText(): string {
		return this.state.title;
	}

	getIcon(): string {
		return "terminal-square";
	}

	getSessionId(): string {
		return this.sessionId;
	}

	getSessionTitle(): string {
		return this.state.title;
	}

	isInteractive(): boolean {
		return this.ptyProcess !== null && !this.processExited;
	}

	supportsBracketedPaste(): boolean {
		return this.term?.modes.bracketedPasteMode ?? false;
	}

	reveal(): void {
		this.plugin.app.workspace.revealLeaf(this.workspaceLeaf);
		this.term?.focus();
	}

	pasteContext(text: string): boolean {
		if (!this.term || !this.isInteractive()) {
			return false;
		}

		this.reveal();
		this.term.paste(text);
		return true;
	}

	refreshTheme(): void {
		if (this.term) {
			this.term.options.theme = this.getXtermTheme();
		}
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (state && typeof state === "object") {
			this.state = { ...this.state, ...(state as Partial<TerminalViewState>) };
		}
		await super.setState(state, result);
		this.plugin.refreshTerminalSession(this);
		this.startIfReady();
	}

	getState(): Record<string, unknown> {
		return { ...this.state };
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("claude-codex-terminal-container");

		const termEl = container.createDiv({ cls: "claude-codex-terminal-el" });

		this.term = new Terminal({
			convertEol: true,
			cursorBlink: true,
			fontSize: 14,
			theme: this.getXtermTheme(),
		});
		this.fitAddon = new FitAddon();
		this.term.loadAddon(this.fitAddon);
		this.term.open(termEl);
		this.fitAddon.fit();
		this.plugin.registerTerminalSession(this);
		this.registerDomEvent(termEl, "focusin", () => this.plugin.setContextTarget(this));

		this.resizeObserver = new ResizeObserver(() => {
			this.fitAddon?.fit();
			if (this.term && this.ptyProcess) {
				this.ptyProcess.resize(this.term.cols, this.term.rows);
			}
		});
		this.resizeObserver.observe(termEl);

		this.startIfReady();
	}

	async onClose(): Promise<void> {
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.plugin.unregisterTerminalSession(this);
		this.plugin.ptyManager.kill(this.sessionId);
		this.ptyProcess = null;
		this.processExited = true;
		this.term?.dispose();
		this.term = null;
	}

	private startIfReady(): void {
		if (this.started || !this.term || !this.state.cwd) {
			return;
		}
		this.started = true;

		const configuredCommand = this.state.command?.trim();
		if (this.state.command !== undefined && !configuredCommand) {
			this.processExited = true;
			this.term.write("\r\n\x1b[31m[terminal command is empty; close this tab and relaunch it from the Command palette]\x1b[0m\r\n");
			this.plugin.refreshTerminalSession(this);
			return;
		}

		const args = this.state.args ?? [];
		const launchCommand = resolveTerminalCommand(configuredCommand, args);

		this.processExited = false;
		this.ptyProcess = this.plugin.ptyManager.spawn(this.sessionId, {
			shellPath: launchCommand.shellPath,
			args: launchCommand.args,
			cwd: this.state.cwd,
			cols: this.term.cols,
			rows: this.term.rows,
		});
		this.plugin.refreshTerminalSession(this);

		this.ptyProcess.onData((data) => this.term?.write(data));
		this.ptyProcess.onExit(({ exitCode }) => {
			this.processExited = true;
			this.plugin.refreshTerminalSession(this);
			this.term?.write(`\r\n\x1b[90m[process exited with code ${exitCode}]\x1b[0m\r\n`);
		});

		this.term.onData((data) => this.ptyProcess?.write(data));
		this.term.focus();
	}

	private getXtermTheme() {
		const styles = getComputedStyle(this.containerEl.ownerDocument.body ?? document.body);
		const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
		return {
			background: read("--background-primary", "#1e1e1e"),
			foreground: read("--text-normal", "#d4d4d4"),
			cursor: read("--text-normal", "#d4d4d4"),
		};
	}
}
