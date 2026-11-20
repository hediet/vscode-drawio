import * as jsoncParser from "jsonc-parser";
import {
	DeckStyleRules,
	DeckStyles,
	styleNamed,
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
	const before = styleNamed(styles, edit.name);
	return before === undefined
		? undefined
		: {
				operation: "update",
				name: edit.name,
				before: before.style,
				after: edit.style,
		  };
}

/**
 * The text of a settings file of VS Code after the edit of its member `drawSlidesCode.deckStyles`,
 * with every other member and every comment as they were.
 * A style keeps its keys of appearance alone.
 * Raises `RefusedStyleEdit` for an edit that the extension does not write.
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
			)}, where an object of kinds of geometry was expected, so the file stays as it is.`
		);
	}
	const kind = checkedKind(stylesOf(given), edit, rules);
	if (edit.operation === "set") {
		return jsoncParser.applyEdits(
			text,
			jsoncParser.modify(
				text,
				[DECK_STYLES, kind, edit.name],
				rules.appearanceOf(edit.style),
				{ formattingOptions: formattingOf(text) }
			)
		);
	}
	if (edit.operation === "rename" && edit.newName === edit.name) {
		return text;
	}
	const property = jsoncParser.findNodeAtLocation(root!, [
		DECK_STYLES,
		kind,
		edit.name,
	])!.parent!;
	if (edit.operation === "remove") {
		// The last style of a kind takes its kind with it.
		const kindProperty = property.parent!.parent!;
		return withoutProperty(
			text,
			property.parent!.children!.length === 1 ? kindProperty : property
		);
	}
	const key = property.children![0];
	return (
		text.slice(0, key.offset) +
		JSON.stringify(edit.newName) +
		text.slice(key.offset + key.length)
	);
}

/** The styles of `drawSlidesCode.deckStyles` after the edit, for a settings file that VS Code writes whole. */
export function withStyleEdit(
	given: Record<string, unknown>,
	edit: DeckStyleEdit,
	rules: DeckStyleRules
): Record<string, unknown> {
	const kind = checkedKind(stylesOf(given), edit, rules);
	const named = isPlainObject(given[kind]) ? given[kind] : {};
	const entries = Object.entries(named)
		.filter(([name]) => edit.operation !== "remove" || name !== edit.name)
		.map(([name, style]) =>
			edit.operation === "rename" && name === edit.name
				? [edit.newName, style]
				: [name, style]
		);
	const styles = Object.fromEntries(entries);
	if (edit.operation === "set") {
		styles[edit.name] = rules.appearanceOf(edit.style);
	}
	if (Object.keys(styles).length > 0) {
		return { ...given, [kind]: styles };
	}
	// The last style of a kind takes its kind with it.
	return Object.fromEntries(
		Object.entries(given).filter(([other]) => other !== kind)
	);
}

/** The styles of each kind of a value of the setting, the names alone counting. */
function stylesOf(given: Record<string, unknown>): DeckStyles {
	return Object.fromEntries(
		Object.entries(given)
			.filter(([, named]) => isPlainObject(named))
			.map(([kind, named]) => [kind, named as Record<string, string>])
	);
}

/** The kind of the style that the edit writes, after the checks that may refuse the edit. */
function checkedKind(
	styles: DeckStyles,
	edit: DeckStyleEdit,
	rules: DeckStyleRules
): string {
	const existing = styleNamed(styles, edit.name);
	switch (edit.operation) {
		case "set":
			if (!rules.isKind(edit.kind)) {
				throw new RefusedStyleEdit(
					`The kind ${JSON.stringify(
						edit.kind
					)} is no name of a shape of draw.io, so ${DECK_STYLES} stays as it is.`
				);
			}
			if (!rules.isName(edit.name)) {
				throw new RefusedStyleEdit(
					`The name ${JSON.stringify(
						edit.name
					)} is not letters and digits that start with a letter, so ${DECK_STYLES} stays as it is.`
				);
			}
			if (existing !== undefined && existing.kind !== edit.kind) {
				throw new RefusedStyleEdit(
					`${DECK_STYLES} already defines a style ${edit.name} of the kind ${existing.kind}, so the setting stays as it is.`
				);
			}
			if (typeof edit.style !== "string") {
				throw new RefusedStyleEdit(
					`The style of ${edit.name} is not a string, so ${DECK_STYLES} stays as it is.`
				);
			}
			return edit.kind;
		case "rename":
		case "remove":
			if (existing === undefined) {
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
					styleNamed(styles, edit.newName) !== undefined
				) {
					throw new RefusedStyleEdit(
						`${DECK_STYLES} already defines a style ${edit.newName}, so ${edit.name} keeps its name.`
					);
				}
			}
			return existing.kind;
		default:
			throw new RefusedStyleEdit(
				`The edit of ${DECK_STYLES} names the operation ${JSON.stringify(
					(edit as { operation: unknown }).operation
				)}, where set, rename or remove was expected, so the setting stays as it is.`
			);
	}
}
