import * as vscode from "vscode";
import { Webview } from "vscode";
import { DrawioInstance } from "../DrawioInstance";
import { DrawioAppServer } from "./DrawioAppServer";
import { formatValue } from "./formatValue";
import { Config } from "../Config";

export abstract class HostedDrawioAppServer implements DrawioAppServer {
	public abstract getHtml(webview: Webview): string;

	constructor(
		private readonly log: vscode.OutputChannel,
		protected readonly config: Config
	) {}

	public async setupWebview(webview: Webview): Promise<DrawioInstance> {
		webview.options = {
			enableScripts: true,
		};

		webview.html = this.getHtml(webview);

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

		drawioInstance.onUnknownMessage.sub(({ message }) => {
			if (message.event === "updateLocalStorage") {
				const newLocalStorage: Record<string, string> = (message as any)
					.newLocalStorage;
				this.config.setLocalStorage(newLocalStorage);
			}
		});

		return drawioInstance;
	}

	public getLanguage(): string {
		const lang = vscode.env.language.split("-")[0].toLowerCase();
		return lang;
	}

	public getTheme(): string {
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
