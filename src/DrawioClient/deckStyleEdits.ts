import * as jsoncParser from "jsonc-parser";
import {
	DeckStyleRules,
	DeckStyles,
	kindOfStyle,
	STYLE_KINDS,
	StyleUseEdit,
} from "../deck/deckStyles";
import {
	formattingOf,
	isPlainObject,
	parseSettings,
	withoutProperty,
} from "./deckColorEdits";

const DECK_STYLES = "drawSlidesCode.deckStyles";

/** An edit of `drawSlidesCode.deckStyles` that the extension refuses, with the reason. */
export class RefusedStyleEdit extends Error {
	public readonly name = "RefusedStyleEdit";
}

/**
 * The edit of the cells linked to a style that an edit of the styles makes, given the styles before
 * the edit: a new style string of a style that exists updates its cells, a new style changes no
 * cell, a rename renames the links and a removal takes them out.
 */
export function styleUseEditOf(
	edit: DeckStyleEdit,
	styles: DeckStyles
): StyleUseEdit | undefined {
	if (edit.operation !== "set") {
		return edit;
	}
	const kind = kindOfStyle(styles, edit.name);
	return kind === undefined
		? undefined
		: {
				operation: "update",
				name: edit.name,
				before: styles[kind][edit.name],
				after: edit.style,
		  };
}

/**
 * The text of a settings file of VS Code after the edit of its member `drawSlidesCode.deckStyles`,
 * with every other member and every comment as they were. A style keeps its keys of appearance
 * alone. Raises `RefusedStyleEdit` for an edit that the extension does not write.
 */
export function withStyleEditInSettings(
	text: string,
	edit: DeckStyleEdit,
	rules: DeckStyleRules
): string {
	const root = parseSettings(text);
	const node = root && jsoncParser.findNodeAtLocation(root, [DECK_STYLES]);
	const given: unknown = node ? jsoncParser.getNodeValue(node) : {};
	if (!isPlainObject(given)) {
		throw new RefusedStyleEdit(
			`The settings file gives ${DECK_STYLES} the value ${JSON.stringify(
				given
			)}, where an object of the kinds rectangles and wires was expected, so the file stays as it is.`
		);
	}
	const styles = stylesOf(given);
	checkStyleEdit(styles, edit, rules);
	const options = { formattingOptions: formattingOf(text) };
	switch (edit.operation) {
		case "set": {
			const style = rules.appearanceOf(edit.style);
			return jsoncParser.applyEdits(
				text,
				jsoncParser.modify(
					text,
					[DECK_STYLES, edit.kind, edit.name],
					style,
					options
				)
			);
		}
		case "remove": {
			const kind = kindOfStyle(styles, edit.name)!;
			const property = jsoncParser.findNodeAtLocation(root!, [
				DECK_STYLES,
				kind,
				edit.name,
			])!.parent!;
			return withoutProperty(text, property);
		}
		case "rename": {
			if (edit.newName === edit.name) {
				return text;
			}
			const kind = kindOfStyle(styles, edit.name)!;
			const key = jsoncParser.findNodeAtLocation(root!, [
				DECK_STYLES,
				kind,
				edit.name,
			])!.parent!.children![0];
			return (
				text.slice(0, key.offset) +
				JSON.stringify(edit.newName) +
				text.slice(key.offset + key.length)
			);
		}
	}
}

/** The styles of `drawSlidesCode.deckStyles` after the edit, for a settings file that VS Code writes whole. */
export function withStyleEdit(
	given: Record<string, unknown>,
	edit: DeckStyleEdit,
	rules: DeckStyleRules
): Record<string, unknown> {
	const styles = stylesOf(given);
	checkStyleEdit(styles, edit, rules);
	const result: Record<string, unknown> = { ...given };
	const kindOf =
		edit.operation === "set" ? edit.kind : kindOfStyle(styles, edit.name)!;
	const named = isPlainObject(given[kindOf]) ? given[kindOf] : {};
	result[kindOf] = Object.fromEntries(
		Object.entries(named as Record<string, unknown>)
			.filter(([name]) => edit.operation !== "remove" || name !== edit.name)
			.map(([name, style]) =>
				edit.operation === "rename" && name === edit.name
					? [edit.newName, style]
					: [name, style]
			)
			.concat(
				edit.operation === "set"
					? [[edit.name, rules.appearanceOf(edit.style)]]
					: []
			)
	);
	return result;
}

/** The styles of each kind of a value of the setting, the names alone counting. */
function stylesOf(given: Record<string, unknown>): DeckStyles {
	const named = (kind: string): Record<string, string> =>
		isPlainObject(given[kind])
			? (given[kind] as Record<string, string>)
			: {};
	return { rectangles: named("rectangles"), wires: named("wires") };
}

function checkStyleEdit(
	styles: DeckStyles,
	edit: DeckStyleEdit,
	rules: DeckStyleRules
): void {
	const kind = kindOfStyle(styles, edit.name);
	switch (edit.operation) {
		case "set":
			if (!(STYLE_KINDS as readonly string[]).includes(edit.kind)) {
				throw new RefusedStyleEdit(
					`The kind ${JSON.stringify(
						edit.kind
					)} is not rectangles or wires, so ${DECK_STYLES} stays as it is.`
				);
			}
			if (!rules.isName(edit.name)) {
				throw new RefusedStyleEdit(
					`The name ${JSON.stringify(
						edit.name
					)} is not letters and digits that start with a letter, so ${DECK_STYLES} stays as it is.`
				);
			}
			if (kind !== undefined && kind !== edit.kind) {
				throw new RefusedStyleEdit(
					`${DECK_STYLES} already defines a style ${edit.name} of the ${kind}, so the setting stays as it is.`
				);
			}
			if (typeof edit.style !== "string") {
				throw new RefusedStyleEdit(
					`The style of ${edit.name} is not a string, so ${DECK_STYLES} stays as it is.`
				);
			}
			return;
		case "rename":
		case "remove":
			if (kind === undefined) {
				throw new RefusedStyleEdit(
					`${DECK_STYLES} defines no style ${JSON.stringify(
						edit.name
					)}, so the setting stays as it is.`
				);
			}
			if (edit.operation === "rename") {
				if (!rules.isName(edit.newName)) {
					throw new RefusedStyleEdit(
						`The name ${JSON.stringify(
							edit.newName
						)} is not letters and digits that start with a letter, so ${
							edit.name
						} keeps its name.`
					);
				}
				if (
					edit.newName !== edit.name &&
					kindOfStyle(styles, edit.newName) !== undefined
				) {
					throw new RefusedStyleEdit(
						`${DECK_STYLES} already defines a style ${edit.newName}, so ${edit.name} keeps its name.`
					);
				}
			}
			return;
		default:
			throw new RefusedStyleEdit(
				`The edit of ${DECK_STYLES} names the operation ${JSON.stringify(
					(edit as { operation: unknown }).operation
				)}, where set, rename or remove was expected, so the setting stays as it is.`
			);
	}
}
