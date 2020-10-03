import * as vscode from "vscode";
import { MobxConsoleLogger } from "@knuddels/mobx-logger";
import * as mobx from "mobx";
import { Extension } from "./Extension";

if (process.env.DEV === "1") {
	new MobxConsoleLogger(mobx);
}

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(new Extension(context));
}

export function deactivate() {}
