import * as fs from "fs";
import { Range, TextDocument, Uri, window, workspace, WorkspaceEdit } from "vscode";
import {
	colorUsesInDrawing,
	withColorUseEditsInDrawing,
} from "../deck/deckColorFiles";
import {
	addedColorUses,
	ColorUseEdit,
	ColorUses,
	NO_COLOR_USES,
} from "../deck/deckColorLinks";
import { changedPart } from "./slideSettings";

/** The button of the question before a removal that removes the color. */
export const DELETE_COLOR = "Delete";

/**
 * Writes an edit of the colors of a deck with its uses in the drawing files of the deck, by their
 * paths. A new value goes into each linked use, a new name into each link and each formula that
 * names the color, and the last value of a removed color, from `colors`, into each linked use and
 * each formula, in place of its name. Before a removal, a modal dialog of VS Code names the color
 * and the uses that keep its value, and the edit goes on only after its button Delete.
 * `writeSettings` then writes the setting, and `writeColorUseEdits` the drawing files. Returns
 * whether the edit was written.
 */
export async function writeDeckColorEditWithUses(
	edit: DeckColorEdit,
	files: readonly string[],
	colors: ReadonlyMap<string, string>,
	writeSettings: () => Promise<void>
): Promise<boolean> {
	const useEdit = colorUseEditOf(edit, colors);
	const documents =
		useEdit === undefined ? [] : await openDrawingDocuments(files);
	if (useEdit?.operation === "remove") {
		const uses = documents.reduce(
			(sum, document) =>
				addedColorUses(
					sum,
					colorUsesInDrawing(document.getText(), useEdit.name)
				),
			NO_COLOR_USES
		);
		const answer = await window.showWarningMessage(
			`Delete the color ${useEdit.name}, ${useEdit.value}?`,
			{ modal: true, detail: removalDetail(useEdit.name, useEdit.value, uses) },
			DELETE_COLOR
		);
		if (answer !== DELETE_COLOR) {
			return false;
		}
	}
	await writeSettings();
	if (useEdit !== undefined) {
		await writeColorUseEdits([useEdit], documents);
	}
	return true;
}

/**
 * The open text documents of the drawing files, one per file, also when two paths lead to the
 * same file through a link of the file system.
 */
export async function openDrawingDocuments(
	files: readonly string[]
): Promise<TextDocument[]> {
	const byRealPath = new Map<string, string>();
	for (const file of files) {
		const realPath = realPathOf(file);
		if (!byRealPath.has(realPath)) {
			byRealPath.set(realPath, file);
		}
	}
	return Promise.all(
		[...byRealPath.values()].map((file) =>
			workspace.openTextDocument(Uri.file(file))
		)
	);
}

/**
 * Writes the edits of the uses of colors into the documents in one edit of VS Code, and saves
 * each document that had no unsaved changes before it. Each text is read right before the edit,
 * with no wait between the reading and the edit, so a change of an open drawing in the meantime
 * stays. A document with unsaved changes takes the edit in its editor and stays unsaved, and a
 * message names it. Raises `Error` when VS Code does not apply the edit or does not save a file.
 */
export async function writeColorUseEdits(
	edits: readonly ColorUseEdit[],
	documents: readonly TextDocument[]
): Promise<void> {
	await writeDrawingEdits(
		documents,
		(text) => withColorUseEditsInDrawing(text, edits),
		"the color",
		"drawSlidesCode.colors"
	);
}

/**
 * Writes the edit of the texts of drawing files that `edited` makes into the documents in one edit
 * of VS Code, and saves each document that had no unsaved changes before it, as
 * `writeColorUseEdits` does. `subject` names what changes, such as `the color`, in the messages,
 * and `setting` the setting that holds the edit.
 */
export async function writeDrawingEdits(
	documents: readonly TextDocument[],
	edited: (text: string) => string,
	subject: string,
	setting: string
): Promise<void> {
	const changed = documents
		.map((document) => {
			const before = document.getText();
			return {
				document,
				before,
				after: edited(before),
				isDirty: document.isDirty,
			};
		})
		.filter(({ before, after }) => before !== after);
	if (changed.length === 0) {
		return;
	}
	const workspaceEdit = new WorkspaceEdit();
	for (const { document, before, after } of changed) {
		const change = changedPart(before, after);
		workspaceEdit.replace(
			document.uri,
			new Range(
				document.positionAt(change.start),
				document.positionAt(change.end)
			),
			change.text
		);
	}
	if (!(await workspace.applyEdit(workspaceEdit))) {
		throw new Error(
			`VS Code did not write the uses of ${subject} into ${pathsOf(
				changed.map(({ document }) => document)
			)}, while ${setting} holds the edit.`
		);
	}
	const unsaved = new Array<TextDocument>();
	for (const { document } of changed.filter(({ isDirty }) => !isDirty)) {
		if (!(await document.save())) {
			unsaved.push(document);
		}
	}
	const kept = changed
		.filter(({ isDirty }) => isDirty)
		.map(({ document }) => document);
	if (kept.length > 0) {
		window.showInformationMessage(keptUnsavedMessage(kept, subject));
	}
	if (unsaved.length > 0) {
		throw new Error(
			`VS Code did not save the uses of ${subject} in ${pathsOf(
				unsaved
			)}, while ${setting} holds the edit.`
		);
	}
}

/** The message that names the drawing files that hold an edit of a color with unsaved changes. */
export function keptUnsavedMessage(
	documents: readonly TextDocument[],
	subject = "the color"
): string {
	return documents.length === 1
		? `${pathsOf(documents)} holds the change of ${subject} with its other unsaved changes.`
		: `${pathsOf(documents)} hold the change of ${subject} with their other unsaved changes.`;
}

function pathsOf(documents: readonly TextDocument[]): string {
	return documents.map((document) => document.uri.fsPath).join(", ");
}

/** The path of the file with every link of the file system followed, or the path itself when the file is missing. */
function realPathOf(file: string): string {
	try {
		return fs.realpathSync(file);
	} catch {
		return file;
	}
}

/**
 * The edit of the uses of a color that an edit of the colors makes: a new value, a new name, or
 * the removal of a color of the deck with its value. A value that `colors` already gives the
 * color changes no use, and a removed color that `colors` lacks has no value to fall back on. A
 * new value of a name that `colors` lacks still reaches the uses, because the colors of the deck
 * may not yet hold a rename sent just before it.
 */
function colorUseEditOf(
	edit: DeckColorEdit,
	colors: ReadonlyMap<string, string>
): ColorUseEdit | undefined {
	const value = colors.get(edit.name);
	switch (edit.operation) {
		case "rename":
			return edit.newName === edit.name ? undefined : edit;
		case "remove":
			return value === undefined
				? undefined
				: { operation: "remove", name: edit.name, value };
		case "set":
			return value?.toUpperCase() === edit.value.toUpperCase()
				? undefined
				: { operation: "set", name: edit.name, value: edit.value.toUpperCase() };
	}
}

/**
 * The detail of the question before a removal, which counts the uses that keep the value and says
 * that the editor of each open drawing starts a new undo history, which `deck-color-links.plugin.js`
 * clears.
 */
export function removalDetail(
	name: string,
	value: string,
	uses: ColorUses
): string {
	const linked = [
		nounWithCount(uses.shape, "shape", "shapes"),
		nounWithCount(uses.line, "line", "lines"),
		nounWithCount(uses.text, "text", "texts"),
	].filter((part): part is string => part !== undefined);
	const parts = [
		...(linked.length === 0
			? []
			: [`${joinedWithAnd(linked)} ${uses.shape + uses.line + uses.text === 1 ? "links" : "link"} to ${name}`]),
		...(uses.formula === 0
			? []
			: [`formulas name ${name} ${uses.formula === 1 ? "once" : `${uses.formula} times`}`]),
	];
	const summary = parts.length === 0
		? `No shape, line, text or formula of the drawing files of the deck uses ${name}.`
		: `In the drawing files of the deck, ${parts.join(
				", and "
		  )}. Each use keeps ${value} in place of the name.`;
	return `${summary} The editor of each open drawing of the deck then starts a new undo history.`;
}

export function nounWithCount(
	count: number,
	singular: string,
	plural: string
): string | undefined {
	return count === 0 ? undefined : `${count} ${count === 1 ? singular : plural}`;
}

/** The parts joined by commas, and by "and" before the last. */
export function joinedWithAnd(parts: readonly string[]): string {
	return parts.length === 1
		? parts[0]
		: `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
