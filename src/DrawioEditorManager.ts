import { Disposable } from "@hediet/std/disposable";
import { EventEmitter } from "@hediet/std/events";
import { startTimeout } from "@hediet/std/timer";
import { autorun, computed, observable, ObservableSet } from "mobx";
import { basename, dirname, extname, join } from "path";
import { TextDocument, Uri, WebviewPanel, window, workspace } from "vscode";
import { Config, DiagramConfig } from "./Config";
import { DrawioBinaryDocument } from "./DrawioEditorProviderBinary";
import { CustomDrawioInstance } from "./DrawioInstance";

export class DrawioEditorManager {
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

	constructor(private readonly config: Config) {
		autorun(() => {
			const a = this.activeDrawioEditor;
			if (a) {
				this._lastActiveDrawioEditor = a;
			}
		});
	}

	public createDrawioEditor(
		webviewPanel: WebviewPanel,
		instance: CustomDrawioInstance,
		document:
			| { kind: "text"; document: TextDocument }
			| { kind: "drawio"; document: DrawioBinaryDocument }
	): DrawioEditor {
		const config = this.config.getConfig(document.document.uri);
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

export class DrawioEditor {
	public readonly dispose = Disposable.fn();
	private readonly onActivityDetectedEmitter = new EventEmitter();
	public readonly onActivityDetected = this.onActivityDetectedEmitter.asEvent();

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

	private timeout: Disposable | undefined;

	constructor(
		_constructorGuard: typeof PrivateSymbol,
		public readonly webviewPanel: WebviewPanel,
		public readonly instance: CustomDrawioInstance,
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
			instance.onFocusChanged.sub(({ hasFocus }) => {
				this._hasFocus = hasFocus;
			})
		);

		this.dispose.track({
			dispose: autorun(() => {
				if (this.hasFocus) {
					if (!this.timeout) {
						this.timeout = this.dispose.track(
							startTimeout(1000 * 60, () => {
								// Activity = 1 minute of focus time
								this.dispose.untrack(this.timeout);
								this.onActivityDetectedEmitter.emit();
							})
						);
					}
				} else {
					if (this.timeout) {
						this.timeout.dispose();
						this.timeout = undefined;
					}
				}
			}),
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

		const buffer = await this.instance.export(targetExtension);

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
		const buffer = await this.instance.export(targetExtension);
		const targetUri = await window.showSaveDialog({
			defaultUri: this.getUriWithExtension(targetExtension),
		});

		if (!targetUri) {
			return;
		}
		await workspace.fs.writeFile(targetUri, buffer);
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
