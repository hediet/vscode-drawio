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
