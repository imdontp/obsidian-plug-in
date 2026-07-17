const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { buildSync } = require("esbuild");

async function main() {
	const testRoot = mkdtempSync(join(tmpdir(), "claude-codex-external-file-"));
	try {
		const bundlePath = join(testRoot, "ExternalFileService.cjs");
		buildSync({
			entryPoints: [join(process.cwd(), "src", "editor", "ExternalFileService.ts")],
			bundle: true,
			format: "cjs",
			outfile: bundlePath,
			platform: "node",
			logLevel: "silent",
		});

		const {
			ExternalFileConflictError,
			ExternalFileService,
			MAX_EXTERNAL_FILE_BYTES,
		} = require(bundlePath);
		const projectRoot = join(testRoot, "project");
		const sourceDir = join(projectRoot, "src");
		const sourcePath = join(sourceDir, "example.ts");
		mkdirSync(sourceDir, { recursive: true });

		const bom = Buffer.from([0xef, 0xbb, 0xbf]);
		writeFileSync(sourcePath, Buffer.concat([bom, Buffer.from("first\r\nsecond\r\n", "utf8")]));

		const service = new ExternalFileService();
		const opened = await service.readTextFile(projectRoot, "src/example.ts");
		assert.equal(opened.text, "first\r\nsecond\r\n");
		assert.equal(opened.lineEnding, "\r\n");
		assert.equal(opened.hasBom, true);

		const saved = await service.saveTextFile(opened, "first\nupdated\n");
		assert.equal(saved.text, "first\r\nupdated\r\n");
		assert.deepEqual(
			readFileSync(sourcePath),
			Buffer.concat([bom, Buffer.from("first\r\nupdated\r\n", "utf8")])
		);

		const conflictSnapshot = await service.readTextFile(projectRoot, "src/example.ts");
		writeFileSync(sourcePath, "changed elsewhere\n", "utf8");
		await assert.rejects(
			() => service.saveTextFile(conflictSnapshot, "my local edit\n"),
			(error) => error instanceof ExternalFileConflictError
		);
		assert.equal(readFileSync(sourcePath, "utf8"), "changed elsewhere\n");

		await assert.rejects(
			() => service.readTextFile(projectRoot, "../outside.txt"),
			/outside the configured project root/
		);

		const binaryPath = join(sourceDir, "binary.bin");
		writeFileSync(binaryPath, Buffer.from([0x61, 0x00, 0x62]));
		await assert.rejects(
			() => service.readTextFile(projectRoot, "src/binary.bin"),
			/Binary files are not supported/
		);

		const largePath = join(sourceDir, "large.txt");
		writeFileSync(largePath, Buffer.alloc(MAX_EXTERNAL_FILE_BYTES + 1, 0x61));
		await assert.rejects(
			() => service.readTextFile(projectRoot, "src/large.txt"),
			/too large to open/
		);

		console.log("External file service tests passed.");
	} finally {
		rmSync(testRoot, { recursive: true, force: true });
	}
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.stack : error);
	process.exitCode = 1;
});
