import * as vscode from "vscode";
import { MobxConsoleLogger } from "@knuddels/mobx-logger";
import * as mobx from "mobx";
import { Extension } from "./Extension";
import { join } from "path";

if (process.env.DEV === "1") {
	new MobxConsoleLogger(mobx);
}

export function activate(context: vscode.ExtensionContext) {
	const packageJsonPath = join(context.extensionPath, "package.json");
	context.subscriptions.push(new Extension(packageJsonPath));
}

export function deactivate() {}
