import { PtyHostProcess, PtySpawnOptions } from "./PtyHostProcess";

export class PtyManager {
	private sessions = new Map<string, PtyHostProcess>();

	constructor(private readonly pluginDir: string, private nodePath: string) {}

	setNodePath(nodePath: string): void {
		this.nodePath = nodePath;
	}

	spawn(id: string, options: PtySpawnOptions): PtyHostProcess {
		this.kill(id);

		const proc = new PtyHostProcess(this.pluginDir, this.nodePath, options);
		this.sessions.set(id, proc);
		proc.onExit(() => this.sessions.delete(id));
		return proc;
	}

	kill(id: string): void {
		this.sessions.get(id)?.kill();
		this.sessions.delete(id);
	}

	killAll(): void {
		for (const proc of this.sessions.values()) {
			proc.kill();
		}
		this.sessions.clear();
	}
}
