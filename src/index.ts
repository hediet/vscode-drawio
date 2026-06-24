import * as vscode from "vscode";
import { MobxConsoleLogger } from "@knuddels/mobx-logger";
import * as mobx from "mobx";
import { Extension } from "./Extension";
import * as inlineEditor from "./inline-editor/extension";

if (process.env.DEV === "1") {
	new MobxConsoleLogger(mobx);
}

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(new Extension(context));

	inlineEditor.activate(context);

	// Return extendMarkdownIt so VS Code's markdown preview can find it.
	return { extendMarkdownIt };
}

export function deactivate() {}

export function extendMarkdownIt(md: any) {
	return inlineEditor.extendMarkdownIt(md);
}
