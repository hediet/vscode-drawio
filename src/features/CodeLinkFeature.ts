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
} from "vscode";
import { wait } from "@hediet/std/timer";
import { DrawioEditorService, DrawioEditor } from "../DrawioEditorService";
import { autorun, action } from "mobx";
import { Config } from "../Config";
import { path } from "../utils/path";
import { registerFailableCommand } from "../utils/registerFailableCommand";

const toggleCodeLinkActivationCommandName =
	"hediet.vscode-drawio.toggleCodeLinkActivation";
const linkCodeWithSelectedNodeCommandName =
	"hediet.vscode-drawio.linkCodeWithSelectedNode";

const linkFileWithSelectedNodeCommandName =
	"hediet.vscode-drawio.linkFileWithSelectedNode";

export class LinkCodeWithSelectedNodeService {
	public readonly dispose = Disposable.fn();

	private readonly statusBar = window.createStatusBarItem();

	private lastActiveTextEditor: TextEditor | undefined =
		window.activeTextEditor;

	constructor(
		private readonly editorManager: DrawioEditorService,
		private readonly config: Config
	) {
		this.dispose.track([
			editorManager.onEditorOpened.sub(({ editor }) =>
				this.handleDrawioEditor(editor)
			),
			{
				dispose: autorun(
					() => {
						const activeEditor = editorManager.activeDrawioEditor;
						this.statusBar.command =
							toggleCodeLinkActivationCommandName;

						if (activeEditor) {
							this.statusBar.text = `$(link) ${
								activeEditor.config.codeLinkActivated
									? "$(circle-filled)"
									: "$(circle-outline)"
							} Code Link`;
							this.statusBar.show();
						} else {
							this.statusBar.hide();
						}
					},
					{ name: "Update UI" }
				),
			},
			window.onDidChangeActiveTextEditor(() => {
				if (window.activeTextEditor) {
					this.lastActiveTextEditor = window.activeTextEditor;
				}
			}),
			registerFailableCommand(
				linkCodeWithSelectedNodeCommandName,
				this.linkCodeWithSelectedNode
			),
			registerFailableCommand(
				toggleCodeLinkActivationCommandName,
				this.toggleCodeLinkEnabled
			),
			registerFailableCommand(
				linkFileWithSelectedNodeCommandName,
				this.linkFileWithSelectedNodeCommandName
			),
		]);
	}

	@action.bound
	private async toggleCodeLinkEnabled() {
		const activeEditor = this.editorManager.activeDrawioEditor;
		if (!activeEditor) {
			return;
		}
		await activeEditor.config.setCodeLinkActivated(
			!activeEditor.config.codeLinkActivated
		);
	}

	@action.bound
	private linkCodeWithSelectedNode(): void {
		const lastActiveDrawioEditor =
			this.editorManager.lastActiveDrawioEditor;
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
		lastActiveDrawioEditor.drawioClient.linkSelectedNodeWithData(
			pos.serialize(lastActiveDrawioEditor.uri)
		);
		this.revealSelection(pos);
	}

	@action.bound
	private linkFileWithSelectedNodeCommandName(file: Uri): void {
		const lastActiveDrawioEditor =
			this.editorManager.lastActiveDrawioEditor;
		if (!lastActiveDrawioEditor) {
			window.showErrorMessage("No active drawio instance.");
			return;
		}

		const pos = new CodePosition(file, undefined);
		lastActiveDrawioEditor.drawioClient.linkSelectedNodeWithData(
			pos.serialize(lastActiveDrawioEditor.uri)
		);
	}

	private handleDrawioEditor(editor: DrawioEditor): void {
		const drawioInstance = editor.drawioClient;

		drawioInstance.onCustomPluginLoaded.sub(() => {
			drawioInstance.dispose.track({
				dispose: autorun(
					() => {
						drawioInstance.setNodeSelectionEnabled(
							editor.config.codeLinkActivated
						);
					},
					{ name: "Send codeLinkActivated to drawio instance" }
				),
			});
		});

		drawioInstance.onNodeSelected.sub(async ({ linkedData, label }) => {
			if (!editor.config.codeLinkActivated) {
				return;
			}

			if (linkedData) {
				const pos = CodePosition.deserialize(linkedData, editor.uri);
				await this.revealSelection(pos);
			} else {
				const match = label.match(/#([a-zA-Z0-9_<>,]+)/);
				if (match) {
					const symbolName = match[1];
					const result = (await commands.executeCommand(
						"vscode.executeWorkspaceSymbolProvider",
						symbolName
					)) as SymbolInformation[];
					const filtered = result
						.filter((r) => r.name === symbolName)
						.sort(
							getSorterBy((matchedSymbol) => {
								let score = 0;

								const uriAsString =
									matchedSymbol.location.uri.toString();

								const idx = window.visibleTextEditors.findIndex(
									(e) =>
										e.document.uri.toString() ===
										uriAsString
								);
								if (idx !== -1) {
									score +=
										(window.visibleTextEditors.length -
											idx) /
										window.visibleTextEditors.length;
								}

								if (matchedSymbol.containerName === "") {
									score += 10;
								}
								return score;
							})
						);

					const symbolInfo = filtered[0];
					if (symbolInfo) {
						const pos = new CodePosition(
							symbolInfo.location.uri,
							symbolInfo.location.range
						);
						await this.revealSelection(pos);
					} else {
						window.showErrorMessage(
							`No symbol found with name "${symbolName}". Maybe you need to load the project by opening at least one of its code files?`
						);
					}
				}
			}
		});
	}

	private lastDecorationType: TextEditorDecorationType | undefined;

	private async revealSelection(pos: CodePosition): Promise<void> {
		if (pos.range) {
			const d = await workspace.openTextDocument(pos.uri);
			const e = await window.showTextDocument(d, {
				viewColumn: ViewColumn.One,
				preserveFocus: true,
			});
			e.revealRange(pos.range, TextEditorRevealType.Default);

			const highlightDecorationType =
				window.createTextEditorDecorationType({
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
		} else {
			await commands.executeCommand("vscode.open", pos.uri, {
				viewColumn: ViewColumn.One,
				preserveFocus: true,
			});
		}
	}
}

class CodePosition {
	public static deserialize(value: unknown, relativeTo: Uri): CodePosition {
		const data = value as Data;
		function getPosition(pos: PositionData): Position {
			return new Position(pos.line, pos.col);
		}

		return new CodePosition(
			relativeTo.with({
				path: Uri.file(path.join(relativeTo.path, data.path)).path,
			}),
			"start" in data
				? new Range(getPosition(data.start), getPosition(data.end))
				: undefined
		);
	}

	constructor(public readonly uri: Uri, public readonly range?: Range) {}

	public serialize(relativeTo: Uri): unknown {
		function toPosition(pos: Position): PositionData {
			return {
				col: pos.character,
				line: pos.line,
			};
		}

		const data: Data = {
			path: path
				.relative(relativeTo.fsPath, this.uri.fsPath)
				.replace(/\\/g, "/"),
			...(this.range
				? {
						start: toPosition(this.range.start),
						end: toPosition(this.range.end),
				  }
				: {}),
		};
		return data;
	}
}

type Data = {
	path: string;
} & (
	| {}
	| {
			start: PositionData;
			end: PositionData;
	  }
);

interface PositionData {
	line: number;
	col: number;
}

function getSorterBy<T>(selector: (item: T) => number) {
	return (item1: T, item2: T) => {
		return selector(item2) - selector(item1);
	};
}
