import * as vscode from "vscode";
import { Disposable } from "@hediet/std/disposable";
import { DrawioEditorProviderBinary } from "./DrawioEditorProviderBinary";
import { DrawioEditorProviderText } from "./DrawioEditorProviderText";
import { Config } from "./Config";
import { DrawioWebviewInitializer } from "./DrawioWebviewInitializer";
import { DrawioEditorManager } from "./DrawioEditorManager";
import { LinkCodeWithSelectedNodeService } from "./features/CodeLinkFeature";
import { EditDiagramAsTextFeature } from "./features/EditDiagramAsTextFeature";
import { LiveshareFeature } from "./features/LiveshareFeature";
import { ActivityTracking } from "./features/ActivtyTracking";
import { join, dirname } from "path";

export class Extension {
	public readonly dispose = Disposable.fn();
	private readonly log = this.dispose.track(
		vscode.window.createOutputChannel("Drawio Integration Log")
	);

	private readonly packageJsonPath = join(
		this.context.extensionPath,
		"package.json"
	);

	private readonly config = new Config(
		this.packageJsonPath,
		this.context.globalState
	);
	private readonly editorManager = new DrawioEditorManager(this.config);
	private readonly linkCodeWithSelectedNodeService = this.dispose.track(
		new LinkCodeWithSelectedNodeService(this.editorManager, this.config)
	);
	private readonly editDiagramsAsTextFeature = this.dispose.track(
		new EditDiagramAsTextFeature(this.editorManager, this.config)
	);
	private readonly liveshareFeature = this.dispose.track(
		new LiveshareFeature(this.editorManager, this.config)
	);
	private readonly insiderFeedbackFeature = this.dispose.track(
		new ActivityTracking(this.editorManager, this.config)
	);
	private readonly drawioWebviewInitializer = new DrawioWebviewInitializer(
		this.config,
		this.log
	);

	constructor(private readonly context: vscode.ExtensionContext) {
		this.dispose.track(
			vscode.commands.registerCommand(
				"hediet.vscode-drawio.newDiagram",
				async () => {
					const newFileName = await vscode.window.showInputBox({
						placeHolder: "Enter file name",
					});

					if (newFileName) {
						// Figure the folder to put new file
						const openFilePath =
							vscode.window.activeTextEditor?.document.uri.path;
						const activeFolderPath = openFilePath
							? dirname(openFilePath)
							: vscode.workspace.workspaceFolders &&
							  vscode.workspace.workspaceFolders[0].uri.path;
						if (activeFolderPath) {
							const fileUri = vscode.Uri.file(
								join(activeFolderPath, newFileName)
							);
							await vscode.workspace.fs.writeFile(
								fileUri,
								Buffer.of()
							); // write file with empty content
							await vscode.commands.executeCommand(
								"vscode.open",
								fileUri
							);
						} else {
							vscode.window.showErrorMessage(
								"Failed to create new file. No active workspace found."
							);
						}
					}
				}
			)
		);

		this.dispose.track(
			vscode.window.registerCustomEditorProvider(
				"hediet.vscode-drawio-text",
				new DrawioEditorProviderText(
					this.drawioWebviewInitializer,
					this.editorManager
				),
				{ webviewOptions: { retainContextWhenHidden: true } }
			)
		);

		this.dispose.track(
			vscode.window.registerCustomEditorProvider(
				"hediet.vscode-drawio",
				new DrawioEditorProviderBinary(
					this.drawioWebviewInitializer,
					this.editorManager
				),
				{
					supportsMultipleEditorsPerDocument: false,
					webviewOptions: { retainContextWhenHidden: true },
				}
			)
		);
	}
}
