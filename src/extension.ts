import * as vscode from "vscode";
import { Disposable } from "@hediet/std/disposable";
import { DrawioEditorProvider } from "./DrawioEditorProvider";
import { DrawioTextEditorProvider } from "./DrawioTextEditorProvider";
import { Config } from "./Config";
import { ConfiguredDrawioAppServer } from "./DrawioAppServer";
import { LinkCodeWithSelectedNodeService } from "./LinkCodeWithSelectedNodeService";

export class Extension {
	public readonly dispose = Disposable.fn();

	private readonly log = this.dispose.track(
		vscode.window.createOutputChannel("Drawio Integration Log")
	);
	private readonly config = this.dispose.track(new Config());
	private readonly server = this.dispose.track(
		new ConfiguredDrawioAppServer(this.config, this.log)
	);
	private readonly linkCodeWithSelectedNodeService = this.dispose.track(
		new LinkCodeWithSelectedNodeService()
	);

	constructor() {
		const textEditorProvider = new DrawioTextEditorProvider(this.server);
		textEditorProvider.onNewDrawioInstance.sub(({ drawioInstance }) => {
			this.linkCodeWithSelectedNodeService.handleDrawioInstance(
				drawioInstance
			);
		});
		this.dispose.track(
			vscode.window.registerCustomEditorProvider(
				"hediet.vscode-drawio-text",
				textEditorProvider,
				{ webviewOptions: { retainContextWhenHidden: true } }
			)
		);

		const enableProposedApi = require("../package.json")
			.enableProposedApi as boolean | undefined;
		if (enableProposedApi) {
			this.dispose.track(
				vscode.window.registerCustomEditorProvider2(
					"hediet.vscode-drawio",
					new DrawioEditorProvider(this.server),
					{
						supportsMultipleEditorsPerDocument: false,
						webviewOptions: { retainContextWhenHidden: true },
					}
				)
			);
		}
	}
}

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(new Extension());
}

export function deactivate() {}
