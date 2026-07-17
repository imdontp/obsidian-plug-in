import { createHash } from "crypto";
import { lstat, readFile, realpath, stat, writeFile } from "fs/promises";
import { isAbsolute, relative, resolve, sep } from "path";

export const MAX_EXTERNAL_FILE_BYTES = 1_000_000;

export interface ExternalTextFile {
	projectRoot: string;
	relativePath: string;
	text: string;
	contentHash: string;
	lineEnding: "\n" | "\r\n";
	hasBom: boolean;
}

interface ResolvedExternalFile {
	root: string;
	path: string;
}

interface FileContent {
	text: string;
	contentHash: string;
	lineEnding: "\n" | "\r\n";
	hasBom: boolean;
}

export class ExternalFileError extends Error {}

export class ExternalFileConflictError extends ExternalFileError {}

/**
 * Restricts external file access to ordinary UTF-8 text files inside the
 * configured project root. Files are only written by an explicit save call.
 */
export class ExternalFileService {
	async readTextFile(projectRoot: string, relativePath: string): Promise<ExternalTextFile> {
		try {
			const target = await this.resolveFile(projectRoot, relativePath);
			const content = await this.readContent(target.path);
			return { projectRoot: target.root, relativePath, ...content };
		} catch (error) {
			throw toFriendlyFileError(error, "read");
		}
	}

	async saveTextFile(file: ExternalTextFile, editorText: string): Promise<ExternalTextFile> {
		try {
			const target = await this.resolveFile(file.projectRoot, file.relativePath);
			const current = await this.readContent(target.path);
			if (current.contentHash !== file.contentHash) {
				throw new ExternalFileConflictError(
					"The file changed on disk after it was opened. Reload it before saving so no external changes are overwritten."
				);
			}

			const output = toOutputBuffer(editorText, file);
			if (output.byteLength > MAX_EXTERNAL_FILE_BYTES) {
				throw new ExternalFileError("The edited file is too large to save in this lightweight editor.");
			}

			await writeFile(target.path, output);
			const saved = await this.readContent(target.path);
			return { projectRoot: target.root, relativePath: file.relativePath, ...saved };
		} catch (error) {
			throw toFriendlyFileError(error, "save");
		}
	}

	private async resolveFile(projectRoot: string, relativePath: string): Promise<ResolvedExternalFile> {
		const requestedRoot = projectRoot.trim();
		if (!requestedRoot) {
			throw new ExternalFileError("Set a project root before opening a project file.");
		}
		if (!relativePath || relativePath.includes("\0") || isAbsolute(relativePath)) {
			throw new ExternalFileError("The requested file path is invalid.");
		}

		let root: string;
		try {
			root = await realpath(requestedRoot);
			if (!(await stat(root)).isDirectory()) {
				throw new ExternalFileError("The configured project root is not a folder.");
			}
		} catch (error) {
			if (error instanceof ExternalFileError) {
				throw error;
			}
			throw new ExternalFileError("The configured project root could not be opened.");
		}

		const candidate = resolve(root, relativePath);
		if (!isPathInside(root, candidate)) {
			throw new ExternalFileError("The requested file is outside the configured project root.");
		}

		const linkInfo = await lstat(candidate);
		if (linkInfo.isSymbolicLink()) {
			throw new ExternalFileError("Symbolic links are not opened by the external file editor.");
		}
		if (!linkInfo.isFile()) {
			throw new ExternalFileError("The requested path is not a regular file.");
		}

		const resolvedFile = await realpath(candidate);
		if (!isPathInside(root, resolvedFile)) {
			throw new ExternalFileError("The requested file resolves outside the configured project root.");
		}

		return { root, path: candidate };
	}

	private async readContent(path: string): Promise<FileContent> {
		const fileStats = await stat(path);
		if (!fileStats.isFile()) {
			throw new ExternalFileError("The requested path is not a regular file.");
		}
		if (fileStats.size > MAX_EXTERNAL_FILE_BYTES) {
			throw new ExternalFileError("The file is too large to open in this lightweight editor.");
		}

		const bytes = await readFile(path);
		if (bytes.includes(0)) {
			throw new ExternalFileError("Binary files are not supported by the external file editor.");
		}

		const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
		let text: string;
		try {
			text = new TextDecoder("utf-8", { fatal: true }).decode(hasBom ? bytes.subarray(3) : bytes);
		} catch {
			throw new ExternalFileError("Only UTF-8 text files can be opened in the external file editor.");
		}

		return {
			text,
			contentHash: createHash("sha256").update(bytes).digest("hex"),
			lineEnding: text.includes("\r\n") ? "\r\n" : "\n",
			hasBom,
		};
	}
}

function isPathInside(root: string, candidate: string): boolean {
	const relativePath = relative(root, candidate);
	return relativePath.length > 0
		&& relativePath !== ".."
		&& !relativePath.startsWith(`..${sep}`)
		&& !isAbsolute(relativePath);
}

function toOutputBuffer(editorText: string, file: ExternalTextFile): Buffer {
	const normalized = editorText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, file.lineEnding);
	const text = file.hasBom && !normalized.startsWith("\ufeff") ? `\ufeff${normalized}` : normalized;
	return Buffer.from(text, "utf8");
}

function toFriendlyFileError(error: unknown, action: "read" | "save"): Error {
	if (error instanceof ExternalFileError) {
		return error;
	}

	const code = typeof error === "object" && error && "code" in error
		? String((error as { code?: unknown }).code)
		: "";
	if (code === "ENOENT") {
		return new ExternalFileError("The file no longer exists. Refresh the Project Diff Review and choose it again.");
	}
	if (code === "EACCES" || code === "EPERM") {
		return new ExternalFileError(`Permission was denied while trying to ${action} this file.`);
	}
	if (code === "EISDIR") {
		return new ExternalFileError("The requested path is a folder, not a file.");
	}

	return new ExternalFileError(`Could not ${action} the external file.`);
}
