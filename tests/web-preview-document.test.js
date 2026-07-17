const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { buildSync } = require("esbuild");

function main() {
	const testRoot = mkdtempSync(join(tmpdir(), "claude-codex-web-preview-"));
	try {
		const bundlePath = join(testRoot, "WebPreviewDocument.cjs");
		buildSync({
			entryPoints: [join(process.cwd(), "src", "browser", "WebPreviewDocument.ts")],
			bundle: true,
			format: "cjs",
			outfile: bundlePath,
			platform: "node",
			logLevel: "silent",
		});

		const { createSandboxedWebPreviewDocument, getProjectFilePreviewKind } = require(bundlePath);
		assert.equal(getProjectFilePreviewKind("pages/index.html"), "web");
		assert.equal(getProjectFilePreviewKind("pages/ABOUT.HTM"), "web");
		assert.equal(getProjectFilePreviewKind("pages/readme.md"), "text");

		const withHead = createSandboxedWebPreviewDocument(
			"<!doctype html><img src=\"https://example.com/before-policy.png\"><html><head><style>h1 { color: red; }</style></head><body class=\"site\"><h1>Hello</h1><script>throw new Error()</script></body></html>"
		);
		assert.match(withHead, /<head><meta http-equiv="Content-Security-Policy"/i);
		assert.match(withHead, /default-src 'none'/);
		assert.match(withHead, /script-src 'none'/);
		assert.match(withHead, /connect-src 'none'/);
		assert.ok(withHead.indexOf("Content-Security-Policy") < withHead.indexOf("before-policy.png"));
		assert.match(withHead, /<body class="site">/i);
		assert.match(withHead, /<h1>Hello<\/h1>/);
		assert.doesNotMatch(withHead, /navigate-to/);

		const withoutNavigation = createSandboxedWebPreviewDocument(
			'<a href="https://example.com">External</a><area xlink:href="file:///private"><meta http-equiv="refresh" content="0; url=https://example.com">'
		);
		assert.doesNotMatch(withoutNavigation, /href=/i);
		assert.doesNotMatch(withoutNavigation, /http-equiv="refresh"/i);

		const withoutHead = createSandboxedWebPreviewDocument("<main>Preview</main>");
		assert.match(withoutHead, /^<!doctype html><html><head>/i);
		assert.match(withoutHead, /<main>Preview<\/main>/);

		console.log("Web preview document tests passed.");
	} finally {
		rmSync(testRoot, { recursive: true, force: true });
	}
}

main();
