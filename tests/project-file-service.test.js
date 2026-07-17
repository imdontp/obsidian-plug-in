const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { buildSync } = require("esbuild");

async function main() {
	const testRoot = mkdtempSync(join(tmpdir(), "claude-codex-project-files-"));
	try {
		const bundlePath = join(testRoot, "ProjectFileService.cjs");
		buildSync({
			entryPoints: [join(process.cwd(), "src", "browser", "ProjectFileService.ts")],
			bundle: true,
			format: "cjs",
			outfile: bundlePath,
			platform: "node",
			logLevel: "silent",
		});

		const { ProjectFileService } = require(bundlePath);
		const projectRoot = join(testRoot, "project");
		mkdirSync(join(projectRoot, "docs"), { recursive: true });
		mkdirSync(join(projectRoot, "src"), { recursive: true });
		mkdirSync(join(projectRoot, ".git"), { recursive: true });
		mkdirSync(join(projectRoot, ".obsidian"), { recursive: true });
		mkdirSync(join(projectRoot, "node_modules", "example"), { recursive: true });
		writeFileSync(join(projectRoot, "docs", "readme.md"), "notes\n", "utf8");
		writeFileSync(join(projectRoot, "src", "app.ts"), "export {};\n", "utf8");
		writeFileSync(join(projectRoot, "untracked.txt"), "included\n", "utf8");
		writeFileSync(join(projectRoot, ".git", "HEAD"), "excluded\n", "utf8");
		writeFileSync(join(projectRoot, ".obsidian", "workspace.json"), "excluded\n", "utf8");
		writeFileSync(join(projectRoot, "node_modules", "example", "index.js"), "excluded\n", "utf8");
		const outsideRoot = join(testRoot, "outside");
		mkdirSync(outsideRoot, { recursive: true });
		writeFileSync(join(outsideRoot, "private.md"), "must not be listed\n", "utf8");
		try {
			symlinkSync(outsideRoot, join(projectRoot, "linked-outside"), process.platform === "win32" ? "junction" : "dir");
		} catch (error) {
			if (!error || error.code !== "EPERM") {
				throw error;
			}
		}

		const listing = await new ProjectFileService().listProjectFiles(projectRoot);
		assert.deepEqual(
			listing.files.map((file) => file.path),
			["docs/readme.md", "src/app.ts", "untracked.txt"]
		);
		assert.equal(listing.truncated, false);

		const capped = await new ProjectFileService(2).listProjectFiles(projectRoot);
		assert.equal(capped.files.length, 2);
		assert.equal(capped.truncated, true);

		await assert.rejects(
			() => new ProjectFileService().listProjectFiles(""),
			/Set a project root/
		);

		console.log("Project file service tests passed.");
	} finally {
		rmSync(testRoot, { recursive: true, force: true });
	}
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.stack : error);
	process.exitCode = 1;
});
