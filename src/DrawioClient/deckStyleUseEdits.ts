import { window } from "vscode";
import {
	addedStyleUses,
	DeckStyleRules,
	DeckStyles,
	NO_STYLE_USES,
	styleUsesInDrawing,
	StyleUseEdit,
	StyleUses,
	withStyleUseEditsInDrawing,
} from "../deck/deckStyles";
import {
	joinedWithAnd,
	nounWithCount,
	openDrawingDocuments,
	writeDrawingEdits,
} from "./deckColorUseEdits";
import { styleUseEditOf } from "./deckStyleEdits";

/** The button of the question before a removal that removes the style. */
export const DELETE_STYLE = "Delete";

/**
 * Writes an edit of the styles of a deck with the cells linked to the style in the drawing files of
 * the deck, by their paths. A new style string of a style that exists goes into each linked cell
 * that holds the keys as the style held them, a new name into each link, and a removal takes each
 * link out and leaves the keys. Before a removal, a modal dialog of VS Code counts the linked
 * cells, and the edit goes on only after its button Delete, and after a rename a message counts
 * them. `writeSettings` writes the setting, before the drawing files. Returns the edit of the linked
 * cells when the edit was written, which the open drawings of the deck then apply, `null` for an
 * edit written that changes no cell, and `undefined` for an edit that the dialog cancelled.
 */
export async function writeDeckStyleEditWithUses(
	edit: DeckStyleEdit,
	files: readonly string[],
	styles: DeckStyles,
	rules: DeckStyleRules,
	writeSettings: () => Promise<void>
): Promise<StyleUseEdit | null | undefined> {
	const useEdit = styleUseEditOf(edit, styles);
	const documents =
		useEdit === undefined ? [] : await openDrawingDocuments(files);
	const uses = () =>
		documents.reduce(
			(sum, document) =>
				addedStyleUses(sum, styleUsesInDrawing(document.getText(), edit.name)),
			NO_STYLE_USES
		);
	if (edit.operation === "remove") {
		const answer = await window.showWarningMessage(
			`Delete the style ${edit.name}?`,
			{ modal: true, detail: styleRemovalDetail(edit.name, uses()) },
			DELETE_STYLE
		);
		if (answer !== DELETE_STYLE) {
			return undefined;
		}
	}
	const renamed = edit.operation === "rename" ? uses() : undefined;
	await writeSettings();
	if (useEdit !== undefined) {
		await writeDrawingEdits(
			documents,
			(text) => withStyleUseEditsInDrawing(text, [useEdit], rules),
			`the style ${edit.name}`,
			"drawSlidesCode.deckStyles"
		);
	}
	if (edit.operation === "rename" && renamed !== undefined) {
		window.showInformationMessage(
			`The style ${edit.name} is now ${edit.newName}, in ${usesText(renamed)} of the drawing files of the deck.`
		);
	}
	return useEdit ?? null;
}

/** The detail of the question before a removal, which counts the cells that keep the keys of the style. */
export function styleRemovalDetail(name: string, uses: StyleUses): string {
	const count = uses.rectangles + uses.wires;
	return count === 0
		? `No rectangle or wire of the drawing files of the deck links to ${name}.`
		: `In the drawing files of the deck, ${usesText(uses)} ${
				count === 1 ? "links" : "link"
		  } to ${name}, and each keeps the keys of the style without the link. The editor of each open drawing of the deck then starts a new undo history.`;
}

function usesText(uses: StyleUses): string {
	const parts = [
		nounWithCount(uses.rectangles, "rectangle", "rectangles"),
		nounWithCount(uses.wires, "wire", "wires"),
	].filter((part): part is string => part !== undefined);
	return parts.length === 0 ? "no cell" : joinedWithAnd(parts);
}
