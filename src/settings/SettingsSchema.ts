export interface AgentProfile {
	binary: string;
	defaultArgs: string[];
}

export interface ClaudeCodexTerminalSettings {
	projectRoot: string;
	shell: string;
	nodePath: string;
	agents: {
		claude: AgentProfile;
		codex: AgentProfile;
	};
}

export const DEFAULT_SETTINGS: ClaudeCodexTerminalSettings = {
	projectRoot: "",
	shell: "",
	nodePath: "",
	agents: {
		claude: { binary: "claude", defaultArgs: [] },
		codex: { binary: "codex", defaultArgs: [] },
	},
};
