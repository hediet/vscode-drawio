import { WebviewPanel, TextDocument, window, workspace, Uri } from "vscode";
import { DrawioInstance } from "./DrawioInstance";
import { DrawioDocument } from "./DrawioEditorProviderBinary";

export class DrawioEditorManager {
	private readonly openedEditors = new Set<DrawioEditor>();

	get activeDrawioEditor(): DrawioEditor | undefined {
		return [...this.openedEditors].find((e) => e.webviewPanel.active);
	}

	register(editor: DrawioEditor): void {
		this.openedEditors.add(editor);
		editor.webviewPanel.onDidDispose(() => {
			this.openedEditors.delete(editor);
		});
	}
}

export class DrawioEditor {
	constructor(
		public readonly webviewPanel: WebviewPanel,
		public readonly instance: DrawioInstance,
		public readonly document:
			| { kind: "text"; document: TextDocument }
			| { kind: "drawio"; document: DrawioDocument }
	) {}

	public get uri(): Uri {
		return this.document.document.uri;
	}

	/**
	 * @param newExtension Must start with a dot.
	 */
	public getUriWithExtension(newExtension: string): Uri {
		const baseName = this.uri.path.split(".")[0];

		return this.uri.with({
			path: baseName + newExtension,
		});
	}

	public async convertTo(targetExtension: string): Promise<void> {
		if (this.document.document.isDirty) {
			await window.showErrorMessage("Save your diagram first!");
			return;
		}
		const sourceUri = this.document.document.uri;
		const targetUri = this.getUriWithExtension(targetExtension);

		try {
			await workspace.fs.stat(targetUri);
			await window.showErrorMessage(
				`File "${targetUri.toString()}" already exists!`
			);
			return;
		} catch (e) {
			// file does not exist
		}

		const buffer = await this.instance.export(targetExtension);

		await workspace.fs.writeFile(sourceUri, buffer);
		await workspace.fs.rename(sourceUri, targetUri);
    }
    
    public async exportTo(targetExtension: string): Promise<void> {
        const buffer = await this.instance.export(targetExtension);
        const targetUri = await window.showSaveDialog({
            defaultUri: this.getUriWithExtension(targetExtension)
        });

        if (!targetUri) {
            return;
        }
        await workspace.fs.writeFile(targetUri, buffer);
    }
}
