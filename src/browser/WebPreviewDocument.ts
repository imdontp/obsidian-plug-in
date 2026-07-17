export type ProjectFilePreviewKind = "text" | "web";

const WEB_PREVIEW_EXTENSIONS = [".htm", ".html"];
const WEB_PREVIEW_POLICY = [
	"base-uri 'none'",
	"connect-src 'none'",
	"default-src 'none'",
	"font-src data:",
	"form-action 'none'",
	"frame-src 'none'",
	"img-src data:",
	"media-src data:",
	"object-src 'none'",
	"script-src 'none'",
	"style-src 'unsafe-inline'",
].join("; ");

const DOCTYPE_PATTERN = /^\s*<!doctype[^>]*>/i;
const HTML_OPEN_TAG_PATTERN = /<html(?:\s[^>]*)?>/i;
const BODY_OPEN_TAG_PATTERN = /<body(?:\s[^>]*)?>/i;
const DOCUMENT_CONTAINER_TAG_PATTERN = /<\/?(?:html|head|body)\b[^>]*>/gi;
const META_REFRESH_TAG_PATTERN = /<meta\b(?=[^>]*\bhttp-equiv\s*=\s*(?:"refresh"|'refresh'|refresh\b))[^>]*>/gi;
const NAVIGATION_ATTRIBUTE_PATTERN = /(<(?:a|area)\b[^>]*?)\s(?:href|xlink:href)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+)/gi;

/** Returns the safest display mode supported by the selected file's extension. */
export function getProjectFilePreviewKind(relativePath: string): ProjectFilePreviewKind {
	const normalizedPath = relativePath.toLocaleLowerCase();
	return WEB_PREVIEW_EXTENSIONS.some((extension) => normalizedPath.endsWith(extension)) ? "web" : "text";
}

/**
 * Places an HTML snapshot inside a document shell whose CSP precedes all
 * selected-file content. The iframe using this document is separately sandboxed.
 * Navigation targets and refresh redirects are removed, while the CSP prevents
 * code execution and external/local resource loading.
 */
export function createSandboxedWebPreviewDocument(html: string): string {
	const securityMeta = `<meta http-equiv="Content-Security-Policy" content="${WEB_PREVIEW_POLICY}">`;
	const staticHtml = html
		.replace(META_REFRESH_TAG_PATTERN, "")
		.replace(NAVIGATION_ATTRIBUTE_PATTERN, "$1");
	const doctype = staticHtml.match(DOCTYPE_PATTERN)?.[0] ?? "<!doctype html>";
	const htmlOpenTag = staticHtml.match(HTML_OPEN_TAG_PATTERN)?.[0] ?? "<html>";
	const bodyOpenTag = staticHtml.match(BODY_OPEN_TAG_PATTERN)?.[0] ?? "<body>";
	const body = staticHtml
		.replace(DOCTYPE_PATTERN, "")
		.replace(DOCUMENT_CONTAINER_TAG_PATTERN, "");
	return `${doctype}${htmlOpenTag}<head>${securityMeta}</head>${bodyOpenTag}${body}</body></html>`;
}
