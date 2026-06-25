import {
	commands,
	env,
	Webview,
	OutputChannel,
	Uri,
	window,
	WebviewPanel,
	workspace,
} from "vscode";
import { CustomizedDrawioClient, simpleDrawioLibrary } from ".";
import { Config, DiagramConfig } from "../Config";
import { VSCODE_PASSTHROUGH_KEYS } from "../vscodeShortcuts";
import { appendEmbedParams } from "../utils/appendEmbedParams";
import html from "./webview-content.html";
import { formatValue } from "../utils/formatValue";
import { autorun, observable, runInAction, untracked } from "mobx";
import { sha256 } from "js-sha256";
import { getDrawioExtensions } from "../DrawioExtensionApi";
import { BufferImpl } from "../utils/buffer";

export class DrawioClientFactory {
	constructor(
		private readonly config: Config,
		private readonly log: OutputChannel,
		private readonly extensionUri: Uri
	) { }

	public async createDrawioClientInWebview(
		uri: Uri,
		webviewPanel: WebviewPanel,
		options: DrawioClientOptions
	): Promise<CustomizedDrawioClient> {
		const config = this.config.getDiagramConfig(uri);
		const plugins = await this.getPlugins(config);

		const webview = webviewPanel.webview;

		webview.options = {
			enableScripts: true,
		};
		const reloadId = observable({ id: 0 });
		let i = 0;
		const disposeAutorun = autorun(
			() => {
				reloadId.id;
				// these getters triggers a reload on change
				config.customLibraries;
				config.customFonts;
				config.presetColors;
				config.customColorSchemes;
				config.styles;
				config.defaultVertexStyle;
				config.defaultEdgeStyle;
				config.colorNames;
				config.simpleLabels;
				config.zoomFactor;
				config.globalVars;
				config.showTooltipIcons;
				config.showLinkIcons;
				config.showConnectHandle;
				config.resizeImages;
				// Reload on theme/appearance SETTING changes, but NOT on system
				// dark-mode changes: getHtml reads config.resolvedTheme untracked, so
				// an OS appearance change is handled live by draw.io's dark=auto
				// instead of forcing a full webview reload (which loses zoom/undo).
				config.theme;
				config.appearance;
				config.appearanceFollowsSystem;
				const html =
					this.getHtml(config, options, webview, plugins) +
					" ".repeat(i++);

				if (config.isResizeImageUpdating) {
					config.isResizeImageUpdating = false;
				} else {
					webview.html = html;
				}
			},
			{ name: "Update Webview Html" }
		);

		const drawioClient = new CustomizedDrawioClient(
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
					presetColors: config.presetColors,
					customColorSchemes: config.customColorSchemes,
					styles: config.styles,
					defaultVertexStyle: config.defaultVertexStyle,
					defaultEdgeStyle: config.defaultEdgeStyle,
					colorNames: config.colorNames,
					simpleLabels: config.simpleLabels,
					defaultLibraries: "general",
					libraries: simpleDrawioLibrary(libs),
					zoomFactor: config.zoomFactor,
					globalVars: (config.globalVars as Record<string, string>) ?? undefined,
					// Chords draw.io should forward to VS Code instead of handling
					// itself (online/cross-origin path; offline uses the injected
					// keydown listener in webview-content.html). See vscodeShortcuts.ts.
					passThroughKeys: VSCODE_PASSTHROUGH_KEYS,
					// The VS Code webview blocks new windows/tabs: draw.io forwards
					// link clicks via {event:'openLink'} (handled below) instead of
					// window.open. (Print can't work in the sandbox either — it needs
					// a popup/modal — so it stays hidden via hideMenuItems.) See
					// drawio-dev Editor.suppressNewWindows.
					suppressNewWindows: true,
					showTooltipIcons: config.showTooltipIcons || undefined,
					showLinkIcons: config.showLinkIcons || undefined,
					showConnectHandle: config.showConnectHandle || undefined,
					compact: true,
					noAutoFocus: true,
					hideMenuItems: ["exportAs", "importFrom", "print",
						"saveAndExit", "plugins", "exit"],
					hideMenus: ["language", "help"],
				};
			},
			() => {
				runInAction("Force reload", () => {
					reloadId.id++;
				});
			}
		);

		drawioClient.onUnknownMessage.sub(({ message }) => {
			if (message.event === "updateLocalStorage") {
				const newLocalStorage = message.newLocalStorage;
				config.setLocalStorage(newLocalStorage);
			} else if (
				((message as any).event === "vscodeShortcut" ||
					(message as any).event === "shortcut") &&
				(message as any).command
			) {
				// Forwarded VS Code chord (e.g. Ctrl+P): either from the offline
				// webview keydown interceptor (vscodeShortcut) or draw.io's native
				// embed passthrough (shortcut, online/cross-origin). Run it.
				commands.executeCommand((message as any).command);
			} else if (
				(message as any).event === "openLink" &&
				(message as any).href
			) {
				// Link click forwarded from draw.io (suppressNewWindows mode):
				// open it in the host's default browser instead of a new tab.
				env.openExternal(Uri.parse((message as any).href));
			}
		});

		webviewPanel.onDidDispose(() => {
			disposeAutorun();
			drawioClient.dispose();
		});

		return drawioClient;
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
				jsCode = BufferImpl.from(
					await workspace.fs.readFile(p.file)
				).toString("utf-8");
			} catch (e) {
				window.showErrorMessage(
					`Could not read plugin file "${p.file}"!`
				);
				continue;
			}

			const fingerprint = sha256.hex(jsCode);
			const pluginId = p.file.toString();

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
		options: DrawioClientOptions,
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
		options: DrawioClientOptions,
		webview: Webview,
		plugins: { jsCode: string }[]
	): string {
		const vsuri = webview.asWebviewUri(
			Uri.joinPath(this.extensionUri, "drawio/src/main/webapp")
		);
		const customPluginsPath = webview.asWebviewUri(
			// See webpack configuration.
			Uri.joinPath(
				this.extensionUri,
				"dist/custom-drawio-plugins/index.js"
			)
		);

		const localStorage = untracked(() => config.localStorage);

		// Read theme values UNTRACKED so a system dark-mode change (which flips
		// vscodeTheme.kind via resolvedTheme) does NOT trigger a full webview
		// reload — draw.io's dark=auto re-themes live. The theme/appearance
		// *settings* are tracked separately in the reload autorun.
		const themeVals = untracked(() => {
			const rt = config.resolvedTheme;
			return {
				theme: rt.themeName,
				appearance: rt.getAppearanceDrawioValue(),
				dark: rt.getDarkDrawioValue(config.appearanceFollowsSystem),
			};
		});

		// TODO use template engine
		// Prevent injection attacks by using JSON.stringify.
		const patchedHtml = html
			.replace(/\$\$literal-vsuri\$\$/g, vsuri.toString())
			.replace("$$theme$$", JSON.stringify(themeVals.theme))
			.replace("$$appearance$$", JSON.stringify(themeVals.appearance))
			.replace("$$dark$$", JSON.stringify(themeVals.dark))
			.replace("$$lang$$", JSON.stringify(config.drawioLanguage))
			.replace("$$simpleLabels$$", JSON.stringify(config.simpleLabels))
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
		// Untracked: a system dark-mode change must not reload (dark=auto handles it).
		const themeVals = untracked(() => {
			const rt = config.resolvedTheme;
			return {
				theme: rt.themeName,
				dark: rt.getDarkDrawioValue(config.appearanceFollowsSystem),
			};
		});
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

				<iframe src="${appendEmbedParams(drawioUrl, `embed=1&ui=${encodeURIComponent(
			themeVals.theme
		)}&proto=json&configure=1&dark=${encodeURIComponent(
			themeVals.dark
		)}&noSaveBtn=0&noExitBtn=1&simpleLabels=${encodeURIComponent(
			config.simpleLabels
		)}&lang=${encodeURIComponent(config.drawioLanguage)}`)}"></iframe>
			</body>
		</html>
			`;
	}
}

export interface DrawioClientOptions {
	isReadOnly: boolean;
}

function prettify(msg: unknown): string {
	try {
		if (typeof msg === "string") {
			const obj = JSON.parse(msg as string);
			return formatValue(obj, process.env.DEV === "1" ? 500 : 80);
		}
		return formatValue(msg, process.env.DEV === "1" ? 500 : 80);
	} catch { }
	return "" + msg;
}
