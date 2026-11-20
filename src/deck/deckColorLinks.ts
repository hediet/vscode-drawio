/**
 * The links of a drawing to the colors of `drawSlidesCode.colors`, read and edited in the XML of a
 * page as the editor saves it.
 *
 * A key of a style that holds a color links to a color of the deck through a key beside it, as
 * `fillColor=#B20000;deckFillColor=red` links the fill to `red`, by `COLOR_LINK_KEYS` of
 * `deckColors.ts`. An element of the HTML of a label links the color of its text through the
 * attribute `data-deck-color`, as `<span data-deck-color="red" style="color: #B20000;">`, and the
 * link holds while the element has a color of its own, in its attribute `color` or in its style.
 * A formula names a color in its commands, as `\textcolor{red}{x}` names `red`, which
 * `formulaColors.ts` reads. The hex value beside a link is the color that a draw.io without the
 * extension draws.
 *
 * The functions read the text of a page as the file holds it, where the HTML of a label is the
 * escaped value of the attribute `value` or `label`, and change only the parts that they edit.
 */
import { COLOR_LINK_KEYS, TEXT_COLOR_LINK } from "./deckColors";
import {
	colorNamesOf,
	formulasOfPage,
	withEachFormulaOfPage,
	withNamedColorChanged,
} from "./formulaColors";

/**
 * An edit of the uses of a color: `set` gives the linked uses the new value of the color,
 * `rename` gives the links and the formulas the new name, and `remove` gives the linked uses and
 * the formulas the last value of the color in place of its name.
 */
export type ColorUseEdit =
	| { readonly operation: "set"; readonly name: string; readonly value: string }
	| {
			readonly operation: "rename";
			readonly name: string;
			readonly newName: string;
	  }
	| {
			readonly operation: "remove";
			readonly name: string;
			readonly value: string;
	  };

/**
 * What a linked use is, as the question before a removal counts it: an edge is a line, a cell
 * whose style starts with `text` and a linked element of a label are texts, and any other cell is
 * a shape. A cell counts once, however many of its keys link to the color.
 */
export type LinkedUseKind = "shape" | "line" | "text";

/** The uses of a color: the linked cells and texts by their kind, and the color arguments of the formulas. */
export type ColorUses = Readonly<Record<LinkedUseKind | "formula", number>>;

export const NO_COLOR_USES: ColorUses = {
	shape: 0,
	line: 0,
	text: 0,
	formula: 0,
};

/**
 * A value beside a link that differs from the value of the color, which a draw.io without the
 * extension draws in place of the color.
 */
export interface DifferingLinkedValue {
	/** The value as the file writes it, such as `#00AA00` or `rgb(0, 170, 0)`. */
	readonly written: string;
	readonly name: string;
	/** The value of the color, `#RRGGBB`. */
	readonly value: string;
}

/**
 * What an edit does to a link: it keeps the link and gives the use a new value, gives the link a
 * new name, or takes the link out and gives the use the last value of the color.
 */
type LinkChange =
	| { readonly kind: "keep-link"; readonly value: string }
	| { readonly kind: "rename-link"; readonly link: string }
	| { readonly kind: "remove-link"; readonly value: string };

/**
 * The change of a link of the name, given the value beside the link, or undefined to leave the
 * link as it is.
 */
type LinkRewrite = (name: string, written: string | undefined) => LinkChange | undefined;

const STYLE_ATTRIBUTE = /(\sstyle=")([^"]*)(")/g;
const LABEL_ATTRIBUTE = /(\s(?:value|label)=")([^"]*)(")/g;
/** The start tag of a cell, which carries its style and whether it is an edge. */
const CELL_TAG = /<mxCell\b[^>]*>/g;
const STYLE_OF_CELL = /\sstyle="([^"]*)"/;
const EDGE = /\sedge="1"/;
/** The start tag of a span or of a font element in the escaped HTML of a label. */
const ESCAPED_TAG = /&lt;(?:span|font)\b(?:(?!&gt;)[\s\S])*&gt;/gi;
const TEXT_LINK = new RegExp(`(\\s${TEXT_COLOR_LINK}=&quot;)([^&]*)(&quot;)`);
const COLOR_ATTRIBUTE = /(\scolor=&quot;)([^&]*)(&quot;)/;
const STYLE_OF_TAG = /(\sstyle=&quot;)((?:(?!&quot;)[\s\S])*)(&quot;)/;
const COLOR_DECLARATION = /((?:^|;)\s*color\s*:\s*)([^;]*)/i;
const HEX_VALUE = /^#[0-9A-Fa-f]{6}$/;
const RGB_VALUE = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i;

/**
 * The page with each linked use of a known color in its current value, the names of the links
 * that the colors do not define, whose uses keep their hex values, and the values beside the
 * links of known colors that differ from the colors. The build draws a page so.
 */
export function withLinkedColorValues(
	page: string,
	colors: ReadonlyMap<string, string>
): {
	readonly page: string;
	readonly unknown: readonly string[];
	readonly differing: readonly DifferingLinkedValue[];
} {
	const unknown = new Set<string>();
	const differing = new Map<string, DifferingLinkedValue>();
	const rewrite: LinkRewrite = (name, written) => {
		const value = colors.get(name);
		if (value === undefined) {
			unknown.add(name);
			return undefined;
		}
		if (written !== undefined && !isSameColor(written, value)) {
			differing.set(`${written}\n${name}`, { written, name, value });
		}
		return { kind: "keep-link", value };
	};
	const linked = withLinkedTexts(withLinkedStyles(page, rewrite), rewrite);
	return {
		page: linked,
		unknown: [...unknown].sort(),
		differing: [...differing.values()],
	};
}

/** The page after the edit of the links of a color and of the uses that they link. */
export function withLinkedUseEdit(page: string, edit: ColorUseEdit): string {
	const rewrite = linkRewrite(edit);
	return withLinkedTexts(withLinkedStyles(page, rewrite), rewrite);
}

/**
 * A style string, as `drawSlidesCode.deckStyles` holds one, after the edit of its links to a color
 * and of the keys that they link.
 */
export function withLinkedStyleStringEdit(
	style: string,
	edit: ColorUseEdit
): string {
	const rewrite = linkRewrite(edit);
	return Object.entries(COLOR_LINK_KEYS)
		.reduce<readonly string[]>(
			(entries, [key, { link }]) =>
				withLinkedKeyChanged(entries, key, link, rewrite),
			style.split(";")
		)
		.join(";");
}

/** The page after the edit of the formulas of its labels that name the color. */
export function withFormulaUseEdit(
	page: string,
	edit: Exclude<ColorUseEdit, { operation: "set" }>
): string {
	const change =
		edit.operation === "rename"
			? ({ kind: "rename", newName: edit.newName } as const)
			: ({ kind: "value", value: edit.value } as const);
	return withEachFormulaOfPage(page, (formula) =>
		withNamedColorChanged(formula, edit.name, change)
	);
}

/** The cells and the texts of the page linked to the color, by their kind, with no formula counted. */
export function linkedUsesOf(page: string, name: string): ColorUses {
	const cells = [...page.matchAll(CELL_TAG)]
		.map(([tag]) => ({ tag, style: STYLE_OF_CELL.exec(tag)?.[1] }))
		.filter(
			({ style }) =>
				style !== undefined &&
				Object.values(COLOR_LINK_KEYS).some(
					({ link }) => styleValue(style.split(";"), link) === name
				)
		)
		.map(({ tag, style }) => linkedCellKind(tag, style!));
	const texts = [...page.matchAll(LABEL_ATTRIBUTE)].flatMap(
		([, , label]) =>
			(label.match(ESCAPED_TAG) ?? []).filter(
				(tag) => TEXT_LINK.exec(tag)?.[2] === name && hasOwnColor(tag)
			)
	);
	return {
		shape: cells.filter((kind) => kind === "shape").length,
		line: cells.filter((kind) => kind === "line").length,
		text: cells.filter((kind) => kind === "text").length + texts.length,
		formula: 0,
	};
}

/** The number of color arguments of the formulas of the page that name the color. */
export function formulaUsesOfPage(page: string, name: string): number {
	return formulasOfPage(page)
		.flatMap(colorNamesOf)
		.filter((named) => named === name).length;
}

/** The sum of the uses of each kind. */
export function addedColorUses(first: ColorUses, second: ColorUses): ColorUses {
	return {
		shape: first.shape + second.shape,
		line: first.line + second.line,
		text: first.text + second.text,
		formula: first.formula + second.formula,
	};
}

function linkedCellKind(tag: string, style: string): LinkedUseKind {
	if (EDGE.test(tag)) {
		return "line";
	}
	return style.split(";")[0] === "text" ? "text" : "shape";
}

function linkRewrite(edit: ColorUseEdit): LinkRewrite {
	return (name) => {
		if (name !== edit.name) {
			return undefined;
		}
		switch (edit.operation) {
			case "set":
				return { kind: "keep-link", value: edit.value };
			case "rename":
				return { kind: "rename-link", link: edit.newName };
			case "remove":
				return { kind: "remove-link", value: edit.value };
		}
	};
}

/** The page with each linked key of a style changed as the rewrite of its link says. */
function withLinkedStyles(page: string, rewrite: LinkRewrite): string {
	return page.replace(
		STYLE_ATTRIBUTE,
		(whole, start: string, style: string, end: string) => {
			const edited = Object.entries(COLOR_LINK_KEYS)
				.reduce<readonly string[]>(
					(entries, [key, { link }]) =>
						withLinkedKeyChanged(entries, key, link, rewrite),
					style.split(";")
				)
				.join(";");
			return edited === style ? whole : start + edited + end;
		}
	);
}

/** The entries of a style with the key and its link changed as the rewrite of the link says. */
function withLinkedKeyChanged(
	entries: readonly string[],
	key: string,
	link: string,
	rewrite: LinkRewrite
): readonly string[] {
	const name = styleValue(entries, link);
	const change =
		name === undefined ? undefined : rewrite(name, styleValue(entries, key));
	if (change === undefined) {
		return entries;
	}
	switch (change.kind) {
		case "keep-link":
			return withStyleValue(entries, key, change.value);
		case "rename-link":
			return withStyleValue(entries, link, change.link);
		case "remove-link":
			return withoutStyleKey(withStyleValue(entries, key, change.value), link);
	}
}

/** The page with each linked text of a label changed as the rewrite of its link says. */
function withLinkedTexts(page: string, rewrite: LinkRewrite): string {
	return page.replace(
		LABEL_ATTRIBUTE,
		(whole, start: string, label: string, end: string) => {
			if (!label.includes(TEXT_COLOR_LINK)) {
				return whole;
			}
			return (
				start +
				label.replace(ESCAPED_TAG, (tag) => withLinkedTag(tag, rewrite)) +
				end
			);
		}
	);
}

/**
 * The start tag after the rewrite of its link. A link of an element without a color of its own
 * links nothing, and a removal takes it out too.
 */
function withLinkedTag(tag: string, rewrite: LinkRewrite): string {
	const name = TEXT_LINK.exec(tag)?.[2];
	const change =
		name === undefined ? undefined : rewrite(name, ownColorOf(tag));
	if (
		change === undefined ||
		(!hasOwnColor(tag) && change.kind !== "remove-link")
	) {
		return tag;
	}
	switch (change.kind) {
		case "keep-link":
			return withTagColor(tag, change.value);
		case "rename-link":
			return tag.replace(
				TEXT_LINK,
				(_, start: string, __, end: string) => start + change.link + end
			);
		case "remove-link":
			return withTagColor(tag, change.value).replace(TEXT_LINK, "");
	}
}

/** The start tag with its own color, in its attribute `color` and in its style, given the value. */
function withTagColor(tag: string, value: string): string {
	return tag
		.replace(COLOR_ATTRIBUTE, (_, start, __, end) => start + value + end)
		.replace(
			STYLE_OF_TAG,
			(_, start: string, style: string, end: string) =>
				start +
				style.replace(
					COLOR_DECLARATION,
					(__, declaration: string) => declaration + value
				) +
				end
		);
}

/** Whether the escaped start tag gives its text a color of its own. */
function hasOwnColor(tag: string): boolean {
	return ownColorOf(tag) !== undefined;
}

/** The color that the escaped start tag gives its text, from its style or else its attribute `color`. */
function ownColorOf(tag: string): string | undefined {
	const style = STYLE_OF_TAG.exec(tag)?.[2] ?? "";
	return (
		COLOR_DECLARATION.exec(style)?.[2].trim() ?? COLOR_ATTRIBUTE.exec(tag)?.[2]
	);
}

/** Whether a color as a file writes it, `#RRGGBB` or `rgb(r, g, b)`, is the value `#RRGGBB`. */
function isSameColor(written: string, value: string): boolean {
	const rgb = RGB_VALUE.exec(written.trim());
	const hex = HEX_VALUE.test(written.trim())
		? written.trim()
		: rgb === null
		? undefined
		: "#" +
		  rgb
				.slice(1)
				.map((part) => Number(part).toString(16).padStart(2, "0"))
				.join("");
	return hex !== undefined && hex.toUpperCase() === value.toUpperCase();
}

/** The value of a key among the entries `key=value` of a style, or undefined. */
function styleValue(entries: readonly string[], key: string): string | undefined {
	const entry = entries.find((candidate) => candidate.startsWith(key + "="));
	return entry?.slice(key.length + 1);
}

/**
 * The entries of a style with the key given the value, in the place of the key or else before
 * the empty entry that a closing `;` leaves.
 */
function withStyleValue(
	entries: readonly string[],
	key: string,
	value: string
): readonly string[] {
	const index = entries.findIndex((entry) => entry.startsWith(key + "="));
	if (index >= 0) {
		return entries.map((entry, position) =>
			position === index ? `${key}=${value}` : entry
		);
	}
	const end =
		entries.length > 0 && entries[entries.length - 1] === ""
			? entries.length - 1
			: entries.length;
	return [...entries.slice(0, end), `${key}=${value}`, ...entries.slice(end)];
}

/** The entries of a style without the key. */
function withoutStyleKey(
	entries: readonly string[],
	key: string
): readonly string[] {
	return entries.filter((entry) => !entry.startsWith(key + "="));
}
