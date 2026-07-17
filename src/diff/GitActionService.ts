import { execFile } from "child_process";
import { lstat, realpath, stat } from "fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "path";

const MAX_GIT_OUTPUT_BYTES = 128_000;
const MAX_COMMIT_MESSAGE_LENGTH = 2_000;

interface GitCommandError extends Error {
	code?: string | number;
}

interface GitFileTarget {
	root: string;
	path: string;
}

export class GitActionError extends Error {}

/**
 * Performs only explicit, local Git mutations requested from the UI. Every
 * file operation uses a validated literal pathspec and never invokes a shell.
 */
export class GitActionService {
	async stageFile(projectRoot: string, relativePath: string): Promise<void> {
		const target = await this.resolveGitFile(projectRoot, relativePath);
		await this.runGit(target.root, ["add", "--", toLiteralPathspec(target.path)], "stage the file");
	}

	async unstageFile(projectRoot: string, relativePath: string): Promise<void> {
		const target = await this.resolveGitFile(projectRoot, relativePath);
		await this.runGit(
			target.root,
			["restore", "--staged", "--", toLiteralPathspec(target.path)],
			"unstage the file"
		);
	}

	async commitStagedChanges(projectRoot: string, message: string): Promise<string> {
		const root = await this.resolveGitRoot(projectRoot);
		const commitMessage = validateCommitMessage(message);
		const stagedFiles = await this.runGit(root, ["diff", "--cached", "--name-only", "-z"], "read staged changes");
		if (!stagedFiles) {
			throw new GitActionError("No staged changes are available to commit.");
		}

		await this.runGit(root, ["commit", "-m", commitMessage], "create the commit");
		return (await this.runGit(root, ["rev-parse", "--short", "HEAD"], "read the new commit")).trim();
	}

	private async resolveGitFile(projectRoot: string, relativePath: string): Promise<GitFileTarget> {
		const root = await this.resolveGitRoot(projectRoot);
		const requestedPath = relativePath;
		if (!requestedPath || requestedPath.includes("\0") || isAbsolute(requestedPath)) {
			throw new GitActionError("The selected file path is invalid.");
		}
		if (requestedPath.endsWith("/") || requestedPath.endsWith("\\")) {
			throw new GitActionError("Select an individual file before staging or unstaging it.");
		}

		const candidate = resolve(root, requestedPath);
		if (!isPathInside(root, candidate)) {
			throw new GitActionError("The selected file is outside the configured project root.");
		}

		const path = relative(root, candidate).split(sep).join("/");
		if (path === ".git" || path.startsWith(".git/")) {
			throw new GitActionError("Git metadata cannot be staged or unstaged from this plugin.");
		}
		await ensureSafeFileTarget(root, candidate);
		return { root, path };
	}

	private async resolveGitRoot(projectRoot: string): Promise<string> {
		const requestedRoot = projectRoot.trim();
		if (!requestedRoot) {
			throw new GitActionError("Set a project root before changing Git status.");
		}

		let root: string;
		try {
			root = await realpath(requestedRoot);
			if (!(await stat(root)).isDirectory()) {
				throw new GitActionError("The configured project root is not a folder.");
			}
		} catch (error) {
			if (error instanceof GitActionError) {
				throw error;
			}
			throw new GitActionError("The configured project root could not be opened.");
		}

		const insideWorkTree = await this.runGit(root, ["rev-parse", "--is-inside-work-tree"], "check the project root");
		if (insideWorkTree.trim() !== "true") {
			throw new GitActionError("The project root is not a Git working tree.");
		}
		return root;
	}

	private runGit(projectRoot: string, args: string[], action: string): Promise<string> {
		return new Promise((resolve, reject) => {
			execFile(
				"git",
				["-C", projectRoot, "--no-pager", ...args],
				{ encoding: "utf8", maxBuffer: MAX_GIT_OUTPUT_BYTES, timeout: 30_000, windowsHide: true },
				(error, stdout, stderr) => {
					if (error) {
						reject(toFriendlyGitActionError(error as GitCommandError, String(stderr), action));
						return;
					}
					resolve(String(stdout));
				}
			);
		});
	}
}

function validateCommitMessage(message: string): string {
	const normalized = message.trim();
	if (!normalized || normalized.includes("\0")) {
		throw new GitActionError("Enter a commit message before creating the commit.");
	}
	if (normalized.length > MAX_COMMIT_MESSAGE_LENGTH) {
		throw new GitActionError(`Keep the commit message under ${MAX_COMMIT_MESSAGE_LENGTH.toLocaleString()} characters.`);
	}
	return normalized;
}

function toLiteralPathspec(path: string): string {
	return `:(literal)${path}`;
}

function isPathInside(root: string, candidate: string): boolean {
	const path = relative(root, candidate);
	return path.length > 0 && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function ensureSafeFileTarget(root: string, path: string): Promise<void> {
	const resolvedParent = await resolveExistingParent(path);
	if (!isPathAtOrInside(root, resolvedParent)) {
		throw new GitActionError("The selected file resolves outside the configured project root.");
	}

	try {
		const info = await lstat(path);
		if (info.isDirectory()) {
			throw new GitActionError("Select an individual file before staging or unstaging it.");
		}
		if (!info.isSymbolicLink() && !isPathInside(root, await realpath(path))) {
			throw new GitActionError("The selected file resolves outside the configured project root.");
		}
	} catch (error) {
		if (error instanceof GitActionError) {
			throw error;
		}
		const code = typeof error === "object" && error && "code" in error
			? String((error as { code?: unknown }).code)
			: "";
		if (code !== "ENOENT") {
			throw new GitActionError("The selected file could not be inspected safely.");
		}
	}
}

async function resolveExistingParent(path: string): Promise<string> {
	let parent = dirname(path);
	for (;;) {
		try {
			return await realpath(parent);
		} catch (error) {
			const code = typeof error === "object" && error && "code" in error
				? String((error as { code?: unknown }).code)
				: "";
			if (code !== "ENOENT") {
				throw new GitActionError("The selected file could not be inspected safely.");
			}
			const nextParent = dirname(parent);
			if (nextParent === parent) {
				throw new GitActionError("The selected file could not be inspected safely.");
			}
			parent = nextParent;
		}
	}
}

function isPathAtOrInside(root: string, candidate: string): boolean {
	return root === candidate || isPathInside(root, candidate);
}

function toFriendlyGitActionError(error: GitCommandError, stderr: string, action: string): Error {
	const details = `${stderr}\n${error.message}`;
	if (error.code === "ENOENT") {
		return new GitActionError("Git was not found. Install Git or make it available in Obsidian's PATH.");
	}
	if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
		return new GitActionError("Git returned too much output. Complete this action in a terminal instead.");
	}
	if (/not a git repository/i.test(details)) {
		return new GitActionError("The project root is not a Git repository.");
	}
	if (/pathspec .* did not match|did not match any files/i.test(details)) {
		return new GitActionError("The selected file no longer matches Git status. Refresh the review and try again.");
	}
	if (/nothing to commit/i.test(details)) {
		return new GitActionError("No staged changes are available to commit.");
	}
	if (/please tell me who you are|unable to auto-detect email address/i.test(details)) {
		return new GitActionError("Configure Git user.name and user.email before creating a commit.");
	}
	if (/hook .* failed|hook declined|pre-commit/i.test(details)) {
		return new GitActionError("A Git hook rejected the commit. Review it in a terminal and try again.");
	}
	if (/cannot change to/i.test(details)) {
		return new GitActionError("The configured project root could not be opened.");
	}
	return new GitActionError(`Git could not ${action}. Review the repository in a terminal and try again.`);
}
