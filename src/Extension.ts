import * as vscode from "vscode";
import { Disposable } from "@hediet/std/disposable";
import { DrawioEditorProviderBinary } from "./DrawioEditorProviderBinary";
import { DrawioEditorProviderText } from "./DrawioEditorProviderText";
import { Config } from "./Config";
import { DrawioEditorService } from "./DrawioEditorService";
import { LinkCodeWithSelectedNodeService } from "./features/CodeLinkFeature";
import { EditDiagramAsTextFeature } from "./features/EditDiagramAsTextFeature";
import { LiveshareFeature } from "./features/LiveshareFeature";
import { DeckSetUpFeature } from "./features/DeckSetUpFeature/DeckSetUpFeature";
import { DeckBuildFeature } from "./features/DeckBuildFeature/DeckBuildFeature";
import { DrawioClientFactory } from "./DrawioClient";
import { registerFailableCommand } from "./utils/registerFailableCommand";

export class Extension {
	public readonly dispose = Disposable.fn();
	public readonly log = this.dispose.track(
		vscode.window.createOutputChannel("Drawio Integration Log")
	);

	public readonly config = new Config(this.context.globalState);
	private readonly drawioClientFactory = new DrawioClientFactory(
		this.config,
		this.log,
		this.context.extensionUri
	);
	private readonly editorService = new DrawioEditorService(
		this.config,
		this.drawioClientFactory
	);
	private readonly linkCodeWithSelectedNodeService = this.dispose.track(
		new LinkCodeWithSelectedNodeService(this.editorService, this.config)
	);
	private readonly editDiagramsAsTextFeature = this.dispose.track(
		new EditDiagramAsTextFeature(this.editorService, this.config)
	);
	private readonly liveshareFeature = this.dispose.track(
		new LiveshareFeature(this.editorService, this.config)
	);
	private readonly deckSetUpFeature = this.dispose.track(
		new DeckSetUpFeature(this.log, this.context.extensionUri.fsPath)
	);
	private readonly deckBuildFeature = this.dispose.track(
		new DeckBuildFeature(this.log, this.context.extensionUri.fsPath)
	);

	constructor(private readonly context: vscode.ExtensionContext) {
		this.dispose.track(
			vscode.window.registerCustomEditorProvider(
				"drawSlidesCode.textEditor",
				new DrawioEditorProviderText(this.editorService),
				{ webviewOptions: { retainContextWhenHidden: true } }
			)
		);

		this.dispose.track(
			vscode.window.registerCustomEditorProvider(
				"drawSlidesCode.binaryEditor",
				new DrawioEditorProviderBinary(this.editorService),
				{
					supportsMultipleEditorsPerDocument: false,
					webviewOptions: { retainContextWhenHidden: true },
				}
			)
		);

		this.dispose.track(
			registerFailableCommand("drawSlidesCode.newDiagram", async () => {
				const targetUri = await vscode.window.showSaveDialog({
					saveLabel: "Create",
					filters: {
						Diagrams: ["drawio"],
					},
				});
				if (!targetUri) {
					return;
				}
				try {
					await vscode.workspace.fs.writeFile(
						targetUri,
						new Uint8Array()
					);
					await vscode.commands.executeCommand(
						"vscode.openWith",
						targetUri,
						"drawSlidesCode.textEditor"
					);
				} catch (e) {
					console.error("Cannot create or open file", e);
					await vscode.window.showErrorMessage(
						`Cannot create or open file "${targetUri.toString()}"!`
					);
				}
			})
		);
	}
}
