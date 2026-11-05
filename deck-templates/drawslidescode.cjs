// Runs the command line of the VS Code extension DrawSlidesCode on this presentation, with the
// mode and the options given, as the scripts of package.json do: `node drawslidescode.cjs build`.
// `node drawslidescode.cjs --help` lists the modes and the options.
//
// The command line is `dist/cli.js` of the folder that the environment variable
// DRAWSLIDESCODE_EXTENSION names, such as a clone of the extension, or else of the newest version
// of yujunhuang.drawslidescode that VS Code, VS Code Insiders or VSCodium has installed. This file
// names no version, so it runs the extension of each machine, also after an update of the
// extension. The command Set Up a Presentation in This Folder of the extension wrote it.
//
// Yujun Huang grants an additional permission for this file under section 7 of the GNU General
// Public License, version 3, in LICENSE-EXCEPTION.md of DrawSlidesCode.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const EXTENSION_ID = "yujunhuang.drawslidescode";
const FOLDER_VARIABLE = "DRAWSLIDESCODE_EXTENSION";
const INSTALLED_NAME = /^yujunhuang\.drawslidescode-(\d+(?:\.\d+)*)$/;
/** The file in which VS Code lists the folders of the versions that it has uninstalled. */
const OBSOLETE = ".obsolete";

/** The folders that hold the extensions of VS Code: the one that `VSCODE_EXTENSIONS` names, and those of VS Code, VS Code Insiders and VSCodium, whose versions the launcher compares together. */
function extensionRoots() {
	return [
		process.env.VSCODE_EXTENSIONS,
		path.join(os.homedir(), ".vscode", "extensions"),
		path.join(os.homedir(), ".vscode-insiders", "extensions"),
		path.join(os.homedir(), ".vscode-oss", "extensions"),
	].filter((root) => root);
}

/** The names of the folders of the root that VS Code has uninstalled and not yet removed. */
function obsoleteNames(root) {
	try {
		return new Set(
			Object.keys(
				JSON.parse(fs.readFileSync(path.join(root, OBSOLETE), "utf8"))
			)
		);
	} catch {
		return new Set();
	}
}

function compareVersions(first, second) {
	for (
		let index = 0;
		index < Math.max(first.length, second.length);
		index++
	) {
		const difference = (first[index] || 0) - (second[index] || 0);
		if (difference !== 0) {
			return difference;
		}
	}
	return 0;
}

/** The installed versions of the extension, each with its folder, the newest last. */
function installedFolders() {
	return extensionRoots()
		.filter((root) => fs.existsSync(root))
		.flatMap((root) => {
			const obsolete = obsoleteNames(root);
			return fs
				.readdirSync(root)
				.filter((name) => !obsolete.has(name))
				.map((name) => [name, INSTALLED_NAME.exec(name)])
				.filter(([, match]) => match !== null)
				.map(([name, match]) => ({
					version: match[1].split(".").map(Number),
					folder: path.join(root, name),
				}));
		})
		.sort((first, second) =>
			compareVersions(first.version, second.version)
		);
}

/** The folder of the extension whose command line runs, or undefined with the reason printed. */
function extensionFolder() {
	const named = process.env[FOLDER_VARIABLE];
	if (named) {
		return path.resolve(named);
	}
	const found = installedFolders();
	if (found.length === 0) {
		console.error(
			`the VS Code extension ${EXTENSION_ID} is not installed, so install it, or set ${FOLDER_VARIABLE} to a clone of it`
		);
		return undefined;
	}
	return found[found.length - 1].folder;
}

const folder = extensionFolder();
const commandLine = folder && path.join(folder, "dist", "cli.js");
if (commandLine === undefined) {
	process.exitCode = 1;
} else if (!fs.existsSync(commandLine)) {
	console.error(`${commandLine} is missing`);
	process.exitCode = 1;
} else {
	require(commandLine);
}
