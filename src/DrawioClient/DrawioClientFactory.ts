import {
	commands,
	Disposable,
	env,
	RelativePattern,
	Webview,
	OutputChannel,
	Uri,
	window,
	WebviewPanel,
	workspace,
} from "vscode";
import { CustomizedDrawioClient, simpleDrawioLibrary } from ".";
import { Config, DiagramConfig, SlideSize } from "../Config";
import { VSCODE_PASSTHROUGH_KEYS } from "../vscodeShortcuts";
import { appendEmbedParams } from "../utils/appendEmbedParams";
import html from "./webview-content.html";
import { formatValue } from "../utils/formatValue";
import {
	autorun,
	comparer,
	observable,
	reaction,
	runInAction,
	untracked,
} from "mobx";
import { sha256 } from "js-sha256";
import { getDrawioExtensions } from "../DrawioExtensionApi";
import { BufferImpl } from "../utils/buffer";
import {
	LiveSlideSettings,
	readLiveSlideSettings,
	readMathCommands,
	readTemplates,
	SlideTemplate,
	templateFiles,
	checkDeckColorEdit,
	plannedStyleSettingsWrite,
	writeDeckColorEdit,
} from "./slideSettings";
import { RefusedColorEdit } from "./deckColorEdits";
import { writeDeckColorEditWithUses } from "./deckColorUseEdits";
import { DeckColorValueWatch } from "./deckColorValueWatch";
import { DeckStyleRules, loadDeckStyleRules } from "../deck/deckStyles";
import { RefusedStyleEdit } from "./deckStyleEdits";
import { writeDeckStyleEditWithUses } from "./deckStyleUseEdits";
import { COLOR_LINK_KEYS, TEXT_COLOR_LINK } from "../deck/deckColors";
import { deckDrawingFiles, deckSectionFiles } from "../deck/deckColorFiles";
import * as path from "path";

/**
 * The plugins of the slides in `drawio-custom-plugins/slides/`, in the
 * order of loading: `deck-files.js` before `deck-pictures.plugin.js`, `language-check.plugin.js`
 * and `media.plugin.js`, `slide-settings.js` before `math-definitions.plugin.js`,
 * `deck-colors.plugin.js`, `deck-color-links.plugin.js`, `deck-colors-section.plugin.js`,
 * `deck-styles-section.plugin.js` and `list-styles.plugin.js`, `deck-style-rules.js` before
 * `deck-styles-section.plugin.js`,
 * `list-marker-rules.js` before
 * `list-styles.plugin.js`, and `media-bar.js` before `media.plugin.js`, which use them.
 */
const SLIDE_PLUGINS = [
	"deck-files.js",
	"slide-settings.js",
	"math-definitions.plugin.js",
	"deck-colors.plugin.js",
	"deck-color-links.plugin.js",
	"deck-colors-section.plugin.js",
	"deck-style-rules.js",
	"deck-styles-section.plugin.js",
	"single-page.plugin.js",
	"click-through.plugin.js",
	"edit-at-click.plugin.js",
	"list-marker-rules.js",
	"list-styles.plugin.js",
	"language-check.plugin.js",
	"view-position.plugin.js",
	"deck-pictures.plugin.js",
	"insert-slide.plugin.js",
	"media-bar.js",
	"media.plugin.js",
];

/** The file whose folder is the folder of a deck. */
const DECK_MARKER = "package.json";

/** The watch of the colors of a deck folder, shared by the open drawings of the deck. */
interface DeckColorWatchEntry {
	readonly watch: DeckColorValueWatch;
	/** The settings of each open drawing of the deck. */
	readonly drawings: Set<DiagramConfig>;
}

export class DrawioClientFactory {
	/** The watch of the colors of each deck folder with an open drawing, by the path of the folder. */
	private readonly deckColorWatches = new Map<string, DeckColorWatchEntry>();

	constructor(
		private readonly config: Config,
		private readonly log: OutputChannel,
		private readonly extensionUri: Uri
	) { }

	private loadedStyleRules: DeckStyleRules | undefined;

	/** The rules of the styles of a deck, from `deck-style-rules.js` of the extension, read once. */
	private get styleRules(): DeckStyleRules {
		this.loadedStyleRules ??= loadDeckStyleRules(
			Uri.joinPath(
				this.extensionUri,
				"drawio-custom-plugins",
				"slides",
				"deck-style-rules.js"
			).fsPath
		);
		return this.loadedStyleRules;
	}

	public async createDrawioClientInWebview(
		uri: Uri,
		webviewPanel: WebviewPanel,
		options: DrawioClientOptions
	): Promise<CustomizedDrawioClient> {
		const config = this.config.getDiagramConfig(uri);
		const slides = config.slides ? await this.getSlides(config) : undefined;
		const otherPlugins = await this.getPlugins(config);
		// The templates as last saved, from which each new page of the webview starts. The
		// variable is no observable, so that a save of a template reaches the page in use through
		// `updateSlideTemplates` and reloads no webview, which would lose the zoom and the undo.
		let slideTemplates = slides?.templates ?? [];
		const readLiveSettings = () =>
			slides && readLiveSlideSettings(
				config,
				slides.mathCommands,
				this.styleRules
			);
		// The live settings that the HTML of the webview holds, which the configuration of
		// draw.io takes as well, so that the two agree at every load of the page, also at a load
		// that VS Code starts from the same HTML.
		let htmlSettings: LiveSlideSettings | undefined;
		// The live settings that the page in the webview holds, the settings of its HTML or the
		// settings sent last.
		let pageSettings: LiveSlideSettings | undefined;
		// Whether the slide plugins of the page listen for the live settings, from the event
		// init of draw.io until the next reload.
		let isPageListening = false;
		readLiveSettings()?.problems.forEach((problem) =>
			this.log.appendLine(problem)
		);

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
				config.styles;
				config.defaultVertexStyle;
				config.defaultEdgeStyle;
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
				// The slide plugins of a drawing of slides in the offline mode follow a change of
				// its live settings without a reload, through the reaction below, so the zoom and
				// the undo history stay. Every other drawing reloads when its colors change.
				const isUpdatedInPlace =
					slides !== undefined && config.mode.kind === "offline";
				if (!isUpdatedInPlace) {
					config.presetColors;
					config.customColorSchemes;
					config.colorNames;
				}
				const settings = isUpdatedInPlace
					? untracked(readLiveSettings)?.settings
					: readLiveSettings()?.settings;
				const plugins =
					slides && settings
						? [
								{
									jsCode: slideSettingsScript(
										slides.deckFolder,
										{
											...settings,
											templates: slideTemplates,
											slideSize: slides.slideSize,
											languageTool: slides.languageTool,
										}
									),
								},
								...slides.plugins,
								...otherPlugins,
						  ]
						: otherPlugins;
				const html =
					this.getHtml(config, options, webview, plugins) +
					" ".repeat(i++);

				if (config.isResizeImageUpdating) {
					config.isResizeImageUpdating = false;
				} else {
					htmlSettings = settings;
					pageSettings = settings;
					isPageListening = false;
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
					presetColors:
						htmlSettings?.presetColors ?? config.presetColors,
					customColorSchemes:
						htmlSettings?.colorSchemes ?? config.customColorSchemes,
					styles: config.styles,
					defaultVertexStyle: config.defaultVertexStyle,
					defaultEdgeStyle: config.defaultEdgeStyle,
					colorNames: htmlSettings?.colorNames ?? config.colorNames,
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
			}
		});

		const releaseDeckColorWatch = slides
			? this.holdDeckColorWatch(slides.deckFolder, config)
			: () => {};
		if (slides) {
			// The edits of a drawing run one after the other, so that each reads the settings
			// file that the edit before it saved.
			let pendingEdit = Promise.resolve();
			drawioClient.onDeckColorEdit.sub(({ edit }) => {
				pendingEdit = pendingEdit
					.then(() =>
						this.editDeckColors(
							config,
							edit,
							slides.deckFolder,
							untracked(readLiveSettings)!.settings.colors
						)
					)
					.catch((error) => this.log.appendLine(`${error}`));
			});
		}

		if (slides) {
			let pendingStyleEdit = Promise.resolve();
			drawioClient.onDeckStyleEdit.sub(({ edit }) => {
				pendingStyleEdit = pendingStyleEdit
					.then(() =>
						this.editDeckStyles(
							config,
							edit,
							slides.deckFolder,
							untracked(readLiveSettings)!.settings.styles
						)
					)
					.catch((error) => this.log.appendLine(`${error}`));
			});
		}

		const templateWatchers = slides
			? this.watchTemplates(config, slides.deckFolder, (templates) => {
					slideTemplates = templates;
					drawioClient.updateSlideTemplates(templates);
			  })
			: [];

		// A change of the live settings goes to the page that listens, and a page that starts
		// after the change gets the settings when it is ready, at the event init.
		const sendLiveSettings = (settings: LiveSlideSettings) => {
			if (
				isPageListening &&
				!comparer.structural(settings, pageSettings)
			) {
				pageSettings = settings;
				drawioClient.updateSlideSettings(settings);
			}
		};
		const disposeLiveSettings = slides
			? reaction(
					() => readLiveSettings()!,
					(reading) => {
						reading.problems.forEach((problem) =>
							this.log.appendLine(problem)
						);
						sendLiveSettings(reading.settings);
					},
					{
						name: "Update Slide Settings",
						equals: comparer.structural,
					}
			  )
			: () => {};
		drawioClient.onInit.sub(() => {
			// A page that has just loaded holds the settings of its HTML.
			pageSettings = htmlSettings;
			isPageListening = slides !== undefined;
			const reading = untracked(readLiveSettings);
			if (reading) {
				sendLiveSettings(reading.settings);
			}
		});

		webviewPanel.onDidDispose(() => {
			disposeAutorun();
			disposeLiveSettings();
			releaseDeckColorWatch();
			drawioClient.dispose();
			templateWatchers.forEach((watcher) => watcher.dispose());
		});

		return drawioClient;
	}

	/**
	 * Keeps a watch of the colors of the deck folder while a drawing of the deck is open, one watch
	 * per deck folder, and returns the function that gives the drawing up.
	 */
	private holdDeckColorWatch(
		deckFolder: Uri,
		config: DiagramConfig
	): () => void {
		const key = deckFolder.fsPath;
		const entry =
			this.deckColorWatches.get(key) ??
			this.startDeckColorWatch(deckFolder, config);
		entry.drawings.add(config);
		return () => {
			entry.drawings.delete(config);
			if (entry.drawings.size === 0) {
				entry.watch.dispose();
				this.deckColorWatches.delete(key);
			}
		};
	}

	/**
	 * Starts the watch of the colors of the deck folder with the drawing as its first drawing, so
	 * that the watch reads the colors of the deck through it from the start.
	 */
	private startDeckColorWatch(
		deckFolder: Uri,
		config: DiagramConfig
	): DeckColorWatchEntry {
		const drawings = new Set<DiagramConfig>([config]);
		const watch = new DeckColorValueWatch(
			deckFolder,
			() =>
				new Map(
					readLiveSlideSettings(
						[...drawings][0] ?? config,
						[],
						this.styleRules
					).settings.colors.map(({ name, value }) => [name, value])
				),
			() => this.deckDrawingFiles(deckFolder, [...drawings]),
			(line) => this.log.appendLine(line)
		);
		const entry = { watch, drawings };
		this.deckColorWatches.set(deckFolder.fsPath, entry);
		return entry;
	}

	/**
	 * The drawing files of a deck that an edit of its colors changes: its section files, or its
	 * multi-page file, its templates, and the open drawings of the deck whose text is the XML of
	 * draw.io, such as a drawing of the deck outside its slides folder.
	 */
	private async deckDrawingFiles(
		deckFolder: Uri,
		drawings: readonly DiagramConfig[]
	): Promise<string[]> {
		const templates =
			drawings.length === 0
				? []
				: await templateFiles(drawings[0].templatePatterns(deckFolder));
		return deckDrawingFiles(
			deckSectionFiles(deckFolder.fsPath),
			templates.map((file) => file.fsPath),
			drawings
				.map((drawing) => drawing.uri)
				.filter((uri) => uri.scheme === "file")
				.map((uri) => uri.fsPath)
		);
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

	/**
	 * The slide plugins, the folder of the deck, the pages of its templates, the commands that
	 * MathJax lacks and the settings that the plugins read once, which `slideSettingsScript`
	 * gives the plugins. The extension ships the plugins, so they load without the question that
	 * a plugin of the settings asks.
	 */
	private async getSlides(config: DiagramConfig): Promise<{
		plugins: { jsCode: string }[];
		deckFolder: Uri;
		templates: SlideTemplate[];
		mathCommands: string[];
		slideSize: SlideSize;
		languageTool: string;
	}> {
		const deckFolder = await findDeckFolder(config.uri);
		const templates = await readTemplates(
			config.templatePatterns(deckFolder),
			this.log
		);
		const mathCommands = await readMathCommands(this.extensionUri);
		const plugins = await Promise.all(
			SLIDE_PLUGINS.map(async (name) => ({
				jsCode: BufferImpl.from(
					await workspace.fs.readFile(
						Uri.joinPath(
							this.extensionUri,
							"drawio-custom-plugins",
							"slides",
							name
						)
					)
				).toString("utf-8"),
			}))
		);
		return {
			plugins,
			deckFolder,
			templates,
			mathCommands,
			slideSize: config.slideSize,
			languageTool: config.languageTool,
		};
	}

	/**
	 * Writes an edit of the colors that the section Deck colors of the Format panel sends into the
	 * settings and into the uses of the color in the drawing files of the deck, after a question
	 * before a removal, and says in VS Code why the extension refuses an edit.
	 */
	private async editDeckColors(
		config: DiagramConfig,
		edit: DeckColorEdit,
		deckFolder: Uri,
		colors: LiveSlideSettings["colors"]
	): Promise<void> {
		const deckColorWatch = this.deckColorWatches.get(deckFolder.fsPath);
		const watch = deckColorWatch?.watch;
		const write = async () => {
			await checkDeckColorEdit(config, edit);
			await writeDeckColorEditWithUses(
				edit,
				await this.deckDrawingFiles(deckFolder, [
					config,
					...(deckColorWatch?.drawings ?? []),
				]),
				new Map(colors.map(({ name, value }) => [name, value])),
				() => writeDeckColorEdit(config, edit)
			);
		};
		try {
			await (watch === undefined ? write() : watch.whileSectionEdits(write));
		} catch (error) {
			const message = error instanceof Error ? error.message : `${error}`;
			this.log.appendLine(message);
			if (error instanceof RefusedColorEdit) {
				window.showWarningMessage(message);
			} else {
				window.showErrorMessage(message);
			}
		}
	}

	/**
	 * Writes an edit of the styles that the section Deck styles of the Format panel sends into the
	 * settings and into the cells linked to the style in the drawing files of the deck, after a
	 * question before a removal, and says in VS Code why the extension refuses an edit.
	 */
	private async editDeckStyles(
		config: DiagramConfig,
		edit: DeckStyleEdit,
		deckFolder: Uri,
		styles: LiveSlideSettings["styles"]
	): Promise<void> {
		const named = (list: { name: string; style: string }[]) =>
			Object.fromEntries(list.map(({ name, style }) => [name, style]));
		try {
			const write = await plannedStyleSettingsWrite(
				config,
				edit,
				this.styleRules
			);
			await writeDeckStyleEditWithUses(
				edit,
				await this.deckDrawingFiles(deckFolder, [
					config,
					...(this.deckColorWatches.get(deckFolder.fsPath)?.drawings ??
						[]),
				]),
				{
					rectangles: named(styles.rectangles),
					wires: named(styles.wires),
				},
				this.styleRules,
				write
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : `${error}`;
			this.log.appendLine(message);
			if (error instanceof RefusedStyleEdit) {
				window.showWarningMessage(message);
			} else {
				window.showErrorMessage(message);
			}
		}
	}

	/**
	 * Watches the template files of a drawing, and gives `update` their pages again after a file
	 * is saved, added or deleted.
	 */
	private watchTemplates(
		config: DiagramConfig,
		deckFolder: Uri,
		update: (templates: SlideTemplate[]) => void
	): Disposable[] {
		const patterns = config.templatePatterns(deckFolder);
		const send = async () => {
			update(await readTemplates(patterns, this.log));
		};
		return patterns.map((pattern) => {
			const watcher = workspace.createFileSystemWatcher(
				new RelativePattern(
					Uri.file(path.dirname(pattern)),
					path.basename(pattern)
				)
			);
			watcher.onDidChange(send);
			watcher.onDidCreate(send);
			watcher.onDidDelete(send);
			return watcher;
		});
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

/**
 * The folder of the deck that holds a drawing: the nearest folder above the drawing that holds
 * `package.json`, up to the workspace folder of the drawing, and otherwise the folder of the
 * drawing.
 */
async function findDeckFolder(uri: Uri): Promise<Uri> {
	const drawingFolder = Uri.joinPath(uri, "..");
	const workspaceFolder = workspace.getWorkspaceFolder(uri);
	let folder = drawingFolder;
	while (true) {
		try {
			await workspace.fs.stat(Uri.joinPath(folder, DECK_MARKER));
			return folder;
		} catch {
			// No deck marker in this folder.
		}
		const parent = Uri.joinPath(folder, "..");
		const isTop =
			parent.path === folder.path ||
			(workspaceFolder !== undefined &&
				folder.path === workspaceFolder.uri.path);
		if (isTop) {
			return drawingFolder;
		}
		folder = parent;
	}
}

/**
 * The script of two lines, loaded before the slide plugins, that gives them the folder of the deck
 * and the settings of the slides, with the keys of the links to the colors of the deck.
 */
function slideSettingsScript(
	deckFolder: Uri,
	settings: LiveSlideSettings & {
		templates: SlideTemplate[];
		slideSize: SlideSize;
		languageTool: string;
	}
): string {
	const deckFolders = JSON.stringify([deckFolder.fsPath]);
	const colorLinks = {
		keys: Object.fromEntries(
			Object.entries(COLOR_LINK_KEYS).map(([key, { link }]) => [key, link])
		),
		textAttribute: TEXT_COLOR_LINK,
	};
	return (
		`window.mediaPluginDeckFolders = ${deckFolders};\n` +
		`window.drawSlidesCodeSettings = ${JSON.stringify({
			...settings,
			colorLinks,
		})};`
	);
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
