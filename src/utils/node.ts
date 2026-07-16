import { existsSync } from "fs";
import { delimiter, join } from "path";

/**
 * Obsidian's Electron build ships with the `runAsNode` fuse disabled, so
 * `ELECTRON_RUN_AS_NODE=1` is ignored and its own binary cannot be forked as
 * a plain Node process. The pty host therefore needs a real Node executable
 * from the user's system.
 */
export function resolveNodePath(configured: string): string {
	if (configured && configured.trim().length > 0) {
		return configured.trim();
	}

	const exeNames = process.platform === "win32" ? ["node.exe"] : ["node"];
	const pathDirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);

	for (const dir of pathDirs) {
		for (const exe of exeNames) {
			const candidate = join(dir, exe);
			if (existsSync(candidate)) {
				return candidate;
			}
		}
	}

	return "";
}
