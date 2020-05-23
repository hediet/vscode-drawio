import {
	CancellationToken,
	CustomTextEditorProvider,
	Range,
	TextDocument,
	WebviewPanel,
	workspace,
	WorkspaceEdit,
} from "vscode";
import * as formatter from "xml-formatter";
import { DrawioWebviewInitializer } from "./DrawioAppServer";
import { canonicalizeXml } from "./utils/canonicalizeXml";
import { DrawioEditorManager, DrawioEditor } from "./DrawioEditorManager";

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
		const drawioInstance = await this.drawioWebviewInitializer.setupWebview(
			document.uri,
			webviewPanel.webview
		);
		this.drawioEditorManager.register(
			new DrawioEditor(webviewPanel, drawioInstance, {
				kind: "text",
				document,
			})
		);

		let lastOutput: string;
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
			const result = evt.document.getText();
			if (canonicalizeXml(result) === lastOutput) {
				return;
			}

			await drawioInstance.mergeXmlLike(result);
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

			// TODO improve this.
			lastOutput = canonicalizeXml(output);

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
