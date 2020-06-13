import { Webview, OutputChannel, Uri } from "vscode";
import {
	CustomDrawioInstance,
	simpleDrawioLibrary,
	DrawioLibraryData,
} from "../DrawioInstance";
import { Config, DiagramConfig } from "../Config";
import html from "./vscode.html";
import path = require("path");
import { formatValue } from "../utils/formatValue";
import { autorun, untracked } from "mobx";

export class DrawioWebviewInitializer {
	constructor(
		private readonly config: Config,
		private readonly log: OutputChannel
	) {}

	public async setupWebview(
		uri: Uri,
		webview: Webview,
		options: DiagramOptions
	): Promise<CustomDrawioInstance> {
		const config = this.config.getConfig(uri);

		webview.options = {
			enableScripts: true,
		};

		let i = 0;
		autorun(
			() => {
				webview.html =
					this.getHtml(config, options, webview) + " ".repeat(i++);

				// these getters triggers a reload on change
				config.customLibraries;
				config.customFonts;
			},
			{ name: "Update Webview Html" }
		);

		const drawioInstance = new CustomDrawioInstance(
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
			async () => {
				const libs = await config.customLibraries;
				return {
					compressXml: false,
					customFonts: config.customFonts,
					defaultLibraries: "general",
					libraries: simpleDrawioLibrary(libs),
				};
			}
		);

		drawioInstance.onUnknownMessage.sub(({ message }) => {
			if (message.event === "updateLocalStorage") {
				const newLocalStorage: Record<string, string> = (message as any)
					.newLocalStorage;
				config.setLocalStorage(newLocalStorage);
			}
		});

		return drawioInstance;
	}

	private getHtml(
		config: DiagramConfig,
		options: DiagramOptions,
		webview: Webview
	): string {
		if (config.mode.kind === "offline") {
			return this.getOfflineHtml(config, options, webview);
		} else {
			return this.getOnlineHtml(config, config.mode.url);
		}
	}

	private getOfflineHtml(
		config: DiagramConfig,
		options: DiagramOptions,
		webview: Webview
	): string {
		const vsuri = webview.asWebviewUri(
			Uri.file(path.join(__dirname, "../../drawio/src/main/webapp"))
		);
		const customPluginsPath = webview.asWebviewUri(
			// See webpack configuration.
			Uri.file(path.join(__dirname, "../custom-drawio-plugins/index.js"))
		);

		const localStorage = untracked(() => config.localStorage);

		// TODO use template engine
		const patchedHtml = html
			.replace(/\$\{vsuri\}/g, vsuri.toString())
			.replace("${theme}", config.theme)
			.replace("${lang}", config.language)
			.replace("${chrome}", options.isReadOnly ? "0" : "1")
			.replace("${customPluginsPath}", customPluginsPath.toString())
			.replace("$$localStorage$$", JSON.stringify(localStorage));
		return patchedHtml;
	}

	private getOnlineHtml(config: DiagramConfig, drawioUrl: string): string {
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

				<iframe src="${drawioUrl}?embed=1&ui=${config.theme}&proto=json&configure=1&noSaveBtn=1&noExitBtn=1&lang=${config.language}"></iframe>
			</body>
		</html>
			`;
	}
}

export interface DiagramOptions {
	isReadOnly: boolean;
}

function prettify(msg: unknown): string {
	try {
		if (typeof msg === "string") {
			const obj = JSON.parse(msg as string);
			return formatValue(obj, process.env.DEV === "1" ? 500 : 80);
		}
		return formatValue(msg, process.env.DEV === "1" ? 500 : 80);
	} catch {}
	return "" + msg;
}
