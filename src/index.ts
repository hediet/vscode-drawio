import * as vscode from "vscode";
import { Disposable } from "@hediet/std/disposable";
import { DrawioEditorProviderBinary } from "./DrawioEditorProviderBinary";
import { DrawioEditorProviderText } from "./DrawioEditorProviderText";
import { Config } from "./Config";
import { DrawioWebviewInitializer } from "./DrawioAppServer";
import { DrawioEditorManager } from "./DrawioEditorManager";
import { MobxConsoleLogger } from "@knuddels/mobx-logger";
import * as mobx from "mobx";
import { LinkCodeWithSelectedNodeService } from "./LinkCodeWithSelectedNodeService";
import { EditDiagramAsTextService } from "./EditDiagramsAsTextService";

if (process.env.DEV === "1") {
	new MobxConsoleLogger(mobx);
}

export class Extension {
	public readonly dispose = Disposable.fn();
	private readonly log = this.dispose.track(
		vscode.window.createOutputChannel("Drawio Integration Log")
	);
	private readonly editorManager = new DrawioEditorManager();

	private readonly config = new Config();
	private readonly linkCodeWithSelectedNodeService = this.dispose.track(
		new LinkCodeWithSelectedNodeService(this.editorManager, this.config)
	);
	private readonly editDiagramsAsTextService = this.dispose.track(
		new EditDiagramAsTextService(this.editorManager, this.config)
	);
	private readonly drawioWebviewInitializer = new DrawioWebviewInitializer(
		this.config,
		this.log
	);

	constructor() {
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

		this.dispose.track(
			vscode.commands.registerCommand(
				"hediet.vscode-drawio.convert",
				async () => {
					// TODO remove the current format from the selection
					const result = await vscode.window.showQuickPick([
						{
							label: ".drawio.svg",
							description:
								"Converts the diagram to an editable SVG file",
						},
						{
							label: ".drawio",
							description:
								"Converts the diagram to a drawio file",
						},

						{
							label: ".drawio.png",
							description:
								"Converts the diagram to an editable png file",
						},
					]);

					if (!result) {
						return;
					}

					const activeDrawioEditor = this.editorManager
						.activeDrawioEditor;
					if (!activeDrawioEditor) {
						return;
					}
					await activeDrawioEditor.convertTo(result.label);
				}
			)
		);

		this.dispose.track(
			vscode.commands.registerCommand(
				"hediet.vscode-drawio.export",
				async () => {
					// TODO remove the current format from the selection
					const result = await vscode.window.showQuickPick([
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

					const activeDrawioEditor = this.editorManager
						.activeDrawioEditor;
					if (!activeDrawioEditor) {
						return;
					}
					await activeDrawioEditor.exportTo(result.label);
				}
			)
		);
	}
}

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(new Extension());
}

export function deactivate() {}
