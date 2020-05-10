import * as vscode from "vscode";
import { Webview } from "vscode";
import { DrawioInstance } from "./DrawioInstance";

export function setupWebviewForDrawio(webview: Webview): DrawioInstance {
	webview.options = { enableScripts: true };

	let ui = "dark";

	try {
		const ctk = (vscode as any).ColorThemeKind;
		ui = {
			[ctk.Light]: "Kennedy",
			[ctk.Dark]: "dark",
			[ctk.HighContrast]: "Kennedy",
		}[(vscode as any).window.activeColorTheme.kind];
	} catch (e) {
		// window.activeColorTheme is only supported since VS Code 45.
	}

	webview.html = `
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
						//console.log("frame -> vscode", event.data);
						api.postMessage(event.data);
                    } else {
						//console.log("vscode -> frame", event.data);
						window.frames[0].postMessage(event.data, "*");
					}
                });
            </script>

            <iframe src="https://www.draw.io/?embed=1&ui=${ui}&proto=json&configure=1"></iframe>
        </body>
    </html>
		`;

	const drawioInstance = new DrawioInstance({
		sendMessage: (msg) => webview.postMessage(msg),
		registerMessageHandler: (handler) =>
			webview.onDidReceiveMessage(handler),
	});
	return drawioInstance;
}
