import * as vscode from "vscode";
import { Disposable } from "@hediet/std/disposable";

export class ActivityBarFeature {
	public readonly dispose = Disposable.fn();

	constructor() {
		this.dispose.track(
			vscode.window.registerTreeDataProvider(
				"drawio-welcome",
				new EmptyTreeDataProvider()
			)
		);
	}
}

class EmptyTreeDataProvider implements vscode.TreeDataProvider<never> {
	getTreeItem(): vscode.TreeItem {
		throw new Error("No items");
	}
	getChildren(): never[] {
		return [];
	}
}
