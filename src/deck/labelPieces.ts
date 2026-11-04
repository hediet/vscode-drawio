/**
 * The pieces of a label for LanguageTool, as the editor plugin `language-check.plugin.js` reads
 * the label being edited: its words as text, its tags as markup, the items of a list and the
 * lines of a label as paragraphs, and a formula between `\(` and `\)` or `$$` as markup that
 * reads as a noun, so its TeX is not checked. A new line in the text is a line break, as the
 * editor shows it, unless the label is HTML whose style holds `nl2Br=0`.
 *
 * A label of HTML is split into its tags and its text as Python's `html.parser` splits it, with
 * the references of characters in the text read: a start tag keeps its text as written, an end
 * tag is written with its name in lower case, a comment, a declaration and a processing
 * instruction are left out, and the text of `script` and `style` is read as it stands, and left
 * out when the label ends before its end tag.
 */
import { decodeHTML } from "entities";

/** A piece of a label: a run of text, or markup with the text that it reads as. */
export type LabelPiece =
	| { readonly text: string }
	| { readonly markup: string; readonly interpretAs: string };

const FORMULA = /\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$/g;
/** The tags that start a paragraph, which LanguageTool reads as a blank line. */
const BLOCKS = new Set([
	"div",
	"p",
	"li",
	"ul",
	"ol",
	"br",
	"table",
	"tr",
	"td",
	"h1",
	"h2",
	"h3",
]);
const LINE_BREAK = { markup: "\n", interpretAs: "\n\n" };
/** The elements whose content is text as it stands, up to their end tag. */
const CDATA_ELEMENTS = new Set(["script", "style"]);

const START_TAG_OPEN = /<[a-zA-Z]/y;
/** The end of a start tag, with its attributes, as `html.parser` locates it. */
const START_TAG_END =
	/<[a-zA-Z][^\t\n\r\f />\x00]*(?:[\s/]*(?:(?<=['"\s/])[^\s/>][^\s/=>]*(?:\s*=+\s*(?:'[^']*'|"[^"]*"|(?!['"])[^>\s]*)\s*)?(?:\s|\/(?!>))*)*)?\s*/y;
const TAG_NAME = /([a-zA-Z][^\t\n\r\f />\x00]*)(?:\s|\/(?!>))*/y;
const ATTRIBUTE =
	/((?<=['"\s/])[^\s/>][^\s/=>]*)(\s*=+\s*('[^']*'|"[^"]*"|(?!['"])[^>\s]*))?(?:\s|\/(?!>))*/y;
const END_TAG = /<\/\s*([a-zA-Z][-.a-zA-Z0-9:_]*)\s*>/y;
const COMMENT_CLOSE = /--\s*>/g;
const START_TAG_END_CHARACTERS =
	"abcdefghijklmnopqrstuvwxyz=/ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The parts of a label of HTML as `html.parser` hands them over. */
type HtmlPart =
	| { readonly kind: "text"; readonly text: string }
	| { readonly kind: "start"; readonly tag: string; readonly source: string }
	| { readonly kind: "end"; readonly tag: string };

function stickyMatch(
	pattern: RegExp,
	text: string,
	at: number
): RegExpExecArray | null {
	pattern.lastIndex = at;
	return pattern.exec(text);
}

/** The end of the start tag at `at`, or -1 when the text ends inside it. */
function startTagEnd(text: string, at: number): number {
	const match = stickyMatch(START_TAG_END, text, at)!;
	const end = at + match[0].length;
	const next = text.slice(end, end + 1);
	if (next === ">") {
		return end + 1;
	}
	if (next === "/") {
		return text.startsWith("/>", end) ? end + 2 : -1;
	}
	if (next === "" || START_TAG_END_CHARACTERS.includes(next)) {
		return -1;
	}
	return end > at ? end : at + 1;
}

/** The parts of a label of HTML. */
function htmlParts(source: string): HtmlPart[] {
	const parts = new Array<HtmlPart>();
	const text = (raw: string, isRead: boolean) => {
		if (raw !== "") {
			parts.push({ kind: "text", text: isRead ? decodeHTML(raw) : raw });
		}
	};
	let cdataElement: string | undefined;
	let index = 0;
	while (index < source.length) {
		if (cdataElement !== undefined) {
			const close = new RegExp(`</\\s*${cdataElement}\\s*>`, "gi");
			close.lastIndex = index;
			const found = close.exec(source);
			if (found === null) {
				return parts;
			}
			text(source.slice(index, found.index), false);
			parts.push({ kind: "end", tag: cdataElement });
			cdataElement = undefined;
			index = found.index + found[0].length;
			continue;
		}
		const open = source.indexOf("<", index);
		const textEnd = open < 0 ? source.length : open;
		text(source.slice(index, textEnd), true);
		index = textEnd;
		if (index >= source.length) {
			break;
		}
		let next: number;
		if (stickyMatch(START_TAG_OPEN, source, index) !== null) {
			next = startTagEnd(source, index);
			if (next >= 0) {
				const name = stickyMatch(TAG_NAME, source, index + 1)!;
				let attributesEnd = index + 1 + name[0].length;
				for (;;) {
					const attribute = stickyMatch(
						ATTRIBUTE,
						source,
						attributesEnd
					);
					if (attribute === null || attributesEnd >= next) {
						break;
					}
					attributesEnd += attribute[0].length;
				}
				const rest = source.slice(attributesEnd, next).trim();
				const tag = name[1].toLowerCase();
				if (rest !== ">" && rest !== "/>") {
					text(source.slice(index, next), false);
				} else {
					parts.push({
						kind: "start",
						tag,
						source: source.slice(index, next),
					});
					if (rest === ">" && CDATA_ELEMENTS.has(tag)) {
						cdataElement = tag;
					}
				}
			}
		} else if (source.startsWith("</", index)) {
			next = endTag(source, index, parts);
		} else if (source.startsWith("<!--", index)) {
			COMMENT_CLOSE.lastIndex = index + 4;
			const close = COMMENT_CLOSE.exec(source);
			next = close === null ? -1 : close.index + close[0].length;
		} else if (
			source.startsWith("<!", index) ||
			source.startsWith("<?", index)
		) {
			const close = source.indexOf(">", index + 2);
			next = close < 0 ? -1 : close + 1;
		} else if (index + 1 < source.length) {
			text("<", false);
			next = index + 1;
		} else {
			break;
		}
		if (next < 0) {
			const close = source.indexOf(">", index + 1);
			const other = source.indexOf("<", index + 1);
			next = close >= 0 ? close + 1 : other >= 0 ? other : index + 1;
			text(source.slice(index, next), true);
		}
		index = next;
	}
	text(source.slice(index), true);
	return parts;
}

/** The end of the end tag at `at`, with the tag added to the parts, or -1 when no `>` follows. */
function endTag(source: string, at: number, parts: HtmlPart[]): number {
	const close = source.indexOf(">", at + 1);
	if (close < 0) {
		return -1;
	}
	const match = stickyMatch(END_TAG, source, at);
	if (match !== null) {
		parts.push({ kind: "end", tag: match[1].toLowerCase() });
		return close + 1;
	}
	const name = stickyMatch(TAG_NAME, source, at + 2);
	if (name === null) {
		if (source.startsWith("</>", at)) {
			return at + 3;
		}
		const bogus = source.indexOf(">", at + 2);
		return bogus < 0 ? -1 : bogus + 1;
	}
	parts.push({ kind: "end", tag: name[1].toLowerCase() });
	return source.indexOf(">", at + name[0].length + 2) + 1;
}

/** The pieces of a run of text: its words, its formulas as markup and its line breaks. */
function textPieces(
	data: string,
	formulaReadsAs: string,
	isNewLineBreak: boolean
): LabelPiece[] {
	const pieces = new Array<LabelPiece>();
	const words = (run: string) => {
		const lines = isNewLineBreak ? run.split("\n") : [run];
		lines.forEach((line, index) => {
			if (index > 0) {
				pieces.push({ ...LINE_BREAK });
			}
			if (line !== "") {
				pieces.push({ text: line });
			}
		});
	};
	let last = 0;
	for (const match of matchesOf(FORMULA, data)) {
		words(data.slice(last, match.index));
		pieces.push({ markup: match[0], interpretAs: formulaReadsAs });
		last = match.index + match[0].length;
	}
	words(data.slice(last));
	return pieces;
}

function matchesOf(pattern: RegExp, text: string): RegExpExecArray[] {
	const global = new RegExp(pattern.source, "g");
	const found = new Array<RegExpExecArray>();
	for (
		let match = global.exec(text);
		match !== null;
		match = global.exec(text)
	) {
		found.push(match);
	}
	return found;
}

/** The pieces of a label, HTML or plain text. */
export function labelPieces(
	label: string,
	isHtml: boolean,
	isNewLineBreak: boolean,
	formulaReadsAs: string
): LabelPiece[] {
	if (!isHtml) {
		return textPieces(label, formulaReadsAs, isNewLineBreak);
	}
	const pieces = new Array<LabelPiece>();
	let data = "";
	const flush = () => {
		if (data !== "") {
			pieces.push(...textPieces(data, formulaReadsAs, isNewLineBreak));
			data = "";
		}
	};
	for (const part of htmlParts(label)) {
		if (part.kind === "text") {
			data += part.text;
			continue;
		}
		flush();
		const interpretAs = BLOCKS.has(part.tag) ? "\n\n" : "";
		pieces.push({
			markup: part.kind === "start" ? part.source : `</${part.tag}>`,
			interpretAs,
		});
	}
	flush();
	return pieces;
}
