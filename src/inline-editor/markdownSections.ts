/**
 * Text sections of the "Markdown with Diagrams" editor.
 *
 * Every top-level Markdown block (paragraph, heading, list, quote, code block,
 * table, ...) becomes one section that maps to an exact range of source lines.
 * The webview shows the rendered block and, while the block has the focus, its
 * Markdown source. An edit replaces exactly the lines of that block, so text
 * the user didn't touch is never rewritten.
 *
 * Rendering uses markdown-it (CommonMark with tables and strikethrough), the
 * renderer of VS Code's Markdown preview. Raw HTML is shown as text.
 *
 * No VS Code dependency, so this can be unit tested.
 */
import MarkdownIt = require("markdown-it");

export interface TextSection {
	type: "text";
	startLine: number;
	endLine: number;
	/** The source lines of the section, joined with "\n". */
	markdown: string;
	html: string;
}

/** Shared by all sections of one document (link references, image folder). */
export interface RenderEnv {
	/** Webview URI of the document's folder; relative images resolve against it. */
	imageBaseUri?: string;
	references?: Record<string, unknown>;
}

const md = new MarkdownIt({ html: false, linkify: true });
// Link only URLs with a scheme, as VS Code's preview does: "draw.io" or
// "notes.md" in a sentence stay text
md.linkify.set({ fuzzyLink: false });

function isRelativeUrl(url: string): boolean {
	return !/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^[/#]/.test(url);
}

const defaultImageRule = md.renderer.rules.image!;
md.renderer.rules.image = (tokens, idx, options, env: RenderEnv, self) => {
	const token = tokens[idx];
	const src = token.attrGet("src");
	if (src && env.imageBaseUri && isRelativeUrl(src)) {
		token.attrSet("src", env.imageBaseUri + "/" + src);
	}
	return defaultImageRule(tokens, idx, options, env, self);
};

/** Shows `- [ ]` / `- [x]` list items as (read-only) check boxes. */
function renderTaskLists(html: string): string {
	return html.replace(
		/<li>(\s*<p>)?\[([ xX])\]\s/g,
		(_m, p: string | undefined, mark: string) =>
			`<li class="task-list-item">${p || ""}<input type="checkbox" disabled${mark === " " ? "" : " checked"}> `
	);
}

function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Splits text into lines without line terminators. */
export function splitLines(text: string): string[] {
	return text.split("\n").map((l) => l.replace(/\r$/, ""));
}

/**
 * Creates the render environment of a document: collects its link reference
 * definitions, so `[text][ref]` resolves in every section.
 */
export function createRenderEnv(text: string, imageBaseUri?: string): RenderEnv {
	const env: RenderEnv = { imageBaseUri };
	md.parse(text, env);
	return env;
}

/** Renders a Markdown snippet with the document's environment. */
export function renderMarkdown(markdown: string, env: RenderEnv): string {
	return renderTaskLists(md.render(markdown, env));
}

/**
 * The text sections of lines [fromLine, toLine] (the text between two diagram
 * blocks), one per top-level Markdown block. Blank lines and link reference
 * definitions between blocks belong to no section.
 */
export function buildTextSections(
	lines: string[],
	fromLine: number,
	toLine: number,
	env: RenderEnv
): TextSection[] {
	const sections: TextSection[] = [];
	if (toLine < fromLine) {
		return sections;
	}

	// YAML front matter at the start of the document is shown as source, not
	// as a rule and a heading.
	if (fromLine === 0 && lines[0] === "---") {
		let close = 1;
		while (close <= toLine && lines[close] !== "---" && lines[close] !== "...") {
			close++;
		}
		if (close <= toLine) {
			const markdown = lines.slice(0, close + 1).join("\n");
			sections.push({
				type: "text",
				startLine: 0,
				endLine: close,
				markdown,
				html: `<pre class="front-matter"><code>${escapeHtml(markdown)}</code></pre>`,
			});
			fromLine = close + 1;
		}
	}

	const tokens = md.parse(lines.slice(fromLine, toLine + 1).join("\n"), env);
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token.level !== 0 || token.nesting === -1 || !token.map) {
			continue;
		}
		// The block's tokens run from its open token to the matching close
		let end = i;
		if (token.nesting === 1) {
			let depth = 0;
			for (end = i; end < tokens.length; end++) {
				depth += tokens[end].nesting;
				if (depth === 0) {
					break;
				}
			}
		}

		const startLine = fromLine + token.map[0];
		let endLine = fromLine + token.map[1] - 1;
		while (endLine > startLine && lines[endLine].trim() === "") {
			endLine--;
		}
		sections.push({
			type: "text",
			startLine,
			endLine,
			markdown: lines.slice(startLine, endLine + 1).join("\n"),
			html: renderTaskLists(md.renderer.render(tokens.slice(i, end + 1), md.options, env)),
		});
		i = end;
	}
	return sections;
}

/**
 * The line at which `expected` starts in `lines`: `hint` if it is there,
 * otherwise the nearest occurrence, or -1 if there is none. Lets an edit find
 * its block again after lines above it were added or removed.
 */
export function locateLines(lines: string[], hint: number, expected: string[]): number {
	const matchesAt = (start: number): boolean => {
		if (start < 0 || start + expected.length > lines.length) {
			return false;
		}
		for (let i = 0; i < expected.length; i++) {
			if (lines[start + i] !== expected[i]) {
				return false;
			}
		}
		return true;
	};

	if (matchesAt(hint)) {
		return hint;
	}
	for (let distance = 1; distance < lines.length; distance++) {
		if (matchesAt(hint - distance)) {
			return hint - distance;
		}
		if (matchesAt(hint + distance)) {
			return hint + distance;
		}
	}
	return -1;
}
