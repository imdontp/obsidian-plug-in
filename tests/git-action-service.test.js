const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { buildSync } = require("esbuild");

function git(projectRoot, args) {
	return execFileSync("git", ["-C", projectRoot, ...args], { encoding: "utf8" });
}

async function main() {
	const testRoot = mkdtempSync(join(tmpdir(), "claude-codex-git-actions-"));
	try {
		const bundlePath = join(testRoot, "GitActionService.cjs");
		buildSync({
			entryPoints: [join(process.cwd(), "src", "diff", "GitActionService.ts")],
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
		writeFileSync(trackedPath, "before\n", "utf8");
		git(projectRoot, ["add", "tracked.txt"]);
		git(projectRoot, ["commit", "-qm", "initial"]);

		const { GitActionService } = require(bundlePath);
		const service = new GitActionService();
		await assert.rejects(
			() => service.commitStagedChanges(projectRoot, "nothing to commit"),
			/No staged changes/
		);

		writeFileSync(trackedPath, "changed\n", "utf8");
		await service.stageFile(projectRoot, "tracked.txt");
		assert.equal(git(projectRoot, ["diff", "--cached", "--name-only"]), "tracked.txt\n");

		await service.unstageFile(projectRoot, "tracked.txt");
		assert.equal(git(projectRoot, ["diff", "--cached", "--name-only"]), "");

		await service.stageFile(projectRoot, "tracked.txt");
		writeFileSync(join(projectRoot, "new file.txt"), "new\n", "utf8");
		await service.stageFile(projectRoot, "new file.txt");
		const commitId = await service.commitStagedChanges(projectRoot, "add guarded changes");
		assert.match(commitId, /^[0-9a-f]+$/);
		assert.equal(git(projectRoot, ["log", "-1", "--format=%s"]), "add guarded changes\n");
		assert.equal(git(projectRoot, ["status", "--porcelain"]), "");

		await assert.rejects(
			() => service.stageFile(projectRoot, "../outside.txt"),
			/outside the configured project root/
		);
		mkdirSync(join(projectRoot, "untracked-folder"), { recursive: true });
		writeFileSync(join(projectRoot, "untracked-folder", "file.txt"), "not staged as a folder\n", "utf8");
		await assert.rejects(
			() => service.stageFile(projectRoot, "untracked-folder"),
			/individual file/
		);
		const outsideRoot = join(testRoot, "outside");
		mkdirSync(outsideRoot, { recursive: true });
		writeFileSync(join(outsideRoot, "outside.txt"), "must remain outside\n", "utf8");
		let linkedOutside = false;
		try {
			symlinkSync(outsideRoot, join(projectRoot, "linked-outside"), process.platform === "win32" ? "junction" : "dir");
			linkedOutside = true;
		} catch (error) {
			if (!error || error.code !== "EPERM") {
				throw error;
			}
		}
		if (linkedOutside) {
			await assert.rejects(
				() => service.stageFile(projectRoot, "linked-outside/outside.txt"),
				/resolves outside the configured project root/
			);
		}
		await assert.rejects(
			() => service.commitStagedChanges(projectRoot, "   "),
			/commit message/
		);

		console.log("Git action service tests passed.");
	} finally {
		rmSync(testRoot, { recursive: true, force: true });
	}
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.stack : error);
	process.exitCode = 1;
});
