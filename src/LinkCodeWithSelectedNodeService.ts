import { CustomDrawioInstance } from "./DrawioInstance";
import { Disposable } from "@hediet/std/disposable";
import {
	commands,
	window,
	Uri,
	Range,
	Position,
	ThemeColor,
	workspace,
	TextEditorRevealType,
	ViewColumn,
	TextEditorDecorationType,
} from "vscode";
import { wait } from "@hediet/std/timer";

export class LinkCodeWithSelectedNodeService {
	public readonly dispose = Disposable.fn();

	public lastDrawioInstance: CustomDrawioInstance | undefined = undefined;

	constructor() {
		this.dispose.track(
			commands.registerCommand(
				"hediet.vscode-drawio.linkCodeWithSelectedNode",
				() => {
					if (!this.lastDrawioInstance) {
						window.showErrorMessage("No active drawio instance.");
						return;
					}
					const editor = window.activeTextEditor;

					if (!editor) {
						window.showErrorMessage("No text editor active.");
						return;
					}

					if (!editor.selection) {
						window.showErrorMessage("Nothing selected.");
						return;
					}

					const pos = new CodePosition(
						editor.document.uri,
						editor.selection
					);
					this.lastDrawioInstance.linkSelectedNodeWithData(
						pos.serialize()
					);
				}
			)
		);
	}

	handleDrawioInstance(drawioInstance: CustomDrawioInstance): void {
		drawioInstance.onDidDispose.sub(() => {
			this.lastDrawioInstance = undefined;
		});
		drawioInstance.onBlur.sub(() => {
			this.lastDrawioInstance = drawioInstance;
		});
		drawioInstance.onRevealCode.sub(async ({ linkedData }) => {
			const pos = CodePosition.deserialize(linkedData);
			await this.revealSelection(pos);
		});
		this.lastDrawioInstance = drawioInstance;
	}

	private lastDecorationType: TextEditorDecorationType | undefined;

	private async revealSelection(pos: CodePosition): Promise<void> {
		const d = await workspace.openTextDocument(pos.uri);
		const e = await window.showTextDocument(d, {
			viewColumn: ViewColumn.One,
			preserveFocus: true,
		});

		e.revealRange(pos.range, TextEditorRevealType.Default);

		const highlightDecorationType = window.createTextEditorDecorationType({
			backgroundColor: new ThemeColor(
				"editor.stackFrameHighlightBackground"
			),
		});

		if (this.lastDecorationType) {
			e.setDecorations(this.lastDecorationType, []);
		}
		this.lastDecorationType = highlightDecorationType;

		e.setDecorations(highlightDecorationType, [pos.range]);
		wait(1000).then(() => {
			e.setDecorations(highlightDecorationType, []);
		});
	}
}

class CodePosition {
	public static deserialize(str: string): CodePosition {
		const data = JSON.parse(str) as Data;
		function getPosition(pos: PositionData): Position {
			return new Position(pos.line, pos.col);
		}

		return new CodePosition(
			Uri.parse(data["uri"]),
			new Range(getPosition(data.start), getPosition(data.end))
		);
	}

	constructor(public readonly uri: Uri, public readonly range: Range) {}

	public serialize(): string {
		function toPosition(pos: Position): PositionData {
			return {
				col: pos.character,
				line: pos.line,
			};
		}

		const data: Data = {
			uri: this.uri.toString(),
			start: toPosition(this.range.start),
			end: toPosition(this.range.end),
		};
		return JSON.stringify(data);
	}
}

interface Data {
	uri: string;
	start: PositionData;
	end: PositionData;
}

interface PositionData {
	line: number;
	col: number;
}
