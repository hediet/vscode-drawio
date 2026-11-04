import { Disposable } from "@hediet/std/disposable";
import { fork } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
	CancellationToken,
	commands,
	Diagnostic,
	DiagnosticCollection,
	DiagnosticSeverity,
	env,
	languages,
	OutputChannel,
	Progress,
	ProgressLocation,
	Range,
	StatusBarAlignment,
	StatusBarItem,
	TabInputCustom,
	TabInputText,
	Uri,
	window,
	workspace,
} from "vscode";
import {
	BuildCancelled,
	BuildReporter,
	BuildStep,
	LanguageIssue,
} from "../../deck/buildEvents";
import { BrowserNotFound } from "../../deck/deckBrowser";
import { failureText } from "../../deck/deckError";
import {
	buildDeck,
	buildDeckHtml,
	buildDeckPdf,
	checkDeck,
	DeckBuildOptions,
	DeckBuildResult,
	reportDeckOutline,
	watchDeck,
} from "../../deck/deckBuild";
import {
	coloursFromTex,
	exportColoursToTex,
	importColoursFromTex,
	settingsFile,
} from "../../deck/colourSettings";
import { COLOURS } from "../../deck/deckSettings";
import { registerFailableCommand } from "../../utils/registerFailableCommand";
import {
	cellPlace,
	deckFolderAbove,
	issueText,
	progressText,
} from "./deckCommandTargets";

const settingSection = "drawioSlides";
const browserPathSetting = "browserPath";
const showOutputButton = "Show Output";
const installButton = "Install Chromium";
const browserSettingButton = "Set the Browser Path";
const openHtmlButton = "Open HTML File";
const openPdfButton = "Open PDF";
const showProblemsButton = "Show Problems";
const importButton = "Import";
const openFileButton = "Open File";

/** A build mode of a command, with the title of the command. */
interface BuildCommand {
	readonly command: string;
	readonly title: string;
	/** What the notification of progress says, before the name of the deck. */
	readonly action: string;
	readonly run: (options: DeckBuildOptions) => Promise<DeckBuildResult>;
}

const buildCommands: readonly BuildCommand[] = [
	{
		command: "drawioSlides.buildDeck",
		title: "Build the Presentation",
		action: "Building the HTML file and the PDF of",
		run: buildDeck,
	},
	{
		command: "drawioSlides.buildDeckHtml",
		title: "Build the HTML File of the Presentation",
		action: "Building the HTML file of",
		run: buildDeckHtml,
	},
	{
		command: "drawioSlides.buildDeckPdf",
		title: "Build the PDF of the Presentation",
		action: "Building the PDF of",
		run: buildDeckPdf,
	},
];

/** A watch of a deck, which its controller stops. */
interface DeckWatch {
	readonly controller: AbortController;
	readonly statusBarItem: StatusBarItem;
}

/**
 * The commands that build a presentation, watch it, check its language, show its outline,
 * convert its colours from and to TeX, and install the browser of the build. A command runs on
 * the deck of the drawing of the active editor, or else of a workspace folder, the one that the
 * user picks when the workspace has several. The output goes to the output channel, the issues of
 * the check to the Problems view, and a build shows its progress in a notification whose button
 * Cancel stops it.
 */
export class DeckBuildFeature {
	public readonly dispose = Disposable.fn();
	/** The decks with a build or a check that runs, each with what runs. */
	private readonly busyDecks = new Map<string, string>();
	private readonly watches = new Map<string, DeckWatch>();
	private readonly problems: DiagnosticCollection;

	constructor(
		private readonly log: OutputChannel,
		private readonly extensionRoot: string
	) {
		this.problems = this.dispose.track(
			languages.createDiagnosticCollection("Draw.io Slides")
		);
		for (const build of buildCommands) {
			this.register(build.command, (target) => this.build(build, target));
		}
		this.register("drawioSlides.watchDeck", (target) => this.watch(target));
		this.register("drawioSlides.stopWatchingDeck", (deck) =>
			this.stopWatching(typeof deck === "string" ? deck : undefined)
		);
		this.register("drawioSlides.checkDeck", (target) => this.check(target));
		this.register("drawioSlides.outlineDeck", (target) =>
			this.showOutline(target)
		);
		this.register("drawioSlides.importColoursFromTex", (target) =>
			this.importColours(target)
		);
		this.register("drawioSlides.exportColoursToTex", (target) =>
			this.exportColours(target)
		);
		this.register("drawioSlides.installBrowser", () =>
			this.installBrowser()
		);
		this.dispose.track({
			dispose: () => {
				for (const watch of this.watches.values()) {
					watch.controller.abort();
					watch.statusBarItem.dispose();
				}
			},
		});
	}

	private register(
		command: string,
		run: (target: unknown) => Promise<void> | void
	): void {
		this.dispose.track(registerFailableCommand(command, run));
	}

	/** The options of a build of the deck, with the browser of the setting. */
	private buildOptions(
		deck: string,
		reporter: BuildReporter,
		signal: AbortSignal | undefined
	): DeckBuildOptions {
		const browserPath = workspace
			.getConfiguration(settingSection)
			.get<string>(browserPathSetting, "")
			.trim();
		return {
			project: deck,
			extensionRoot: this.extensionRoot,
			browser: browserPath === "" ? {} : { executablePath: browserPath },
			reporter,
			signal,
		};
	}

	/** A reporter that writes the lines and the warnings into the output channel, and counts the warnings. */
	private logReporter(
		progress?: Progress<{ message?: string }>
	): BuildReporter & { readonly warnings: () => number } {
		let warnings = 0;
		return {
			onLine: (line) => this.log.appendLine(line),
			onWarning: (warning) => {
				warnings += 1;
				this.log.appendLine(`warning: ${warning}`);
			},
			onFailure: (reason) =>
				this.log.appendLine(`build failed: ${reason}`),
			onProgress: (step) =>
				progress?.report({ message: progressText(step) }),
			warnings: () => warnings,
		};
	}

	/**
	 * The deck that a command runs on: the deck of the path that the command was given, such as a
	 * folder clicked in the Explorer, or else of the drawing of the active editor, or else a
	 * workspace folder. Undefined, after a message, when the workspace is untrusted, the user
	 * cancels the pick, or no folder is open.
	 */
	private async chooseDeck(
		target: unknown,
		title: string
	): Promise<string | undefined> {
		if (!workspace.isTrusted) {
			window.showErrorMessage(
				`${title} runs a browser on the files of the workspace and reads its settings, so the command runs only in a trusted workspace. Trust the workspace with the command Workspaces: Manage Workspace Trust, then run the command again.`
			);
			return undefined;
		}
		const given = target instanceof Uri ? target : activeDrawing();
		if (given !== undefined && given.scheme === "file") {
			const start = isFolder(given.fsPath)
				? given.fsPath
				: path.dirname(given.fsPath);
			const deck = deckFolderAbove(
				start,
				workspace.getWorkspaceFolder(given)?.uri.fsPath
			);
			if (deck !== undefined) {
				return deck;
			}
		}
		const folders = (workspace.workspaceFolders ?? []).filter(
			(folder) => folder.uri.scheme === "file"
		);
		if (folders.length === 0) {
			window.showErrorMessage(
				`${title} runs on the presentation of the drawing open in the editor, or else of a workspace folder, and no folder is open. Open the folder of a presentation with File > Open Folder…, and run the command again.`
			);
			return undefined;
		}
		if (folders.length === 1) {
			return folders[0].uri.fsPath;
		}
		const picked = await window.showWorkspaceFolderPick({
			placeHolder: `The workspace folder of the presentation, for ${title}`,
		});
		return picked?.uri.fsPath;
	}

	/** Whether the deck is free, after a message that names what runs on it when it is not. */
	private isFree(deck: string): boolean {
		const name = path.basename(deck);
		if (this.watches.has(deck)) {
			window.showWarningMessage(
				`${name} is watched, so the command leaves it to the watch. The command Stop Watching the Presentation stops the watch.`
			);
			return false;
		}
		const running = this.busyDecks.get(deck);
		if (running !== undefined) {
			window.showWarningMessage(
				`${name} has ${running} running. Run the command again after it.`
			);
			return false;
		}
		return true;
	}

	/**
	 * Runs a step on the deck with a notification of its progress whose button Cancel aborts the
	 * signal, and keeps other builds of the deck out while it runs.
	 */
	private async withProgress<T>(
		deck: string,
		running: string,
		title: string,
		run: (
			progress: Progress<{ message?: string }>,
			signal: AbortSignal
		) => Promise<T>
	): Promise<T> {
		this.busyDecks.set(deck, running);
		try {
			return await window.withProgress(
				{
					location: ProgressLocation.Notification,
					title,
					cancellable: true,
				},
				(progress, token: CancellationToken) => {
					const controller = new AbortController();
					token.onCancellationRequested(() => controller.abort());
					return run(progress, controller.signal);
				}
			);
		} finally {
			this.busyDecks.delete(deck);
		}
	}

	/**
	 * Says why a command stopped, and offers what helps: the installation of a browser, or the
	 * output. An error other than `DeckError` is reported in the same way, with its message.
	 */
	private showStop(action: string, error: unknown): void {
		if (error instanceof BuildCancelled) {
			this.log.appendLine(`${action}: ${error.message}`);
			window.showInformationMessage(`${action} was cancelled.`);
			return;
		}
		const reason = failureText(error);
		this.log.appendLine(`${action} stopped: ${reason}`);
		if (error instanceof BrowserNotFound) {
			window
				.showErrorMessage(
					`${action} stopped: ${error.message}`,
					installButton,
					browserSettingButton
				)
				.then((choice) => {
					if (choice === installButton) {
						this.installBrowser();
					} else if (choice === browserSettingButton) {
						commands.executeCommand(
							"workbench.action.openSettings",
							`${settingSection}.${browserPathSetting}`
						);
					}
				});
			return;
		}
		this.showErrorWithOutput(`${action} stopped: ${reason}`);
	}

	private showErrorWithOutput(message: string): void {
		window.showErrorMessage(message, showOutputButton).then((choice) => {
			if (choice === showOutputButton) {
				this.log.show();
			}
		});
	}

	private async build(build: BuildCommand, target: unknown): Promise<void> {
		const deck = await this.chooseDeck(target, build.title);
		if (deck === undefined || !this.isFree(deck)) {
			return;
		}
		const name = path.basename(deck);
		const action = `${build.title} on ${name}`;
		this.log.appendLine(`${build.title}: ${deck}`);
		let warnings = 0;
		let result: DeckBuildResult;
		try {
			result = await this.withProgress(
				deck,
				"a build",
				`${build.action} ${name}`,
				(progress, signal) => {
					const reporter = this.logReporter(progress);
					return build
						.run(this.buildOptions(deck, reporter, signal))
						.finally(() => (warnings = reporter.warnings()));
				}
			);
		} catch (error) {
			return this.showStop(action, error);
		}
		const written = [result.htmlFile, result.pdfFile].filter(
			(file): file is string => file !== undefined
		);
		const buttons = [
			...(result.htmlFile === undefined ? [] : [openHtmlButton]),
			...(result.pdfFile === undefined ? [] : [openPdfButton]),
			...(warnings > 0 ? [showOutputButton] : []),
		];
		const choice = await window.showInformationMessage(
			`${written
				.map((file) => path.relative(deck, file))
				.join(" and ")} of ${name} written${
				warnings > 0
					? `, with ${warnings} warning${
							warnings > 1 ? "s" : ""
					  } in the output`
					: ""
			}.`,
			...buttons
		);
		if (choice === openHtmlButton) {
			env.openExternal(Uri.file(result.htmlFile!));
		} else if (choice === openPdfButton) {
			env.openExternal(Uri.file(result.pdfFile!));
		} else if (choice === showOutputButton) {
			this.log.show();
		}
	}

	/**
	 * Starts a watch of the deck, which writes the HTML file again after every save until the
	 * command Stop Watching the Presentation, or a click on its item in the status bar, stops it.
	 */
	private async watch(target: unknown): Promise<void> {
		const title = "Watch the Presentation";
		const deck = await this.chooseDeck(target, title);
		if (deck === undefined || !this.isFree(deck)) {
			return;
		}
		const name = path.basename(deck);
		const statusBarItem = window.createStatusBarItem(
			StatusBarAlignment.Left
		);
		const watching = `$(eye) ${name}`;
		statusBarItem.text = watching;
		statusBarItem.tooltip = `Watching ${deck}: the HTML file is written again after every save. Click to stop the watch.`;
		statusBarItem.command = {
			title: "Stop Watching the Presentation",
			command: "drawioSlides.stopWatchingDeck",
			arguments: [deck],
		};
		statusBarItem.show();
		const controller = new AbortController();
		this.watches.set(deck, { controller, statusBarItem });
		this.log.appendLine(`${title}: ${deck}`);
		const reporter: BuildReporter = {
			...this.logReporter(),
			onProgress: (progress) => {
				statusBarItem.text =
					progress.step === BuildStep.HTML
						? watching
						: `$(sync~spin) ${name}: ${progressText(progress)}`;
			},
			onFailure: (reason) => {
				this.log.appendLine(`build failed: ${reason}`);
				statusBarItem.text = `$(warning) ${name}`;
				statusBarItem.tooltip = `Watching ${deck}: the last build failed: ${reason}. Click to stop the watch.`;
			},
		};
		watchDeck(this.buildOptions(deck, reporter, controller.signal))
			.catch((error) => this.showStop(`${title} on ${name}`, error))
			.finally(() => {
				statusBarItem.dispose();
				this.watches.delete(deck);
				this.log.appendLine(`${title}: ${deck} stopped`);
			});
		window.showInformationMessage(
			`Watching ${name}: the HTML file is written again after every save. A click on the item ${name} in the status bar stops the watch.`
		);
	}

	private async stopWatching(deck: string | undefined): Promise<void> {
		const decks = [...this.watches.keys()];
		const chosen =
			deck ??
			(decks.length <= 1
				? decks[0]
				: await window.showQuickPick(decks, {
						placeHolder: "The presentation whose watch stops",
				  }));
		if (chosen === undefined) {
			if (decks.length === 0) {
				window.showInformationMessage("No presentation is watched.");
			}
			return;
		}
		this.watches.get(chosen)?.controller.abort();
	}

	/** Checks the language of the deck, and puts each issue into the Problems view at its cell. */
	private async check(target: unknown): Promise<void> {
		const title = "Check the Spelling and Grammar of the Presentation";
		const deck = await this.chooseDeck(target, title);
		if (deck === undefined || !this.isFree(deck)) {
			return;
		}
		const name = path.basename(deck);
		this.log.appendLine(`${title}: ${deck}`);
		const issues = new Array<LanguageIssue>();
		let count: number;
		try {
			count = await this.withProgress(
				deck,
				"a check",
				`Checking the spelling and the grammar of ${name}`,
				(progress, signal) =>
					checkDeck(
						this.buildOptions(
							deck,
							{
								...this.logReporter(progress),
								onIssue: (issue) => issues.push(issue),
							},
							signal
						)
					)
			);
		} catch (error) {
			return this.showStop(`${title} on ${name}`, error);
		}
		this.showIssues(deck, issues);
		const choice = await window.showInformationMessage(
			count === 0
				? `The check found no issue in ${name}.`
				: `The check found ${count} issue${
						count > 1 ? "s" : ""
				  } in ${name}, in the Problems view.`,
			...(count === 0 ? [] : [showProblemsButton])
		);
		if (choice === showProblemsButton) {
			commands.executeCommand("workbench.actions.view.problems");
		}
	}

	/** Replaces the problems of the slide files of the deck by the issues, each at its cell. */
	private showIssues(deck: string, issues: readonly LanguageIssue[]): void {
		const ofDeck = new Array<Uri>();
		this.problems.forEach((uri) => {
			if (!path.relative(deck, uri.fsPath).startsWith("..")) {
				ofDeck.push(uri);
			}
		});
		ofDeck.forEach((uri) => this.problems.delete(uri));
		const byFile = new Map<string, Diagnostic[]>();
		const texts = new Map<string, string>();
		for (const issue of issues) {
			if (!texts.has(issue.file)) {
				texts.set(issue.file, fs.readFileSync(issue.file, "utf8"));
			}
			const place = cellPlace(
				texts.get(issue.file)!,
				issue.pagePosition,
				issue.cellId
			);
			const diagnostic = new Diagnostic(
				new Range(
					place.line,
					place.character,
					place.line,
					place.character + place.length
				),
				issueText(issue),
				DiagnosticSeverity.Warning
			);
			diagnostic.source = "LanguageTool";
			byFile.set(issue.file, [
				...(byFile.get(issue.file) ?? []),
				diagnostic,
			]);
		}
		for (const [file, diagnostics] of byFile) {
			this.problems.set(Uri.file(file), diagnostics);
		}
	}

	/** Writes the outline of the deck into the output channel, and shows the channel. */
	private async showOutline(target: unknown): Promise<void> {
		const title = "Show the Outline of the Presentation";
		const deck = await this.chooseDeck(target, title);
		if (deck === undefined) {
			return;
		}
		this.log.appendLine(`${title}: ${deck}`);
		this.log.show(true);
		try {
			reportDeckOutline(
				this.buildOptions(deck, this.logReporter(), undefined)
			);
		} catch (error) {
			this.showStop(`${title} of ${path.basename(deck)}`, error);
		}
	}

	/**
	 * Writes the colours of TeX files that the user chooses into `drawioSlides.colors` of the
	 * deck, after a confirmation, since the colours replace those of the setting.
	 */
	private async importColours(target: unknown): Promise<void> {
		const title = "Import Colours from TeX";
		const deck = await this.chooseDeck(target, title);
		if (deck === undefined) {
			return;
		}
		const files = await window.showOpenDialog({
			title: `${title}: the TeX files whose \\definecolor lines give the colours of ${path.basename(
				deck
			)}`,
			defaultUri: Uri.file(deck),
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: true,
			filters: { TeX: ["tex", "sty"] },
			openLabel: "Import Colours",
		});
		if (files === undefined || files.length === 0) {
			return;
		}
		const settings = settingsFile(deck);
		const open = workspace.textDocuments.find(
			(document) =>
				document.uri.scheme === "file" &&
				path.resolve(document.uri.fsPath) === settings
		);
		if (open?.isDirty) {
			window.showErrorMessage(
				`${settings} has unsaved changes, so ${title} leaves it as it is. Save or revert the file, then run the command again.`
			);
			return;
		}
		const paths = files.map((file) => file.fsPath);
		let count: number;
		try {
			count = coloursFromTex(paths).colours.members.length;
		} catch (error) {
			return this.showStop(title, error);
		}
		const answer = await window.showInformationMessage(
			`Replace the colours of ${COLOURS} in ${settings} with the ${count} colours of ${paths
				.map((file) => path.basename(file))
				.join(", ")}?`,
			{
				modal: true,
				detail: `The other settings of the file and its comments stay as they are.`,
			},
			importButton
		);
		if (answer !== importButton) {
			return;
		}
		try {
			const result = importColoursFromTex(deck, paths);
			this.log.appendLine(result.line);
			result.warnings.forEach((warning) =>
				this.log.appendLine(`warning: ${warning}`)
			);
			if (result.warnings.length > 0) {
				this.showErrorWithOutput(
					`${result.line}, with ${result.warnings.length} warnings in the output.`
				);
			} else {
				window.showInformationMessage(`${result.line}.`);
			}
		} catch (error) {
			this.showStop(title, error);
		}
	}

	/** Writes the colours of `drawioSlides.colors` of the deck into a TeX file that the user names. */
	private async exportColours(target: unknown): Promise<void> {
		const title = "Export Colours to TeX";
		const deck = await this.chooseDeck(target, title);
		if (deck === undefined) {
			return;
		}
		const file = await window.showSaveDialog({
			title: `${title}: the TeX file of the colours of ${path.basename(
				deck
			)}`,
			defaultUri: Uri.file(path.join(deck, "colours.tex")),
			filters: { TeX: ["tex"] },
			saveLabel: "Export Colours",
		});
		if (file === undefined) {
			return;
		}
		try {
			const result = exportColoursToTex(deck, file.fsPath);
			this.log.appendLine(result.line);
			const choice = await window.showInformationMessage(
				`${result.line}.`,
				openFileButton
			);
			if (choice === openFileButton) {
				window.showTextDocument(file);
			}
		} catch (error) {
			this.showStop(title, error);
		}
	}

	/**
	 * Installs the Chromium of the version of `playwright-core` of the extension into the cache of
	 * Playwright, where the build looks first, with the command line of Playwright, run by the
	 * Node.js of VS Code. The output goes to the output channel.
	 */
	private async installBrowser(): Promise<void> {
		const title = "Install Chromium for the Build";
		const cli = path.join(
			this.extensionRoot,
			"node_modules",
			"playwright-core",
			"cli.js"
		);
		const args = ["install", "chromium"];
		this.log.appendLine(`${title}: node ${cli} ${args.join(" ")}`);
		this.log.show(true);
		const status = await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: "Installing Chromium for the build",
				cancellable: true,
			},
			(_progress, token) =>
				new Promise<number | string>((resolve) => {
					const child = fork(cli, args, {
						silent: true,
						env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
					});
					child.stdout?.on("data", (data) =>
						this.log.append(String(data))
					);
					child.stderr?.on("data", (data) =>
						this.log.append(String(data))
					);
					token.onCancellationRequested(() => child.kill());
					child.on("error", (error) => resolve(error.message));
					child.on("exit", (code, signal) =>
						resolve(code ?? `stopped by ${signal}`)
					);
				})
		);
		if (status === 0) {
			window.showInformationMessage(
				"Chromium is installed for the build of the presentations."
			);
		} else {
			this.showErrorWithOutput(
				`${title} stopped: the installation ended with ${
					typeof status === "number"
						? `exit status ${status}`
						: status
				}.`
			);
		}
	}
}

/** The file of the active editor, a drawing in the editor of the extension or a text file. */
function activeDrawing(): Uri | undefined {
	const input = window.tabGroups.activeTabGroup.activeTab?.input;
	if (input instanceof TabInputCustom || input instanceof TabInputText) {
		return input.uri;
	}
	return window.activeTextEditor?.document.uri;
}

function isFolder(folder: string): boolean {
	return fs.existsSync(folder) && fs.statSync(folder).isDirectory();
}
