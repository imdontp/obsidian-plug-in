import { execFile } from "child_process";

const MAX_DIFF_BYTES = 1_000_000;
const MAX_STATUS_BYTES = 128_000;

export interface ProjectDiff {
	text: string;
	files: ProjectDiffFile[];
	filesChanged: number;
	additions: number;
	deletions: number;
	untrackedFiles: number;
}

export interface ProjectDiffFile {
	path: string;
	status: string;
}

interface GitCommandError extends Error {
	code?: string | number;
}

/**
 * Reads Git metadata for the configured project root. All commands are
 * argument-based (never shell strings) and intentionally perform no writes.
 */
export class GitDiffService {
	async readProjectDiff(projectRoot: string): Promise<ProjectDiff> {
		const root = projectRoot.trim();
		if (!root) {
			throw new Error("Set a project root before reviewing Git changes.");
		}

		const insideWorkTree = await this.runGit(root, ["rev-parse", "--is-inside-work-tree"], 4_096);
		if (insideWorkTree.trim() !== "true") {
			throw new Error("The project root is not a Git working tree.");
		}

		const [text, status, changedFiles] = await Promise.all([
			this.runGit(root, ["diff", "--no-ext-diff", "--no-textconv", "--unified=3", "HEAD", "--"], MAX_DIFF_BYTES),
			this.runGit(root, ["status", "--porcelain=v1", "--untracked-files=normal"], MAX_STATUS_BYTES),
			this.runGit(root, ["diff", "--no-ext-diff", "--no-textconv", "--name-status", "-z", "HEAD", "--"], MAX_STATUS_BYTES),
		]);
		const summary = summarizeUnifiedDiff(text);
		const files = parseChangedFiles(changedFiles);

		return {
			text,
			files,
			...summary,
			filesChanged: files.length,
			untrackedFiles: status.split(/\r?\n/).filter((line) => line.startsWith("?? ")).length,
		};
	}

	private runGit(projectRoot: string, args: string[], maxBuffer: number): Promise<string> {
		return new Promise((resolve, reject) => {
			execFile(
				"git",
				["-C", projectRoot, "--no-pager", ...args],
				{ encoding: "utf8", maxBuffer, timeout: 10_000, windowsHide: true },
				(error, stdout, stderr) => {
					if (error) {
						reject(this.toFriendlyError(error as GitCommandError, String(stderr)));
						return;
					}

					resolve(String(stdout));
				}
			);
		});
	}

	private toFriendlyError(error: GitCommandError, stderr: string): Error {
		const details = `${stderr}\n${error.message}`;
		if (error.code === "ENOENT") {
			return new Error("Git was not found. Install Git or make it available in Obsidian's PATH.");
		}

		if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
			return new Error("The Git diff is too large to display safely. Review it in your Git client instead.");
		}

		if (/not a git repository/i.test(details)) {
			return new Error("The project root is not a Git repository.");
		}

		if (/does not have any commits yet|ambiguous argument ['\"]HEAD|unknown revision/i.test(details)) {
			return new Error("This Git repository has no commit yet. Create an initial commit before reviewing its diff.");
		}

		if (/cannot change to/i.test(details)) {
			return new Error("The configured project root could not be opened.");
		}

		return new Error("Could not read the Git diff. Check the project root and Git installation.");
	}
}

function summarizeUnifiedDiff(text: string): Pick<ProjectDiff, "filesChanged" | "additions" | "deletions"> {
	let filesChanged = 0;
	let additions = 0;
	let deletions = 0;

	for (const line of text.split(/\r?\n/)) {
		if (line.startsWith("diff --git ")) {
			filesChanged += 1;
		} else if (line.startsWith("+") && !line.startsWith("+++ ")) {
			additions += 1;
		} else if (line.startsWith("-") && !line.startsWith("--- ")) {
			deletions += 1;
		}
	}

	return { filesChanged, additions, deletions };
}

function parseChangedFiles(output: string): ProjectDiffFile[] {
	const fields = output.split("\0");
	const files: ProjectDiffFile[] = [];

	for (let index = 0; index < fields.length;) {
		const status = fields[index++];
		if (!status) {
			continue;
		}

		const firstPath = fields[index++];
		if (firstPath === undefined) {
			break;
		}

		const code = status.charAt(0);
		const path = code === "R" || code === "C" ? fields[index++] : firstPath;
		if (path) {
			files.push({ path, status });
		}
	}

	return files;
}
