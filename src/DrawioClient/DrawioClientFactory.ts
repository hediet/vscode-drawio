import {
	commands,
	env,
	Webview,
	OutputChannel,
	Uri,
	window,
	SecretStorage,
	WebviewPanel,
	workspace,
} from "vscode";
import { CustomizedDrawioClient, DrawioConfig, simpleDrawioLibrary } from ".";
import {
	applyDialogConfig,
	mergeDrawioConfig,
	readConfigSecrets,
	readConfigState,
} from "../drawioConfiguration";
import { DeferredReloads } from "./DeferredReloads";
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
	// Reloads of all editors while the Configuration dialog writes the settings
	private readonly dialogReloads = new DeferredReloads();

	constructor(
		private readonly config: Config,
		private readonly log: OutputChannel,
		private readonly extensionUri: Uri,
		// Stores the API keys of the Configuration dialog
		private readonly secrets: SecretStorage
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
		const reload = () => {
			runInAction("Reload after configuration", () => {
				reloadId.id++;
			});
		};
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
				config.drawioConfig;
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
				} else if (!this.dialogReloads.defer(reload)) {
					// Else reloads once the Configuration dialog wrote the settings
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
				const hostConfig: Record<string, unknown> = {
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

				// Adds the config setting and the Configuration dialog
				return mergeDrawioConfig(hostConfig, readConfigState(config.uri),
					await readConfigSecrets(this.secrets, (message) =>
						this.log.appendLine(message))) as DrawioConfig;
			},
			() => {
				runInAction("Force reload", () => {
					reloadId.id++;
				});
			},
			() => config.svgAppearance
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
			} else if ((message as any).event === "configuration") {
				// Apply in the Configuration dialog: stores the options in the
				// user settings and the API keys in the secret storage. The open
				// editors reload once for the settings (also after an error, for
				// the settings that were written), and this one also for the API
				// keys, which no setting tracks. If the change events of the
				// settings come after the writes, the editors reload for them as
				// usual.
				this.dialogReloads.run(async () => {
					const changes = await applyDialogConfig(config.uri,
						(message as any).config, this.secrets);

					if (changes.secrets > 0) {
						this.dialogReloads.defer(reload);
					}
				}).catch((e) => {
					window.showErrorMessage(`Could not store the Draw.io configuration: ${e}`);
				});
			}
		});

		webviewPanel.onDidDispose(() => {
			disposeAutorun();
			this.dialogReloads.forget(reload);
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
		// The bridge below only sends to and accepts messages from the origin
		// of the configured app, so diagram data can't reach a page the frame
		// navigated to. A URL without an http(s) origin keeps the unpinned
		// bridge. frame-src stays open since a self-hosted app may pass
		// through a sign-in page on another origin.
		let drawioOrigin = "*";
		try {
			const url = new URL(drawioUrl);
			if (url.protocol === "https:" || url.protocol === "http:") {
				drawioOrigin = url.origin;
			}
		} catch {
			// Not an absolute URL
		}
		const nonce = getNonce();
		return `
			<html>
			<head>
			<meta charset="UTF-8">
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; frame-src *;">
			<style>
				html { height: 100%; width: 100%; padding: 0; margin: 0; }
				body { height: 100%; width: 100%; padding: 0; margin: 0; }
				iframe { height: 100%; width: 100%; padding: 0; margin: 0; border: 0; display: block; }
			</style>
			</head>
			<body>
				<script nonce="${nonce}">
					const api = window.VsCodeApi = acquireVsCodeApi();
					const drawioOrigin = ${JSON.stringify(drawioOrigin)};
					window.addEventListener('message', event => {
						
						if (event.source === window.frames[0]) {
							//console.log("frame -> vscode", event.data);
							if (drawioOrigin === "*" || event.origin === drawioOrigin) {
								api.postMessage(event.data);
							}
						} else {
							//console.log("vscode -> frame", event.data);
							window.frames[0].postMessage(event.data, drawioOrigin);
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

function getNonce(): string {
	let text = "";
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
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
