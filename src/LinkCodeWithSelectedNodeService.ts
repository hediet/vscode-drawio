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
	TextEditor,
	SymbolInformation,
	DocumentSymbol,
	SymbolKind,
} from "vscode";
import { wait } from "@hediet/std/timer";
import { DrawioEditorManager } from "./DrawioEditorManager";
import { autorun, observable, action } from "mobx";
import { Config } from "./Config";

export class LinkCodeWithSelectedNodeService {
	public readonly dispose = Disposable.fn();

	private readonly statusBar = window.createStatusBarItem();

	@observable
	private codeLinkEnabled = true;

	private lastActiveTextEditor: TextEditor | undefined =
		window.activeTextEditor;

	constructor(
		private readonly editorManager: DrawioEditorManager,
		private readonly config: Config
	) {
		if (!config.experimentalFeaturesEnabled) {
			return;
		}

		this.dispose.track([
			editorManager.onEditorOpened.sub(({ editor }) =>
				this.handleDrawioInstance(editor.instance)
			),
			{
				dispose: autorun(() => {
					const activeEditor = editorManager.activeDrawioEditor;
					this.statusBar.command =
						"hediet.vscode-drawio.toggleCodeLinkEnabled";
					this.statusBar.text = `$(link) ${
						this.codeLinkEnabled
							? "$(circle-filled)"
							: "$(circle-outline)"
					} Code Link`;
					if (activeEditor) {
						this.statusBar.show();
					} else {
						this.statusBar.hide();
					}
				}),
			},
			window.onDidChangeActiveTextEditor(() => {
				if (window.activeTextEditor) {
					this.lastActiveTextEditor = window.activeTextEditor;
				}
			}),
			commands.registerCommand(
				"hediet.vscode-drawio.linkCodeWithSelectedNode",
				this.linkCodeWithSelectedNode
			),
			commands.registerCommand(
				"hediet.vscode-drawio.toggleCodeLinkEnabled",
				this.toggleCodeClinkEnabled
			),
		]);
	}

	@action.bound
	private toggleCodeClinkEnabled() {
		this.codeLinkEnabled = !this.codeLinkEnabled;
	}

	@action.bound
	private linkCodeWithSelectedNode(): void {
		const lastActiveDrawioEditor = this.editorManager
			.lastActiveDrawioEditor;
		if (!lastActiveDrawioEditor) {
			window.showErrorMessage("No active drawio instance.");
			return;
		}

		const editor = this.lastActiveTextEditor;
		if (!editor) {
			window.showErrorMessage("No text editor active.");
			return;
		}

		if (!editor.selection) {
			window.showErrorMessage("Nothing selected.");
			return;
		}

		const pos = new CodePosition(editor.document.uri, editor.selection);
		lastActiveDrawioEditor.instance.linkSelectedNodeWithData(
			pos.serialize()
		);
		this.revealSelection(pos);
	}

	private handleDrawioInstance(drawioInstance: CustomDrawioInstance): void {
		drawioInstance.onNodeSelected.sub(async ({ linkedData, label }) => {
			if (!this.codeLinkEnabled) {
				return;
			}

			if (linkedData) {
				const pos = CodePosition.deserialize(linkedData);
				await this.revealSelection(pos);
			} else if (label.startsWith("#")) {
				const match = label.match(/#([a-zA-Z0-9_]+)/);
				if (match) {
					const symbolName = match[1];
					const result = (await commands.executeCommand(
						"vscode.executeWorkspaceSymbolProvider",
						symbolName
					)) as (SymbolInformation | DocumentSymbol)[];

					const symbolInfo = result[0];
					if (symbolInfo && "location" in symbolInfo) {
						const pos = new CodePosition(
							symbolInfo.location.uri,
							symbolInfo.location.range
						);
						await this.revealSelection(pos);
					}
				}
			}
		});
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
	public static deserialize(value: unknown): CodePosition {
		const data = value as Data;
		function getPosition(pos: PositionData): Position {
			return new Position(pos.line, pos.col);
		}

		return new CodePosition(
			Uri.parse(data["uri"]),
			new Range(getPosition(data.start), getPosition(data.end))
		);
	}

	constructor(public readonly uri: Uri, public readonly range: Range) {}

	public serialize(): unknown {
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
		return data;
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
