const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { buildSync } = require("esbuild");

function git(projectRoot, args) {
	return execFileSync("git", ["-C", projectRoot, ...args], { encoding: "utf8" });
}

async function main() {
	const testRoot = mkdtempSync(join(tmpdir(), "claude-codex-git-diff-"));
	try {
		const bundlePath = join(testRoot, "GitDiffService.cjs");
		buildSync({
			entryPoints: [join(process.cwd(), "src", "diff", "GitDiffService.ts")],
			bundle: true,
			format: "cjs",
			outfile: bundlePath,
			platform: "node",
			logLevel: "silent",
		});

		const projectRoot = join(testRoot, "project");
		git(testRoot, ["init", "-q", "project"]);
		git(projectRoot, ["config", "user.email", "test@example.invalid"]);
		git(projectRoot, ["config", "user.name", "Test User"]);
		git(projectRoot, ["config", "core.autocrlf", "false"]);

		const trackedPath = join(projectRoot, "tracked.txt");
		const renameFromPath = join(projectRoot, "rename-from.txt");
		writeFileSync(trackedPath, "before\n", "utf8");
		writeFileSync(renameFromPath, "rename me\n", "utf8");
		git(projectRoot, ["add", "tracked.txt", "rename-from.txt"]);
		git(projectRoot, ["commit", "-qm", "initial"]);

		writeFileSync(trackedPath, "staged change\n", "utf8");
		git(projectRoot, ["add", "tracked.txt"]);
		writeFileSync(trackedPath, "working copy change\n", "utf8");
		git(projectRoot, ["mv", "rename-from.txt", "renamed.txt"]);
		writeFileSync(join(projectRoot, "untracked file.txt"), "not shown\n", "utf8");

		const { GitDiffService } = require(bundlePath);
		const diff = await new GitDiffService().readProjectDiff(projectRoot);
		assert.equal(diff.filesChanged, 2);
		assert.deepEqual(diff.files, [
			{ path: "renamed.txt", status: "R100" },
			{ path: "tracked.txt", status: "M" },
		]);
		assert.match(diff.text, /working copy change/);
		assert.equal(diff.untrackedFiles, 1);
		assert.equal(diff.statusFiles.length, 3);

		const trackedStatus = diff.statusFiles.find((file) => file.path === "tracked.txt");
		assert.deepEqual(
			[trackedStatus.indexStatus, trackedStatus.workTreeStatus, trackedStatus.originalPath ?? null],
			["M", "M", null]
		);

		const renameStatus = diff.statusFiles.find((file) => file.path === "renamed.txt");
		assert.deepEqual(
			[renameStatus.indexStatus, renameStatus.workTreeStatus, renameStatus.originalPath],
			["R", " ", "rename-from.txt"]
		);

		const untrackedStatus = diff.statusFiles.find((file) => file.path === "untracked file.txt");
		assert.deepEqual(
			[untrackedStatus.indexStatus, untrackedStatus.workTreeStatus, untrackedStatus.originalPath ?? null],
			["?", "?", null]
		);

		console.log("Git diff service tests passed.");
	} finally {
		rmSync(testRoot, { recursive: true, force: true });
	}
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.stack : error);
	process.exitCode = 1;
});
