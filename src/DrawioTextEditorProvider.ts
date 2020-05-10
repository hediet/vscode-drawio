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
import { DrawioAppServer } from "./DrawioAppServer";

export class DrawioTextEditorProvider implements CustomTextEditorProvider {
	constructor(public readonly drawioAppServer: DrawioAppServer) {}

	public async resolveCustomTextEditor(
		document: TextDocument,
		webviewPanel: WebviewPanel,
		token: CancellationToken
	): Promise<void> {
		const drawioInstance = await this.drawioAppServer.setupWebview(
			webviewPanel.webview
		);
		let isThisEditorSaving = false;

		workspace.onDidChangeTextDocument((evt) => {
			if (evt.document !== document) {
				return;
			}
			if (isThisEditorSaving) {
				// We don't want to integrate our own changes
				return;
			}
			drawioInstance.loadXml(evt.document.getText());
		});

		drawioInstance.onChange.sub(async ({ newXml }) => {
			// We format the xml so that it can be easily edited in a second text editor.
			const formatted = formatter(newXml);

			const edit = new WorkspaceEdit();
			edit.replace(
				document.uri,
				new Range(0, 0, document.lineCount, 0),
				formatted
			);

			isThisEditorSaving = true;
			await workspace.applyEdit(edit);
			isThisEditorSaving = false;
		});

		drawioInstance.onSave.sub(async () => {
			await document.save();
		});

		drawioInstance.onInit.one(async () => {
			drawioInstance.loadXml(document.getText());
		});
	}
}
