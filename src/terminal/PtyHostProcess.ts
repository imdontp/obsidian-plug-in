import { ChildProcess, fork } from "child_process";
import { join } from "path";

export interface PtySpawnOptions {
	shellPath: string;
	args?: string[];
	cwd: string;
	cols?: number;
	rows?: number;
	env?: NodeJS.ProcessEnv;
}

export interface PtyExitEvent {
	exitCode: number;
	signal?: number;
}

type DataListener = (data: string) => void;
type ExitListener = (event: PtyExitEvent) => void;

/**
 * Pty-like handle backed by a separate forked Node process (see pty-host.js)
 * rather than an in-process node-pty instance: node-pty needs worker_threads,
 * which Obsidian's renderer cannot create.
 */
export class PtyHostProcess {
	private readonly child: ChildProcess;
	private readonly dataListeners: DataListener[] = [];
	private readonly exitListeners: ExitListener[] = [];
	private channelOpen = true;

	constructor(pluginDir: string, nodePath: string, options: PtySpawnOptions) {
		const hostScript = join(pluginDir, "pty-host.js");

		this.child = fork(hostScript, [], {
			execPath: nodePath,
			stdio: ["ignore", "pipe", "pipe", "ipc"],
			cwd: options.cwd,
		});

		this.child.stderr?.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			console.error("[claude-codex-terminal] pty-host:", text);
			this.emitData(`\r\n\x1b[31m${text.replace(/\n/g, "\r\n")}\x1b[0m`);
		});

		this.child.on("error", (err) => {
			this.channelOpen = false;
			this.emitData(`\r\n\x1b[31m[failed to start pty host: ${err.message}]\x1b[0m\r\n`);
			this.emitExit({ exitCode: 1 });
		});

		this.child.on("exit", (code) => {
			if (!this.channelOpen) return;
			this.channelOpen = false;
			this.emitExit({ exitCode: code ?? 0 });
		});

		this.child.on("message", (message: { type: string; data?: string; exitCode?: number; signal?: number }) => {
			if (message?.type === "data" && typeof message.data === "string") {
				this.emitData(message.data);
			} else if (message?.type === "exit") {
				this.channelOpen = false;
				this.emitExit({ exitCode: message.exitCode ?? 0, signal: message.signal });
			}
		});

		this.send({
			type: "spawn",
			shellPath: options.shellPath,
			args: options.args ?? [],
			cwd: options.cwd,
			cols: options.cols ?? 80,
			rows: options.rows ?? 24,
			env: options.env ?? process.env,
		});
	}

	private emitData(data: string): void {
		for (const listener of this.dataListeners) listener(data);
	}

	private emitExit(event: PtyExitEvent): void {
		for (const listener of this.exitListeners) listener(event);
	}

	private send(message: Record<string, unknown>): void {
		if (!this.channelOpen || !this.child.connected) return;
		this.child.send(message, (err) => {
			if (err) this.channelOpen = false;
		});
	}

	onData(listener: DataListener): void {
		this.dataListeners.push(listener);
	}

	onExit(listener: ExitListener): void {
		this.exitListeners.push(listener);
	}

	write(data: string): void {
		this.send({ type: "input", data });
	}

	resize(cols: number, rows: number): void {
		this.send({ type: "resize", cols, rows });
	}

	kill(): void {
		if (this.child.killed) return;
		this.send({ type: "kill" });
		setTimeout(() => {
			if (!this.child.killed) this.child.kill();
		}, 200);
	}
}
