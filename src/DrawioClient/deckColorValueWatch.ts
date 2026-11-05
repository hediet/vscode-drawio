import { Disposable, Uri, window, workspace } from "vscode";
import { withColorUseEditsInDrawing } from "../deck/deckColorFiles";
import { ColorUseEdit } from "../deck/deckColorLinks";
import {
	joinedWithAnd,
	openDrawingDocuments,
	writeColorUseEdits,
} from "./deckColorUseEdits";

/** The button of the question after a new value by hand that writes the values into the files. */
export const WRITE_COLOR_VALUES = "Write";

/**
 * Follows `drawSlidesCode.colors` of a deck folder. After a new value of a color that the section
 * Deck colors did not send, such as a value typed in `.vscode/settings.json` or picked with the
 * color picker of VS Code there, a message asks whether to write the new values into the linked
 * uses of the drawing files of the deck, and its button writes them as a new value from the
 * section goes in, by `writeColorUseEdits`. A message comes only when a drawing file would change,
 * so a value that the files already hold, as after a change from the section, asks nothing. A
 * name renamed or removed by hand changes no file.
 */
export class DeckColorValueWatch {
	private knownColors: ReadonlyMap<string, string>;
	/** The number of edits of the section Deck colors being written, whose new values ask nothing. */
	private sectionEdits = 0;
	private readonly listener: Disposable;

	constructor(
		deckFolder: Uri,
		private readonly readColors: () => ReadonlyMap<string, string>,
		private readonly drawingFiles: () => Promise<readonly string[]>,
		private readonly log: (line: string) => void
	) {
		this.knownColors = readColors();
		this.listener = workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration("drawSlidesCode.colors", deckFolder)) {
				this.offerNewValues().catch((error) =>
					this.reportError(error)
				);
			}
		});
	}

	/** Runs the write of an edit of the section Deck colors, whose new values ask nothing. */
	public async whileSectionEdits<T>(write: () => Promise<T>): Promise<T> {
		this.sectionEdits += 1;
		try {
			return await write();
		} finally {
			this.knownColors = this.readColors();
			this.sectionEdits -= 1;
		}
	}

	public dispose(): void {
		this.listener.dispose();
	}

	private async offerNewValues(): Promise<void> {
		const colors = this.readColors();
		const edits = newValueEdits(this.knownColors, colors);
		this.knownColors = colors;
		if (this.sectionEdits > 0 || edits.length === 0) {
			return;
		}
		const files = await this.filesToChange(edits);
		if (files === 0) {
			return;
		}
		const answer = await window.showInformationMessage(
			newValuesQuestion(edits, files),
			WRITE_COLOR_VALUES
		);
		if (answer === WRITE_COLOR_VALUES) {
			await writeColorUseEdits(
				edits,
				await openDrawingDocuments(await this.drawingFiles())
			);
		}
	}

	/** The number of drawing files of the deck whose text the edits change. */
	private async filesToChange(edits: readonly ColorUseEdit[]): Promise<number> {
		const documents = await openDrawingDocuments(await this.drawingFiles());
		return documents.filter((document) => {
			const text = document.getText();
			return withColorUseEditsInDrawing(text, edits) !== text;
		}).length;
	}

	private reportError(error: unknown): void {
		const message = error instanceof Error ? error.message : `${error}`;
		this.log(message);
		window.showErrorMessage(message);
	}
}

/** The edits `set` of each name that both lists of colors hold, with a new value. */
export function newValueEdits(
	before: ReadonlyMap<string, string>,
	after: ReadonlyMap<string, string>
): ColorUseEdit[] {
	return [...after]
		.filter(([name, value]) => {
			const old = before.get(name);
			return old !== undefined && old.toUpperCase() !== value.toUpperCase();
		})
		.map(([name, value]) => ({
			operation: "set",
			name,
			value: value.toUpperCase(),
		}));
}

/** The question after new values by hand, with the names and the number of files to change. */
function newValuesQuestion(edits: readonly ColorUseEdit[], files: number): string {
	const names = joinedWithAnd(edits.map(({ name }) => name));
	const fileCount = files === 1 ? "1 drawing file" : `${files} drawing files`;
	return edits.length === 1
		? `drawSlidesCode.colors gives ${names} a new value. Write the new value into the shapes, the lines and the texts linked to ${names} in ${fileCount} of the deck?`
		: `drawSlidesCode.colors gives ${names} new values. Write the new values into the shapes, the lines and the texts linked to these colors in ${fileCount} of the deck?`;
}
