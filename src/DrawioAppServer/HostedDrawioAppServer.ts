import * as vscode from "vscode";
import { Webview } from "vscode";
import { DrawioInstance } from "../DrawioInstance";
import { DrawioAppServer } from "./DrawioAppServer";
import { formatValue } from "./formatValue";
import { Config } from "../Config";

export abstract class HostedDrawioAppServer implements DrawioAppServer {
	public abstract getIndexUrl(): Promise<string>;

	constructor(
		private readonly log: vscode.OutputChannel,
		private readonly config: Config
	) {}

	public async setupWebview(webview: Webview): Promise<DrawioInstance> {
		webview.options = { enableScripts: true };

		const indexUrl = await this.getIndexUrl();

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
	
				<iframe src="${indexUrl}?embed=1&ui=${this.getTheme()}&proto=json&configure=1&noSaveBtn=1&noExitBtn=1&lang=${this.getLanguage()}"></iframe>
			</body>
		</html>
			`;

		const drawioInstance = new DrawioInstance(
			{
				sendMessage: (msg) => {
					this.log.appendLine("vscode -> drawio: " + prettify(msg));
					webview.postMessage(msg);
				},
				registerMessageHandler: (handler) => {
					return webview.onDidReceiveMessage((msg) => {
						this.log.appendLine(
							"vscode <- drawio: " + prettify(msg)
						);
						handler(msg);
					});
				},
			},
			{
				compressXml: false,
			}
		);

		return drawioInstance;
	}

	private getLanguage(): string {
		const lang = vscode.env.language.split("-")[0].toLowerCase();
		return lang;
	}

	private getTheme(): string {
		if (this.config.drawioTheme !== "automatic") {
			return this.config.drawioTheme;
		}

		try {
			const ctk = (vscode as any).ColorThemeKind;
			return {
				[ctk.Light]: "Kennedy",
				[ctk.Dark]: "dark",
				[ctk.HighContrast]: "Kennedy",
			}[(vscode as any).window.activeColorTheme.kind];
		} catch (e) {
			// window.activeColorTheme is only supported since VS Code 1.45.
		}
		return "dark";
	}
}

function prettify(msg: unknown): string {
	try {
		if (typeof msg === "string") {
			const obj = JSON.parse(msg as string);
			return formatValue(
				obj,
				process.env.NODE_ENV === "development" ? 500 : 80
			);
		}
	} catch {}
	return "" + msg;
}
