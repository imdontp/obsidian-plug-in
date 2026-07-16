import { ItemView, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { PtyHostProcess } from "./PtyHostProcess";
import type ClaudeCodexTerminalPlugin from "../main";
import { getDefaultShell } from "../utils/shell";

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
	private state: TerminalViewState = DEFAULT_STATE;
	private term: Terminal | null = null;
	private fitAddon: FitAddon | null = null;
	private ptyProcess: PtyHostProcess | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private started = false;
	private readonly sessionId: string;

	constructor(leaf: WorkspaceLeaf, plugin: ClaudeCodexTerminalPlugin) {
		super(leaf);
		this.plugin = plugin;
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

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (state && typeof state === "object") {
			this.state = { ...this.state, ...(state as Partial<TerminalViewState>) };
		}
		await super.setState(state, result);
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
		this.plugin.ptyManager.kill(this.sessionId);
		this.ptyProcess = null;
		this.term?.dispose();
		this.term = null;
	}

	private startIfReady(): void {
		if (this.started || !this.term || !this.state.cwd) {
			return;
		}
		this.started = true;

		const shellPath = this.state.command ?? getDefaultShell();
		const args = this.state.args ?? [];

		this.ptyProcess = this.plugin.ptyManager.spawn(this.sessionId, {
			shellPath,
			args,
			cwd: this.state.cwd,
			cols: this.term.cols,
			rows: this.term.rows,
		});

		this.ptyProcess.onData((data) => this.term?.write(data));
		this.ptyProcess.onExit(({ exitCode }) => {
			this.term?.write(`\r\n\x1b[90m[process exited with code ${exitCode}]\x1b[0m\r\n`);
		});

		this.term.onData((data) => this.ptyProcess?.write(data));
		this.term.focus();
	}

	private getXtermTheme() {
		const styles = getComputedStyle(document.body);
		const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
		return {
			background: read("--background-primary", "#1e1e1e"),
			foreground: read("--text-normal", "#d4d4d4"),
			cursor: read("--text-normal", "#d4d4d4"),
		};
	}
}
