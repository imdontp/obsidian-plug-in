import { lstat, readdir, realpath, stat } from "fs/promises";
import { isAbsolute, join, relative, sep } from "path";

export const MAX_PROJECT_FILE_COUNT = 5_000;

const EXCLUDED_DIRECTORY_NAMES = new Set([".git", ".obsidian", "node_modules"]);

export interface ProjectFile {
	path: string;
	size: number;
}

export interface ProjectFileListing {
	root: string;
	files: ProjectFile[];
	truncated: boolean;
}

export class ProjectFileError extends Error {}

/**
 * Lists regular files below a project root without reading their contents.
 * Git metadata, Obsidian's internal folder, dependency trees, and symbolic
 * links are excluded so the browser remains focused and bounded.
 */
export class ProjectFileService {
	private readonly maxFiles: number;

	constructor(maxFiles = MAX_PROJECT_FILE_COUNT) {
		this.maxFiles = Math.max(1, Math.floor(maxFiles));
	}

	async listProjectFiles(projectRoot: string): Promise<ProjectFileListing> {
		const root = await resolveProjectDirectory(projectRoot);
		const files: ProjectFile[] = [];
		let truncated = false;

		const visit = async (directory: string): Promise<void> => {
			let entries;
			try {
				entries = await readdir(directory, { withFileTypes: true });
			} catch {
				// A child directory can disappear or become inaccessible while the
				// user is working. Keep the remaining browser results usable.
				return;
			}

			entries.sort((left, right) => left.name.localeCompare(right.name));
			for (const entry of entries) {
				if (files.length >= this.maxFiles) {
					truncated = true;
					return;
				}

				if (entry.isSymbolicLink()) {
					continue;
				}

				const fullPath = join(directory, entry.name);
				if (entry.isDirectory()) {
					if (!EXCLUDED_DIRECTORY_NAMES.has(entry.name) && await isSafeChildDirectory(root, fullPath)) {
						await visit(fullPath);
					}
					if (truncated) {
						return;
					}
					continue;
				}

				if (!entry.isFile()) {
					continue;
				}

				try {
					const info = await lstat(fullPath);
					if (!info.isFile() || info.isSymbolicLink()) {
						continue;
					}
					const resolvedPath = await realpath(fullPath);
					if (!isPathInside(root, resolvedPath)) {
						continue;
					}
					const path = toRelativePath(root, fullPath);
					if (path) {
						files.push({ path, size: info.size });
					}
				} catch {
					// Files can be removed between readdir and lstat. Ignore only the
					// unavailable entry rather than failing the entire listing.
				}
			}
		};

		await visit(root);
		return { root, files, truncated };
	}
}

async function isSafeChildDirectory(root: string, path: string): Promise<boolean> {
	try {
		const info = await lstat(path);
		if (!info.isDirectory() || info.isSymbolicLink()) {
			return false;
		}
		return isPathInside(root, await realpath(path));
	} catch {
		return false;
	}
}

async function resolveProjectDirectory(projectRoot: string): Promise<string> {
	const requestedRoot = projectRoot.trim();
	if (!requestedRoot) {
		throw new ProjectFileError("Set a project root before browsing project files.");
	}

	try {
		const root = await realpath(requestedRoot);
		if (!(await stat(root)).isDirectory()) {
			throw new ProjectFileError("The configured project root is not a folder.");
		}
		return root;
	} catch (error) {
		if (error instanceof ProjectFileError) {
			throw error;
		}
		throw new ProjectFileError("The configured project root could not be opened.");
	}
}

function toRelativePath(root: string, fullPath: string): string | null {
	const path = relative(root, fullPath);
	if (!path || !isPathInside(root, fullPath)) {
		return null;
	}
	return path.split(sep).join("/");
}

function isPathInside(root: string, candidate: string): boolean {
	const path = relative(root, candidate);
	return path.length > 0 && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
