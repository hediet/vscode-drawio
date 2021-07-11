import { commands, window, Disposable } from "vscode";

export function registerFailableCommand(
	commandName: string,
	commandFn: (...args: any[]) => any
): Disposable {
	return commands.registerCommand(commandName, async (...args: any[]) => {
		try {
			return await commandFn(...args);
		} catch (e) {
			window.showErrorMessage("The command failed: " + e.message);
			return false;
		}
	});
}
