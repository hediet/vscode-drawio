import * as vscode from "vscode";
import { Disposable } from "@hediet/std/disposable";
import { DrawioEditorProviderBinary } from "./DrawioEditorProviderBinary";
import { DrawioEditorProviderText } from "./DrawioEditorProviderText";
import { Config } from "./Config";
import { ConfiguredDrawioAppServer } from "./DrawioAppServer";
import { DrawioEditorManager } from "./DrawioEditorManager";

export class Extension {
	public readonly dispose = Disposable.fn();
	private readonly log = this.dispose.track(
		vscode.window.createOutputChannel("Drawio Integration Log")
	);
	private readonly editorManager = new DrawioEditorManager();

	constructor() {
		const config = this.dispose.track(new Config());
		const server = this.dispose.track(
			new ConfiguredDrawioAppServer(config, this.log)
		);

		this.dispose.track(
			vscode.window.registerCustomEditorProvider(
				"hediet.vscode-drawio-text",
				new DrawioEditorProviderText(server, this.editorManager),
				{ webviewOptions: { retainContextWhenHidden: true } }
			)
		);

		const enableProposedApi = require("../package.json")
			.enableProposedApi as boolean | undefined;

		if (enableProposedApi) {
			this.dispose.track(
				vscode.window.registerCustomEditorProvider2(
					"hediet.vscode-drawio",
					new DrawioEditorProviderBinary(server, this.editorManager),
					{
						supportsMultipleEditorsPerDocument: false,
						webviewOptions: { retainContextWhenHidden: true },
					}
				)
			);
		}

		this.dispose.track(
			vscode.commands.registerCommand(
				"hediet.vscode-drawio.convert",
				async () => {
					// TODO remove the current format from the selection
					const result = await vscode.window.showQuickPick(
						[
							{
								label: ".drawio.svg",
								description:
									"Converts the diagram to an editable SVG file",
							},
							{
								label: ".drawio",
								description:
									"Converts the diagram to an editable drawio file",
							},
						].concat(
							enableProposedApi
								? [
										{
											label: ".drawio.png",
											description:
												"Converts the diagram to an editable png file",
										},
								  ]
								: []
						)
					);

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
	}
}

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(new Extension());
}

export function deactivate() {}
