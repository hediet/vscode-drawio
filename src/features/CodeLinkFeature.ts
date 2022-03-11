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
	QuickPickItem,
	QuickPickOptions,
	DocumentSymbol,
	SymbolKind,
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
const linkSymbolWithSelectedNodeCommandName =
	"hediet.vscode-drawio.linkSymbolWithSelectedNode";
const linkWsSymbolWithSelectedNodeCommandName =
	"hediet.vscode-drawio.linkWsSymbolWithSelectedNode";
const linkFileWithSelectedNodeCommandName =
	"hediet.vscode-drawio.linkFileWithSelectedNode";

const symbolNameMap: Record<SymbolKind, string> = {
	[SymbolKind.File]: "symbol-file",
	[SymbolKind.Module]: "symbol-module",
	[SymbolKind.Namespace]: "symbol-namespace",
	[SymbolKind.Package]: "symbol-package",
	[SymbolKind.Class]: "symbol-class",
	[SymbolKind.Method]: "symbol-method",
	[SymbolKind.Property]: "symbol-property",
	[SymbolKind.Field]: "symbol-field",
	[SymbolKind.Constructor]: "symbol-constructor",
	[SymbolKind.Enum]: "symbol-enum",
	[SymbolKind.Interface]: "symbol-interface",
	[SymbolKind.Function]: "symbol-function",
	[SymbolKind.Variable]: "symbol-variable",
	[SymbolKind.Constant]: "symbol-constant",
	[SymbolKind.String]: "symbol-string",
	[SymbolKind.Number]: "symbol-number",
	[SymbolKind.Boolean]: "symbol-boolean",
	[SymbolKind.Array]: "symbol-array",
	[SymbolKind.Object]: "symbol-object",
	[SymbolKind.Key]: "symbol-key",
	[SymbolKind.Null]: "symbol-null",
	[SymbolKind.EnumMember]: "symbol-enum-member",
	[SymbolKind.Struct]: "symbol-struct",
	[SymbolKind.Event]: "symbol-event",
	[SymbolKind.Operator]: "symbol-operator",
	[SymbolKind.TypeParameter]: "symbol-type-parameter",
};

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
				this.linkFileWithSelectedNode
			),
			registerFailableCommand(
				linkSymbolWithSelectedNodeCommandName,
				this.linkSymbolWithSelectedNode
			),
			registerFailableCommand(
				linkWsSymbolWithSelectedNodeCommandName,
				this.linkWsSymbolWithSelectedNode
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

		const pos = new DeserializedCodePosition(
			editor.document.uri,
			editor.selection
		);
		lastActiveDrawioEditor.drawioClient.linkSelectedNodeWithData(
			pos.serialize(lastActiveDrawioEditor.uri)
		);
		this.revealSelection(pos);
	}

	@action.bound
	private linkFileWithSelectedNode(file: Uri): void {
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

	@action.bound
	private async linkWsSymbolWithSelectedNode() {
		this.linkSymbolWithSelectedNode(true);
	}

	@action.bound
	private async linkSymbolWithSelectedNode(
		storeTopLevelSymbol: boolean = false
	) {
		const lastActiveDrawioEditor =
			this.editorManager.lastActiveDrawioEditor;
		if (!lastActiveDrawioEditor) {
			window.showErrorMessage("No active drawio instance.");
			return;
		}
		const editor = window.activeTextEditor;
		if (editor == undefined) {
			window.showErrorMessage("No text editor active.");
			return;
		}
		const uri = editor.document.uri;
		const hasSelection = !editor.selection.start.isEqual(
			editor.selection.end
		);
		const result = (await commands.executeCommand(
			"vscode.executeDocumentSymbolProvider",
			uri
		)) as DocumentSymbol[];
		let items: QuickPickItem[] = [];
		function recurse(symb: DocumentSymbol[], path: string) {
			for (let x of symb) {
				// If there is a selection and we do not intersect it, omit the symbol
				let intersectSelection = true;
				if (hasSelection && editor) {
					intersectSelection = editor.selections.reduce(
						(prev: boolean, cur) => {
							return (
								prev &&
								cur.intersection(x.selectionRange) !== undefined
							);
						},
						intersectSelection
					);
				}
				// Add the symbol and descend into children
				let curpath = path == "" ? x.name : `${path}.${x.name}`;
				if (intersectSelection) {
					items.push(<QuickPickItem>{
						label: `$(${symbolNameMap[x.kind]}) ${x.name}`,
						description: x.detail,
						detail: curpath,
					});
				}
				recurse(x.children, curpath);
			}
		}
		recurse(result, "");
		window
			.showQuickPick(items, <QuickPickOptions>{
				matchOnDescription: true,
				matchOnDetail: true,
				placeHolder: `Choose symbol from ${path.basename(uri.fsPath)}`,
			})
			.then(async (v) => {
				if (v == undefined) return;
				const pos: CodePosition = new CodePosition(
					storeTopLevelSymbol ? undefined : uri,
					v.detail
				);
				lastActiveDrawioEditor.drawioClient.linkSelectedNodeWithData(
					pos.serialize(lastActiveDrawioEditor.uri)
				);
				// Validate upon exist, as some languages do not export workspace symbols
				if (
					storeTopLevelSymbol &&
					v.detail &&
					!(await resolveTopSymbol(v.detail))
				) {
					window.showWarningMessage(
						`Cannot resolve symbol ${v.detail}. This likely means workspace symbols are not supported by your language. Try "Link Symbol With Selected Node" instead.`
					);
				}
			});
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
				try {
					const pos = await CodePosition.deserialize(
						linkedData,
						editor.uri
					);
					await this.revealSelection(pos);
				} catch (e) {
					window.showErrorMessage((e as Error).message);
				}
			} else {
				const match = label.match(/#([a-zA-Z0-9_<>,]+)/);
				if (match) {
					const symbolName = match[1];
					const pos = await resolveWorkspaceSymbol(symbolName);
					if (pos) {
						await this.revealSelection(pos);
					} else {
						window.showErrorMessage(
							`No symbol found with name "${symbolName}". Maybe you need to load the symbols by opening at least one of its code files?`
						);
					}
				}
			}
		});
	}

	private lastDecorationType: TextEditorDecorationType | undefined;

	private async revealSelection(
		pos: DeserializedCodePosition
	): Promise<void> {
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

// CodePosition before serializing and passing to editor
class CodePosition {
	public readonly range: Range | undefined;
	private readonly symbol: string | undefined;

	public static async deserialize(
		value: unknown,
		relativeTo: Uri
	): Promise<DeserializedCodePosition> {
		const data = value as Data;
		function getPosition(pos: PositionData): Position {
			return new Position(pos.line, pos.col);
		}

		// If data.path is defined, then
		//	1. Either have explicit range (data.start) defined
		//	2. Or symbol path (data.symbol) defined
		// Otherwise, we must resolve using data.symbol only.
		if (data.path) {
			let uri: Uri = relativeTo.with({
				path: Uri.file(path.join(relativeTo.path, data.path)).path,
			});
			if ("start" in data) {
				let range = new Range(
					getPosition(data.start),
					getPosition(data.end)
				);
				return new DeserializedCodePosition(uri, range);
			} else if ("symbol" in data) {
				let range = await resolveSymbol(uri, data.symbol);
				if (range == undefined)
					throw new Error(
						`Cannot find symbol by path: ${data.symbol}. Maybe you need to load the symbols by opening at least one of its code files?`
					);
				return new DeserializedCodePosition(uri, range);
			}
			return new DeserializedCodePosition(uri, undefined);
		} else if ("symbol" in data) {
			let pos = await resolveTopSymbol(data.symbol);
			if (pos) return pos;
			throw new Error(
				`Cannot find symbol by path: ${data.symbol}. Maybe you need to load the symbols by opening at least one of its code files?`
			);
		}

		// Exceptions will be very rare in this case
		console.error("Draw.io: Data is invalid or cannot find symbol", data);
		throw new Error(`Malformed symbol information. Check console log.`);
	}

	constructor(
		public readonly uri: Uri | undefined,
		private obj?: Range | string
	) {
		if (obj instanceof Range) {
			this.range = obj as Range;
		} else if (typeof obj == "string") {
			this.symbol = obj as string;
		}
	}

	public serialize(relativeTo: Uri): Data {
		function toPosition(pos: Position): PositionData {
			return {
				col: pos.character,
				line: pos.line,
			};
		}

		let rangeObj = {};
		if (this.range) {
			rangeObj = {
				start: toPosition(this.range.start),
				end: toPosition(this.range.end),
			};
		} else if (this.symbol) {
			rangeObj = {
				symbol: this.symbol,
			};
		}

		if (this.uri) {
			return <Data>{
				path: path
					.relative(relativeTo.fsPath, this.uri.fsPath)
					.replace(/\\/g, "/"),
				...rangeObj,
			};
		} else {
			return <Data>{
				...rangeObj,
			};
		}
	}
}

// CodePosition after deserializing (from Data object)
class DeserializedCodePosition {
	constructor(public readonly uri: Uri, public readonly range?: Range) {}
	public serialize(relativeTo: Uri): Data {
		return new CodePosition(this.uri, this.range).serialize(relativeTo);
	}
}

type Data = {
	path: string | undefined;
} & (
	| {}
	| {
			start: PositionData;
			end: PositionData;
	  }
	| {
			symbol: string;
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

async function resolveSymbol(
	uri: Uri,
	path: string
): Promise<Range | undefined> {
	const result = (await commands.executeCommand(
		"vscode.executeDocumentSymbolProvider",
		uri
	)) as DocumentSymbol[];
	let treePath = path.split(".");
	let cur: DocumentSymbol[] | undefined = result;
	for (let i = 0; i < treePath.length; i++) {
		if (cur == undefined) break;
		cur = cur.filter((x) => x.name == treePath[i]);
		if (i < treePath.length - 1) cur = cur[0]?.children;
	}
	if (cur == undefined || cur.length == 0) return undefined;
	return cur[0].selectionRange;
}

async function resolveTopSymbol(
	path: string
): Promise<DeserializedCodePosition | undefined> {
	let res = path.split(".");
	if (res.length == 0) return undefined;
	// res.length > 0
	let symb = await resolveWorkspaceSymbol(res[0]);
	if (!symb) return undefined;
	if (res.length == 2) {
		const range = await resolveSymbol(symb.uri, path);
		if (range) symb = new DeserializedCodePosition(symb.uri, range);
	}
	return symb;
}

async function resolveWorkspaceSymbol(
	symbolName: string
): Promise<DeserializedCodePosition | undefined> {
	const result = (await commands.executeCommand(
		"vscode.executeWorkspaceSymbolProvider",
		symbolName
	)) as SymbolInformation[];
	for (let x of result) console.log(x.name);
	const filtered = result
		.filter((r) => r.name === symbolName)
		.sort(
			getSorterBy((matchedSymbol) => {
				let score = 0;

				const uriAsString = matchedSymbol.location.uri.toString();

				const idx = window.visibleTextEditors.findIndex(
					(e) => e.document.uri.toString() === uriAsString
				);
				if (idx !== -1) {
					score +=
						(window.visibleTextEditors.length - idx) /
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
		return new DeserializedCodePosition(
			symbolInfo.location.uri,
			symbolInfo.location.range
		);
	}
	return undefined;
}
