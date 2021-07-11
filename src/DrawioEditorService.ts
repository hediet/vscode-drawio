import { Disposable } from "@hediet/std/disposable";
import { EventEmitter } from "@hediet/std/events";
import { autorun, computed, observable, ObservableSet } from "mobx";
import { extname } from "path";
import {
	commands,
	StatusBarAlignment,
	TextDocument,
	Uri,
	WebviewPanel,
	window,
	workspace,
} from "vscode";
import { Config, DiagramConfig } from "./Config";
import { DrawioBinaryDocument } from "./DrawioEditorProviderBinary";
import {
	CustomizedDrawioClient,
	DrawioClientOptions,
	DrawioClientFactory,
} from "./DrawioClient";
import { registerFailableCommand } from "./utils/registerFailableCommand";

const drawioChangeThemeCommand = "hediet.vscode-drawio.changeTheme";

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
			registerFailableCommand("hediet.vscode-drawio.export", () => {
				const activeDrawioEditor = this.activeDrawioEditor;
				if (!activeDrawioEditor) {
					return;
				}
				activeDrawioEditor.handleExportCommand();
			})
		);

		this.dispose.track({
			dispose: autorun(
				() => {
					const activeEditor = this.activeDrawioEditor;
					this.statusBar.command = drawioChangeThemeCommand;

					if (activeEditor) {
						this.statusBar.text = `Theme: ${activeEditor.config.theme}`;
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
}

const PrivateSymbol = Symbol();

/**
 * Represents a drawio editor in VS Code.
 * Wraps a `CustomizedDrawioClient` and a webview.
 */
export class DrawioEditor {
	public readonly dispose = Disposable.fn();

	@observable private _isActive = false;
	@observable private _hasFocus = false;

	private readonly knownDrawioFileExtensions: ReadonlyArray<string> = [
		".drawio",
		".dio",
		".drawio.svg",
		".drawio.png",
		".dio.svg",
		".dio.png",
	];

	public get fileExtension(): string {
		const currentFilePath = this.uri.path;
		// Just in case an extension is the prefix of another,
		// we want to return the longest.
		const sortedExtensionsByLengthDesc = this.knownDrawioFileExtensions
			.slice()
			.sort((a, b) => b.length - a.length);
		return (
			sortedExtensionsByLengthDesc.find((ext) =>
				currentFilePath.endsWith(ext)
			) || extname(currentFilePath)
		);
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
		const buffer = await this.drawioClient.export(targetExtension);
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
		let availableThemes = [
			"automatic",
			"min",
			"atlas",
			"dark",
			"Kennedy",
			"sketch",
		];

		const originalTheme = this.config.theme;
		availableThemes = availableThemes.filter((t) => t !== originalTheme);
		availableThemes.unshift(originalTheme);

		const result = await window.showQuickPick(
			availableThemes.map((theme) => ({
				label: theme,
				description: `Selects Theme "${theme}"`,
				theme,
			})),
			{
				onDidSelectItem: async (item) => {
					await this.config.setTheme((item as any).theme);
				},
			}
		);

		if (!result) {
			await this.config.setTheme(originalTheme);
			return;
		}

		await this.config.setTheme(result.theme);
	}
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
