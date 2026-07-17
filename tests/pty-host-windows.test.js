const assert = require("node:assert/strict");
const { fork } = require("node:child_process");

if (process.platform !== "win32") {
	console.log("Skipping Windows PTY host smoke test on a non-Windows platform.");
	process.exit(0);
}

function spawnAndCollect(request) {
	return new Promise((resolve, reject) => {
		const child = fork("pty-host.js", [], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
		const messages = [];
		const timeout = setTimeout(() => {
			child.kill();
			reject(new Error("PTY host did not exit within 10 seconds."));
		}, 10_000);

		child.on("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.on("message", (message) => messages.push(message));
		child.on("exit", (exitCode) => {
			clearTimeout(timeout);
			resolve({ exitCode, messages });
		});

		child.send({ type: "spawn", cwd: process.cwd(), cols: 80, rows: 24, ...request });
	});
}

async function main() {
	const emptyCommand = await spawnAndCollect({ shellPath: "", args: [] });
	assert.equal(emptyCommand.exitCode, 1);
	assert.ok(
		emptyCommand.messages.some(
			(message) => message.type === "error" && message.message.includes("Terminal command is empty")
		),
		"an empty command should produce a structured error"
	);

	const invocation = "& 'powershell.exe' '-NoLogo' '-NoProfile' '-Command' 'Write-Output pty-shell-wrapper-ok; exit 0'; exit 0";
	const wrappedCommand = await spawnAndCollect({
		shellPath: "powershell.exe",
		args: ["-NoLogo", "-NoExit", "-Command", invocation],
	});
	assert.equal(wrappedCommand.exitCode, 0);
	assert.ok(
		wrappedCommand.messages.some(
			(message) => message.type === "data" && message.data.includes("pty-shell-wrapper-ok")
		),
		"a PowerShell-wrapped command should run inside the PTY"
	);

	console.log("Windows PTY host smoke test passed.");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
