/**
 * JSON with comments, as VS Code reads a settings file, read and written so that the value of one
 * key of the top object is replaced in the text and every other key and comment stays:
 *
 *     const settings = '{\n  // the editor\n  "drawSlidesCode.slides": true,\n}\n';
 *     withMemberObject(settings, "drawSlidesCode.colors", {
 *         members: [{ key: "accent", value: "#004D80", comments: ["the markers"] }],
 *         closingComments: [],
 *     });
 *
 * gives
 *
 *     {
 *       // the editor
 *       "drawSlidesCode.slides": true,
 *       "drawSlidesCode.colors": {
 *         // the markers
 *         "accent": "#004D80"
 *       }
 *     }
 *
 * The edits of single colors that the color panel makes are in `deckColorEdits.ts`, which
 * edits through `jsonc-parser`. This module writes a whole object with the comment lines before
 * each member, which `jsonc-parser` does not write.
 */
import { jsonText } from "./textFormats";

export enum TokenKind {
	String = "string",
	LineComment = "line comment",
	BlockComment = "block comment",
	Punctuation = "punctuation",
	Literal = "literal",
}

const PUNCTUATION = "{}[],:";

export interface Token {
	readonly kind: TokenKind;
	readonly start: number;
	readonly end: number;
}

/**
 * A member of an object of JSON with comments, with the comment lines before it, `null` for a
 * blank line between them, and the line comment after it on its own line.
 */
export interface CommentedMember {
	readonly key: string;
	readonly value: unknown;
	readonly comments: readonly (string | null)[];
	readonly trailing?: string;
}

/** The members of an object, and the comment lines after the last of them. */
export interface CommentedObject {
	readonly members: readonly CommentedMember[];
	readonly closingComments: readonly (string | null)[];
}

/**
 * Where the parts of the object at the top of a JSON text with comments are: the value of each
 * key, from its first character to after its last, the start of each key, and the braces.
 */
export interface ObjectLayout {
	readonly values: ReadonlyMap<string, readonly [number, number]>;
	readonly keys: ReadonlyMap<string, number>;
	readonly opening: number;
	readonly closing: number;
}

/** A text that does not read as JSON with comments, with the place of the fault. */
export class JsonWithCommentsError extends Error {
	public readonly name = "JsonWithCommentsError";
}

function isComment(token: Token): boolean {
	return (
		token.kind === TokenKind.LineComment ||
		token.kind === TokenKind.BlockComment
	);
}

function isSpace(character: string): boolean {
	return /\s/.test(character);
}

/**
 * The tokens of JSON with comments, without the spaces. A literal is a number, `true`, `false`
 * or `null`, read up to the next space, punctuation, string or comment.
 */
export function jsonTokens(text: string): Token[] {
	const tokens = new Array<Token>();
	const length = text.length;
	let index = 0;
	while (index < length) {
		const character = text[index];
		if (isSpace(character)) {
			index += 1;
			continue;
		}
		let end: number;
		let kind: TokenKind;
		if (character === '"') {
			end = index + 1;
			while (end < length && text[end] !== '"' && text[end] !== "\n") {
				end += text[end] === "\\" ? 2 : 1;
			}
			if (end >= length || text[end] !== '"') {
				throw new JsonWithCommentsError(
					`the string at character ${index} does not end on its line`
				);
			}
			kind = TokenKind.String;
			end += 1;
		} else if (text.startsWith("//", index)) {
			const newline = text.indexOf("\n", index);
			kind = TokenKind.LineComment;
			end = newline < 0 ? length : newline;
		} else if (text.startsWith("/*", index)) {
			const close = text.indexOf("*/", index + 2);
			kind = TokenKind.BlockComment;
			end = close < 0 ? length : close + 2;
		} else if (PUNCTUATION.includes(character)) {
			kind = TokenKind.Punctuation;
			end = index + 1;
		} else {
			end = index + 1;
			while (
				end < length &&
				!isSpace(text[end]) &&
				!PUNCTUATION.includes(text[end]) &&
				text[end] !== '"' &&
				!text.startsWith("//", end) &&
				!text.startsWith("/*", end)
			) {
				end += 1;
			}
			kind = TokenKind.Literal;
		}
		tokens.push({ kind, start: index, end });
		index = end;
	}
	return tokens;
}

/**
 * JSON with comments and trailing commas as plain JSON, each comment and each trailing comma
 * replaced by spaces, so that an error of the JSON names its place in the file.
 */
export function withoutComments(text: string): string {
	const all = jsonTokens(text);
	const tokens = all.filter((token) => !isComment(token));
	const trailingCommas = tokens.filter(
		(token, index) =>
			index + 1 < tokens.length &&
			text.slice(token.start, token.end) === "," &&
			"}]".includes(text[tokens[index + 1].start])
	);
	const removed = [...all.filter(isComment), ...trailingCommas];
	const plain = text.split("");
	for (const token of removed) {
		for (let index = token.start; index < token.end; index++) {
			plain[index] = text[index] === "\n" ? "\n" : " ";
		}
	}
	return plain.join("");
}

/** The index of the token after the value that starts at the token `first`. */
function valueEnd(
	text: string,
	tokens: readonly Token[],
	first: number
): number {
	let depth = 0;
	let index = first;
	while (index < tokens.length) {
		const piece = text.slice(tokens[index].start, tokens[index].end);
		if (
			tokens[index].kind === TokenKind.Punctuation &&
			"{[".includes(piece)
		) {
			depth += 1;
		} else if (
			tokens[index].kind === TokenKind.Punctuation &&
			"}]".includes(piece)
		) {
			depth -= 1;
		}
		index += 1;
		if (depth <= 0) {
			return index;
		}
	}
	throw new JsonWithCommentsError(
		`the value at character ${tokens[first].start} does not end`
	);
}

function parseJson(text: string, start: number): unknown {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new JsonWithCommentsError(
			`the value at character ${start} is no JSON: ${
				(error as Error).message
			}`
		);
	}
}

/** The layout of the object at the top of a JSON text with comments. */
export function objectLayout(text: string): ObjectLayout {
	const tokens = jsonTokens(text).filter((token) => !isComment(token));
	const pieces = tokens.map((token) => text.slice(token.start, token.end));
	if (pieces.length === 0 || pieces[0] !== "{") {
		throw new JsonWithCommentsError("the text holds no object");
	}
	const values = new Map<string, readonly [number, number]>();
	const keys = new Map<string, number>();
	let index = 1;
	while (index < tokens.length && pieces[index] !== "}") {
		if (
			tokens[index].kind !== TokenKind.String ||
			index + 2 >= tokens.length ||
			pieces[index + 1] !== ":"
		) {
			throw new JsonWithCommentsError(
				`character ${tokens[index].start} is no key of the object`
			);
		}
		const key = parseJson(pieces[index], tokens[index].start) as string;
		const after = valueEnd(text, tokens, index + 2);
		keys.set(key, tokens[index].start);
		values.set(key, [tokens[index + 2].start, tokens[after - 1].end]);
		index =
			after < tokens.length && pieces[after] === "," ? after + 1 : after;
	}
	if (index >= tokens.length) {
		throw new JsonWithCommentsError(
			`the object at character ${tokens[0].start} does not end`
		);
	}
	return {
		values,
		keys,
		opening: tokens[0].start,
		closing: tokens[index].start,
	};
}

/** The lines of a comment without its marks and without the space after `//`. */
function commentLines(text: string, token: Token): string[] {
	const body = text.slice(token.start, token.end);
	if (token.kind === TokenKind.LineComment) {
		return [body.replace(/^\/\/ ?/, "")];
	}
	return body
		.slice(2, -2)
		.trim()
		.split(/\r\n|\n|\r/)
		.map((line) => line.trim());
}

/**
 * The members of the object between `start` and `end` of a JSON text with comments, in order,
 * with their comments.
 *
 * A line comment on the line of a member, after its value or its comma, is the trailing comment
 * of the member. A blank line between two comments, or between a member and a comment, is kept
 * as `null`.
 */
export function readCommentedObject(
	text: string,
	start: number,
	end: number
): CommentedObject {
	const tokens = jsonTokens(text.slice(0, end))
		.filter((token) => token.start >= start)
		.slice(1, -1);
	const members = new Array<CommentedMember>();
	let pending = new Array<string | null>();
	let previous = start + 1;
	let index = 0;
	while (index < tokens.length) {
		const token = tokens[index];
		const hasBlankLine = countNewlines(text, previous, token.start) >= 2;
		if (
			hasBlankLine &&
			(pending.length > 0 || members.length > 0) &&
			pending[pending.length - 1] !== null
		) {
			pending.push(null);
		}
		if (isComment(token)) {
			const last = members[members.length - 1];
			const isTrailing =
				token.kind === TokenKind.LineComment &&
				last !== undefined &&
				pending.length === 0 &&
				last.trailing === undefined &&
				!text.slice(previous, token.start).includes("\n");
			if (isTrailing) {
				members[members.length - 1] = {
					...last,
					trailing: commentLines(text, token)[0],
				};
			} else {
				pending.push(...commentLines(text, token));
			}
			previous = token.end;
			index += 1;
			continue;
		}
		// The key, the colon and the value, without the comments among them.
		const plain = tokens
			.map((_token, position) => position)
			.filter(
				(position) => position >= index && !isComment(tokens[position])
			);
		const after = valueEnd(
			text,
			plain.map((position) => tokens[position]),
			2
		);
		const valueStart = tokens[plain[2]].start;
		const valueText = withoutComments(
			text.slice(valueStart, tokens[plain[after - 1]].end)
		);
		members.push({
			key: parseJson(
				text.slice(token.start, token.end),
				token.start
			) as string,
			value: parseJson(valueText, valueStart),
			comments: pending,
		});
		pending = [];
		let lastPosition = plain[after - 1];
		if (after < plain.length && text[tokens[plain[after]].start] === ",") {
			lastPosition = plain[after];
		}
		previous = tokens[lastPosition].end;
		index = lastPosition + 1;
	}
	return { members, closingComments: withoutTrailingBlanks(pending) };
}

function countNewlines(text: string, start: number, end: number): number {
	let count = 0;
	for (let index = start; index < end; index++) {
		count += text[index] === "\n" ? 1 : 0;
	}
	return count;
}

/** The comment lines without the blank lines at their end. */
export function withoutTrailingBlanks(
	lines: readonly (string | null)[]
): (string | null)[] {
	let end = lines.length;
	while (end > 0 && lines[end - 1] === null) {
		end -= 1;
	}
	return lines.slice(0, end);
}

/**
 * An object as JSON with comments, its members one unit further in than `indent`, which the
 * closing brace keeps.
 */
export function commentedObjectText(
	content: CommentedObject,
	indent: string,
	unit: string
): string {
	const inner = indent + unit;
	const comment = (line: string | null): string =>
		line === null ? "" : inner + (line ? "// " + line : "//");
	const lines = ["{"];
	content.members.forEach((member, position) => {
		lines.push(...member.comments.map(comment));
		const comma = position < content.members.length - 1 ? "," : "";
		const trailing =
			member.trailing === undefined ? "" : " // " + member.trailing;
		lines.push(
			`${inner}${jsonText(member.key)}: ${jsonText(
				member.value
			)}${comma}${trailing}`
		);
	});
	lines.push(...content.closingComments.map(comment));
	lines.push(indent + "}");
	return lines.join("\n");
}

/** The indent of the first key of the object, or two spaces for an object without keys. */
function memberIndent(text: string, layout: ObjectLayout): string {
	if (layout.keys.size === 0) {
		return "  ";
	}
	const first = Math.min(...layout.keys.values());
	const lineStart = text.lastIndexOf("\n", first - 1) + 1;
	const indent = text.slice(lineStart, first);
	return indent !== "" && indent.trim() === "" ? indent : "  ";
}

/**
 * A JSON text with comments whose top object gives `key` the object `content`, in the place of
 * the value it had, or else as a new last member, with every other key and comment kept.
 */
export function withMemberObject(
	text: string,
	key: string,
	content: CommentedObject
): string {
	const layout = objectLayout(text);
	const indent = memberIndent(text, layout);
	const value = commentedObjectText(content, indent, indent);
	const span = layout.values.get(key);
	if (span !== undefined) {
		return text.slice(0, span[0]) + value + text.slice(span[1]);
	}
	const member = `${indent}${jsonText(key)}: ${value}`;
	if (layout.values.size === 0) {
		const inside = text.slice(layout.opening + 1, layout.closing);
		if (inside.trim() === "") {
			return (
				text.slice(0, layout.opening + 1) +
				"\n" +
				member +
				"\n" +
				text.slice(layout.closing)
			);
		}
		return (
			text.slice(0, layout.opening + 1) +
			"\n" +
			member +
			text.slice(layout.opening + 1)
		);
	}
	const beforeClosing = text.slice(0, layout.closing).replace(/\s+$/, "");
	const written =
		beforeClosing + "\n" + member + "\n" + text.slice(layout.closing);
	const tokens = jsonTokens(beforeClosing).filter(
		(token) => !isComment(token)
	);
	const last = tokens[tokens.length - 1];
	return written.slice(last.start, last.end) === ","
		? written
		: written.slice(0, last.end) + "," + written.slice(last.end);
}
