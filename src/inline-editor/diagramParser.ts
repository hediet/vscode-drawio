/**
 * Parses Markdown content to find embedded draw.io diagram blocks.
 *
 * Supported formats:
 *
 * 1. Fenced code block:
 *    ```drawio
 *    <mxfile>...</mxfile>
 *    ```
 *
 * 2. HTML comment block:
 *    <!-- drawio:start -->
 *    <mxfile>...</mxfile>
 *    <!-- drawio:end -->
 *
 * Both formats support optional attributes after the language tag:
 *    ```drawio locked
 *    ```drawio height=400
 *    ```drawio locked height=400 width=600
 *    <!-- drawio:start locked -->
 *    <!-- drawio:start locked height=400 width=600 -->
 */

import * as zlib from "zlib";

export const FENCED_REGEX = /^(`{3,})drawio((?:\s+(?:locked|height=\d+|width=\d+))*)\s*\r?\n([\s\S]*?)^\1\s*$/gm;
export const COMMENT_REGEX = /^<!--\s*drawio:start((?:\s+(?:locked|height=\d+|width=\d+))*)\s*-->\s*\r?\n([\s\S]*?)^<!--\s*drawio:end\s*-->\s*$/gm;
export const MERMAID_REGEX = /^(`{3,})mermaid\s*\r?\n([\s\S]*?)^\1\s*$/gm;

export type BlockFormat = "fenced" | "comment";

export interface DiagramBlock {
	index: number;
	startLine: number;
	endLine: number;
	xml: string;
	locked: boolean;
	height: number | null;
	width: number | null;
	format: BlockFormat;
	fullMatch: string;
}

export interface MermaidBlock {
	index: number;
	startLine: number;
	endLine: number;
	source: string;
	fullMatch: string;
}

interface Range {
	start: number;
	end: number;
}

/**
 * Finds ranges of fenced code blocks that could contain nested diagram blocks.
 * Any fenced block whose language tag is NOT drawio or mermaid is treated as an
 * outer container — diagram/mermaid blocks found inside these ranges are skipped.
 */
function findOuterFenceRanges(text: string): Range[] {
	const ranges: Range[] = [];
	const outerFenceRegex = /^(`{3,}|~{3,})([^\n]*)\r?\n([\s\S]*?)^\1\s*$/gm;
	let match;
	while ((match = outerFenceRegex.exec(text)) !== null) {
		const lang = match[2].trim().split(/\s+/)[0] || "";
		if (lang === "drawio" || lang === "mermaid") { continue; }
		ranges.push({ start: match.index, end: match.index + match[0].length });
	}
	return ranges;
}

/**
 * Returns true if the given character offset falls inside any of the ranges.
 */
function isInsideRanges(offset: number, ranges: Range[]): boolean {
	for (const range of ranges) {
		if (offset > range.start && offset < range.end) { return true; }
	}
	return false;
}

/**
 * Builds a line offset lookup and returns a function to convert character
 * offsets to line numbers.
 */
function buildOffsetToLine(text: string): (charOffset: number) => number {
	const lines = text.split("\n");
	const lineOffsets: number[] = [];
	let offset = 0;
	for (const line of lines) {
		lineOffsets.push(offset);
		offset += line.length + 1;
	}

	return function offsetToLine(charOffset: number): number {
		for (let i = lineOffsets.length - 1; i >= 0; i--) {
			if (lineOffsets[i] <= charOffset) {
				return i;
			}
		}
		return 0;
	};
}

/**
 * Parses attribute flags from a match string (e.g. " locked height=400").
 */
function parseBlockAttrs(attrsStr: string): { locked: boolean; height: number | null; width: number | null } {
	const heightMatch = attrsStr.match(/\bheight=(\d+)/);
	const widthMatch = attrsStr.match(/\bwidth=(\d+)/);
	return {
		locked: /\blocked\b/.test(attrsStr),
		height: heightMatch ? Math.max(20, parseInt(heightMatch[1], 10)) : null,
		width: widthMatch ? Math.max(20, parseInt(widthMatch[1], 10)) : null,
	};
}

/**
 * Finds all draw.io diagram blocks in the given markdown text.
 */
export function findDiagramBlocks(text: string): DiagramBlock[] {
	const blocks: DiagramBlock[] = [];
	const offsetToLine = buildOffsetToLine(text);
	const outerRanges = findOuterFenceRanges(text);

	let match;

	// Find fenced code blocks
	FENCED_REGEX.lastIndex = 0;
	while ((match = FENCED_REGEX.exec(text)) !== null) {
		if (isInsideRanges(match.index, outerRanges)) { continue; }
		const attrs = parseBlockAttrs((match[2] || "").trim());
		blocks.push({
			index: match.index,
			startLine: offsetToLine(match.index),
			endLine: offsetToLine(match.index + match[0].length - 1),
			xml: match[3].trim(),
			locked: attrs.locked,
			height: attrs.height,
			width: attrs.width,
			format: "fenced",
			fullMatch: match[0],
		});
	}

	// Find HTML comment blocks
	COMMENT_REGEX.lastIndex = 0;
	while ((match = COMMENT_REGEX.exec(text)) !== null) {
		if (isInsideRanges(match.index, outerRanges)) { continue; }
		const attrs = parseBlockAttrs((match[1] || "").trim());
		blocks.push({
			index: match.index,
			startLine: offsetToLine(match.index),
			endLine: offsetToLine(match.index + match[0].length - 1),
			xml: match[2].trim(),
			locked: attrs.locked,
			height: attrs.height,
			width: attrs.width,
			format: "comment",
			fullMatch: match[0],
		});
	}

	blocks.sort((a, b) => a.index - b.index);
	return blocks;
}

/**
 * Rebuilds a diagram block string from its components.
 */
export function buildDiagramBlock(
	xml: string,
	format: BlockFormat,
	locked: boolean,
	height?: number | null,
	width?: number | null
): string {
	let attrs = "";
	if (locked) { attrs += " locked"; }
	if (height != null && height >= 20) { attrs += " height=" + height; }
	if (width != null && width >= 20) { attrs += " width=" + width; }

	if (format === "fenced") {
		return "```drawio" + attrs + "\n" + xml + "\n```";
	} else {
		return "<!-- drawio:start" + attrs + " -->\n" + xml + "\n<!-- drawio:end -->";
	}
}

/**
 * Replaces a diagram block in the markdown text with updated XML.
 */
export function replaceDiagramBlock(
	text: string,
	block: DiagramBlock,
	newXml: string,
	locked?: boolean,
	height?: number | null,
	width?: number | null
): string {
	const newLocked = locked !== undefined ? locked : block.locked;
	const newHeight = height !== undefined ? height : block.height;
	const newWidth = width !== undefined ? width : block.width;
	const replacement = buildDiagramBlock(newXml, block.format, newLocked, newHeight, newWidth);
	return text.substring(0, block.index) + replacement + text.substring(block.index + block.fullMatch.length);
}

/**
 * Creates a minimal empty diagram XML.
 */
export function createEmptyDiagram(): string {
	return '<mxfile>\n  <diagram id="default" name="Page-1">\n    <mxGraphModel>\n      <root>\n        <mxCell id="0"/>\n        <mxCell id="1" parent="0"/>\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>';
}

/**
 * Finds all mermaid code blocks in the given markdown text.
 */
export function findMermaidBlocks(text: string): MermaidBlock[] {
	const blocks: MermaidBlock[] = [];
	const offsetToLine = buildOffsetToLine(text);
	const outerRanges = findOuterFenceRanges(text);

	let match;
	MERMAID_REGEX.lastIndex = 0;
	while ((match = MERMAID_REGEX.exec(text)) !== null) {
		if (isInsideRanges(match.index, outerRanges)) { continue; }
		blocks.push({
			index: match.index,
			startLine: offsetToLine(match.index),
			endLine: offsetToLine(match.index + match[0].length - 1),
			source: match[2].trim(),
			fullMatch: match[0],
		});
	}

	return blocks;
}

/**
 * Replaces a mermaid block with a drawio diagram block.
 */
export function replaceMermaidBlock(
	text: string,
	block: MermaidBlock,
	xml: string,
	format?: BlockFormat,
	height?: number | null,
	width?: number | null
): string {
	const replacement = buildDiagramBlock(xml, format || "fenced", false, height, width);
	return text.substring(0, block.index) + replacement + text.substring(block.index + block.fullMatch.length);
}

/**
 * Returns true if the given XML represents a blank/empty diagram
 * (only the two root mxCell elements, no actual shapes).
 */
export function isBlankDiagram(xml: string): boolean {
	if (!xml) { return true; }
	const cells = xml.match(/<mxCell\b/g);
	return !cells || cells.length <= 2;
}

/**
 * A Markdown image link to an editable draw.io image file, e.g.
 *
 *     ![alt](diagrams/foo.drawio.svg)
 *     ![alt](diagrams/foo.drawio.png)
 *
 * A `.drawio.svg` carries the diagram XML in its root `<svg content="...">`
 * attribute; a `.drawio.png` carries it in a `tEXt`/`zTXt` "mxfile" chunk. Either
 * can be opened and edited inline like a codeblock and written back to the file.
 */
export interface ImageLink {
	index: number;
	startLine: number;
	endLine: number;
	alt: string;
	/** The raw link target as written in the markdown (may be relative or a URL). */
	target: string;
	fullMatch: string;
}

// Matches `![alt](target)` where target ends in `.drawio.svg` or `.drawio.png`
// (optionally with a title or #fragment/?query). Title syntax `![alt](target
// "title")` is tolerated.
const DRAWIO_IMAGE_REGEX = /!\[([^\]]*)\]\(\s*<?([^)\s>]+?\.drawio\.(?:svg|png))>?(?:[?#][^)\s]*)?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;

/** Returns true if the link target points at a `.drawio.png` (vs `.drawio.svg`). */
export function isPngLinkTarget(target: string): boolean {
	return /\.drawio\.png(?:[?#].*)?$/i.test(target);
}

/**
 * Finds all `![alt](*.drawio.svg)` / `![alt](*.drawio.png)` image links in the
 * given markdown text. Links inside drawio/other code blocks are skipped (so an
 * example link in a fenced block isn't treated as editable).
 */
export function findDiagramImageLinks(text: string): ImageLink[] {
	const links: ImageLink[] = [];
	const offsetToLine = buildOffsetToLine(text);
	const outerRanges = findOuterFenceRanges(text);
	const drawioBlocks = findDiagramBlocks(text).map((b) => ({ start: b.index, end: b.index + b.fullMatch.length }));

	let match;
	DRAWIO_IMAGE_REGEX.lastIndex = 0;
	while ((match = DRAWIO_IMAGE_REGEX.exec(text)) !== null) {
		if (isInsideRanges(match.index, outerRanges) || isInsideRanges(match.index, drawioBlocks)) { continue; }
		links.push({
			index: match.index,
			startLine: offsetToLine(match.index),
			endLine: offsetToLine(match.index + match[0].length - 1),
			alt: match[1],
			target: match[2],
			fullMatch: match[0],
		});
	}

	return links;
}

/**
 * Returns true if the given image link target points at a local file (not an
 * http(s)/data URL).
 */
export function isLocalLinkTarget(target: string): boolean {
	return !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith("//");
}

/**
 * Extracts the diagram XML embedded in an editable draw.io SVG (the `content`
 * attribute of the root <svg> element). Returns null if not an editable SVG.
 *
 * draw.io HTML-encodes the XML in the attribute; this decodes the entities the
 * exporter uses (&lt; &gt; &amp; &quot; &#10; &#xa; etc.).
 */
export function extractDiagramXmlFromSvg(svg: string): string | null {
	if (!svg) { return null; }
	const match = svg.match(/<svg[^>]*\scontent="([\s\S]*?)"/i);
	if (!match) { return null; }
	const xml = decodeXmlEntities(match[1]).trim();
	if (!xml) { return null; }
	return inflateDiagramXml(xml);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Extracts the diagram XML embedded in an editable draw.io PNG. draw.io stores
 * it in a `tEXt` chunk (keyword "mxfile", value `encodeURIComponent(xml)`) or, in
 * older files, a zlib-compressed `zTXt` chunk (keyword "mxfile"/"mxGraphModel").
 * Returns null if the PNG carries no draw.io diagram. The returned XML is raw
 * (compressed <diagram> bodies are inflated), matching extractDiagramXmlFromSvg.
 */
export function extractDiagramXmlFromPng(buf: Buffer): string | null {
	if (!buf || buf.length < 8) { return null; }
	for (let i = 0; i < 8; i++) { if (buf[i] !== PNG_SIGNATURE[i]) { return null; } }

	let off = 8;
	while (off + 12 <= buf.length) {
		const len = buf.readUInt32BE(off);
		const type = buf.toString("latin1", off + 4, off + 8);
		const dataStart = off + 8;
		const dataEnd = dataStart + len;
		if (dataEnd + 4 > buf.length) { break; }

		if (type === "tEXt" || type === "zTXt") {
			const data = buf.subarray(dataStart, dataEnd);
			const nul = data.indexOf(0);
			if (nul > 0) {
				const keyword = data.toString("latin1", 0, nul);
				if (keyword === "mxfile" || keyword === "mxGraphModel") {
					let text: string | null = null;
					try {
						if (type === "tEXt") {
							text = data.toString("latin1", nul + 1);
						} else {
							// zTXt: keyword \0 <compression-method byte> <zlib data>
							const comp = data.subarray(nul + 2);
							try { text = zlib.inflateSync(comp).toString("latin1"); }
							catch (e) { text = zlib.inflateRawSync(comp).toString("latin1"); }
						}
					} catch (e) { text = null; }

					if (text != null) {
						// Mirror draw.io's Editor.extractGraphModelFromPng: only the zTXt
						// path applies the URLEncoder '+'->space workaround; both paths
						// percent-decode ONLY when the value is actually percent-encoded
						// (and twice for double-encoded values). A raw/verbatim tEXt XML
						// payload — including a literal '+' — is therefore preserved.
						let xml = (type === "zTXt") ? text.replace(/\+/g, " ") : text;
						try { if (xml.charAt(0) === "%") { xml = decodeURIComponent(xml); } } catch (e) { /* keep */ }
						try { if (xml.charAt(0) === "%") { xml = decodeURIComponent(xml); } } catch (e) { /* keep */ }
						xml = xml.trim();
						if (xml) { return inflateDiagramXml(xml); }
					}
				}
			}
		}

		if (type === "IEND") { break; }
		off = dataEnd + 4; // skip the 4-byte CRC
	}
	return null;
}

/**
 * draw.io compresses each <diagram> body (base64 of a raw-DEFLATE of the
 * URL-encoded mxGraphModel) by default when it saves .drawio / .drawio.svg
 * files, so most real-world linked files are compressed. The rest of the
 * inline-editor pipeline — the blank/bounds heuristics, the preview renderer,
 * and codeblock diagrams — all assume raw, uncompressed XML, so we inflate
 * every compressed <diagram> body back to a raw <mxGraphModel> here. Bodies
 * that are already raw (start with "<"), empty, or that fail to inflate are
 * left untouched, so uncompressed files and codeblock-style XML still work.
 */
export function inflateDiagramXml(xml: string): string {
	// The open-tag scan skips over quoted attribute values so a literal '>' inside
	// an attribute (e.g. a page named "Step 1 -> Step 2", which draw.io serializes
	// unescaped) cannot terminate the tag early and leave the body compressed.
	return xml.replace(
		/(<diagram\b(?:[^>"']|"[^"]*"|'[^']*')*>)([\s\S]*?)(<\/diagram>)/gi,
		(full: string, open: string, body: string, close: string) => {
			const data = body.trim();
			if (!data || data.charAt(0) === "<") { return full; }
			const raw = inflateDrawioPayload(data);
			return raw != null ? open + raw + close : full;
		}
	);
}

/**
 * Reverses draw.io's Graph.compress: base64-decode → raw-inflate → URL-decode.
 * Returns null if the data is not a valid compressed draw.io payload.
 */
function inflateDrawioPayload(data: string): string | null {
	try {
		const inflated = zlib.inflateRawSync(Buffer.from(data, "base64")).toString("utf8");
		return decodeURIComponent(inflated);
	} catch (e) {
		return null;
	}
}

function decodeXmlEntities(s: string): string {
	return s
		.replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
}
