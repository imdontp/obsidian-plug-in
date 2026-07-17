export function getDefaultShell(): string {
	if (process.platform === "win32") {
		return "powershell.exe";
	}
	return process.env.SHELL || "/bin/bash";
}

export interface TerminalCommand {
	shellPath: string;
	args: string[];
}

/**
 * On Windows, agent CLIs may be .cmd or .ps1 shims. Launching them directly
 * through node-pty bypasses PowerShell's command resolution, so use the
 * default PowerShell host for configured agent commands instead.
 */
export function resolveTerminalCommand(command: string | undefined, args: string[]): TerminalCommand {
	const executable = command?.trim();
	if (!executable) {
		return { shellPath: getDefaultShell(), args };
	}

	if (process.platform !== "win32") {
		return { shellPath: executable, args };
	}

	return {
		shellPath: getDefaultShell(),
		args: ["-NoLogo", "-NoExit", "-Command", buildPowerShellInvocation(executable, args)],
	};
}

function buildPowerShellInvocation(command: string, args: string[]): string {
	const invocation = [command, ...args]
		.map((value) => `'${value.replace(/'/g, "''")}'`)
		.join(" ");
	return `& ${invocation}`;
}
