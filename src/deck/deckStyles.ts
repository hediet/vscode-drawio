/**
 * The styles of a deck, the setting `drawSlidesCode.deckStyles`, and their links in the XML of a
 * drawing as the editor saves it.
 *
 * The setting holds one object of names to style strings per kind of geometry, such as `wire`,
 * `rectangle` or `ellipse`, and a name stands for one style across every kind. The kind of a cell
 * and the keys that a style holds are the rules of `deck-style-rules.js`, which the editor applies
 * alike. A cell links to a style through the key `deckStyle` of its own style, beside the keys of
 * the style. The functions here read the text of a page as the file holds it, where the style of a
 * cell is the escaped value of its attribute `style`, and change only the cells that they edit.
 */
import * as fs from "fs";
import { COLOR_LINK_KEYS } from "./deckColors";
import { DIAGRAM } from "./deckFiles";

/** The key of a style of draw.io that links a cell to a style of the deck. */
export const STYLE_LINK = "deckStyle";

/** The styles of a deck, by kind of geometry, each a name to its style string. */
export type DeckStyles = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** A style of the deck with its kind, as the editor lists it. */
export interface NamedStyle {
	readonly kind: string;
	readonly name: string;
	readonly style: string;
}

/**
 * An edit of the cells linked to a style: `update` writes the change of the style from `before` to
 * `after` into each linked cell that holds the keys as the style held them, `rename` gives the
 * links the new name, and `remove` takes the links out and leaves the keys.
 */
export type StyleUseEdit =
	| {
			readonly operation: "update";
			readonly name: string;
			readonly before: string;
			readonly after: string;
	  }
	| {
			readonly operation: "rename";
			readonly name: string;
			readonly newName: string;
	  }
	| { readonly operation: "remove"; readonly name: string };

/** The rules of `deck-style-rules.js`, which the editor and the extension share. */
export interface DeckStyleRules {
	readonly link: string;
	readonly geometryKeys: readonly string[];
	readonly kindKeys: readonly string[];
	isName(name: unknown): boolean;
	isKind(kind: unknown): boolean;
	kindOf(style: string, isEdge: boolean): string | null;
	linkOf(style: string): string | null;
	appearanceOf(style: string): string;
	differingKeys(cellStyle: string, style: string): string[];
	given(cellStyle: string, name: string, style: string): string;
	updated(cellStyle: string, before: string, after: string): string;
	relinked(cellStyle: string, newName: string | null): string;
	afterUseEdit(cellStyle: string, edit: StyleUseEdit): string;
}

/** The cells linked to a style, by their kind of geometry. */
export type StyleUses = ReadonlyMap<string, number>;

/** The rules of the file `deck-style-rules.js`, with the keys of the links to the colors of the deck. */
export function loadDeckStyleRules(rulesFile: string): DeckStyleRules {
	const rules = new Function(
		fs.readFileSync(rulesFile, "utf8") + "\nreturn deckStyleRules;"
	)() as (colorLinkKeys: Record<string, string>) => DeckStyleRules;
	return rules(
		Object.fromEntries(
			Object.entries(COLOR_LINK_KEYS).map(([key, { link }]) => [key, link])
		)
	);
}

/** The start tag of a cell, which carries its style and whether it is an edge. */
const CELL_TAG = /<mxCell\b[^>]*>/g;
const STYLE_ATTRIBUTE = /(\sstyle=")([^"]*)(")/;
const EDGE = /\sedge="1"/;
const LINK_IN_STYLE = new RegExp(`(?:^|;)${STYLE_LINK}=([^;]*)`);

/** The text of a drawing file after the edits of the cells linked to styles. */
export function withStyleUseEditsInDrawing(
	text: string,
	edits: readonly StyleUseEdit[],
	rules: DeckStyleRules
): string {
	return text.replace(new RegExp(DIAGRAM.source, "g"), (page) =>
		page.replace(CELL_TAG, (tag) =>
			tag.replace(
				STYLE_ATTRIBUTE,
				(whole, start: string, escaped: string, end: string) => {
					const style = unescapeAttribute(escaped);
					const edited = edits.reduce(
						(result, edit) => rules.afterUseEdit(result, edit),
						style
					);
					return edited === style
						? whole
						: start + escapeAttribute(edited) + end;
				}
			)
		)
	);
}

/** The cells of a drawing file linked to the style, by their kind. */
export function styleUsesInDrawing(
	text: string,
	name: string,
	rules: DeckStyleRules
): StyleUses {
	const uses = new Map<string, number>();
	for (const { style, isEdge } of cellStyles(text)) {
		if (rules.linkOf(style) === name) {
			const kind = rules.kindOf(style, isEdge) ?? "cell";
			uses.set(kind, (uses.get(kind) ?? 0) + 1);
		}
	}
	return uses;
}

/** The sum of the uses of each kind. */
export function addedStyleUses(first: StyleUses, second: StyleUses): StyleUses {
	const sum = new Map(first);
	second.forEach((count, kind) => sum.set(kind, (sum.get(kind) ?? 0) + count));
	return sum;
}

/** The names that the cells of the page link to and that the styles do not define, sorted. */
export function unknownStyleLinks(page: string, styles: DeckStyles): string[] {
	const known = new Set(namedStyles(styles).map(({ name }) => name));
	const links = cellStyles(page)
		.map(({ style }) => LINK_IN_STYLE.exec(style)?.[1])
		.filter((link): link is string => !!link && !known.has(link));
	return [...new Set(links)].sort();
}

/** The styles of every kind, in the order of the setting. */
export function namedStyles(styles: DeckStyles): NamedStyle[] {
	return Object.entries(styles).flatMap(([kind, named]) =>
		Object.entries(named).map(([name, style]) => ({ kind, name, style }))
	);
}

/** The style of the name, or undefined when the styles do not define it. */
export function styleNamed(
	styles: DeckStyles,
	name: string
): NamedStyle | undefined {
	return namedStyles(styles).find((style) => style.name === name);
}

/**
 * The styles of a value of `drawSlidesCode.deckStyles`, with a line for each entry that they leave
 * out: a value that is no object, a kind that is no name of a shape, a name that is not letters and
 * digits starting with a letter or that an earlier style holds, and a style that is not a string.
 * Each style keeps its keys of appearance alone.
 */
export function readDeckStyles(
	value: unknown,
	rules: DeckStyleRules
): { readonly styles: DeckStyles; readonly problems: readonly string[] } {
	const setting = "drawSlidesCode.deckStyles";
	if (value === undefined) {
		return { styles: {}, problems: [] };
	}
	if (!isPlainObject(value)) {
		return {
			styles: {},
			problems: [
				`${setting} holds ${JSON.stringify(value)}, where an object of kinds of geometry was expected, so the deck has no style.`,
			],
		};
	}
	const problems = new Array<string>();
	const seen = new Set<string>();
	const styles: Record<string, Record<string, string>> = {};
	for (const [kind, given] of Object.entries(value)) {
		if (!rules.isKind(kind)) {
			problems.push(
				`${setting} holds the kind ${JSON.stringify(kind)}, which is no name of a shape of draw.io, so its styles are left out.`
			);
			continue;
		}
		if (!isPlainObject(given)) {
			problems.push(
				`${setting}.${kind} holds ${JSON.stringify(given)}, where an object of names and styles was expected, so it is left out.`
			);
			continue;
		}
		for (const [name, style] of Object.entries(given)) {
			if (!rules.isName(name)) {
				problems.push(
					`${setting}.${kind} names a style ${JSON.stringify(name)}, which is not letters and digits that start with a letter, so the style is left out.`
				);
			} else if (seen.has(name)) {
				problems.push(
					`${setting}.${kind} names a style ${name}, which an earlier kind holds as well, so this one is left out.`
				);
			} else if (typeof style !== "string") {
				problems.push(
					`${setting}.${kind} gives ${name} the value ${JSON.stringify(style)}, where a style string was expected, so the style is left out.`
				);
			} else {
				seen.add(name);
				styles[kind] = { ...styles[kind], [name]: rules.appearanceOf(style) };
			}
		}
	}
	return { styles, problems };
}

/** The style of each cell of a text, unescaped, and whether the cell is an edge. */
function cellStyles(
	text: string
): { readonly style: string; readonly isEdge: boolean }[] {
	return [...text.matchAll(CELL_TAG)].flatMap(([tag]) => {
		const escaped = STYLE_ATTRIBUTE.exec(tag)?.[2];
		return escaped === undefined
			? []
			: [{ style: unescapeAttribute(escaped), isEdge: EDGE.test(tag) }];
	});
}

function unescapeAttribute(text: string): string {
	return text.replace(
		/&(quot|lt|gt|apos|amp|#x[0-9A-Fa-f]+|#\d+);/g,
		(_, entity: string) => {
			switch (entity) {
				case "quot":
					return '"';
				case "lt":
					return "<";
				case "gt":
					return ">";
				case "apos":
					return "'";
				case "amp":
					return "&";
			}
			return String.fromCodePoint(
				entity.startsWith("#x")
					? parseInt(entity.slice(2), 16)
					: parseInt(entity.slice(1), 10)
			);
		}
	);
}

/** The text as the value of an attribute in double quotes, as draw.io escapes it. */
function escapeAttribute(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\n/g, "&#xa;");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
