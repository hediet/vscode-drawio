import * as jsoncParser from "jsonc-parser";
import {
	COLOR_NAME,
	COLOR_VALUE,
	LIST_KINDS,
	SCHEME_COLOR_KEYS,
} from "../deck/deckColors";

export { COLOR_NAME, COLOR_VALUE, LIST_KINDS, SCHEME_COLOR_KEYS };

const COLORS = "drawioSlides.colors";
const LIST_STYLES = "drawioSlides.listStyles";
const COLOR_SCHEMES = "drawioSlides.customColorSchemes";
const OPERATIONS: Record<DeckColorEdit["operation"], true> = {
	set: true,
	rename: true,
	remove: true,
};

/** An edit of `drawioSlides.colors` that the extension refuses, with the reason. */
export class RefusedColorEdit extends Error {
	public readonly name = "RefusedColorEdit";
}

/**
 * The colors of `drawioSlides.colors` after the edit, in the order of the setting, with a renamed
 * color in its place and a new color last.
 */
export function withColorEdit(
	colors: Record<string, unknown>,
	edit: DeckColorEdit
): Record<string, unknown> {
	checkColorEdit(colors, edit);
	return Object.keys(colors)
		.concat(
			edit.operation === "set" && !hasColor(colors, edit.name)
				? [edit.name]
				: []
		)
		.reduce((result, name) => {
			if (edit.operation === "remove" && name === edit.name) {
				return result;
			}
			if (edit.operation === "rename" && name === edit.name) {
				return { ...result, [edit.newName]: colors[name] };
			}
			if (edit.operation === "set" && name === edit.name) {
				return { ...result, [name]: edit.value };
			}
			return { ...result, [name]: colors[name] };
		}, {} as Record<string, unknown>);
}

/**
 * The text of a settings file of VS Code after the edit of its member `drawioSlides.colors`, with
 * every other member and every comment as they were. A rename also renames the color where
 * `drawioSlides.listStyles` and `drawioSlides.customColorSchemes` of the file name it.
 */
export function withColorEditInSettings(
	text: string,
	edit: DeckColorEdit
): string {
	const root = parseSettings(text);
	const colorsNode = root && jsoncParser.findNodeAtLocation(root, [COLORS]);
	const colors: unknown = colorsNode
		? jsoncParser.getNodeValue(colorsNode)
		: {};
	if (!isPlainObject(colors)) {
		throw new RefusedColorEdit(
			`The settings file gives drawioSlides.colors the value ${JSON.stringify(
				colors
			)}, where an object of names and colors was expected, so the file stays as it is.`
		);
	}
	checkColorEdit(colors, edit);
	const options = { formattingOptions: formattingOf(text) };
	if (edit.operation === "rename" && edit.newName === edit.name) {
		return text;
	}
	if (edit.operation === "set") {
		return jsoncParser.applyEdits(
			text,
			jsoncParser.modify(text, [COLORS, edit.name], edit.value, options)
		);
	}
	const property = jsoncParser.findNodeAtLocation(root!, [COLORS, edit.name])!
		.parent!;
	if (edit.operation === "remove") {
		return withoutProperty(text, property);
	}
	const key = property.children![0];
	const renamed =
		text.slice(0, key.offset) +
		JSON.stringify(edit.newName) +
		text.slice(key.offset + key.length);
	return pathsNamingColor(parseSettings(renamed)!, edit.name).reduce(
		(result, path) =>
			jsoncParser.applyEdits(
				result,
				jsoncParser.modify(result, path, edit.newName, options)
			),
		renamed
	);
}

/** Whether a settings file of VS Code holds the member `drawioSlides.colors`. */
export function hasColorsMember(text: string): boolean {
	const root = parseSettings(text);
	return (
		root !== undefined &&
		jsoncParser.findNodeAtLocation(root, [COLORS]) !== undefined
	);
}

function checkColorEdit(
	colors: Record<string, unknown>,
	edit: DeckColorEdit
): void {
	if (!Object.prototype.hasOwnProperty.call(OPERATIONS, edit.operation)) {
		throw new RefusedColorEdit(
			`The edit of drawioSlides.colors names the operation ${JSON.stringify(
				edit.operation
			)}, where set, rename or remove was expected, so the setting stays as it is.`
		);
	}
	if (edit.operation === "set") {
		if (typeof edit.name !== "string" || !COLOR_NAME.test(edit.name)) {
			throw new RefusedColorEdit(
				`The name ${JSON.stringify(
					edit.name
				)} is not letters and digits that start with a letter, so drawioSlides.colors stays as it is.`
			);
		}
		if (typeof edit.value !== "string" || !COLOR_VALUE.test(edit.value)) {
			throw new RefusedColorEdit(
				`The value ${JSON.stringify(edit.value)} of ${
					edit.name
				} is not # and six hexadecimal digits, so drawioSlides.colors stays as it is.`
			);
		}
		return;
	}
	if (!hasColor(colors, edit.name)) {
		throw new RefusedColorEdit(
			`drawioSlides.colors defines no color ${JSON.stringify(
				edit.name
			)}, so the setting stays as it is.`
		);
	}
	if (edit.operation === "rename") {
		if (
			typeof edit.newName !== "string" ||
			!COLOR_NAME.test(edit.newName)
		) {
			throw new RefusedColorEdit(
				`The name ${JSON.stringify(
					edit.newName
				)} is not letters and digits that start with a letter, so ${
					edit.name
				} keeps its name.`
			);
		}
		if (edit.newName !== edit.name && hasColor(colors, edit.newName)) {
			throw new RefusedColorEdit(
				`drawioSlides.colors already defines a color ${edit.newName}, so ${edit.name} keeps its name.`
			);
		}
	}
}

/**
 * The text without a member of an object and its comma, and without its line when nothing else is
 * left on it. The comments around the member stay, which `jsoncParser.modify` removes before the
 * first member of an object.
 */
function withoutProperty(text: string, property: jsoncParser.Node): string {
	const siblings = property.parent!.children!;
	const index = siblings.indexOf(property);
	const start = property.offset;
	const end = property.offset + property.length;
	const isLast = index === siblings.length - 1;
	const trailingComma = isLast ? nextTokenOffset(text, end) : undefined;
	const commaAfter = isLast
		? text[trailingComma!] === ","
			? trailingComma
			: undefined
		: nextTokenOffset(text, end);
	const commaBefore =
		isLast && index > 0 && commaAfter === undefined
			? nextTokenOffset(
					text,
					siblings[index - 1].offset + siblings[index - 1].length
			  )
			: undefined;
	const removedEnd = commaAfter === undefined ? end : commaAfter + 1;
	const lineStart = text.lastIndexOf("\n", start - 1) + 1;
	const newline = text.indexOf("\n", removedEnd);
	const lineEnd = newline < 0 ? text.length : newline + 1;
	const isAloneOnLine =
		text.slice(lineStart, start).trim() === "" &&
		text.slice(removedEnd, lineEnd).trim() === "";
	const [cutStart, cutEnd] = isAloneOnLine
		? [lineStart, lineEnd]
		: [start, removedEnd];
	const withoutMember = text.slice(0, cutStart) + text.slice(cutEnd);
	return commaBefore === undefined
		? withoutMember
		: withoutMember.slice(0, commaBefore) +
				withoutMember.slice(commaBefore + 1);
}

/** The offset of the first token after an offset, past white space and comments. */
function nextTokenOffset(text: string, offset: number): number {
	const scanner = jsoncParser.createScanner(text.slice(offset), false);
	let token = scanner.scan();
	while (
		token === jsoncParser.SyntaxKind.Trivia ||
		token === jsoncParser.SyntaxKind.LineBreakTrivia ||
		token === jsoncParser.SyntaxKind.LineCommentTrivia ||
		token === jsoncParser.SyntaxKind.BlockCommentTrivia
	) {
		token = scanner.scan();
	}
	return offset + scanner.getTokenOffset();
}

function parseSettings(text: string): jsoncParser.Node | undefined {
	if (jsoncParser.stripComments(text).trim() === "") {
		return undefined;
	}
	const errors = new Array<jsoncParser.ParseError>();
	const root = jsoncParser.parseTree(text, errors, {
		allowTrailingComma: true,
		disallowComments: false,
	});
	if (errors.length > 0) {
		const [error] = errors;
		throw new RefusedColorEdit(
			`The settings file does not read as JSON with comments, with the error ${jsoncParser.printParseErrorCode(
				error.error
			)} at offset ${error.offset}, so the file stays as it is.`
		);
	}
	return root;
}

/**
 * The places of `drawioSlides.listStyles` and `drawioSlides.customColorSchemes` that name the
 * color: the color of a level of a list, and a color of a swatch.
 */
function pathsNamingColor(
	root: jsoncParser.Node,
	name: string
): jsoncParser.JSONPath[] {
	const valueAt = (path: jsoncParser.JSONPath): unknown => {
		const node = jsoncParser.findNodeAtLocation(root, path);
		return node && jsoncParser.getNodeValue(node);
	};
	const listStyles = valueAt([LIST_STYLES]);
	const listPaths = LIST_KINDS.reduce((paths, kind) => {
		const levels = isPlainObject(listStyles) ? listStyles[kind] : [];
		return Array.isArray(levels)
			? paths.concat(
					levels
						.map((level, index) => ({ level, index }))
						.filter(
							({ level }) =>
								isPlainObject(level) && level.color === name
						)
						.map(({ index }) => [LIST_STYLES, kind, index, "color"])
			  )
			: paths;
	}, new Array<jsoncParser.JSONPath>());
	const schemes = valueAt([COLOR_SCHEMES]);
	const schemePaths = (Array.isArray(schemes) ? schemes : []).reduce(
		(paths: jsoncParser.JSONPath[], page: unknown, pageIndex: number) =>
			Array.isArray(page)
				? paths.concat(
						...page.map((scheme: unknown, schemeIndex: number) =>
							SCHEME_COLOR_KEYS.filter(
								(key) =>
									isPlainObject(scheme) &&
									scheme[key] === name
							).map((key) => [
								COLOR_SCHEMES,
								pageIndex,
								schemeIndex,
								key,
							])
						)
				  )
				: paths,
		new Array<jsoncParser.JSONPath>()
	);
	return [...listPaths, ...schemePaths];
}

/** The indentation and the line ends of a settings file, which an added member follows. */
function formattingOf(text: string): jsoncParser.FormattingOptions {
	const indent = /^([ \t]+)\S/m.exec(text)?.[1] ?? "  ";
	return {
		insertSpaces: !indent.includes("\t"),
		tabSize: indent.includes("\t") ? 4 : indent.length,
		eol: text.includes("\r\n") ? "\r\n" : "\n",
	};
}

/**
 * Whether the colors define a color of the name, which a name of the prototype of an object,
 * such as `constructor`, does not make them do.
 */
function hasColor(colors: Record<string, unknown>, name: string): boolean {
	return Object.prototype.hasOwnProperty.call(colors, name);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
