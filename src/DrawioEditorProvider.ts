import {
	CustomEditorProvider,
	EventEmitter,
	CustomDocument,
	CancellationToken,
	Uri,
	CustomDocumentBackupContext,
	CustomDocumentBackup,
	CustomDocumentOpenContext,
	WebviewPanel,
	CustomDocumentContentChangeEvent,
	workspace,
	window,
	commands,
} from "vscode";
import { DrawioInstance, DrawioDocumentChange } from "./DrawioInstance";
import { extname } from "path";
import { DrawioAppServer } from "./DrawioAppServer";
import { Disposable } from "@hediet/std/disposable";

export class DrawioEditorProvider
	implements CustomEditorProvider<DrawioDocument> {
	private readonly onDidChangeCustomDocumentEmitter = new EventEmitter<
		CustomDocumentContentChangeEvent<DrawioDocument>
	>();

	public readonly onDidChangeCustomDocument = this
		.onDidChangeCustomDocumentEmitter.event;

	public constructor(public readonly drawioAppServer: DrawioAppServer) {}

	public saveCustomDocument(
		document: DrawioDocument,
		cancellation: CancellationToken
	): Promise<void> {
		return document.save();
	}

	public saveCustomDocumentAs(
		document: DrawioDocument,
		destination: Uri,
		cancellation: CancellationToken
	): Promise<void> {
		return document.saveAs(destination);
	}

	public revertCustomDocument(
		document: DrawioDocument,
		cancellation: CancellationToken
	): Promise<void> {
		return document.revert();
	}

	public async backupCustomDocument(
		document: DrawioDocument,
		context: CustomDocumentBackupContext,
		cancellation: CancellationToken
	): Promise<CustomDocumentBackup> {
		return document.backup(context.destination);
	}

	public async openCustomDocument(
		uri: Uri,
		openContext: CustomDocumentOpenContext,
		token: CancellationToken
	): Promise<DrawioDocument> {
		const document = new DrawioDocument(uri, openContext.backupId);
		document.onChange(() => {
			this.onDidChangeCustomDocumentEmitter.fire({
				document,
			});
		});
		document.onInstanceSave(() => {
			commands.executeCommand("workbench.action.files.save");
		});

		return document;
	}

	public async resolveCustomEditor(
		document: DrawioDocument,
		webviewPanel: WebviewPanel,
		token: CancellationToken
	): Promise<void> {
		const drawioInstance = await this.drawioAppServer.setupWebview(
			webviewPanel.webview
		);
		document.setDrawioInstance(drawioInstance);
	}
}

class DrawioDocument implements CustomDocument {
	private readonly onChangeEmitter = new EventEmitter<DrawioDocumentChange>();
	public readonly onChange = this.onChangeEmitter.event;

	private readonly onInstanceSaveEmitter = new EventEmitter();
	public readonly onInstanceSave = this.onInstanceSaveEmitter.event;

	private _drawio: DrawioInstance | undefined;

	private get drawio(): DrawioInstance {
		return this._drawio!;
	}

	public constructor(
		public readonly uri: Uri,
		public readonly backupId: string | undefined
	) {}

	public setDrawioInstance(instance: DrawioInstance): void {
		if (this._drawio) {
			throw new Error("Instance already set!");
		}
		this._drawio = instance;

		instance.onInit.one(async () => {
			await this.load(true);
		});

		instance.onChange.sub((change) => {
			this.onChangeEmitter.fire(change);
		});

		instance.onSave.sub((change) => {
			this.onInstanceSaveEmitter.fire();
		});
	}

	private async load(initial: boolean) {
		if (initial && this.backupId) {
			const backupFile = Uri.parse(this.backupId);
			const content = await workspace.fs.readFile(backupFile);
			const xml = Buffer.from(content).toString("utf-8");
			await this.drawio.loadXmlLike(xml);
		} else {
			if (this.uri.fsPath.endsWith(".png")) {
				const buffer = await workspace.fs.readFile(this.uri);
				await this.drawio.loadPngWithEmbeddedXml(buffer);
			} else {
				throw new Error("Invalid file extension");
			}
		}
	}

	public save(): Promise<void> {
		return this.saveAs(this.uri);
	}

	public async saveAs(target: Uri): Promise<void> {
		const buffer = await this.drawio.export(extname(target.path));
		await workspace.fs.writeFile(target, buffer);
	}

	public async backup(destination: Uri): Promise<CustomDocumentBackup> {
		const xml = await this.drawio.getXml();
		await workspace.fs.writeFile(destination, Buffer.from(xml, "utf-8"));
		return {
			id: destination.toString(),
			delete: async () => {
				try {
					await workspace.fs.delete(destination);
				} catch {
					// noop
				}
			},
		};
	}

	public dispose(): void {}

	public revert(): Promise<void> {
		return this.load(false);
	}
}
