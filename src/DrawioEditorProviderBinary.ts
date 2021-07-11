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
	commands,
	window,
} from "vscode";
import { CustomizedDrawioClient } from "./DrawioClient";
import { extname } from "path";
import { DrawioEditorService } from "./DrawioEditorService";
import { BufferImpl } from "./utils/buffer";

export class DrawioEditorProviderBinary
	implements CustomEditorProvider<DrawioBinaryDocument>
{
	private readonly onDidChangeCustomDocumentEmitter = new EventEmitter<
		CustomDocumentContentChangeEvent<DrawioBinaryDocument>
	>();

	public readonly onDidChangeCustomDocument =
		this.onDidChangeCustomDocumentEmitter.event;

	public constructor(
		private readonly drawioEditorService: DrawioEditorService
	) {}

	public saveCustomDocument(
		document: DrawioBinaryDocument,
		cancellation: CancellationToken
	): Promise<void> {
		return document.save();
	}

	public saveCustomDocumentAs(
		document: DrawioBinaryDocument,
		destination: Uri,
		cancellation: CancellationToken
	): Promise<void> {
		return document.saveAs(destination);
	}

	public revertCustomDocument(
		document: DrawioBinaryDocument,
		cancellation: CancellationToken
	): Promise<void> {
		return document.loadFromDisk();
	}

	public async backupCustomDocument(
		document: DrawioBinaryDocument,
		context: CustomDocumentBackupContext,
		cancellation: CancellationToken
	): Promise<CustomDocumentBackup> {
		return document.backup(context.destination);
	}

	public async openCustomDocument(
		uri: Uri,
		openContext: CustomDocumentOpenContext,
		token: CancellationToken
	): Promise<DrawioBinaryDocument> {
		const document = new DrawioBinaryDocument(uri, openContext.backupId);
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
		document: DrawioBinaryDocument,
		webviewPanel: WebviewPanel,
		token: CancellationToken
	): Promise<void> {
		try {
			const editor =
				await this.drawioEditorService.createDrawioEditorInWebview(
					webviewPanel,
					{ kind: "drawio", document },
					{ isReadOnly: false }
				);

			document.setDrawioClient(editor.drawioClient);
		} catch (e) {
			window.showErrorMessage(`Failed to open diagram: ${e}`);
			throw e;
		}
	}
}

export class DrawioBinaryDocument implements CustomDocument {
	private readonly onChangeEmitter = new EventEmitter<void>();
	public readonly onChange = this.onChangeEmitter.event;

	private readonly onInstanceSaveEmitter = new EventEmitter<void>();
	public readonly onInstanceSave = this.onInstanceSaveEmitter.event;

	private _drawioClient: CustomizedDrawioClient | undefined;

	private get drawioClient(): CustomizedDrawioClient {
		return this._drawioClient!;
	}

	private _isDirty = false;
	public get isDirty() {
		return this._isDirty;
	}

	private currentXml: string | undefined;

	public constructor(
		public readonly uri: Uri,
		public readonly backupId: string | undefined
	) {}

	public setDrawioClient(drawioClient: CustomizedDrawioClient): void {
		if (this._drawioClient) {
			throw new Error("Client already set!");
		}
		this._drawioClient = drawioClient;

		drawioClient.onInit.sub(async () => {
			if (this.currentXml) {
				this.drawioClient.loadXmlLike(this.currentXml);
			} else if (this.backupId) {
				const backupFile = Uri.parse(this.backupId);
				const content = await workspace.fs.readFile(backupFile);
				const xml = BufferImpl.from(content).toString("utf-8");
				await this.drawioClient.loadXmlLike(xml);
				this._isDirty = true; // because of backup
			} else {
				this.loadFromDisk();
			}
		});

		drawioClient.onChange.sub((change) => {
			this.currentXml = change.newXml;
			this._isDirty = true;
			this.onChangeEmitter.fire();
		});

		drawioClient.onSave.sub((change) => {
			this.onInstanceSaveEmitter.fire();
		});
	}

	public async loadFromDisk(): Promise<void> {
		this._isDirty = false;
		if (this.uri.fsPath.endsWith(".png")) {
			const buffer = await workspace.fs.readFile(this.uri);
			await this.drawioClient.loadPngWithEmbeddedXml(buffer);
		} else {
			throw new Error("Invalid file extension");
		}
	}

	public save(): Promise<void> {
		this._isDirty = false;
		return this.saveAs(this.uri);
	}

	public async saveAs(target: Uri): Promise<void> {
		const buffer = await this.drawioClient.export(extname(target.path));
		await workspace.fs.writeFile(target, buffer);
	}

	public async backup(destination: Uri): Promise<CustomDocumentBackup> {
		const xml = await this.drawioClient.getXml();
		await workspace.fs.writeFile(
			destination,
			BufferImpl.from(xml, "utf-8")
		);
		return {
			id: destination.toString(),
			delete: async () => {
				try {
					await workspace.fs.delete(destination);
				} catch {
					// no op
				}
			},
		};
	}

	public dispose(): void {
		// no op
	}
}
