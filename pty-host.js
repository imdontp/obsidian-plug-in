"use strict";
/*
 * Standalone host process for a single pty session.
 *
 * node-pty needs `worker_threads` on Windows to relay ConPTY/winpty output,
 * and Obsidian's renderer process cannot construct Workers ("The V8 platform
 * used by this instance of Node does not support creating Workers"). This
 * script is forked as a real, separate Node process (via
 * `child_process.fork` with ELECTRON_RUN_AS_NODE=1) where worker_threads
 * works normally, and talks back to the plugin over the fork's IPC channel.
 *
 * Kept as plain JS (not bundled by esbuild) since it must be loaded by
 * `child_process.fork(path)` as its own file, sitting next to node_modules.
 */

const pty = require("node-pty");

let ptyProcess = null;

function reportStartError(message) {
	if (!process.send) {
		process.exit(1);
		return;
	}

	process.send({ type: "error", message }, () => process.exit(1));
}

process.on("message", (message) => {
	if (!message || typeof message !== "object") {
		return;
	}

	switch (message.type) {
		case "spawn": {
			const shellPath = typeof message.shellPath === "string" ? message.shellPath.trim() : "";
			if (!shellPath) {
				reportStartError("Terminal command is empty. Set the command in the plugin settings and try again.");
				break;
			}

			try {
				ptyProcess = pty.spawn(shellPath, message.args || [], {
					name: "xterm-256color",
					cols: message.cols || 80,
					rows: message.rows || 24,
					cwd: message.cwd,
					env: message.env || process.env,
				});
			} catch (error) {
				const details = error instanceof Error ? error.message : String(error);
				reportStartError(`Could not start ${shellPath}: ${details}`);
				break;
			}

			ptyProcess.onData((data) => {
				if (process.send) {
					process.send({ type: "data", data });
				}
			});

			ptyProcess.onExit(({ exitCode, signal }) => {
				if (process.send) {
					process.send({ type: "exit", exitCode, signal });
				}
				process.exit(0);
			});
			break;
		}
		case "input":
			ptyProcess?.write(message.data);
			break;
		case "resize":
			ptyProcess?.resize(message.cols, message.rows);
			break;
		case "kill":
			ptyProcess?.kill();
			break;
	}
});

process.on("disconnect", () => {
	ptyProcess?.kill();
	process.exit(0);
});
