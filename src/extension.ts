import * as vscode from "vscode";
import { Disposable } from "@hediet/std/disposable";
import {
	enableHotReload,
	hotRequireExportedFn,
	registerUpdateReconciler,
	getReloadCount,
} from "@hediet/node-reload";
import { MyCustomEditor } from "./MyCustomEditor";

if (process.env.HOT_RELOAD) {
	enableHotReload({ entryModule: module, loggingEnabled: true });
}

registerUpdateReconciler(module);

export class Extension {
	public readonly dispose = Disposable.fn();

	constructor() {
		if (getReloadCount(module) > 0) {
			const i = this.dispose.track(vscode.window.createStatusBarItem());
			i.text = "reload" + getReloadCount(module);
			i.show();
		}

		vscode.window.registerCustomEditorProvider2(
			"hediet.vscode-drawio",
			new MyCustomEditor(),
			{ supportsMultipleEditorsPerDocument: false, webviewOptions: {  } }
		);
	}
}

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		hotRequireExportedFn(module, Extension, (Extension) => new Extension())
	);
}

export function deactivate() {}
