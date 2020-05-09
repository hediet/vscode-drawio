import * as vscode from "vscode";
import { Disposable } from "@hediet/std/disposable";
import {
	enableHotReload,
	hotRequireExportedFn,
	registerUpdateReconciler,
	getReloadCount,
} from "@hediet/node-reload";

if (process.env.HOT_RELOAD) {
	enableHotReload({ entryModule: module, loggingEnabled: true });
}

import { DrawioEditorProvider } from "./DrawioEditorProvider";
import { DrawioTextEditorProvider } from "./DrawioTextEditorProvider";

registerUpdateReconciler(module);

export class Extension {
	public readonly dispose = Disposable.fn();

	constructor() {
		if (getReloadCount(module) > 0) {
			const i = this.dispose.track(vscode.window.createStatusBarItem());
			i.text = "reload" + getReloadCount(module);
			i.show();
		}

		this.dispose.track(
			vscode.window.registerCustomEditorProvider(
				"hediet.vscode-drawio-text",
				new DrawioTextEditorProvider(),
				{ webviewOptions: { retainContextWhenHidden: true } }
			)
		);

		const enableProposedApi = require("../package.json")
			.enableProposedApi as boolean | undefined;

		if (enableProposedApi) {
			this.dispose.track(
				vscode.window.registerCustomEditorProvider2(
					"hediet.vscode-drawio",
					new DrawioEditorProvider(),
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
	context.subscriptions.push(
		hotRequireExportedFn(module, Extension, (Extension) => new Extension())
	);
}

export function deactivate() {}
