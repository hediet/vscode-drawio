/**
 * markdown-it plugin that renders ```drawio fenced code blocks
 * as placeholder divs with base64-encoded XML.
 *
 * The XML is base64-encoded to survive VS Code's markdown preview
 * HTML sanitizer (which would otherwise entity-encode the < and >
 * inside the data attribute, corrupting the XML).
 *
 * previewInit.js decodes the base64 and sets up the proper
 * data-mxgraph attribute before the viewer processes the elements.
 *
 * Two mechanisms are used for maximum compatibility:
 *
 * 1. **Fence rule override**: Replaces `<pre><code>` with a `<div>`
 *    carrying base64-encoded XML + width/locked metadata. This is the
 *    preferred path (handled by processPluginBlocks in previewInit.js).
 *
 * 2. **Core rule fallback**: Injects `drawio-w-{N}` / `locked` CSS
 *    classes directly onto the fence token. Even if VS Code or another
 *    extension overrides our fence renderer, the default renderer will
 *    emit `<code class="language-drawio drawio-w-838 locked">`, and
 *    processFencedBlocks() can read these classes.
 */

// markdown-it types are not available in this project, so we use
// minimal structural types for the parts of the API we need.

interface MarkdownItToken {
	type: string;
	info: string;
	content: string;
	map: [number, number] | null;
	attrJoin(name: string, value: string): void;
}

interface MarkdownItState {
	tokens: MarkdownItToken[];
}

type FenceRenderer = (
	tokens: MarkdownItToken[],
	idx: number,
	options: unknown,
	env: Record<string, unknown>,
	self: { renderToken(tokens: MarkdownItToken[], idx: number, options: unknown): string }
) => string;

interface MarkdownIt {
	core: { ruler: { push(name: string, fn: (state: MarkdownItState) => void): void } };
	renderer: { rules: { fence?: FenceRenderer } };
	use(plugin: (md: MarkdownIt) => MarkdownIt): MarkdownIt;
}

function toBase64(str: string): string {
	// Use Buffer in Node.js, btoa in web workers
	if (typeof Buffer !== "undefined") {
		return Buffer.from(str, "utf-8").toString("base64");
	}
	// btoa only handles Latin-1; use TextEncoder for full UTF-8 support
	const bytes = new TextEncoder().encode(str);
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

export default function markdownItDrawio(md: MarkdownIt): MarkdownIt {
	// -----------------------------------------------------------------------
	// Core rule: inject width/locked classes onto drawio fence tokens.
	// This runs before any renderer and survives fence-rule overrides.
	// -----------------------------------------------------------------------
	md.core.ruler.push("drawio_attrs", function (state: MarkdownItState) {
		for (let i = 0; i < state.tokens.length; i++) {
			const token = state.tokens[i];
			if (token.type !== "fence") { continue; }

			const info = token.info.trim();
			if (!/^drawio(\s|$)/.test(info)) { continue; }

			const widthMatch = info.match(/\bwidth=(\d+)/);
			if (widthMatch) {
				token.attrJoin("class", "drawio-w-" + widthMatch[1]);
			}

			if (/\blocked\b/.test(info)) {
				token.attrJoin("class", "drawio-locked");
			}
		}
	});

	// -----------------------------------------------------------------------
	// Fence rule override: preferred path that emits a <div> with base64 XML.
	// -----------------------------------------------------------------------
	const defaultFence = md.renderer.rules.fence;

	md.renderer.rules.fence = function (tokens, idx, options, env, self) {
		const token = tokens[idx];
		const info = token.info.trim();

		if (/^drawio(\s|$)/.test(info)) {
			const xml = token.content.trim();
			const xmlBase64 = toBase64(xml);
			const isLocked = /\blocked\b/.test(info);
			const widthMatch = info.match(/\bwidth=(\d+)/);
			const line = token.map ? token.map[0] : "";

			// env.currentDocument is the file URI set by VS Code's markdown engine.
			// We pass it through so the preview edit button can include it in the
			// vscode:// URI, letting the handler open the exact file.
			let docAttr = "";
			if (env && env.currentDocument) {
				const uri = typeof env.currentDocument === "string"
					? env.currentDocument
					: String(env.currentDocument);
				docAttr = ` data-doc-uri="${encodeURIComponent(uri)}"`;
			}

			const widthClass = widthMatch ? " drawio-w-" + widthMatch[1] : "";

			return `<div class="drawio-diagram${widthClass}" data-drawio-xml="${xmlBase64}" data-line="${line}"${docAttr}${isLocked ? ' data-locked="true"' : ""}></div>\n`;
		}

		if (defaultFence) {
			return defaultFence(tokens, idx, options, env, self);
		}
		return self.renderToken(tokens, idx, options);
	};

	return md;
}
