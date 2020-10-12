import { Webview, OutputChannel, Uri, window } from "vscode";
import { CustomDrawioInstance, simpleDrawioLibrary } from "../DrawioInstance";
import { Config, DiagramConfig } from "../Config";
import html from "./webview-content.html";
import path = require("path");
import { formatValue } from "../utils/formatValue";
import { autorun, observable, runInAction, untracked } from "mobx";
import { sha256 } from "js-sha256";
import { readFileSync } from "fs";
import { getDrawioExtensions } from "../DrawioExtensionApi";

export class DrawioWebviewInitializer {
	constructor(
		private readonly config: Config,
		private readonly log: OutputChannel,
		private readonly extensionPath: string
	) {}

	public async initializeWebview(
		uri: Uri,
		webview: Webview,
		options: DiagramOptions
	): Promise<CustomDrawioInstance> {
		const config = this.config.getConfig(uri);
		const plugins = await this.getPlugins(config);

		webview.options = {
			enableScripts: true,
		};
		const reloadId = observable({ id: 0 });
		let i = 0;
		autorun(
			() => {
				reloadId.id;

				webview.html =
					this.getHtml(config, options, webview, plugins) +
					" ".repeat(i++);

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
			},
			() => {
				runInAction("Force reload", () => {
					reloadId.id++;
				});
			}
		);

		drawioInstance.onUnknownMessage.sub(({ message }) => {
			if (message.event === "updateLocalStorage") {
				const newLocalStorage = message.newLocalStorage;
				config.setLocalStorage(newLocalStorage);
			}
		});

		return drawioInstance;
	}

	private async getPlugins(
		config: DiagramConfig
	): Promise<{ jsCode: string }[]> {
		const pluginsToLoad = new Array<{ jsCode: string }>();
		const promises = new Array<Promise<void>>();

		for (const ext of getDrawioExtensions()) {
			promises.push(
				(async () => {
					pluginsToLoad.push(
						...(await ext.getDrawioPlugins({ uri: config.uri }))
					);
				})()
			);
		}

		for (const p of config.plugins) {
			let jsCode: string;
			try {
				jsCode = readFileSync(p.file, { encoding: "utf-8" });
			} catch (e) {
				window.showErrorMessage(
					`Could not read plugin file "${p.file}"!`
				);
				continue;
			}

			const fingerprint = sha256.hex(jsCode);
			const pluginId = p.file;

			const isAllowed = this.config.isPluginAllowed(
				pluginId,
				fingerprint
			);
			if (isAllowed) {
				pluginsToLoad.push({ jsCode });
			} else if (isAllowed === undefined) {
				promises.push(
					(async () => {
						const result = await window.showWarningMessage(
							`Found unknown plugin "${pluginId}" with fingerprint "${fingerprint}"`,
							{},
							{
								title: "Allow",
								action: async () => {
									pluginsToLoad.push({ jsCode });
									await this.config.addKnownPlugin(
										pluginId,
										fingerprint,
										true
									);
								},
							},
							{
								title: "Disallow",
								action: async () => {
									await this.config.addKnownPlugin(
										pluginId,
										fingerprint,
										false
									);
								},
							}
						);

						if (result) {
							await result.action();
						}
					})()
				);
			}
		}

		await Promise.all(promises);
		return pluginsToLoad;
	}

	private getHtml(
		config: DiagramConfig,
		options: DiagramOptions,
		webview: Webview,
		plugins: { jsCode: string }[]
	): string {
		if (config.mode.kind === "offline") {
			return this.getOfflineHtml(config, options, webview, plugins);
		} else {
			return this.getOnlineHtml(config, config.mode.url);
		}
	}

	private getOfflineHtml(
		config: DiagramConfig,
		options: DiagramOptions,
		webview: Webview,
		plugins: { jsCode: string }[]
	): string {
		const vsuri = webview.asWebviewUri(
			Uri.file(path.join(this.extensionPath, "drawio/src/main/webapp"))
		);
		const customPluginsPath = webview.asWebviewUri(
			// See webpack configuration.
			Uri.file(
				path.join(
					this.extensionPath,
					"dist/custom-drawio-plugins/index.js"
				)
			)
		);

		const localStorage = untracked(() => config.localStorage);

		// TODO use template engine
		// Prevent injection attacks by using JSON.stringify.
		const patchedHtml = html
			.replace(/\$\$literal-vsuri\$\$/g, vsuri.toString())
			.replace("$$theme$$", JSON.stringify(config.theme))
			.replace("$$lang$$", JSON.stringify(config.language))
			.replace(
				"$$chrome$$",
				JSON.stringify(options.isReadOnly ? "0" : "1")
			)
			.replace(
				"$$customPluginPaths$$",
				JSON.stringify([customPluginsPath.toString()])
			)
			.replace("$$localStorage$$", JSON.stringify(localStorage))
			.replace(
				"$$additionalCode$$",
				JSON.stringify(plugins.map((p) => p.jsCode))
			);
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

				<iframe src="${drawioUrl}?embed=1&ui=${encodeURIComponent(
			config.theme
		)}&proto=json&configure=1&noSaveBtn=1&noExitBtn=1&lang=${encodeURIComponent(
			config.language
		)}"></iframe>
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
