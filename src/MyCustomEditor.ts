import {
	CustomEditorProvider,
	EventEmitter,
	CustomDocumentEditEvent,
	CustomDocument,
	CancellationToken,
	Uri,
	CustomDocumentBackupContext,
	CustomDocumentBackup,
	CustomDocumentOpenContext,
	WebviewPanel,
} from "vscode";
import { readFileSync } from "fs";

export class MyCustomEditor implements CustomEditorProvider {
	private readonly onDidChangeCustomDocumentEmitter = new EventEmitter<
		CustomDocumentEditEvent<CustomDocument>
	>();
	public readonly onDidChangeCustomDocument = this
		.onDidChangeCustomDocumentEmitter.event;

	async saveCustomDocument(
		document: CustomDocument,
		cancellation: CancellationToken
	): Promise<void> {
		throw new Error("Method not implemented.");
	}

	async saveCustomDocumentAs(
		document: CustomDocument,
		destination: Uri,
		cancellation: CancellationToken
	): Promise<void> {
		throw new Error("Method not implemented.");
	}

	async revertCustomDocument(
		document: CustomDocument,
		cancellation: CancellationToken
	): Promise<void> {
		throw new Error("Method not implemented.");
	}

	async backupCustomDocument(
		document: CustomDocument,
		context: CustomDocumentBackupContext,
		cancellation: CancellationToken
	): Promise<CustomDocumentBackup> {
		throw new Error("Method not implemented.");
	}

	async openCustomDocument(
		uri: Uri,
		openContext: CustomDocumentOpenContext,
		token: CancellationToken
	): Promise<CustomDocument> {
		return new DrawioDocument(uri);
	}

	async resolveCustomEditor(
		document: CustomDocument,
		webviewPanel: WebviewPanel,
		token: CancellationToken
	): Promise<void> {
		webviewPanel.webview.options = { enableScripts: true };
		webviewPanel.webview.html = `
        <html>
        <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval'; script-src * 'unsafe-inline' 'unsafe-eval'; connect-src * 'unsafe-inline'; img-src * data: blob: 'unsafe-inline'; frame-src *; style-src * 'unsafe-inline'; worker-src * data: 'unsafe-inline' 'unsafe-eval'; font-src * 'unsafe-inline' 'unsafe-eval';">
        <style>
            html { height: 100%; width: 100%; padding: 0; margin: 0; }
            body { height: 100%; width: 100%; padding: 0; margin: 0; }
            iframe { height: 100%; width: 100%; padding: 0; margin: 0; border: 0; display: block; }
        </style>
        </head>
        <body>
            <script>
                const api = window.VsCodeApi = acquireVsCodeApi();
                window.addEventListener('message', event => {
					
                    if (event.source === window.frames[0]) {
						console.log("frame -> vscode", event.data);
						api.postMessage(event.data);
                    } else {
						console.log("vscode -> frame", event.data);
						window.frames[0].postMessage(event.data, "*");
					}
                });
            </script>

            <iframe src="https://www.draw.io/?embed=1&ui=dark&proto=json"></iframe>
        </body>
    </html>
		`;
		webviewPanel.webview.onDidReceiveMessage((arg: string) => {
			const evt = JSON.parse(arg) as DrawioEvent;
			console.log(evt.event);
			if (evt.event === "init") {
				let fileContent = readFileSync(document.uri.fsPath) as Buffer;
				let str = fileContent.toString("base64");
				webviewPanel.webview.postMessage(JSON.stringify({
					action: "load",
					xml: "data:image/png;base64," + str,
					autosave: 1
				} as DrawioAction))
			} else if (evt.event === "save") {
				this.onDidChangeCustomDocumentEmitter.fire({ document, redo() {}, undo() {} })
			}
		});
	}
}

class DrawioDocument implements CustomDocument {
	public constructor(public readonly uri: Uri, public readonly drawioInstance: DrawioInstance) {}

	public dispose(): void {}
}

class DrawioInstance {
	constructor() {

	}

	public exportAsPngWithEmbeddedXml(): Promise<Buffer> {

	}
}

type DrawioEvent = {
	event: "init";
} | {
	event: "autosave"
	xml: string;
} | {
	event: "save";
	xml: string;
};

type DrawioAction = { action: "load", xml: string; autosave?: 1 } |  {
	action: "prompt";
} | {
	action: "template"
} | {
	action: "draft"
} | {
	action: "export";
	format: "html" | "xmlpng" | "png" | "xml";
} 
