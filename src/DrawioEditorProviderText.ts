import {
	CancellationToken,
	CustomTextEditorProvider,
	Range,
	TextDocument,
	WebviewPanel,
	workspace,
	WorkspaceEdit,
	FileType,
} from "vscode";
import * as formatter from "xml-formatter";
import { DrawioWebviewInitializer } from "./DrawioAppServer";
import { DrawioEditorManager, DrawioEditor } from "./DrawioEditorManager";
import { JSDOM } from "jsdom";

export class DrawioEditorProviderText implements CustomTextEditorProvider {
	constructor(
		public readonly drawioWebviewInitializer: DrawioWebviewInitializer,
		private readonly drawioEditorManager: DrawioEditorManager
	) {}

	public async resolveCustomTextEditor(
		document: TextDocument,
		webviewPanel: WebviewPanel,
		token: CancellationToken
	): Promise<void> {
		const readonlySchemes = new Set(["git", "conflictResolution"]);
		const isReadOnly = readonlySchemes.has(document.uri.scheme);

		const drawioInstance = await this.drawioWebviewInitializer.setupWebview(
			document.uri,
			webviewPanel.webview,
			{ isReadOnly }
		);
		this.drawioEditorManager.register(
			new DrawioEditor(webviewPanel, drawioInstance, {
				kind: "text",
				document,
			})
		);

		interface NormalizedDocument {
			equals(other: this): boolean;
		}

		function getNormalizedDocument(src: string): NormalizedDocument {
			try {
				var document = new JSDOM(src).window.document;
			} catch (e) {
				console.warn("Could not parse xml: ", e);
				return {
					equals: () => false,
				};
			}

			try {
				// If only those attributes have changed, we want to ignore this change
				const mxFile = document.getElementsByTagName("mxfile")[0];
				if (mxFile !== undefined) {
					mxFile.setAttribute("modified", "");
					mxFile.setAttribute("etag", "");
				}

				const mxGraphModel = document.getElementsByTagName(
					"mxGraphModel"
				)[0];
				if (mxGraphModel !== undefined) {
					mxGraphModel.setAttribute("dx", "");
					mxGraphModel.setAttribute("dy", "");
				}
			} catch (e) {
				console.error(e);
			}

			function trimText(node: any) {
				for (node = node.firstChild; node; node = node.nextSibling) {
					if (node.nodeType == 3) {
						node.textContent = node.textContent.trim();
					} else {
						trimText(node);
					}
				}
			}
			trimText(document);

			const html = [...document.children]
				.map((c) => c.innerHTML)
				.join("\n");

			const normalizedDoc = {
				html,
				equals(other: any) {
					return other.html === html;
				},
			};
			return normalizedDoc;
		}

		let lastDocument: NormalizedDocument = getNormalizedDocument(
			document.getText()
		);
		let isThisEditorSaving = false;

		workspace.onDidChangeTextDocument(async (evt) => {
			if (evt.document !== document) {
				return;
			}
			if (isThisEditorSaving) {
				// We don't want to integrate our own changes
				return;
			}
			if (evt.contentChanges.length === 0) {
				// Sometimes VS Code reports a document change without a change.
				return;
			}

			const newText = evt.document.getText();
			const newDocument = getNormalizedDocument(newText);
			if (newDocument.equals(lastDocument)) {
				return;
			}
			lastDocument = newDocument;

			await drawioInstance.mergeXmlLike(newText);
		});

		drawioInstance.onChange.sub(async ({ newXml }) => {
			// We format the xml so that it can be easily edited in a second text editor.

			let output: string;
			if (document.uri.path.endsWith(".svg")) {
				const svg = await drawioInstance.exportAsSvgWithEmbeddedXml();
				newXml = svg.toString("utf-8");
				output = formatter(newXml);
			} else {
				output = formatter(newXml);
			}

			const newDocument = getNormalizedDocument(output);
			if (newDocument.equals(lastDocument)) {
				return;
			}
			lastDocument = newDocument;

			const workspaceEdit = new WorkspaceEdit();

			// TODO diff the new document with the old document and only edit the changes.
			workspaceEdit.replace(
				document.uri,
				new Range(0, 0, document.lineCount, 0),
				output
			);

			isThisEditorSaving = true;
			try {
				await workspace.applyEdit(workspaceEdit);

				/*
				// This does not work until we can use the same FormattingOptions
				// that VS Code is using
				const formatEdits = await commands.executeCommand<TextEdit[]>(
					"vscode.executeFormatDocumentProvider",
					document.uri,
					{
						insertSpaces: true,
						tabSize: 4,
					} as FormattingOptions
				);
				if (formatEdits !== undefined) {
					const formatWorkspaceEdit = new WorkspaceEdit();
					formatWorkspaceEdit.set(document.uri, formatEdits);
					await workspace.applyEdit(formatWorkspaceEdit);
				}*/
			} finally {
				isThisEditorSaving = false;
			}
		});

		drawioInstance.onSave.sub(async () => {
			await document.save();
		});

		drawioInstance.onInit.sub(async () => {
			drawioInstance.loadXmlLike(document.getText());
		});
	}
}
