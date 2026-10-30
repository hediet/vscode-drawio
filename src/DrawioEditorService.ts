import { Disposable } from "@hediet/std/disposable";
import { EventEmitter } from "@hediet/std/events";
import { autorun, computed, observable, ObservableSet } from "mobx";
import { basename, extname, isAbsolute } from "path";
import {
	commands,
	QuickPickItem, QuickPickItemKind, StatusBarAlignment,
	TextDocument,
	Uri,
	ViewColumn,
	WebviewPanel,
	window,
	workspace
} from "vscode";
import { Config, DiagramConfig, ResolvedDrawioTheme } from "./Config";
import {
	CustomizedDrawioClient,
	DrawioClientFactory,
	DrawioClientOptions,
} from "./DrawioClient";
import { DrawioBinaryDocument } from "./DrawioEditorProviderBinary";
import { BufferImpl } from "./utils/buffer";
import { registerFailableCommand } from "./utils/registerFailableCommand";

const drawioChangeThemeCommand = "hediet.vscode-drawio.changeTheme";

/**
 * The argument of `hediet.vscode-drawio.export` for exporting a diagram file
 * without an editor and without prompts, e.g. from another extension.
 * Paths are absolute or relative to the first workspace folder.
 */
export interface ExportOptions {
	source: Uri | string;
	/** Defaults to the source with the extension of the format. */
	destination?: Uri | string;
	/** Defaults to the extension of the destination, else svg. */
	format?: "svg" | "png" | "drawio";
	/** Replaces an existing destination file. Defaults to false. */
	overwrite?: boolean;
}

const exportFormats = ["svg", "png", "drawio"];
const exportTimeoutMs = 60_000;

export class DrawioEditorService {
	public readonly dispose = Disposable.fn();

	private readonly onEditorOpenedEmitter = new EventEmitter<{
		editor: DrawioEditor;
	}>();
	public readonly onEditorOpened = this.onEditorOpenedEmitter.asEvent();

	public readonly openedEditors = new ObservableSet<DrawioEditor>();

	@computed
	get activeDrawioEditor(): DrawioEditor | undefined {
		return [...this.openedEditors].find((e) => e.isActive);
	}

	@observable private _lastActiveDrawioEditor: DrawioEditor | undefined;
	get lastActiveDrawioEditor(): DrawioEditor | undefined {
		return this._lastActiveDrawioEditor;
	}

	private readonly statusBar = this.dispose.track(
		window.createStatusBarItem(StatusBarAlignment.Right)
	);

	constructor(
		private readonly config: Config,
		private readonly drawioClientFactory: DrawioClientFactory
	) {
		autorun(() => {
			const a = this.activeDrawioEditor;
			if (a) {
				this._lastActiveDrawioEditor = a;
			}
			commands.executeCommand(
				"setContext",
				"hediet.vscode-drawio.active",
				!!a
			);
		});

		this.dispose.track(
			registerFailableCommand(drawioChangeThemeCommand, () => {
				const activeDrawioEditor = this.activeDrawioEditor;
				if (!activeDrawioEditor) {
					return;
				}
				activeDrawioEditor.handleChangeThemeCommand();
			})
		);

		this.dispose.track(
			registerFailableCommand("hediet.vscode-drawio.convert", () => {
				const activeDrawioEditor = this.activeDrawioEditor;
				if (!activeDrawioEditor) {
					return;
				}
				activeDrawioEditor.handleConvertCommand();
			})
		);

		this.dispose.track(
			registerFailableCommand(
				"hediet.vscode-drawio.reload-webview",
				() => {
					for (const e of this.openedEditors) {
						e.drawioClient.reloadWebview();
					}
				}
			)
		);

		this.dispose.track(
			commands.registerCommand(
				"hediet.vscode-drawio.export",
				async (options?: ExportOptions) => {
					if (options?.source !== undefined) {
						// Errors reject the command so that the caller sees them.
						return await this.exportFile(options);
					}
					const activeDrawioEditor = this.activeDrawioEditor;
					if (!activeDrawioEditor) {
						return;
					}
					try {
						await activeDrawioEditor.handleExportCommand();
					} catch (e: any) {
						window.showErrorMessage("The command failed: " + e.message);
						return false;
					}
				}
			)
		);

		this.dispose.track({
			dispose: autorun(
				() => {
					const activeEditor = this.activeDrawioEditor;
					this.statusBar.command = drawioChangeThemeCommand;

					if (activeEditor) {
						this.statusBar.text = `Theme: ${activeEditor.config.resolvedTheme.toString()}`;
						this.statusBar.show();
					} else {
						this.statusBar.hide();
					}
				},
				{ name: "Update UI" }
			),
		});
	}

	public async createDrawioEditorInWebview(
		webviewPanel: WebviewPanel,
		document:
			| { kind: "text"; document: TextDocument }
			| { kind: "drawio"; document: DrawioBinaryDocument },
		options: DrawioClientOptions
	): Promise<DrawioEditor> {
		const instance =
			await this.drawioClientFactory.createDrawioClientInWebview(
				document.document.uri,
				webviewPanel,
				options
			);

		const config = this.config.getDiagramConfig(document.document.uri);
		const editor = new DrawioEditor(
			PrivateSymbol,
			webviewPanel,
			instance,
			document,
			config
		);

		this.openedEditors.add(editor);
		this.onEditorOpenedEmitter.emit({ editor });

		editor.webviewPanel.onDidDispose(() => {
			this.openedEditors.delete(editor);
		});

		return editor;
	}

	/**
	 * Exports a diagram file as it is saved on disk. It is rendered in a
	 * temporary webview that closes when the export is written.
	 */
	public async exportFile(options: ExportOptions): Promise<Uri> {
		const source = resolveUri(options.source);
		const destinationOption =
			options.destination !== undefined
				? resolveUri(options.destination)
				: undefined;
		const format = (
			options.format ??
			(destinationOption && exportFormatOf(destinationOption.path)) ??
			"svg"
		)
			.replace(/^\./, "")
			.toLowerCase();
		if (!exportFormats.includes(format)) {
			throw new Error(
				`Invalid format "${format}"! Use "svg", "png" or "drawio".`
			);
		}
		const destination =
			destinationOption ??
			source.with({
				path:
					removeEnd(source.path, getDiagramFileExtension(source.path)) +
					"." +
					format,
			});

		if (destination.toString() === source.toString()) {
			throw new Error(
				`Cannot export "${source.toString()}" to itself!`
			);
		}
		if (!options.overwrite && (await fileExists(destination))) {
			throw new Error(
				`File "${destination.toString()}" already exists! Pass overwrite: true to replace it.`
			);
		}
		const content = await workspace.fs.readFile(source);

		const panel = window.createWebviewPanel(
			"hediet.vscode-drawio.export",
			`Exporting ${basename(source.path)}`,
			{ viewColumn: ViewColumn.Active, preserveFocus: true },
			{ retainContextWhenHidden: true }
		);
		let timeout: NodeJS.Timeout | undefined;
		try {
			const drawioClient =
				await this.drawioClientFactory.createDrawioClientInWebview(
					source,
					panel,
					{ isReadOnly: false }
				);
			const buffer = await new Promise<BufferImpl>((resolve, reject) => {
				timeout = setTimeout(
					() => reject(new Error(`Exporting "${source.toString()}" timed out!`)),
					exportTimeoutMs
				);
				panel.onDidDispose(() =>
					reject(new Error("The export was canceled."))
				);
				drawioClient.onInit.sub(async () => {
					try {
						if (source.path.endsWith(".png")) {
							await drawioClient.loadPngWithEmbeddedXml(content);
						} else {
							await drawioClient.loadXmlLike(
								BufferImpl.from(content).toString("utf-8")
							);
						}
						resolve(await drawioClient.export("." + format, true));
					} catch (e) {
						reject(e);
					}
				});
			});
			await workspace.fs.writeFile(destination, buffer);
			return destination;
		} finally {
			clearTimeout(timeout);
			panel.dispose();
		}
	}
}

const PrivateSymbol = Symbol();

const knownDrawioFileExtensions: ReadonlyArray<string> = [
	".drawio",
	".dio",
	".drawio.svg",
	".drawio.png",
	".dio.svg",
	".dio.png",
];

function getDiagramFileExtension(path: string): string {
	// Just in case an extension is the prefix of another,
	// we want to return the longest.
	const sortedExtensionsByLengthDesc = knownDrawioFileExtensions
		.slice()
		.sort((a, b) => b.length - a.length);
	return (
		sortedExtensionsByLengthDesc.find((ext) => path.endsWith(ext)) ||
		extname(path)
	);
}

function exportFormatOf(path: string): string | undefined {
	const ext = extname(path).toLowerCase();
	return ext === ".dio" ? "drawio" : ext.substr(1) || undefined;
}

/**
 * Accepts a Uri, a URI string, an absolute path or a path relative to the
 * first workspace folder (in its file system, e.g. in a remote window).
 */
function resolveUri(uriOrPath: Uri | string): Uri {
	if (uriOrPath instanceof Uri) {
		return uriOrPath;
	}
	if (typeof uriOrPath !== "string") {
		// Uri components, e.g. from a keybinding's args
		return Uri.from(uriOrPath);
	}
	if (/^[a-z][\w+.-]+:\/\//i.test(uriOrPath)) {
		return Uri.parse(uriOrPath, true);
	}
	const folder = workspace.workspaceFolders?.[0]?.uri;
	if (isAbsolute(uriOrPath)) {
		const path = Uri.file(uriOrPath).path;
		return folder ? folder.with({ path }) : Uri.file(uriOrPath);
	}
	if (!folder) {
		throw new Error(
			`Cannot resolve the relative path "${uriOrPath}" without a workspace folder!`
		);
	}
	return Uri.joinPath(folder, uriOrPath);
}

/**
 * Represents a drawio editor in VS Code.
 * Wraps a `CustomizedDrawioClient` and a webview.
 */
export class DrawioEditor {
	public readonly dispose = Disposable.fn();

	@observable private _isActive = false;
	@observable private _hasFocus = false;

	public get fileExtension(): string {
		return getDiagramFileExtension(this.uri.path);
	}

	constructor(
		_constructorGuard: typeof PrivateSymbol,
		public readonly webviewPanel: WebviewPanel,
		public readonly drawioClient: CustomizedDrawioClient,
		public readonly document:
			| { kind: "text"; document: TextDocument }
			| { kind: "drawio"; document: DrawioBinaryDocument },
		public readonly config: DiagramConfig
	) {
		this._isActive = webviewPanel.active;
		this.dispose.track(
			webviewPanel.onDidChangeViewState(() => {
				this._isActive = webviewPanel.active;
			})
		);

		this.dispose.track(
			drawioClient.onFocusChanged.sub(({ hasFocus }) => {
				this._hasFocus = hasFocus;
			})
		);

		drawioClient.onInvokeCommand.sub(({ command }) => {
			if (command === "convert") {
				this.handleConvertCommand();
			} else if (command === "export") {
				this.handleExportCommand();
			} else if (command === "save") {
				this.drawioClient.triggerOnSave();
			}
		});
	}

	public get isActive(): boolean {
		return this._isActive;
	}

	public get hasFocus(): boolean {
		return this._hasFocus;
	}

	public get uri(): Uri {
		return this.document.document.uri;
	}

	/**
	 * Supports `.drawio`, `.dio`, `.drawio.svg` `.drawio.png` and other extensions.
	 *
	 * @param newExtension Must start with a dot.
	 */
	public getUriWithExtension(newExtension: string): Uri {
		return this.uri.with({
			path: removeEnd(this.uri.path, this.fileExtension) + newExtension,
		});
	}

	public async convertTo(targetExtension: string): Promise<void> {
		if (this.document.document.isDirty) {
			await window.showErrorMessage("Save your diagram first!");
			return;
		}

		const targetUri = this.getUriWithExtension(targetExtension);
		if (await fileExists(targetUri)) {
			await window.showErrorMessage(
				`File "${targetUri.toString()}" already exists!`
			);
			return;
		}

		const buffer = await this.drawioClient.export(targetExtension);

		const sourceUri = this.document.document.uri;
		const oldContent = await workspace.fs.readFile(sourceUri);

		await workspace.fs.writeFile(sourceUri, buffer);
		try {
			await workspace.fs.rename(sourceUri, targetUri);
		} catch (e) {
			await workspace.fs.writeFile(sourceUri, oldContent);
			throw e;
		}
	}

	public async exportTo(targetExtension: string): Promise<void> {
		// Exports the page that is visible in the editor
		const buffer = await this.drawioClient.export(targetExtension, true);
		const targetUri = await window.showSaveDialog({
			defaultUri: this.getUriWithExtension(targetExtension),
		});

		if (!targetUri) {
			return;
		}
		await workspace.fs.writeFile(targetUri, buffer);
	}

	public async handleConvertCommand(): Promise<void> {
		const result = await window.showQuickPick(
			[
				{
					label: ".drawio.svg",
					description: "Converts the diagram to an editable SVG file",
				},
				{
					label: ".drawio",
					description: "Converts the diagram to a drawio file",
				},

				{
					label: ".drawio.png",
					description: "Converts the diagram to an editable png file",
				},
			].filter((x) => x.label !== this.fileExtension)
		);

		if (!result) {
			return;
		}
		await this.convertTo(result.label);
	}

	public async handleExportCommand(): Promise<void> {
		const result = await window.showQuickPick([
			{
				label: ".svg",
				description: "Exports the diagram to a SVG file",
			},
			{
				label: ".png",
				description: "Exports the diagram to a png file",
			},
			{
				label: ".drawio",
				description: "Exports the diagram to a drawio file",
			},
		]);

		if (!result) {
			return;
		}
		await this.exportTo(result.label);
	}

	public async handleChangeThemeCommand(): Promise<void> {
		const originalTheme = this.config.theme;
		const originalAppearance = this.config.appearance;
		const availableThemes = withFirstUnique(ResolvedDrawioTheme.getThemeNames(), originalTheme);

		const availableOptions: (QuickPickItem & { onSelect?: (preview: boolean) => void })[] = [];

		const curVsCodeAppearance = this.config.getVsCodeAppearance();

		const appearances = withFirstUnique(["automatic", "light", "dark"], originalAppearance);
		for (const appearance of appearances) {
			const appearanceLabel = appearance === "automatic" ? `always match VS Code theme '${curVsCodeAppearance}'` : appearance;

			availableOptions.push({
				kind: QuickPickItemKind.Separator,
				label: appearanceLabel,
			});
			for (const theme of availableThemes) {
				availableOptions.push({
					label: `${theme} - ${appearance}`,
					onSelect: () => {
						this.config.setTheme(theme);
						this.config.setAppearance(appearance);
					}
				});
			}
		}
		const result = await window.showQuickPick(
			availableOptions,
			{
				onDidSelectItem: async (item) => {
					(item as any).onSelect(true);
				},
			}
		);
		if (!result || !result.onSelect) {
			await this.config.setTheme(originalTheme);
			await this.config.setAppearance(originalAppearance);
			return;
		}
		result.onSelect(false);
	}
}

function withFirstUnique<T>(items: T[], firstItem: T): T[] {
	const filtered = items.filter(t => t !== firstItem);
	return [firstItem, ...filtered];
}

async function fileExists(uri: Uri): Promise<boolean> {
	try {
		await workspace.fs.stat(uri);
		return true;
	} catch (e) {
		return false;
	}
}

function removeEnd(value: string, end: string): string {
	if (!value.endsWith(end)) {
		throw new Error(`Value does not end with "${end}"!`);
	}
	return value.substr(0, value.length - end.length);
}
