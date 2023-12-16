import {
	CancellationToken,
	CustomTextEditorProvider,
	Range,
	TextDocument,
	WebviewPanel,
	window,
	workspace,
	WorkspaceEdit,
} from "vscode";
import formatter = require("xml-formatter");
import { DrawioEditorService } from "./DrawioEditorService";

export class DrawioEditorProviderText implements CustomTextEditorProvider {
	constructor(private readonly drawioEditorService: DrawioEditorService) {}

	public async resolveCustomTextEditor(
		document: TextDocument,
		webviewPanel: WebviewPanel,
		token: CancellationToken
	): Promise<void> {
		try {
			const readonlySchemes = new Set([
				"git",
				"conflictResolution",
				"gitlens",
			]);
			const isReadOnly = readonlySchemes.has(document.uri.scheme);

			const editor =
				await this.drawioEditorService.createDrawioEditorInWebview(
					webviewPanel,
					{
						kind: "text",
						document,
					},
					{ isReadOnly }
				);
			const drawioClient = editor.drawioClient;

			interface NormalizedDocument {
				equals(other: this): boolean;
			}

			function getNormalizedDocument(src: string): NormalizedDocument {
				const result = {
					src,
					equals: (o: any) => o.src === src,
				};
				return result;
			}

			let lastDocument = getNormalizedDocument(document.getText());
			let isThisEditorSaving = false;

			workspace.onDidChangeTextDocument(async (evt) => {
				if (evt.document !== document) {
					return;
				}
				if (isThisEditorSaving) {
					// We don't want to process our own changes.
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

				await drawioClient.mergeXmlLike(newText);
			});

			drawioClient.onChange.sub(async ({ oldXml, newXml }) => {
				// We format the xml so that it can be easily edited in a second text editor.
				async function getOutput(): Promise<string> {
					if (document.uri.path.endsWith(".svg")) {
						const svg =
							await drawioClient.exportAsSvgWithEmbeddedXml();
						newXml = svg.toString("utf-8");

						// This adds a host to track which files are created by this extension and which by draw.io desktop.
						newXml = newXml.replace(
							/^<svg /,
							() => `<svg host="65bd71144e" `
						);

						return formatter(newXml);
					} else {
						if (newXml.startsWith('<mxfile host="')) {
							newXml = newXml.replace(
								/^<mxfile host="(.*?)"/,
								() => `<mxfile host="65bd71144e"`
							);
						} else {
							// in case there is no host attribute
							newXml = newXml
								.replace(
									/^<mxfile /,
									() => `<mxfile host="65bd71144e"`
								)
								.replace(
									/^<mxfile>/,
									() => `<mxfile host="65bd71144e">`
								);
						}

						return formatter(
							// This normalizes the host
							newXml
						);
					}
				}

				const output = await getOutput();
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
					if (!(await workspace.applyEdit(workspaceEdit))) {
						window.showErrorMessage(
							"Could not apply Draw.io document changes to the underlying document. Try to save again!"
						);
					}
				} finally {
					isThisEditorSaving = false;
				}
			});

			drawioClient.onSave.sub(async () => {
				await document.save();
			});

			drawioClient.onInit.sub(async () => {
				drawioClient.loadXmlLike(document.getText());
			});
		} catch (e) {
			window.showErrorMessage(`Failed to open diagram: ${e}`);
			throw e;
		}
	}
}
