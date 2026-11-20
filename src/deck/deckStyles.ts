/**
 * The styles of a deck, the setting `drawSlidesCode.deckStyles`, and their links in the XML of a
 * drawing as the editor saves it.
 *
 * The setting holds one object of names to style strings per kind of geometry, `rectangles` and
 * `wires`, and a name stands for one style of the deck across both kinds. A cell links to a style
 * through the key `deckStyle` of its own style, beside the keys of the style, as the header of
 * `deck-style-rules.js` says. The functions here read the text of a page as the file holds it, where
 * the style of a cell is the escaped value of its attribute `style`, and change only the cells that
 * they edit, by the rules of `deck-style-rules.js`, which the editor applies alike.
 */
import * as fs from "fs";
import { COLOR_LINK_KEYS } from "./deckColors";
import { DIAGRAM } from "./deckFiles";

/** The kinds of geometry of the styles of a deck, the keys of `drawSlidesCode.deckStyles`. */
export const STYLE_KINDS = ["rectangles", "wires"] as const;
export type StyleKind = typeof STYLE_KINDS[number];

/** The key of a style of draw.io that links a cell to a style of the deck. */
export const STYLE_LINK = "deckStyle";

/** The styles of a deck by kind, each a name to its style string. */
export type DeckStyles = Readonly<
	Record<StyleKind, Readonly<Record<string, string>>>
>;

export const NO_DECK_STYLES: DeckStyles = { rectangles: {}, wires: {} };

/** The rules of `deck-style-rules.js`, which the editor and the extension share. */
export interface DeckStyleRules {
	readonly link: string;
	readonly geometryKeys: readonly string[];
	isName(name: unknown): boolean;
	kindOf(style: string, isEdge: boolean): StyleKind | null;
	linkOf(style: string): string | null;
	appearanceOf(style: string): string;
	differingKeys(cellStyle: string, style: string): string[];
	given(cellStyle: string, name: string, style: string): string;
	updated(cellStyle: string, before: string, after: string): string;
	relinked(cellStyle: string, newName: string | null): string;
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

/** The cells linked to a style, by the kind of geometry of the cell. */
export type StyleUses = Readonly<Record<StyleKind, number>>;

export const NO_STYLE_USES: StyleUses = { rectangles: 0, wires: 0 };

/** The rules of the file `deck-style-rules.js`, with the keys of the links to the colors of the deck. */
export function loadDeckStyleRules(rulesFile: string): DeckStyleRules {
	return deckStyleRulesOf(fs.readFileSync(rulesFile, "utf8"));
}

/** The rules of the text of `deck-style-rules.js`, with the keys of the links to the colors of the deck. */
export function deckStyleRulesOf(rulesText: string): DeckStyleRules {
	const rules = new Function(rulesText + "\nreturn deckStyleRules;")() as (
		colorLinkKeys: Record<string, string>
	) => DeckStyleRules;
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

/** The page after the edit of the cells linked to a style. */
export function withStyleUseEdit(
	page: string,
	edit: StyleUseEdit,
	rules: DeckStyleRules
): string {
	return page.replace(CELL_TAG, (tag) =>
		tag.replace(
			STYLE_ATTRIBUTE,
			(whole, start: string, escaped: string, end: string) => {
				const style = unescapeAttribute(escaped);
				if (rules.linkOf(style) !== edit.name) {
					return whole;
				}
				const edited =
					edit.operation === "update"
						? rules.updated(style, edit.before, edit.after)
						: rules.relinked(
								style,
								edit.operation === "rename" ? edit.newName : null
						  );
				return edited === style
					? whole
					: start + escapeAttribute(edited) + end;
			}
		)
	);
}

/** The text of a drawing file after the edits of the cells linked to styles, page by page. */
export function withStyleUseEditsInDrawing(
	text: string,
	edits: readonly StyleUseEdit[],
	rules: DeckStyleRules
): string {
	return text.replace(new RegExp(DIAGRAM.source, "g"), (page) =>
		edits.reduce((result, edit) => withStyleUseEdit(result, edit, rules), page)
	);
}

/** The cells of a drawing file linked to the style, by their kind: an edge is a wire, any other cell a rectangle. */
export function styleUsesInDrawing(text: string, name: string): StyleUses {
	const kinds = linkedCells(text)
		.filter(({ link }) => link === name)
		.map(({ isEdge }) => (isEdge ? "wires" : "rectangles"));
	return {
		rectangles: kinds.filter((kind) => kind === "rectangles").length,
		wires: kinds.filter((kind) => kind === "wires").length,
	};
}

/** The sum of the uses of each kind. */
export function addedStyleUses(first: StyleUses, second: StyleUses): StyleUses {
	return {
		rectangles: first.rectangles + second.rectangles,
		wires: first.wires + second.wires,
	};
}

/** The names that the cells of the page link to and that the styles do not define, sorted. */
export function unknownStyleLinks(
	page: string,
	styles: DeckStyles
): string[] {
	const known = new Set(styleNames(styles));
	return [
		...new Set(
			linkedCells(page)
				.map(({ link }) => link)
				.filter((link) => !known.has(link))
		),
	].sort();
}

/** The names of the styles of every kind. */
export function styleNames(styles: DeckStyles): string[] {
	return STYLE_KINDS.flatMap((kind) => Object.keys(styles[kind]));
}

/** The kind of the style of the name, or undefined when the styles do not define it. */
export function kindOfStyle(
	styles: DeckStyles,
	name: string
): StyleKind | undefined {
	return STYLE_KINDS.find((kind) =>
		Object.prototype.hasOwnProperty.call(styles[kind], name)
	);
}

/**
 * The styles of a value of `drawSlidesCode.deckStyles`, with a line for each entry that they leave
 * out: a value that is no object, a kind other than `rectangles` and `wires`, a name that is not
 * letters and digits starting with a letter or that another kind holds as well, and a style that
 * is not a string. Each style keeps its keys of appearance alone.
 */
export function readDeckStyles(
	value: unknown,
	rules: DeckStyleRules
): { readonly styles: DeckStyles; readonly problems: readonly string[] } {
	const setting = "drawSlidesCode.deckStyles";
	const problems = new Array<string>();
	if (value === undefined) {
		return { styles: NO_DECK_STYLES, problems };
	}
	if (!isPlainObject(value)) {
		return {
			styles: NO_DECK_STYLES,
			problems: [
				`${setting} holds ${JSON.stringify(value)}, where an object of the kinds rectangles and wires was expected, so the deck has no style.`,
			],
		};
	}
	Object.keys(value)
		.filter((kind) => !(STYLE_KINDS as readonly string[]).includes(kind))
		.forEach((kind) =>
			problems.push(
				`${setting} holds the kind ${JSON.stringify(kind)}, where rectangles or wires was expected, so its styles are left out.`
			)
		);
	const seen = new Set<string>();
	const styles = { rectangles: {}, wires: {} } as Record<
		StyleKind,
		Record<string, string>
	>;
	for (const kind of STYLE_KINDS) {
		const given = value[kind];
		if (given === undefined) {
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
					`${setting}.${kind} names a style ${name}, which another kind holds as well, so the second is left out.`
				);
			} else if (typeof style !== "string") {
				problems.push(
					`${setting}.${kind} gives ${name} the value ${JSON.stringify(style)}, where a style string was expected, so the style is left out.`
				);
			} else {
				seen.add(name);
				styles[kind][name] = rules.appearanceOf(style);
			}
		}
	}
	return { styles, problems };
}

/** The cells of a text that link to a style, with the name of the style and whether the cell is an edge. */
function linkedCells(
	text: string
): { readonly link: string; readonly isEdge: boolean }[] {
	return [...text.matchAll(CELL_TAG)].flatMap(([tag]) => {
		const escaped = STYLE_ATTRIBUTE.exec(tag)?.[2];
		const link =
			escaped === undefined
				? undefined
				: LINK_IN_STYLE.exec(unescapeAttribute(escaped))?.[1];
		return link === undefined || link === ""
			? []
			: [{ link, isEdge: EDGE.test(tag) }];
	});
}

function unescapeAttribute(text: string): string {
	return text.replace(/&(quot|lt|gt|apos|amp|#x[0-9A-Fa-f]+|#\d+);/g, (_, entity: string) => {
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
	});
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
