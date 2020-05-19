import { HostedDrawioAppServer } from "./HostedDrawioAppServer";
import { OutputChannel, Webview } from "vscode";
import { Config } from "../Config";

export class ExternallyHostedDrawioAppServer extends HostedDrawioAppServer {
	constructor(public url: string, log: OutputChannel, config: Config) {
		super(log, config);
	}

	public async getHtml(webview: Webview): Promise<string> {
		return `
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

				<iframe src="${this.url}?embed=1&ui=${this.getTheme()}&proto=json&configure=1&noSaveBtn=1&noExitBtn=1&lang=${this.getLanguage()}"></iframe>
			</body>
		</html>
			`;
	}
}
