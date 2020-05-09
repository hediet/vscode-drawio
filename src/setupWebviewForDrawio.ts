import { Webview, window, ColorThemeKind } from "vscode";
import { DrawioInstance } from "./DrawioInstance";

export function setupWebviewForDrawio(webview: Webview): DrawioInstance {
	webview.options = { enableScripts: true };

	const ui = {
		[ColorThemeKind.Light]: "Kennedy",
		[ColorThemeKind.Dark]: "dark",
		[ColorThemeKind.HighContrast]: "Kennedy",
	}[window.activeColorTheme.kind];

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
