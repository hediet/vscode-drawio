const fs = require("node:fs");
const path = require("node:path");

/**
 * A stand-in of the API of VS Code for the tests of the commands, which `useStandIn` of
 * `loadTsModule.js` puts in the place of the module `vscode`. It records what a command shows,
 * asks and runs in `state`, and answers each question of a command from `state.answers`: a list
 * per kind of question, such as `information` or `input`, whose next value, or the value that a
 * function in its place returns, is the answer.
 */

/** What the commands showed, asked and ran since the last `resetState`, and what the stand-in answers. */
let state;

/** Starts the record again, with the workspace, the settings and the answers of the options. */
function resetState(options = {}) {
	state = {
		trusted: true,
		workspaceFolders: [],
		settings: {},
		messages: [],
		inputs: [],
		dialogs: [],
		executed: [],
		opened: [],
		log: [],
		shown: 0,
		answers: {},
		activeTab: undefined,
		textDocuments: [],
		progress: [],
		statusBarItems: [],
		configurationListeners: [],
		/** The number of reports of progress after which a notification is cancelled, or undefined. */
		cancelAfter: undefined,
		/** The workspace edits that `workspace.applyEdit` applied, each a list of its replacements. */
		appliedEdits: [],
		/** The paths of the documents saved, in the order of the saves. */
		saved: [],
		...options,
	};
	return state;
}

function answer(kind, message, options) {
	const next = (state.answers[kind] || []).shift();
	return typeof next === "function" ? next(message, options) : next;
}

class Uri {
	constructor(scheme, fsPath) {
		this.scheme = scheme;
		this.fsPath = fsPath;
		this.path = fsPath;
	}
	static file(fsPath) {
		return new Uri("file", fsPath);
	}
	static joinPath(base, ...parts) {
		return new Uri(base.scheme, path.join(base.fsPath, ...parts));
	}
	toString() {
		return `${this.scheme}://${this.fsPath}`;
	}
}

class TabInputCustom {
	constructor(uri, viewType) {
		this.uri = uri;
		this.viewType = viewType;
	}
}

class TabInputText {
	constructor(uri) {
		this.uri = uri;
	}
}

class Position {
	constructor(line, character) {
		Object.assign(this, { line, character });
	}
}

/** A range of lines and characters, or of two positions of `TextDocument.positionAt`, which carry their offsets. */
class Range {
	constructor(startLine, startCharacter, endLine, endCharacter) {
		if (startLine instanceof Position) {
			Object.assign(this, { start: startLine, end: startCharacter });
		} else {
			Object.assign(this, { startLine, startCharacter, endLine, endCharacter });
		}
	}
}

/** The replacements of a workspace edit, each a file, a range of two positions and a text. */
class WorkspaceEdit {
	constructor() {
		this.replacements = [];
	}
	replace(uri, range, text) {
		this.replacements.push({ uri, range, text });
	}
}

/**
 * A text document of the file, with the text on the disk unless given: `positionAt` gives a
 * position with its offset, and `save` writes the text to the disk.
 */
function textDocument(fsPath, text, isDirty = false) {
	const document = {
		uri: Uri.file(fsPath),
		isDirty,
		text: text ?? fs.readFileSync(fsPath, "utf8"),
		getText: () => document.text,
		positionAt: (offset) => Object.assign(new Position(0, offset), { offset }),
		save: () => {
			fs.writeFileSync(fsPath, document.text);
			document.isDirty = false;
			state.saved.push(fsPath);
			return Promise.resolve(true);
		},
	};
	return document;
}

/** The open document of the file, or a new one from the disk, which is then open. */
function openTextDocument(uri) {
	let document = state.textDocuments.find(
		(open) => open.uri.fsPath === uri.fsPath
	);
	if (document === undefined) {
		document = textDocument(uri.fsPath);
		state.textDocuments.push(document);
	}
	return Promise.resolve(document);
}

/** Applies the replacements to the documents, which become dirty, unless `state.answers.applyEdit` answers false. */
async function applyEdit(edit) {
	if (answer("applyEdit") === false) {
		return false;
	}
	state.appliedEdits.push(edit.replacements);
	for (const { uri, range, text } of edit.replacements) {
		const document = await openTextDocument(uri);
		document.text =
			document.text.slice(0, range.start.offset) +
			text +
			document.text.slice(range.end.offset);
		document.isDirty = true;
	}
	return true;
}

class Diagnostic {
	constructor(range, message, severity) {
		Object.assign(this, { range, message, severity });
	}
}

/** A message of the level, with its options and its buttons, answered from the answers of the level. */
function message(level) {
	return (text, ...rest) => {
		const options =
			rest.length > 0 && typeof rest[0] === "object" ? rest.shift() : undefined;
		state.messages.push({
			level,
			text,
			modal: Boolean(options && options.modal),
			detail: options && options.detail,
			buttons: rest,
		});
		return Promise.resolve(answer(level, text, options));
	};
}

/** The problems of the Problems view, by the path of their file. */
const diagnostics = new Map();
/** The commands registered, by their names. */
const registered = {};

const workspaceFolders = () =>
	state.workspaceFolders.length === 0
		? undefined
		: state.workspaceFolders.map((folder, index) => ({
				uri: Uri.file(folder),
				name: path.basename(folder),
				index,
		  }));

function withProgress(options, task) {
	const record = {
		title: options.title,
		location: options.location,
		cancellable: options.cancellable,
		reports: [],
	};
	state.progress.push(record);
	const listeners = [];
	const token = {
		isCancellationRequested: false,
		onCancellationRequested: (listener) => {
			listeners.push(listener);
			return { dispose: () => {} };
		},
	};
	const progress = {
		report: (value) => {
			record.reports.push(value.message);
			if (record.reports.length === state.cancelAfter) {
				token.isCancellationRequested = true;
				listeners.forEach((listener) => listener());
			}
		},
	};
	return task(progress, token);
}

function createStatusBarItem() {
	const item = {
		text: "",
		tooltip: "",
		command: undefined,
		shown: false,
		disposed: false,
		texts: [],
	};
	item.show = () => (item.shown = true);
	item.dispose = () => (item.disposed = true);
	state.statusBarItems.push(item);
	return new Proxy(item, {
		set(target, key, value) {
			if (key === "text") {
				target.texts.push(value);
			}
			target[key] = value;
			return true;
		},
	});
}

const vscode = {
	Uri,
	TabInputCustom,
	TabInputText,
	Position,
	Range,
	WorkspaceEdit,
	Diagnostic,
	DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
	StatusBarAlignment: { Left: 1, Right: 2 },
	ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
	FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
	ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
	env: {
		openExternal: (uri) => {
			state.opened.push(uri.fsPath);
			return Promise.resolve(true);
		},
	},
	languages: {
		createDiagnosticCollection: (name) => ({
			name,
			set: (uri, list) => diagnostics.set(uri.fsPath, { uri, list }),
			delete: (uri) => diagnostics.delete(uri.fsPath),
			forEach: (callback) =>
				[...diagnostics.values()].forEach(({ uri, list }) =>
					callback(uri, list)
				),
			dispose: () => diagnostics.clear(),
		}),
	},
	workspace: {
		get isTrusted() {
			return state.trusted;
		},
		get workspaceFolders() {
			return workspaceFolders();
		},
		getWorkspaceFolder: (uri) =>
			workspaceFolders()?.find(
				(folder) =>
					!path.relative(folder.uri.fsPath, uri.fsPath).startsWith("..")
			),
		get textDocuments() {
			return state.textDocuments;
		},
		openTextDocument,
		applyEdit,
		fs: {
			stat: (uri) =>
				fs.promises.stat(uri.fsPath).then((stats) => ({
					type: stats.isDirectory() ? 2 : 1,
					size: stats.size,
				})),
		},
		getConfiguration: (section) => ({
			get: (key, fallback) => state.settings[`${section}.${key}`] ?? fallback,
		}),
		onDidChangeConfiguration: (listener) => {
			state.configurationListeners.push(listener);
			return {
				dispose: () => {
					state.configurationListeners = state.configurationListeners.filter(
						(other) => other !== listener
					);
				},
			};
		},
	},
	window: {
		showErrorMessage: message("error"),
		showWarningMessage: message("warning"),
		showInformationMessage: message("information"),
		showInputBox: (options) => {
			state.inputs.push(options);
			return Promise.resolve(answer("input", undefined, options));
		},
		showOpenDialog: (options) => {
			state.dialogs.push({ kind: "open", ...options });
			const files = answer("openDialog", undefined, options);
			return Promise.resolve(files?.map((file) => Uri.file(file)));
		},
		showSaveDialog: (options) => {
			state.dialogs.push({ kind: "save", ...options });
			const file = answer("saveDialog", undefined, options);
			return Promise.resolve(file === undefined ? undefined : Uri.file(file));
		},
		showWorkspaceFolderPick: (options) => {
			state.messages.push({
				level: "workspaceFolderPick",
				text: options.placeHolder,
			});
			const index = answer("workspaceFolderPick");
			return Promise.resolve(
				index === undefined ? undefined : workspaceFolders()[index]
			);
		},
		showQuickPick: (items, options) => {
			state.messages.push({
				level: "quickPick",
				text: options.placeHolder,
				buttons: items,
			});
			return Promise.resolve(answer("quickPick", items));
		},
		showTextDocument: (uri) => {
			state.executed.push(["showTextDocument", uri.fsPath]);
			return Promise.resolve();
		},
		withProgress,
		createStatusBarItem,
		tabGroups: {
			get activeTabGroup() {
				return {
					activeTab:
						state.activeTab === undefined
							? undefined
							: { input: state.activeTab },
				};
			},
		},
		get activeTextEditor() {
			return undefined;
		},
	},
	commands: {
		registerCommand: (name, callback) => {
			registered[name] = callback;
			return { dispose: () => {} };
		},
		executeCommand: (...args) => {
			state.executed.push(args);
			return Promise.resolve(registered[args[0]]?.(...args.slice(1)));
		},
	},
};

/** The output channel of the extension, whose lines go into `state.log`. */
const log = {
	appendLine: (line) => state.log.push(line + "\n"),
	append: (text) => state.log.push(text),
	show: () => {
		state.shown += 1;
	},
};

/** Runs the registered command with the arguments, and returns what it returns. */
function runCommand(command, ...args) {
	return registered[command](...args);
}

/** The messages of the levels, such as `information` and `error`, in the order shown. */
function messagesOf(...levels) {
	return state.messages.filter((shown) => levels.includes(shown.level));
}

/** The last message of the level. */
function lastMessageOf(level) {
	return messagesOf(level).pop();
}

/** The text that the commands wrote into the output channel. */
function loggedText() {
	return state.log.join("");
}

resetState();

/**
 * Sets a setting and tells the listeners, as VS Code does once it has read a changed settings
 * file, and records the change among the commands run, so that a test sees the order.
 */
function changeConfiguration(key, value) {
	state.settings[key] = value;
	state.executed.push(["configurationChanged", key]);
	for (const listener of [...state.configurationListeners]) {
		listener({ affectsConfiguration: (section) => section === key });
	}
}

module.exports = {
	textDocument,
	changeConfiguration,
	vscode,
	log,
	diagnostics,
	resetState,
	runCommand,
	messagesOf,
	lastMessageOf,
	loggedText,
	state: () => state,
};
